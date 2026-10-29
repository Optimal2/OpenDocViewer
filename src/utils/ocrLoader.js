// File: src/utils/ocrLoader.js
/**
 * The only door into the OCR module.
 *
 * `loadOcrModule` resolves to null while `ocr.enabled` is not the literal true, without touching
 * src/ocr/: the `import()` below is the single reference to that folder from the rest of the
 * application, so the OCR code, tesseract.js and its worker, engine core and language models are
 * never fetched on the default code path. When the switch is on the module is imported once and
 * the same promise is returned to every caller.
 */
import { isOcrEnabled } from './runtimeConfig.js';

/** @type {(Promise<Object>|null)} */
let modulePromise = null;

/**
 * @param {Object=} cfg  Runtime config; omitted means the viewer's own.
 * @returns {Promise<(Object|null)>} The OCR module (src/ocr/index.js) or null while OCR is off.
 */
export function loadOcrModule(cfg) {
  const enabled = cfg === undefined ? isOcrEnabled() : isOcrEnabled(cfg);
  if (!enabled) return Promise.resolve(null);
  if (!modulePromise) {
    modulePromise = import('../ocr/index.js').catch((error) => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

/** True once the module import has been requested in this session. */
export function isOcrModuleRequested() {
  return modulePromise !== null;
}

/** Test hook: forget the cached import so the next call imports again. */
export function resetOcrModuleForTests() {
  modulePromise = null;
}
