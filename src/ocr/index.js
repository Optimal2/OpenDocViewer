// File: src/ocr/index.js
/**
 * Entry point of the OCR module: the one file the viewer imports, and only through
 * `src/utils/ocrLoader.js` with `import()` after `isOcrEnabled()` returned true. Code splitting
 * therefore places everything under src/ocr/, tesseract.js and the asset manifest in one lazy
 * chunk, `ocr-<hash>.js` (named after this folder), which scripts/verify-ocr-lazy-chunk.mjs
 * checks after every build. Nothing in this folder may be imported statically from outside it.
 */
export { createOcrEngine, classifyOcrStartupError, flattenOcrWords, OCR_STARTUP_FAILURE } from './engine.js';
export { readOcrAssetManifest, resolveOcrAssetUrls } from './assetUrls.js';
export { KNOWN_OCR_LANGUAGES, partitionOcrLanguages } from './languages.js';
export { createConfiguredOcrEngine, describeOcrSetup } from './setup.js';
export { OCR_PAGE_DECISION, OCR_SKIP_REASON, PDF_TEXT_LAYER_THRESHOLDS, assessPdfTextLayer, classifyPageSource } from './classify.js';
export { DEFAULT_OPEN_PDF_DOCUMENTS, createPdfTextProber } from './pdfTextProbe.js';
export { DEFAULT_OCR_CACHE_LIMIT, createOcrResultCache } from './resultCache.js';
export { OCR_WINDOW_AHEAD, OCR_WINDOW_BEHIND, maxOcrWindowSize, planOcrWindow } from './window.js';
export { OCR_PAGE_STATUS, createOcrQueue } from './queue.js';
