// File: src/ocr/pdfText.js
/**
 * Entry point of the text-only part of the OCR module: everything a page's text layer needs
 * when the text is a PDF page's own and nothing is recognised (`pdfTextLayer.enabled` with
 * `ocr.enabled` off). The page queue, its outcome cache, the window plan, the PDF text prober
 * and the language guess live here; the engine, its pool, the image preparation, the boost and
 * the benchmarks do not, and nothing reachable from this file imports tesseract.js or the
 * asset manifest.
 *
 * `src/utils/ocrLoader.js` imports this file with `import()` in that mode, so code splitting
 * gives it a chunk of its own (`pdfText-<hash>.js`). The full module (index.js) re-exports
 * everything here, so the two entries share that chunk and the engine stays in the `ocr` chunk,
 * which the text-only mode never requests (scripts/verify-ocr-lazy-chunk.mjs checks both after
 * every build). Nothing in this folder may be imported statically from outside it.
 */
export { OCR_PAGE_DECISION, OCR_SKIP_REASON, PDF_TEXT_LAYER_THRESHOLDS, assessPdfTextLayer, classifyPageSource } from './classify.js';
export { DEFAULT_OPEN_PDF_DOCUMENTS, createPdfTextProber } from './pdfTextProbe.js';
export { PDF_TEXT_DEFAULT_ASCENT, PDF_TEXT_DEFAULT_DESCENT, pdfTextLayerWords } from './pdfTextWords.js';
export { DEFAULT_OCR_CACHE_LIMIT, createOcrResultCache } from './resultCache.js';
export { OCR_WINDOW_AHEAD, OCR_WINDOW_BEHIND, maxOcrWindowSize, planOcrWindow } from './window.js';
export { OCR_OUTCOME_SOURCE, OCR_PAGE_STATUS, createOcrQueue } from './queue.js';
export { DETECTABLE_LANGUAGES, MIN_HITS, RUNNER_UP_RATIO, detectTextLanguage } from './detectLanguage.js';
