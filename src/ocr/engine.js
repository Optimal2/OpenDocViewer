// File: src/ocr/engine.js
/**
 * Thin wrapper around a tesseract.js worker.
 *
 * One engine owns one Web Worker. The worker is created on the first recognition, with the
 * worker script, engine core and language models served from the viewer's own `ocr/` folder (or
 * the site's `ocr.assetBaseUrl`), never from a CDN. `cacheMethod: 'none'` keeps tesseract.js from
 * writing the models to IndexedDB: the only cache is the browser's ordinary HTTP cache.
 *
 * Start-up failures need care, because tesseract.js 7.0.0's `createWorker` reports only some of
 * them: a `load` rejection settles its promise, but a missing language model only reaches the
 * optional `errorHandler`, and a WebAssembly compile refused by the site's Content-Security-Policy
 * aborts inside the worker without any message to the page. The engine therefore (1) probes
 * WebAssembly compilation on the main thread first, which yields the browser's own CSP error
 * at once, (2) passes an `errorHandler` so model and initialisation failures reject the start,
 * and (3) bounds the start with a timeout as the last resort. A failure is classified so the
 * caller can tell a policy that lacks `'wasm-unsafe-eval'` from missing files, and it is final:
 * every later call rejects with the same error and no second worker is started, so a
 * misconfigured site pays for one attempt per session.
 *
 * The worker is created with Tesseract's page segmentation mode set to automatic layout analysis
 * (`OCR_PAGE_SEGMENTATION_MODE`), through the `config` argument of `createWorker`, which
 * tesseract.js writes to the worker's Tesseract configuration before `Init`. The Tesseract API
 * defaults to "a single uniform block of text" (mode 6), which reads a page with a short text
 * line beside a large graphic, or with columns, as one block and returns fragments; the
 * automatic mode finds the text regions first. Mode 1 (automatic with orientation and script
 * detection) is not used: it needs the `osd` model, which the viewer does not ship. The value is
 * a fixed constant Tesseract accepts; tesseract.js does not report a rejected variable, so the
 * engine cannot detect one and does not try to.
 *
 * Part of the lazy OCR chunk: nothing here is imported while `ocr.enabled` is off.
 */
import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js';
import logger from '../logging/systemLogger.js';

/** Why the engine could not start (see classifyOcrStartupError). */
export const OCR_STARTUP_FAILURE = Object.freeze({
  /** WebAssembly compilation refused: the site CSP lacks 'wasm-unsafe-eval' in script-src. */
  CSP: 'csp',
  /** The worker script, engine core or a language model could not be loaded. */
  ASSETS: 'assets',
  /** The worker gave no answer within the start timeout. */
  TIMEOUT: 'timeout',
  /** Anything else. */
  UNKNOWN: 'unknown',
});

/** Default bound on worker start-up (core and models are a few MB; a stalled start stays silent otherwise). */
export const DEFAULT_OCR_START_TIMEOUT_MS = 60000;

/**
 * Tesseract page segmentation mode every worker starts with: 3 = fully automatic page
 * segmentation without orientation and script detection (the mode the `tesseract` command line
 * uses). The API default, 6, treats the whole page as one text block. Kept as a string because
 * that is how tesseract.js writes `tessedit_pageseg_mode` to the worker's configuration.
 */
export const OCR_PAGE_SEGMENTATION_MODE = '3';

// Chromium phrases the refusal as "'unsafe-eval' is not an allowed source of script" even though
// 'wasm-unsafe-eval' alone is enough to allow it; Firefox names 'wasm-unsafe-eval'. Both match.
const CSP_PATTERN = /wasm-unsafe-eval|unsafe-eval|content.security.policy|refused to compile|compileerror/i;
const ASSETS_PATTERN = /failed to load tesseractcore|importscripts|traineddata|network|fetch|404|failed to load/i;
const TIMEOUT_PATTERN = /did not start within/i;

/** The smallest valid WebAssembly module: magic number and version, nothing else. */
const EMPTY_WASM_MODULE = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/**
 * Throw the browser's own error when WebAssembly modules cannot be compiled on this page, which
 * under a Content-Security-Policy without 'wasm-unsafe-eval' is a CompileError that names the
 * missing token. Returns normally when compilation is allowed.
 */
