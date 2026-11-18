// File: src/utils/ocrLoader.js
/**
 * The only door into the OCR module.
 *
 * `loadOcrModule` resolves to null while neither `ocr.enabled` nor `pdfTextLayer.enabled` is
 * the literal true, without touching src/ocr/: the two `import()` calls below are the only
 * references to that folder from the rest of the application, so nothing of it is fetched on
 * the default code path.
 *
 * - With `ocr.enabled` on, the full module is imported (src/ocr/index.js): the OCR code,
 *   tesseract.js and, once a page is recognised, its worker, engine core and language models.
 * - With only `pdfTextLayer.enabled` on, the text-only entry is imported (src/ocr/pdfText.js):
 *   the page queue and the reader of a PDF page's own text. That entry holds no engine code, so
 *   tesseract.js is not downloaded at all, and no worker, WebAssembly or language file follows.
 *
 * Each entry is imported once and the same promise is returned to every caller.
 */
import { isOcrEnabled, isPdfTextLayerEnabled } from './runtimeConfig.js';

/** @type {(Promise<Object>|null)} The full module (OCR on). */
let modulePromise = null;
/** @type {(Promise<Object>|null)} The text-only entry (only a PDF page's own text). */
let textModulePromise = null;

/**
 * @param {Object=} cfg  Runtime config; omitted means the viewer's own.
 * @returns {Promise<(Object|null)>} The OCR module (src/ocr/index.js) while OCR is on, its
 *   text-only entry (src/ocr/pdfText.js) while only `pdfTextLayer.enabled` is, otherwise null.
 */
export function loadOcrModule(cfg) {
  const ocr = cfg === undefined ? isOcrEnabled() : isOcrEnabled(cfg);
  if (ocr) {
    if (!modulePromise) {
      modulePromise = import('../ocr/index.js').catch((error) => {
        modulePromise = null;
        throw error;
      });
    }
    return modulePromise;
  }
  const pdfText = cfg === undefined ? isPdfTextLayerEnabled() : isPdfTextLayerEnabled(cfg);
  if (!pdfText) return Promise.resolve(null);
  if (!textModulePromise) {
    textModulePromise = import('../ocr/pdfText.js').catch((error) => {
      textModulePromise = null;
      throw error;
    });
  }
  return textModulePromise;
}

/** True once the full module's import has been requested in this session. */
export function isOcrModuleRequested() {
  return modulePromise !== null;
}

/** True once the text-only entry's import has been requested in this session. */
export function isPdfTextModuleRequested() {
  return textModulePromise !== null;
}

/** Test hook: forget the cached imports so the next call imports again. */
export function resetOcrModuleForTests() {
  modulePromise = null;
  textModulePromise = null;
}
