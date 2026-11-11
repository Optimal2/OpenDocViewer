// File: src/ocr/index.js
/**
 * Entry point of the OCR module: the one file the viewer imports, and only through
 * `src/utils/ocrLoader.js` with `import()` after `isOcrEnabled()` returned true. Code splitting
 * therefore places everything under src/ocr/, tesseract.js and the asset manifest in one lazy
 * chunk, `ocr-<hash>.js` (named after this folder), which scripts/verify-ocr-lazy-chunk.mjs
 * checks after every build. Nothing in this folder may be imported statically from outside it.
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
export { OCR_PAGE_DECISION, OCR_SKIP_REASON, PDF_TEXT_LAYER_THRESHOLDS, assessPdfTextLayer, classifyPageSource } from './classify.js';
export { DEFAULT_OPEN_PDF_DOCUMENTS, createPdfTextProber } from './pdfTextProbe.js';
export { PDF_TEXT_DEFAULT_ASCENT, PDF_TEXT_DEFAULT_DESCENT, pdfTextLayerWords } from './pdfTextWords.js';
export { DEFAULT_OCR_CACHE_LIMIT, createOcrResultCache } from './resultCache.js';
export { OCR_WINDOW_AHEAD, OCR_WINDOW_BEHIND, maxOcrWindowSize, planOcrWindow } from './window.js';
export { OCR_OUTCOME_SOURCE, OCR_PAGE_STATUS, createOcrQueue } from './queue.js';
export { DETECTABLE_LANGUAGES, MIN_HITS, RUNNER_UP_RATIO, detectTextLanguage } from './detectLanguage.js';
export { RULING_LINE_DILATE_PX, createEventLoopYield, removeRulingLines, removeRulingLinesAsync, rulingLineMinRunPx } from './lineRemoval.js';
export { OCR_LINE_REMOVAL_MAX_PIXELS, prepareOcrImage } from './prepareImage.js';
export { canPrepareImagesHere, prepareOcrImageCore } from './prepareImageCore.js';
export {
  OCR_IMAGE_PREPARER_IDLE_MS, OCR_IMAGE_PREPARER_MAX_FAILURES, createOcrImagePreparer, disposeOcrImagePreparer, getOcrImagePreparer,
} from './imagePreparer.js';
export { DEFAULT_OCR_BOOST_SLOWDOWN_FRACTION, OCR_BOOST_STATE, OCR_BOOST_STEPS, createOcrBoostController, planOcrBoostLevels } from './boost.js';
export { OCR_REFERENCE_PAGE_LINES, OCR_REFERENCE_PAGE_SIZE, createOcrReferencePage } from './referencePage.js';