export function probeWebAssemblyCompilation() {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is not available in this browser');
  // Synchronous on purpose: the module is 8 bytes, and a thrown CompileError is the signal.
  new WebAssembly.Module(EMPTY_WASM_MODULE);
}

/**
 * Classify a start-up error by its message.
 *
 * @param {*} error
 * @returns {string} One of OCR_STARTUP_FAILURE.
 */
export function classifyOcrStartupError(error) {
  const text = String(error?.message ?? error ?? '');
  if (CSP_PATTERN.test(text)) return OCR_STARTUP_FAILURE.CSP;
  if (TIMEOUT_PATTERN.test(text)) return OCR_STARTUP_FAILURE.TIMEOUT;
  if (ASSETS_PATTERN.test(text)) return OCR_STARTUP_FAILURE.ASSETS;
  return OCR_STARTUP_FAILURE.UNKNOWN;
}

/**
 * Flatten tesseract.js' block tree into one word list with page-pixel boxes.
 *
 * @param {Object} data tesseract.js recognition result (`data` with `blocks`).
 * @returns {Array<{ text: string, confidence: number, bbox: { x0: number, y0: number, x1: number, y1: number } }>}
 */
export function flattenOcrWords(data) {
  const words = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        for (const word of line?.words || []) {
          const text = String(word?.text ?? '').trim();
          if (!text || !word?.bbox) continue;
          words.push({
            text,
            confidence: Number(word.confidence) || 0,
            bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
          });
        }
      }
    }
  }
  return words;
}

/** @param {*} reason @returns {Error} */
function toError(reason) {
  return reason instanceof Error ? reason : new Error(String(reason?.message ?? reason ?? 'unknown error'));
}

/**
 * @typedef {Object} OcrEngine
 * @property {function(): Promise<void>} ensureStarted  Create the worker if needed (loads core and models).
 * @property {function(*): Promise<{ text: string, confidence: number, words: Array<Object> }>} recognize
 *   Recognize one page image (anything tesseract.js accepts: canvas, Blob, ImageData, URL).
 *   Rejects with "terminated" when terminate() is called while it runs or before it starts.
 * @property {function(): Promise<void>} terminate  Stop the worker and release its WebAssembly memory.
 * @property {function(): ({ kind: string, error: Error }|null)} getFailure  The start-up failure, if any.
 * @property {function(): boolean} isStarted  True while a worker is running.
 */

/**
 * Create an engine for the given languages and asset URLs. Nothing is loaded until the first
 * `ensureStarted` or `recognize` call.
 *
 * @param {Object} options
 * @param {Array<string>} options.languages  Tesseract language codes, model order.
 * @param {{ workerPath: string, corePath: string, langPath: string }} options.assetUrls
 * @param {Function=} options.createWorker  tesseract.js createWorker (injectable for tests).
 * @param {Function=} options.probeWebAssembly  Main-thread WebAssembly probe (injectable for tests).
 * @param {number=} options.startTimeoutMs  Bound on worker start-up (default 60 s).
 * @param {{ error: Function, debug: Function }=} options.log  Logger (injectable for tests).
 * @returns {OcrEngine}
 */
