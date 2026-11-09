// File: src/ocr/queue.js
/**
 * The OCR page queue: `concurrency` pages at a time (one by default), bounded by the window
 * (window.js), results in the in-memory cache (resultCache.js).
 *
 * The queue holds the candidates the viewer last handed it (`setWindow`) and works through them in
 * that order on one engine, or on an engine pool (enginePool.js) when more than one page runs at
 * a time: classify (classify.js), probe a PDF's text layer when it has one,
 * fetch the rendered page image, recognise. A PDF page whose own text layer is usable is done
 * without the engine: its outcome holds the layer's words (pdfTextProbe.js), marked with the
 * source `pdf-text`, in the same shape as recognised words, so the page is searchable like a
 * recognised one. Replacing the window drops the pages that have not
 * started; the pages in flight finish and their outcomes are kept, because a tesseract.js worker
 * cannot be interrupted short of terminating it (which would also discard the loaded models).
 * When a document leaves the viewer (`retainSources`) its outcomes are dropped and an in-flight
 * page of that document is abandoned by terminating its worker (on a pool, that worker alone;
 * a single engine as a whole); the next page starts a fresh one. `setPaused(true)` lets the
 * pages in flight finish and starts nothing new (the viewer pauses OCR while a print PDF is
 * prepared and under hard memory pressure). Part of the lazy OCR
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

/** Where a `done` outcome's words come from (`source`). */
export const OCR_OUTCOME_SOURCE = Object.freeze({
  /** The engine recognised the page image. */
  RECOGNITION: 'recognition',
  /** The PDF page's own text layer, read through pdf.js; the engine never ran. */
  PDF_TEXT: 'pdf-text',
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
 * @property {boolean} busy  True while at least one page is being probed or recognised.
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
 * @param {Object} options.engine  An OcrEngine (engine.js) or an OcrEnginePool (enginePool.js).
 *   A pool (recognised by its numeric `size`) takes a control object as the second argument of
 *   `recognize`, through which the queue aborts that one recognition.
 * @param {number=} options.concurrency  Pages in flight at most; default 1. More than one is
 *   only useful with a pool of at least that many engines.
 * @param {Object} options.cache  An OcrResultCache (resultCache.js).
 * @param {function(string, number): Promise<Object>} options.probeTextLayer
 *   `(sourceKey, pageIndex)` to a PdfTextLayerAssessment (pdfTextProbe.js).
 * @param {function(OcrQueueCandidate): Promise<{ blob: Blob, width: number, height: number, rulingLinePixels: (number|undefined) }>} options.getPageImage
 *   The image for the engine (the rendered page, or its line-free copy), its pixel size and
 *   how many pixels the ruling-line removal painted.
 * @param {function(Object): Object=} options.classify  Default classifyPageSource.
 * @param {function(Object): (string|null)=} options.detectLanguage  Given a `done` outcome,
 *   the ISO 639-1 language of its text or null when unsure (detectLanguage.js); the outcome
 *   then carries it as `language`. Absent: no guess.
 * @param {Object=} options.log  Logger with `warn` and `debug`.
 * @param {function(OcrQueueSnapshot): void=} options.onChange  Called after every state change.
 * @param {function(): void=} options.onBusy  Called when a page starts.
 * @param {function(): void=} options.onIdle  Called when nothing is left to do.
 * @param {Object=} options.timeouts  Per-step bounds in ms (`probe`, `image`, `recognize`); default OCR_STEP_TIMEOUTS_MS.
 * @returns {OcrQueue}
 */
export function createOcrQueue({
  engine,
  concurrency = 1,
  cache,
  probeTextLayer,
  getPageImage,
  classify = classifyPageSource,
  detectLanguage = null,
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
  /** @type {Map<string, { key: string, sourceKey: string, abandoned: boolean, control: { abort: (function(): void|null) } }>} */
  const inFlight = new Map();
  const limit = Math.max(1, Math.floor(Number(concurrency)) || 1);
  // A pool aborts one recognition through its control object; a single engine can only be
  // terminated as a whole (which is what happened before pools existed).
  const pooled = typeof engine?.size === 'number';
  let paused = false;
  let disposed = false;
  /** @type {(string|null)} */
  let engineFailure = null;

  const isRetained = (sourceKey) => retained === null || retained.has(sourceKey);

  function getSnapshot() {
    const pages = {};
    for (const [key, outcome] of cache.entries()) pages[key] = outcome;
    for (const [key, entry] of transient) pages[key] = { status: entry.status };
    return { pages, engineFailure, busy: inFlight.size > 0 };
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

  /** Abort one job's recognition: its worker on a pool, the engine as a whole otherwise. */
  function abortJob(job) {
    if (typeof job.control.abort === 'function') job.control.abort();
    else if (!pooled) void engine.terminate();
  }

  function nextCandidate() {
    return plan.find((entry) => {
      if (cache.has(entry.key) || inFlight.has(entry.key)) return false;
      const status = transient.get(entry.key)?.status;
      return status === undefined || status === OCR_PAGE_STATUS.QUEUED;
    });
  }

  function pump() {
    if (disposed || paused) return;
    if (engineFailure) {
      // Nothing more will run this session; let the owner release the prober and the worker.
      if (inFlight.size === 0) onIdle?.();
      return;
    }
    while (inFlight.size < limit) {
      const candidate = nextCandidate();
      if (!candidate) break;
      // run() is synchronous up to its first await, so the page is in flight (and, unless it is
      // skipped outright, marked probing or recognizing) before the next candidate is looked for.
      void run(candidate);
    }
    if (inFlight.size === 0 && !nextCandidate()) onIdle?.();
  }

  async function run(candidate) {
    const job = { key: candidate.key, sourceKey: candidate.sourceKey, abandoned: false, control: { abort: null } };
    inFlight.set(job.key, job);
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
            const words = Array.isArray(assessment.words) ? assessment.words : [];
            const pageWidth = Math.max(0, Number(assessment.pageWidth) || 0);
            const pageHeight = Math.max(0, Number(assessment.pageHeight) || 0);
            if (words.length > 0 && pageWidth > 0 && pageHeight > 0) {
              // The page's own text, in the shape of a recognised page: the text layer, the
              // search and read-aloud take it as they take recognised words.
              outcome = {
                status: OCR_PAGE_STATUS.DONE,
                source: OCR_OUTCOME_SOURCE.PDF_TEXT,
                text: String(assessment.text ?? ''),
                confidence: 100,
                words,
                imageWidth: pageWidth,
                imageHeight: pageHeight,
                rulingLinePixels: 0,
              };
            } else {
              // Usable text that cannot be placed (none of it upright, or no page size): the
              // viewer's own text stays, and the engine is not run over a text page.
              const { usable, verdict, characters, letters, privateUse } = assessment;
              outcome = {
                status: OCR_PAGE_STATUS.SKIPPED,
                reason: OCR_SKIP_REASON.TEXT_LAYER,
                assessment: { usable, verdict, characters, letters, privateUse },
              };
            }
          }
        }
        if (!outcome && !job.abandoned) {
          setTransient(job.key, job.sourceKey, OCR_PAGE_STATUS.RECOGNIZING);
          const image = await withTimeout(getPageImage(candidate), timeouts.image, 'page image');
          const result = await withTimeout(engine.recognize(image.blob, job.control), timeouts.recognize, 'recognition');
          outcome = {
            status: OCR_PAGE_STATUS.DONE,
            source: OCR_OUTCOME_SOURCE.RECOGNITION,
            text: result.text,
            confidence: result.confidence,
            words: result.words,
            imageWidth: Math.max(0, Number(image.width) || 0),
            imageHeight: Math.max(0, Number(image.height) || 0),
            // Pixels the ruling-line removal painted white on the engine's copy (0: none ran).
            rulingLinePixels: Math.max(0, Number(image.rulingLinePixels) || 0),
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
          abortJob(job);
        }
      }
    }
    if (outcome?.status === OCR_PAGE_STATUS.DONE && typeof detectLanguage === 'function') {
      // The text's language, for the read-aloud voice and the layer's `lang`; a guess that
      // fails leaves the outcome without one.
      try {
        const language = detectLanguage(outcome);
        if (typeof language === 'string' && language) outcome.language = language;
      } catch (error) {
        log.warn?.('OCR language guess failed', { sourceKey: job.sourceKey, error: String(error?.message || error) });
      }
    }
    inFlight.delete(job.key);
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
      for (const job of inFlight.values()) {
        if (retained.has(job.sourceKey) || job.abandoned) continue;
        job.abandoned = true;
        abortJob(job);
      }
      notify();
      pump();
    },
    getSnapshot,
    isBusy() {
      return inFlight.size > 0;
    },
    async releaseEngineIfIdle() {
      if (disposed || inFlight.size > 0) return false;
      await engine.terminate();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      plan = [];
      transient.clear();
      for (const job of inFlight.values()) job.abandoned = true;
      void engine.terminate();
    },
  };
}
