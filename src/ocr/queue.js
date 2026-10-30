// File: src/ocr/queue.js
/**
 * The OCR page queue: one page at a time, bounded by the window (window.js), results in the
 * in-memory cache (resultCache.js).
 *
 * The queue holds the candidates the viewer last handed it (`setWindow`) and works through them in
 * that order on one engine: classify (classify.js), probe a PDF's text layer when it has one,
 * fetch the rendered page image, recognise. Replacing the window drops the pages that have not
 * started; the page in flight finishes and its outcome is kept, because a tesseract.js worker
 * cannot be interrupted short of terminating it (which would also discard the loaded models).
 * When a document leaves the viewer (`retainSources`) its outcomes are dropped and an in-flight
 * page of that document is abandoned by terminating the engine; the next page starts a fresh
 * worker. `setPaused(true)` lets the current page finish and starts nothing new (the viewer
 * pauses OCR while a print PDF is prepared and under hard memory pressure). Part of the lazy OCR
 * chunk.
 */
import { OCR_PAGE_DECISION, OCR_SKIP_REASON, classifyPageSource } from './classify.js';

/**
 * Upper bounds per step, so a promise that never settles (a pdf.js document that hangs, a page
 * image that never arrives, a worker that stops answering) fails the page instead of blocking
 * the queue for the rest of the session. Recognition of a large page at 300 dpi takes seconds;
 * the bound is far above that.
 */
export const OCR_STEP_TIMEOUTS_MS = Object.freeze({
  probe: 30000,
  image: 30000,
  recognize: 180000,
});

/** Marker on the error of a step that exceeded its bound. */
const TIMEOUT_STEP = Symbol('ocr-step-timeout');

/**
 * @param {Promise<*>} promise
 * @param {number} ms
 * @param {string} step
 * @returns {Promise<*>}
 */
function withTimeout(promise, ms, step) {
  if (!(ms > 0)) return promise;
  let timer;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`OCR ${step} exceeded ${ms} ms`);
      error[TIMEOUT_STEP] = step;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

