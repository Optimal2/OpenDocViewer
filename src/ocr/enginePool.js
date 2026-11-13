// File: src/ocr/enginePool.js
/**
 * A pool of OCR engines (engine.js) behind the one-engine interface the queue (queue.js) uses,
 * so that several pages (the worker count, see setup.js) can be recognised at the same time.
 *
 * Engines are created lazily, one per concurrent recognition up to `size`, and the first one is
 * started before any other: a start-up failure (a CSP without 'wasm-unsafe-eval', missing files)
 * is then found once, and the others can take the engine core and the language models from the
 * browser's HTTP cache instead of all fetching them at once (the shipped web.config serves the
 * ocr/ folder as immutable; a host that serves it no-store pays the download per worker). If the
 * first engine is dropped while it starts (its page was aborted), a page waiting for it waits for
 * the next first engine instead of failing. When no engine of the pool has ever started, a
 * start-up failure is the pool's: no further engine is created and every call rejects with it,
 * as a single engine does (the session cannot do OCR). Once an engine has started, the files and
 * the policy are known to be in order, and an engine that cannot start after that (a model that
 * did not arrive over a slow link, a start that timed out on a loaded machine, memory that ran
 * out for one more worker) is that engine's own trouble: it is dropped, its page is recognised
 * on another engine, and the pool carries on with the engines it has, creating no more than
 * those until it is resized or terminated (`capacity()` says how many). With no engine left
 * the page fails alone and the next page starts a fresh engine; when that has happened
 * OCR_ENGINE_BARREN_STARTS times in a row the engines cannot start any more (the server went
 * away, say), and the failure is the pool's after all, so the queue stops instead of failing
 * every page that is left. A recognition can be
 * aborted on its own: `recognize(image, control)` sets `control.abort` to a function that
 * terminates only the worker holding that page, which the pool replaces lazily, so the other
 * pages in flight are left alone (a single engine can only be terminated as a whole).
 * `terminate()` stops every worker; a caller waiting for a free engine is rejected then.
 * `resize(size)` changes the ceiling while the pool runs: a larger one lets more engines be
 * created as the queue asks for them, a smaller one terminates the idle engines above it at
 * once and each busy one as soon as its page is done, so no recognition is cut short (the
 * boost control grows and shrinks the pool this way).
 *
 * Part of the lazy OCR chunk.
 */

import logger from '../logging/systemLogger.js';

/**
 * Start-up failures in a row, each leaving the pool without an engine, after which a pool that
 * has worked gives OCR up for the session after all.
 */
export const OCR_ENGINE_BARREN_STARTS = 3;

/** Rejection for callers waiting on a free engine when the pool is terminated. */
const TERMINATED_MESSAGE = 'OCR engine was terminated';

/**
 * @typedef {Object} OcrEnginePool
 * @property {number} size  Most engines the pool creates (follows `resize`).
 * @property {function(number): void} resize  Change the ceiling: grow lazily, shrink as engines
 *   go idle; a value below one counts as one.
 * @property {function(): Promise<void>} ensureStarted  Start the first engine (loads core and models).
 * @property {function(*, Object=): Promise<{ text: string, confidence: number, words: Array<Object> }>} recognize
 *   Recognise one page image on a free engine; `control.abort`, when a control object is
 *   given, terminates that engine alone while the recognition runs.
 * @property {function(): Promise<void>} terminate  Stop every engine.
 * @property {function(): ({ kind: string, error: Error }|null)} getFailure  The start-up failure
 *   that keeps the pool from doing any OCR: an engine's, while no engine has ever started.
 * @property {function(): number} capacity  Pages the pool recognises at a time now: its size,
 *   or fewer while additional engines cannot start.
 * @property {function(): boolean} isStarted  True while at least one engine runs.
 * @property {function(): number} engineCount  Engines created so far (for diagnostics and tests).
 */

/**
 * @param {Object} options
 * @param {number} options.size  Engines at most; 1 or less behaves like one engine.
 * @param {function(): Object} options.createEngine  Makes one OcrEngine (engine.js).
 * @param {{ warn: Function }=} options.log  Logger (injectable for tests).
 * @returns {OcrEnginePool}
 */
