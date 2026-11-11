// File: src/ocr/imagePreparer.js
/**
 * Hands page images to the preparation worker (src/ocr/prepareWorker.js) and falls back
 * to the main thread where it cannot.
 *
 * Why a worker: the preparation (decode, canvas, ruling-line removal, PNG) ran on the main
 * thread, and every engine asked for it once per page. Measured on 2026-11-10 with the OCR
 * benchmark on three clients, the main thread's worst event-loop lag grew with the number of
 * engines (159 to 385 ms from two to four workers on a four-core client; 235 to 1581 ms from four
 * to 24 on a 24-thread client), and ruled table pages took up to seven seconds to prepare because
 * the removal's band yields were starved. Recognition itself always ran in the engines' own
 * workers; the preparation was the one piece of per-page work left on the thread that scrolls.
 *
 * One worker, created with the first page and terminated after `idleMs` without work (the
 * engines' idle shutdown in useOcrTextLayers.js is longer; the next page starts it again), so
 * a document that is done costs no thread. Requests may overlap; each is answered by its id.
 * Blobs cross the thread boundary by reference, so no pixels are copied on the way.
 *
 * Fallbacks, all to the main-thread copy of the same code (prepareImageCore.js), never to a
 * failed page:
 *  - no `Worker` in this browser, or the worker cannot be created: the main thread prepares;
 *  - the worker scope has no decoder or canvas (its first reply says `unsupported`): the
 *    worker is ended and the main thread prepares for the rest of the session;
 *  - the worker fails (an `error` event, a message that cannot be read): its pending requests
 *    are redone on the main thread, the worker is ended, and the next request starts a new one;
 *    after `maxFailures` such failures the main thread prepares for the rest of the session,
 *    with one warning;
 *  - the worker falls silent (no reply within `requestTimeoutMs`, which is under the queue's own
 *    bound on the page image, OCR_STEP_TIMEOUTS_MS.image in queue.js): treated as a failure of
 *    the worker, so the pages are redone on the main thread before the queue gives up on them.
 * A reply that says the image could not be decoded is passed on as the rejection it always was
 * (the page fails, see prepareImageCore.js); redoing it on the main thread would only fail again.
 *
 * Part of the lazy OCR chunk: this module, and so the worker file, are reached only after
 * `ocr.enabled` is the literal true. With the switch off no worker exists.
 */
import logger from '../logging/systemLogger.js';
import OcrPrepareWorker from './prepareWorker.js?worker';
import { prepareOcrImageCore } from './prepareImageCore.js';

/** Idle time after which the preparation worker is terminated (restarted by the next page). */
export const OCR_IMAGE_PREPARER_IDLE_MS = 20000;
/** Worker failures after which the session prepares on the main thread only. */
export const OCR_IMAGE_PREPARER_MAX_FAILURES = 2;
/**
 * Longest wait for one reply before the worker counts as failed. Under the queue's 30 s bound on
 * the page image, so a silent worker costs a main-thread retry, never a failed page. Far above
 * what a worker shared by every engine needs: a 20-million-pixel page takes about a second to
 * prepare, and no more than a few dozen requests can wait in line.
 */
export const OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS = 25000;

/**
 * @typedef {Object} OcrImagePreparer
 * @property {function(Blob, Object): Promise<Object>} prepare  `(blob, { removeRulingLines, fallbackSize, maxPixels })`
 *   resolving to a PreparedOcrImage (prepareImageCore.js).
 * @property {function(): void} dispose  Ends the worker; pending requests finish on the main thread.
 * @property {function(): { mode: ('worker'|'main'), workerAlive: boolean, pending: number, failures: number }} inspect
 */

/**
 * @param {Object=} options  Injectable for tests; the defaults are the real worker and timers.
 * @param {function(): Worker=} options.createWorker
 * @param {boolean=} options.workersSupported  Default: `typeof Worker === 'function'`.
 * @param {function(Blob, Object): Promise<Object>=} options.prepareOnMainThread  Default prepareOcrImageCore.
 * @param {number=} options.idleMs
 * @param {number=} options.maxFailures
 * @param {number=} options.requestTimeoutMs
 * @param {Object=} options.log  Logger with `debug` and `warn`.
 * @param {function(function(): void, number): *=} options.setTimer
 * @param {function(*): void=} options.clearTimer
 * @returns {OcrImagePreparer}
 */