export const OCR_PAGE_STATUS = Object.freeze({
  QUEUED: 'queued',
  PROBING: 'probing',
  RECOGNIZING: 'recognizing',
  DONE: 'done',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

/**
 * @typedef {Object} OcrQueueCandidate
 * @property {string} key  The page's OCR key (utils/ocrPageKey.js).
 * @property {string} sourceKey
 * @property {number} pageIndex  Index inside the source document.
 * @property {number} viewerIndex  Index into the viewer's page list.
 * @property {Object} page  The viewer page entry.
 */

/**
 * @typedef {Object} OcrQueueSnapshot
 * @property {Object<string, Object>} pages  Outcome or transient state per page key.
 * @property {(string|null)} engineFailure  OCR_STARTUP_FAILURE code once the engine cannot start.
 * @property {boolean} busy  True while a page is being probed or recognised.
 */

/**
 * @typedef {Object} OcrQueue
 * @property {function(Array<OcrQueueCandidate>): void} setWindow
 * @property {function(boolean): void} setPaused
 * @property {function(Set<string>): void} retainSources
 * @property {function(): OcrQueueSnapshot} getSnapshot
 * @property {function(): boolean} isBusy
 * @property {function(): Promise<boolean>} releaseEngineIfIdle  Terminates the engine when nothing runs.
 * @property {function(): void} dispose
 */

/**
 * @param {Object} options
 * @param {Object} options.engine  An OcrEngine (engine.js).
 * @param {Object} options.cache  An OcrResultCache (resultCache.js).
 * @param {function(string, number): Promise<Object>} options.probeTextLayer
 *   `(sourceKey, pageIndex)` to a PdfTextLayerAssessment (pdfTextProbe.js).
 * @param {function(OcrQueueCandidate): Promise<{ blob: Blob, width: number, height: number }>} options.getPageImage
 *   The rendered page image and its pixel size.
 * @param {function(Object): Object=} options.classify  Default classifyPageSource.
 * @param {Object=} options.log  Logger with `warn` and `debug`.
 * @param {function(OcrQueueSnapshot): void=} options.onChange  Called after every state change.
 * @param {function(): void=} options.onBusy  Called when a page starts.
 * @param {function(): void=} options.onIdle  Called when nothing is left to do.
 * @param {Object=} options.timeouts  Per-step bounds in ms (`probe`, `image`, `recognize`); default OCR_STEP_TIMEOUTS_MS.
 * @returns {OcrQueue}
 */
export function createOcrQueue({
  engine,
  cache,
  probeTextLayer,
  getPageImage,
  classify = classifyPageSource,
  log = console,
  onChange,
  onBusy,
  onIdle,
  timeouts = OCR_STEP_TIMEOUTS_MS,
}) {
  /** @type {Array<OcrQueueCandidate>} */
  let plan = [];
  /** @type {Map<string, { status: string, sourceKey: string }>} */
  const transient = new Map();
  /** @type {(Set<string>|null)} null until retainSources is called: every source is retained. */
  let retained = null;
  /** @type {({ key: string, sourceKey: string, abandoned: boolean }|null)} */
  let inFlight = null;
  let paused = false;
  let disposed = false;
  /** @type {(string|null)} */
  let engineFailure = null;

  const isRetained = (sourceKey) => retained === null || retained.has(sourceKey);

  function getSnapshot() {
    const pages = {};
    for (const [key, outcome] of cache.entries()) pages[key] = outcome;
    for (const [key, entry] of transient) pages[key] = { status: entry.status };
    return { pages, engineFailure, busy: inFlight !== null };
  }

  function notify() {
    if (disposed) return;
    try {
      onChange?.(getSnapshot());
    } catch (error) {
      log.warn?.('OCR queue listener failed', { error: String(error?.message || error) });
    }
  }

  function setTransient(key, sourceKey, status) {
    transient.set(key, { status, sourceKey });
    notify();
  }

  function pump() {
    if (disposed || paused || inFlight) return;
    if (engineFailure) {
      // Nothing more will run this session; let the owner release the prober and the worker.
      onIdle?.();
      return;
    }
    const candidate = plan.find((entry) => {
      if (cache.has(entry.key)) return false;
      const status = transient.get(entry.key)?.status;
      return status === undefined || status === OCR_PAGE_STATUS.QUEUED;
    });
    if (!candidate) {
      onIdle?.();
      return;
    }
    void run(candidate);
  }

  async function run(candidate) {
    const job = { key: candidate.key, sourceKey: candidate.sourceKey, abandoned: false };
    inFlight = job;
    onBusy?.();
    let outcome = null;
    try {
      const { decision, reason } = classify(candidate.page);
      if (decision === OCR_PAGE_DECISION.SKIP) {
        outcome = { status: OCR_PAGE_STATUS.SKIPPED, reason };
      } else {
        if (decision === OCR_PAGE_DECISION.PROBE_TEXT) {
          setTransient(job.key, job.sourceKey, OCR_PAGE_STATUS.PROBING);
          const assessment = await withTimeout(
            probeTextLayer(candidate.sourceKey, candidate.pageIndex), timeouts.probe, 'text-layer probe'
          );
          if (assessment?.usable) {
            outcome = { status: OCR_PAGE_STATUS.SKIPPED, reason: OCR_SKIP_REASON.TEXT_LAYER, assessment };
          }
        }
        if (!outcome && !job.abandoned) {
          setTransient(job.key, job.sourceKey, OCR_PAGE_STATUS.RECOGNIZING);
          const image = await withTimeout(getPageImage(candidate), timeouts.image, 'page image');
          const result = await withTimeout(engine.recognize(image.blob), timeouts.recognize, 'recognition');
          outcome = {
            status: OCR_PAGE_STATUS.DONE,
            text: result.text,
            confidence: result.confidence,
            words: result.words,
            imageWidth: Math.max(0, Number(image.width) || 0),
            imageHeight: Math.max(0, Number(image.height) || 0),
          };
        }
      }
    } catch (error) {
      const failure = typeof engine.getFailure === 'function' ? engine.getFailure() : null;
      if (failure) {
        // The engine cannot start in this session (CSP, missing files, timeout); engine.js has
        // logged the cause. Stop the queue instead of failing page after page.
        engineFailure = String(failure?.kind || failure);
        outcome = { status: OCR_PAGE_STATUS.FAILED, reason: `engine:${engineFailure}` };
      } else if (!job.abandoned) {
        const message = String(error?.message || error);
        log.warn?.('OCR of a page failed', { sourceKey: job.sourceKey, pageIndex: candidate.pageIndex, error: message });
        outcome = { status: OCR_PAGE_STATUS.FAILED, reason: message };
        if (error?.[TIMEOUT_STEP] === 'recognition') {
          // The worker stopped answering: drop it so the next page starts a fresh one.
          void engine.terminate();
        }
      }
    }
    inFlight = null;
    transient.delete(job.key);
    if (outcome && !job.abandoned && isRetained(job.sourceKey)) cache.set(job.key, job.sourceKey, outcome);
    notify();
    pump();
  }

  return {
    setWindow(candidates) {
      if (disposed) return;
      plan = (Array.isArray(candidates) ? candidates : []).filter((entry) => entry?.key && isRetained(entry.sourceKey));
      const keys = new Set(plan.map((entry) => entry.key));
      for (const [key, entry] of transient) {
        if (entry.status === OCR_PAGE_STATUS.QUEUED && !keys.has(key)) transient.delete(key);
      }
      for (const entry of plan) {
        if (!cache.has(entry.key) && !transient.has(entry.key)) {
          transient.set(entry.key, { status: OCR_PAGE_STATUS.QUEUED, sourceKey: entry.sourceKey });
        }
      }
      notify();
      pump();
    },
    setPaused(flag) {
      paused = Boolean(flag);
      if (!paused) pump();
    },
    retainSources(sourceKeys) {
      retained = new Set(sourceKeys);
      cache.retainSources(retained);
      for (const [key, entry] of transient) {
        if (!retained.has(entry.sourceKey)) transient.delete(key);
      }
      plan = plan.filter((entry) => retained.has(entry.sourceKey));
      if (inFlight && !retained.has(inFlight.sourceKey)) {
        inFlight.abandoned = true;
        void engine.terminate();
      }
      notify();
      pump();
    },
    getSnapshot,
    isBusy() {
      return inFlight !== null;
    },
    async releaseEngineIfIdle() {
      if (disposed || inFlight) return false;
      await engine.terminate();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      plan = [];
      transient.clear();
      if (inFlight) inFlight.abandoned = true;
      void engine.terminate();
    },
  };
}
