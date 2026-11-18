// File: src/ocr/index.js
/**
 * Entry point of the OCR module: the file the viewer imports while OCR is on, and only through
 * `src/utils/ocrLoader.js` with `import()` after `isOcrEnabled()` returned true. Code splitting
 * therefore places the engine side of src/ocr/, tesseract.js and the asset manifest in one lazy
 * chunk, `ocr-<hash>.js` (named after this folder), which scripts/verify-ocr-lazy-chunk.mjs
 * checks after every build. The text-only part has an entry and a chunk of its own
 * (pdfText.js), which this file re-exports. Nothing in this folder may be imported statically
 * from outside it.
 */
export { createOcrEngine, classifyOcrStartupError, flattenOcrWords, OCR_STARTUP_FAILURE } from './engine.js';
export { createOcrEnginePool } from './enginePool.js';
export {
  OCR_BENCHMARK_DEFAULTS, OCR_BENCHMARK_SCHEMA, downscaleOcrImage, expandOcrBenchmarkWorkerCounts, normalizeOcrBenchmarkConfig,
  planOcrBenchmarkScenarios, resolveOcrBenchmarkLanguages, runOcrBenchmark, selectOcrBenchmarkPages, startMainThreadLagSampler,
  summarizeDurations,
} from './benchmark.js';
// The boost benchmark (worker counts above MAX_OCR_WORKER_COUNT, measurement only) is deliberately
// not re-exported: it stays its own chunk, loaded when About -> Diagnostics asks for it.
export const loadOcrBoostBenchmark = () => import('./boostBenchmark.js');
export { readOcrAssetManifest, resolveOcrAssetUrls } from './assetUrls.js';
export { KNOWN_OCR_LANGUAGES, partitionOcrLanguages } from './languages.js';
export { createConfiguredOcrEngine, describeOcrSetup, resolveOcrConcurrency } from './setup.js';
// The text-only part (the queue, its cache, the window plan, the PDF text prober, the language
// guess): one entry of its own, src/ocr/pdfText.js, which the viewer loads alone when only a PDF
// page's own text is read (`pdfTextLayer.enabled` with OCR off).
export * from './pdfText.js';
export { RULING_LINE_DILATE_PX, createEventLoopYield, removeRulingLines, removeRulingLinesAsync, rulingLineMinRunPx } from './lineRemoval.js';
export { OCR_LINE_REMOVAL_MAX_PIXELS, prepareOcrImage } from './prepareImage.js';
export { canPrepareImagesHere, prepareOcrImageCore } from './prepareImageCore.js';
export {
  OCR_IMAGE_PREPARER_IDLE_MS, OCR_IMAGE_PREPARER_MAX_FAILURES, createOcrImagePreparer, disposeOcrImagePreparer, getOcrImagePreparer,
} from './imagePreparer.js';
export { DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION, OCR_BOOST_STATE, OCR_BOOST_STEPS, OCR_BOOST_STOP, createOcrBoostController, planOcrBoostLevels } from './boost.js';
export { OCR_REFERENCE_PAGE_LINES, OCR_REFERENCE_PAGE_SIZE, createOcrReferencePage } from './referencePage.js';