export function createOcrEnginePool({ size, createEngine, log = logger }) {
  if (typeof createEngine !== 'function') throw new Error('OCR engine pool needs an engine factory');
  let limit = Math.max(1, Math.floor(Number(size)) || 1);
  // True once an engine of this pool has started: from then on an engine that cannot start is
  // dropped instead of ending OCR for the session. Kept across terminate(): the idle shutdown
  // stops the workers, not what the session has learnt.
  let everStarted = false;
  // Engines at most while additional engines cannot start: the ones the pool had when one
  // failed to (at least one). No bound otherwise; a new size or a terminate is a new attempt.
  let cap = Infinity;
  // Start-up failures in a row that left the pool without an engine, and the last of them:
  // at OCR_ENGINE_BARREN_STARTS the failure is the pool's. Any engine that works clears it.
  let barrenStarts = 0;
  /** @type {({ kind: string, error: Error }|null)} */
  let barrenFailure = null;
  /** @type {Array<{ engine: Object, busy: boolean }>} */
  let entries = [];
  /** @type {Array<{ resolve: function(Object): void, reject: function(Error): void }>} */
  let waiters = [];
  // Bumped by terminate(): an acquisition that began under an older generation is dropped.
  let generation = 0;

  const failureOf = (entry) => (typeof entry.engine.getFailure === 'function' ? entry.engine.getFailure() : null);

  /**
   * The failure that ends OCR for the session: an engine's, while none has ever started; or,
   * in a pool that has worked, the last of several in a row that each left it without an engine.
   */
  function firstFailure() {
    if (everStarted) return barrenStarts >= OCR_ENGINE_BARREN_STARTS ? barrenFailure : null;
    for (const entry of entries) {
      const failure = failureOf(entry);
      if (failure) return failure;
    }
    return null;
  }

  function createEntry() {
    const entry = { engine: createEngine(), busy: false };
    entries.push(entry);
    return entry;
  }

  /** A free entry now, a new one while under the limit, else null. */
  function takeIdle() {
    const idle = entries.find((entry) => !entry.busy);
    const entry = idle || (entries.length < Math.min(limit, cap) ? createEntry() : null);
    if (entry) entry.busy = true;
    return entry;
  }

  /**
   * @param {(Object|null)} control  The job's control object: while the job waits for an engine,
   *   `control.abort` takes it out of the line (the queue gave the page up), so no engine is
   *   later spent on a page nobody waits for.
   */
  function acquire(control) {
    const failure = firstFailure();
    if (failure) return Promise.reject(failure.error);
    const entry = takeIdle();
    if (entry) return Promise.resolve(entry);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiters.push(waiter);
      if (control && typeof control === 'object') {
        control.abort = () => {
          if (!waiters.includes(waiter)) return;
          waiters = waiters.filter((candidate) => candidate !== waiter);
          reject(new Error(TERMINATED_MESSAGE));
        };
      }
    });
  }

  /**
   * An engine could not start in a pool that has worked. It goes, and no more engines than the
   * pool is left with are created until the next resize or terminate (set before the drop,
   * which wakes the pages waiting: they must not be handed another start).
   */
  function dropUnstartable(entry) {
    const failure = failureOf(entry);
    cap = Math.max(1, entries.length - 1);
    drop(entry);
    if (entries.length === 0) {
      barrenStarts += 1;
      barrenFailure = failure;
    }
    log.warn?.(barrenStarts >= OCR_ENGINE_BARREN_STARTS
      ? 'No OCR engine can start any more; OCR stops for this session'
      : 'An OCR engine could not start; OCR carries on with the engines it has', {
      engines: entries.length,
      kind: String(failure?.kind || ''),
      error: String(failure?.error?.message || failure?.error || ''),
    });
  }

  function release(entry) {
    if (entries.length > limit && entries.includes(entry)) {
      // The pool was shrunk while this engine worked: its page is done, so it goes now.
      drop(entry);
      return;
    }
    entry.busy = false;
    wake();
  }

  /** Terminate idle engines above the ceiling, newest first; the busy ones go as they finish. */
  function shrink() {
    while (entries.length > limit) {
      const idle = [...entries].reverse().find((entry) => !entry.busy);
      if (!idle) return;
      drop(idle);
    }
  }

  function wake() {
    while (waiters.length > 0) {
      const entry = takeIdle();
      if (!entry) return;
      const waiter = waiters.shift();
      waiter.resolve(entry);
    }
  }

  /** Terminate one engine and forget it; the next acquisition creates a fresh one in its place. */
  function drop(entry) {
    entries = entries.filter((candidate) => candidate !== entry);
    Promise.resolve(entry.engine.terminate()).catch(() => {});
    wake();
  }

  async function ensureStarted() {
    const failure = firstFailure();
    if (failure) throw failure.error;
    const first = entries[0] || createEntry();
    try {
      await first.engine.ensureStarted();
      everStarted = true;
      barrenStarts = 0;
    } catch (error) {
      // A first engine that cannot start in a pool that has worked (started again after the
      // idle shutdown, say): gone, so the next call starts a fresh one instead of meeting the
      // same failure for good.
      if (everStarted && failureOf(first) && entries.includes(first)) dropUnstartable(first);
      throw error;
    }
  }

  return {
    get size() { return limit; },
    resize(nextSize) {
      limit = Math.max(1, Math.floor(Number(nextSize)) || 1);
      cap = Infinity;
      shrink();
      // Grown: waiters may now get an engine of their own.
      wake();
    },
    ensureStarted,
    async recognize(image, control = null) {
      const callGeneration = generation;
      // More than one turn only when the engine the page was given could not start while the
      // pool has others: the page then goes to one of those.
      for (let misses = 0; ; misses += 1) {
        const entry = await acquire(control);
        if (callGeneration !== generation) throw new Error(TERMINATED_MESSAGE);
        let dropped = false;
        if (control && typeof control === 'object') {
          control.abort = () => {
            if (dropped) return;
            dropped = true;
            drop(entry);
          };
        }
        try {
          if (entry !== entries[0]) {
            // The first engine starts alone; the others follow once it runs (or fail with it).
            for (let attempt = 0; ; attempt += 1) {
              try {
                await ensureStarted();
                break;
              } catch (error) {
                // The first engine was dropped while starting (its page was aborted, or it could
                // not start in a pool that has worked): that is not the pool's failure, so the
                // next first engine starts in its place and this page waits for it instead of
                // failing. A classified failure, a terminate or a drop of this entry ends the
                // wait; so does a third miss, which would mean something else.
                if (callGeneration !== generation || dropped || firstFailure() || attempt >= 2) throw error;
              }
            }
            if (callGeneration !== generation || dropped) throw new Error(TERMINATED_MESSAGE);
          }
          const result = await entry.engine.recognize(image);
          everStarted = true;
          barrenStarts = 0;
          return result;
        } catch (error) {
          // An engine that could not start, in a pool that has worked: its own trouble. The
          // page waits for one of the others; with none left, or after a third such engine, it
          // fails alone, and the next page starts a fresh engine.
          if (!everStarted || dropped || callGeneration !== generation || !failureOf(entry) || !entries.includes(entry)) throw error;
          dropped = true;
          dropUnstartable(entry);
          if (entries.length === 0 || misses >= 2) throw error;
        } finally {
          if (control && typeof control === 'object') control.abort = null;
          if (!dropped && callGeneration === generation) release(entry);
        }
      }
    },
    async terminate() {
      generation += 1;
      cap = Infinity;
      const stopping = entries;
      entries = [];
      const waiting = waiters;
      waiters = [];
      for (const waiter of waiting) waiter.reject(new Error(TERMINATED_MESSAGE));
      await Promise.all(stopping.map((entry) => Promise.resolve(entry.engine.terminate()).catch(() => {})));
    },
    getFailure: firstFailure,
    capacity: () => Math.min(limit, cap),
    isStarted: () => entries.some((entry) => typeof entry.engine.isStarted === 'function' && entry.engine.isStarted()),
    engineCount: () => entries.length,
  };
}