export function createOcrImagePreparer({
  createWorker = () => new OcrPrepareWorker({ type: 'module', name: 'odv-ocr-prepare' }),
  workersSupported = typeof Worker === 'function',
  prepareOnMainThread = (blob, options) => prepareOcrImageCore(blob, options),
  idleMs = OCR_IMAGE_PREPARER_IDLE_MS,
  maxFailures = OCR_IMAGE_PREPARER_MAX_FAILURES,
  requestTimeoutMs = OCR_IMAGE_PREPARER_REQUEST_TIMEOUT_MS,
  log = logger,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  /** @type {(Worker|null)} */
  let worker = null;
  /** @type {Map<number, { resolve: function(Object): void, reject: function(*): void, blob: Blob, options: Object, timer: * }>} */
  const pending = new Map();
  let nextId = 1;
  let failures = 0;
  let mainOnly = !workersSupported;
  let idleTimer = null;
  let disposed = false;

  const onMainThread = (blob, options) => prepareOnMainThread(blob, { ...options, log });

  const clearIdle = () => {
    if (idleTimer !== null) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
  };

  const endWorker = () => {
    clearIdle();
    if (!worker) return;
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
  };

  const scheduleIdle = () => {
    clearIdle();
    if (!worker || pending.size > 0) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (pending.size === 0) endWorker();
    }, Math.max(0, Number(idleMs) || 0));
  };

  /** Take a request out of the map, its reply timer with it. */
  const takePending = (id) => {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    if (entry.timer !== null) clearTimer(entry.timer);
    return entry;
  };

  /** Finish every pending request on the main thread (the worker is gone or going). */
  const redoPendingOnMainThread = () => {
    const entries = [...pending.keys()].map(takePending);
    for (const entry of entries) {
      onMainThread(entry.blob, entry.options).then(entry.resolve, entry.reject);
    }
  };

  const failWorker = (reason, error) => {
    endWorker();
    failures += 1;
    const details = { error: String(error?.message || error || reason), failures };
    if (failures >= maxFailures && !mainOnly) {
      mainOnly = true;
      log.warn?.('OCR image preparation worker failed repeatedly; preparing on the main thread for the rest of the session', details);
    } else {
      log.warn?.(`OCR image preparation worker ${reason}; redoing its pages on the main thread`, details);
    }
    redoPendingOnMainThread();
  };

  const forwardLog = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (entry?.level === 'warn') log.warn?.(entry.message, entry.details);
      else log.debug?.(entry.message, entry.details);
    }
  };

  const onReply = (event) => {
    const reply = event?.data;
    if (!reply || reply.type !== 'prepared') return;
    // A reply from a worker already given up on (its pages were redone) finds no entry: ignored.
    const entry = takePending(reply.id);
    if (!entry) return;
    forwardLog(reply.log);
    if (reply.ok) {
      entry.resolve({
        blob: reply.blob,
        width: Math.max(0, Number(reply.width) || 0),
        height: Math.max(0, Number(reply.height) || 0),
        rulingLinePixels: Math.max(0, Number(reply.rulingLinePixels) || 0),
      });
    } else if (reply.unsupported) {
      // The worker scope cannot decode or draw: this browser's main thread may still do both.
      if (!mainOnly) {
        mainOnly = true;
        log.debug?.('OCR image preparation worker has no image decoder or canvas; preparing on the main thread');
      }
      endWorker();
      onMainThread(entry.blob, entry.options).then(entry.resolve, entry.reject);
      // The pages still pending in the ended worker would never be answered: redo them here too.
      redoPendingOnMainThread();
    } else {
      entry.reject(new Error(reply.error || 'OCR image preparation failed in the worker'));
    }
    scheduleIdle();
  };

  const ensureWorker = () => {
    if (worker) return worker;
    try {
      worker = createWorker();
    } catch (error) {
      worker = null;
      failWorker('could not be created', error);
      return null;
    }
    worker.onmessage = onReply;
    worker.onerror = (event) => failWorker('failed', event?.error || event?.message || event);
    worker.onmessageerror = (event) => failWorker('sent a message that could not be read', event?.data || event);
    return worker;
  };

  return {
    prepare(blob, options) {
      const request = {
        removeRulingLines: options?.removeRulingLines === true,
        fallbackSize: options?.fallbackSize || null,
        maxPixels: options?.maxPixels,
      };
      if (disposed || mainOnly) return onMainThread(blob, request);
      const target = ensureWorker();
      if (!target) return onMainThread(blob, request);
      clearIdle();
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, blob, options: request, timer: null };
        pending.set(id, entry);
        try {
          target.postMessage({ type: 'prepare', id, blob, ...request });
        } catch (error) {
          pending.delete(id);
          failWorker('refused the page image', error);
          onMainThread(blob, request).then(resolve, reject);
          return;
        }
        entry.timer = setTimer(() => {
          entry.timer = null;
          if (pending.get(id) !== entry) return;
          failWorker(`gave no reply within ${requestTimeoutMs} ms`, null);
        }, Math.max(0, Number(requestTimeoutMs) || 0));
      });
    },
    dispose() {
      // The pending pages finish on the main thread rather than failing: the caller that asked
      // for them may still want them (the benchmarks share this preparer with the viewer's
      // queue, and a disposed queue drops a late result on its own).
      disposed = true;
      endWorker();
      redoPendingOnMainThread();
    },
    inspect() {
      return { mode: mainOnly ? 'main' : 'worker', workerAlive: worker !== null, pending: pending.size, failures };
    },
  };
}

/** @type {(OcrImagePreparer|null)} */
let shared = null;

/** The viewer's one preparer, created on first use (prepareImage.js, the benchmarks). */
export function getOcrImagePreparer() {
  if (!shared) shared = createOcrImagePreparer();
  return shared;
}

/** End the shared preparer's worker (useOcrTextLayers.js on unmount); the next use makes a new one. */
export function disposeOcrImagePreparer() {
  if (!shared) return;
  const current = shared;
  shared = null;
  current.dispose();
}