export function createOcrEngine({
  languages,
  assetUrls,
  createWorker = Tesseract.createWorker,
  probeWebAssembly = probeWebAssemblyCompilation,
  startTimeoutMs = DEFAULT_OCR_START_TIMEOUT_MS,
  log = logger,
}) {
  if (!Array.isArray(languages) || !languages.length) throw new Error('OCR engine needs at least one language');
  if (!assetUrls?.workerPath || !assetUrls?.corePath || !assetUrls?.langPath) throw new Error('OCR engine needs worker, core and language URLs');

  // Snapshot the inputs: the worker starts later, and the caller's arrays must not change it.
  const languageList = Object.freeze([...languages]);
  const urls = Object.freeze({ workerPath: assetUrls.workerPath, corePath: assetUrls.corePath, langPath: assetUrls.langPath });

  /** @type {(Promise<Object>|null)} */
  let workerPromise = null;
  /** @type {({ kind: string, error: Error }|null)} */
  let failure = null;
  let started = false;
  // Bumped by terminate(): calls that began under an older generation reject instead of
  // touching a worker that is gone, and in-flight recognitions are released.
  let generation = 0;
  /** @type {Array<function(Error): void>} */
  let releaseInFlight = [];

  function startWorker() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn) => (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(value);
      };
      const succeed = finish(resolve);
      const fail = finish((reason) => reject(toError(reason)));

      try {
        probeWebAssembly();
      } catch (error) {
        fail(error);
        return;
      }

      timer = setTimeout(() => fail(new Error(`OCR worker did not start within ${startTimeoutMs} ms`)), startTimeoutMs);

      let creation;
      try {
        creation = Promise.resolve(createWorker([...languageList], Tesseract.OEM.LSTM_ONLY, {
          workerPath: urls.workerPath,
          corePath: urls.corePath,
          langPath: urls.langPath,
          gzip: true,
          cacheMethod: 'none',
          workerBlobURL: true,
          logger: () => {},
          // tesseract.js only settles createWorker for `load` failures; model and initialisation
          // failures arrive here (and would otherwise be thrown unhandled from worker.onmessage).
          errorHandler: fail,
        }, { tessedit_pageseg_mode: OCR_PAGE_SEGMENTATION_MODE }));
      } catch (error) {
        fail(error);
        return;
      }
      creation.then((worker) => {
        if (settled) {
          // Arrived after the timeout: do not leave a worker with megabytes of memory behind.
          Promise.resolve(worker?.terminate?.()).catch(() => {});
          return;
        }
        succeed(worker);
      }, fail);
    });
  }

  async function ensureStarted() {
    if (failure) throw failure.error;
    if (!workerPromise) {
      const startGeneration = generation;
      workerPromise = startWorker().then((worker) => {
        if (startGeneration !== generation) {
          Promise.resolve(worker?.terminate?.()).catch(() => {});
          throw new Error('OCR engine was terminated during start');
        }
        started = true;
        return worker;
      }).catch((error) => {
        if (startGeneration !== generation) throw error;
        failure = { kind: classifyOcrStartupError(error), error };
        workerPromise = null;
        log.error('OCR engine could not start; OCR stays off for this session', {
          kind: failure.kind,
          languages: [...languageList],
          hint: failure.kind === OCR_STARTUP_FAILURE.CSP
            ? "add 'wasm-unsafe-eval' to the script-src of the site Content-Security-Policy"
            : failure.kind === OCR_STARTUP_FAILURE.UNKNOWN
              ? 'the error is not a policy, file or timeout failure; see its message'
              : `check that ${urls.workerPath}, ${urls.corePath} and ${urls.langPath}/<lang>.traineddata.gz are served`,
          error: String(error?.message || error),
        });
        throw error;
      });
    }
    await workerPromise;
  }

  return {
    ensureStarted,
    async recognize(image) {
      const callGeneration = generation;
      await ensureStarted();
      const pending = workerPromise;
      if (callGeneration !== generation || !pending) throw new Error('OCR engine was terminated');
      const worker = await pending;
      // tesseract.js never settles a job that was in flight when the worker is terminated, so
      // terminate() releases it here instead of leaving the caller waiting.
      let release = null;
      const released = new Promise((_resolve, reject) => { release = reject; releaseInFlight.push(reject); });
      try {
        const { data } = await Promise.race([worker.recognize(image, {}, { text: true, blocks: true }), released]);
        return { text: String(data?.text ?? ''), confidence: Number(data?.confidence) || 0, words: flattenOcrWords(data) };
      } finally {
        releaseInFlight = releaseInFlight.filter((entry) => entry !== release);
      }
    },
    async terminate() {
      generation += 1;
      const pending = workerPromise;
      const wasStarted = started;
      workerPromise = null;
      started = false;
      const waiting = releaseInFlight;
      releaseInFlight = [];
      for (const reject of waiting) reject(new Error('OCR engine was terminated'));
      if (!pending) return;
      if (!wasStarted) {
        // Still starting: the generation check in ensureStarted terminates the worker when (if)
        // it arrives. Waiting here would block the caller for as long as the start takes.
        pending.catch(() => {});
        return;
      }
      try {
        const worker = await pending;
        await worker.terminate();
      } catch (error) {
        log.debug('OCR worker terminate after a failed start', { error: String(error?.message || error) });
      }
    },
    getFailure: () => failure,
    isStarted: () => started && workerPromise !== null,
  };
}
