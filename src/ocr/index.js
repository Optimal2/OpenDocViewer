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
