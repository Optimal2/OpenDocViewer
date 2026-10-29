// File: src/ocr/engine.js
/**
 * Thin wrapper around a tesseract.js worker.
 *
 * One engine owns one Web Worker. The worker is created on the first recognition, with the
 * worker script, engine core and language models served from the viewer's own `ocr/` folder (or
 * the site's `ocr.assetBaseUrl`), never from a CDN. `cacheMethod: 'none'` keeps tesseract.js from
 * writing the models to IndexedDB: the only cache is the browser's ordinary HTTP cache.
 *
 * A start-up failure is classified so the caller can tell a Content-Security-Policy that blocks
 * WebAssembly (`'wasm-unsafe-eval'` missing from script-src) from missing files. After a failure
 * the engine stays off: every later call rejects with the same error and no second worker is
 * started, so a misconfigured site pays for one attempt per session.
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
  /** Anything else. */
  UNKNOWN: 'unknown',
});

const CSP_PATTERN = /wasm-unsafe-eval|unsafe-eval|content.security.policy|refused to compile|compileerror/i;
const ASSETS_PATTERN = /failed to load tesseractcore|importscripts|traineddata|network|fetch|404|failed to load/i;

/**
 * Classify a start-up error by its message. Chromium reports a CSP block as a `CompileError`
 * whose message names `'wasm-unsafe-eval'`; tesseract.js reports a missing core as
 * "Failed to load TesseractCore" and a missing model by its `.traineddata` name.
 *
 * @param {*} error
 * @returns {string} One of OCR_STARTUP_FAILURE.
 */
export function classifyOcrStartupError(error) {
  const text = String(error?.message ?? error ?? '');
  if (CSP_PATTERN.test(text)) return OCR_STARTUP_FAILURE.CSP;
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

/**
 * @typedef {Object} OcrEngine
 * @property {function(): Promise<void>} ensureStarted  Create the worker if needed (loads core and models).
 * @property {function(*): Promise<{ text: string, confidence: number, words: Array<Object> }>} recognize
 *   Recognize one page image (anything tesseract.js accepts: canvas, Blob, ImageData, URL).
 * @property {function(): Promise<void>} terminate  Stop the worker and release its WebAssembly memory.
 * @property {function(): ({ kind: string, error: * }|null)} getFailure  The start-up failure, if any.
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
 * @param {{ error: Function, debug: Function }=} options.log  Logger (injectable for tests).
 * @returns {OcrEngine}
 */
export function createOcrEngine({ languages, assetUrls, createWorker = Tesseract.createWorker, log = logger }) {
  if (!Array.isArray(languages) || !languages.length) throw new Error('OCR engine needs at least one language');
  if (!assetUrls?.workerPath || !assetUrls?.corePath || !assetUrls?.langPath) throw new Error('OCR engine needs worker, core and language URLs');

  // Snapshot the inputs: the worker starts later, and the caller's arrays must not change it.
  const languageList = Object.freeze([...languages]);
  const urls = Object.freeze({ workerPath: assetUrls.workerPath, corePath: assetUrls.corePath, langPath: assetUrls.langPath });

  /** @type {(Promise<Object>|null)} */
  let workerPromise = null;
  /** @type {({ kind: string, error: * }|null)} */
  let failure = null;
  let started = false;

  async function start() {
    const worker = await createWorker([...languageList], Tesseract.OEM.LSTM_ONLY, {
      workerPath: urls.workerPath,
      corePath: urls.corePath,
      langPath: urls.langPath,
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: true,
      logger: () => {},
    });
    started = true;
    return worker;
  }

  async function ensureStarted() {
    if (failure) throw failure.error;
    if (!workerPromise) {
      workerPromise = start().catch((error) => {
        failure = { kind: classifyOcrStartupError(error), error };
        workerPromise = null;
        log.error('OCR engine could not start; OCR stays off for this session', {
          kind: failure.kind,
          languages: [...languageList],
          hint: failure.kind === OCR_STARTUP_FAILURE.CSP
            ? "add 'wasm-unsafe-eval' to the script-src of the site Content-Security-Policy"
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
      await ensureStarted();
      const worker = await workerPromise;
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      return { text: String(data?.text ?? ''), confidence: Number(data?.confidence) || 0, words: flattenOcrWords(data) };
    },
    async terminate() {
      const pending = workerPromise;
      workerPromise = null;
      started = false;
      if (!pending) return;
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
