// File: src/ocr/setup.js
/**
 * Builds an OCR engine from the runtime configuration and reports configuration problems once.
 *
 * The runtimeConfig accessors are side-effect free, so this is where their diagnostics become
 * log lines: a `languages` value that fell back to the default (neither a preset name nor an
 * array, or an array without a usable code), codes that were dropped (bad form or no known
 * model) and an `assetBaseUrl` that was rejected. Nothing is logged while OCR is off,
 * because this module is only imported when the switch is on.
 *
 * Part of the lazy OCR chunk.
 */
import {
  DEFAULT_OCR_LANGUAGES,
  DEFAULT_OCR_WORKER_COUNT,
  MAX_OCR_WORKER_COUNT,
  OCR_LANGUAGE_PRESETS,
  describeOcrAssetBaseUrl,
  describeOcrLanguages,
  describeOcrWorkerCount,
  getRuntimeConfig,
  resolveOcrWorkerCount,
} from '../utils/runtimeConfig.js';
import logger from '../logging/systemLogger.js';
import { readOcrAssetManifest, resolveOcrAssetUrls } from './assetUrls.js';
import { createOcrEngine } from './engine.js';
import { createOcrEnginePool } from './enginePool.js';
import { partitionOcrLanguages } from './languages.js';

/**
 * @typedef {Object} OcrSetup
 * @property {Array<string>} languages  The codes the engine will load.
 * @property {Object} assetUrls  Absolute `workerPath`, `corePath`, `langPath` and `base` (see assetUrls.js).
 * @property {number} workerCount  Engines to run at the same time (`ocr.workerCount`, resolved).
 * @property {Array<string>} warnings  Human-readable configuration problems (also logged).
 */

/**
 * Resolve languages and asset URLs from the configuration, logging each problem once.
 *
 * @param {Object=} cfg  Runtime config (defaults to the viewer's).
 * @param {Object=} options  Injection points, all optional.
 * @param {Object=} options.log  Logger with `warn` (defaults to the system logger).
 * @param {Object=} options.manifest  Asset manifest (defaults to the build's).
 * @param {string=} options.moduleUrl  Caller location (defaults to this module's `import.meta.url`).
 * @param {string=} options.documentBaseUrl  Base for a relative assetBaseUrl (defaults to `document.baseURI`).
 * @param {boolean=} options.dev  Dev-server mode (defaults to `import.meta.env.DEV`).
 * @param {number=} options.cores  Logical cores for `ocr.workerCount: 0` (defaults to
 *   `navigator.hardwareConcurrency`).
 * @returns {OcrSetup}
 */
export function describeOcrSetup(cfg = getRuntimeConfig(), {
  log = logger,
  manifest = readOcrAssetManifest(),
  moduleUrl = import.meta.url,
  documentBaseUrl = typeof document !== 'undefined' ? document.baseURI : undefined,
  dev = Boolean(import.meta.env?.DEV),
  cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
} = {}) {
  const warnings = [];

  const workerConfig = describeOcrWorkerCount(cfg);
  if (Object.prototype.hasOwnProperty.call(workerConfig, 'rejected')) {
    warnings.push(`ocr.workerCount must be an integer (0 for automatic), not ${JSON.stringify(workerConfig.rejected)}; using ${DEFAULT_OCR_WORKER_COUNT}`);
  } else if (workerConfig.clamped) {
    warnings.push(`ocr.workerCount is limited to ${MAX_OCR_WORKER_COUNT}; using ${MAX_OCR_WORKER_COUNT}`);
  }
  const workerCount = resolveOcrWorkerCount(cfg, { cores });

  const languageConfig = describeOcrLanguages(cfg);
  if (languageConfig.notArray) {
    const rawLanguages = cfg?.ocr?.languages;
    const given = typeof rawLanguages === 'string' ? JSON.stringify(rawLanguages) : typeof rawLanguages;
    warnings.push(`ocr.languages must be one of ${Object.keys(OCR_LANGUAGE_PRESETS).map((name) => JSON.stringify(name)).join(', ')} or an array of language codes, not ${given}; using the default ${JSON.stringify([...DEFAULT_OCR_LANGUAGES])}`);
  } else if (languageConfig.configured && languageConfig.fallback) {
    warnings.push(`ocr.languages has no usable entry; using the default ${JSON.stringify([...DEFAULT_OCR_LANGUAGES])}`);
  }
  if (languageConfig.dropped.length) {
    warnings.push(`ocr.languages entries ignored (not a Tesseract language code): ${JSON.stringify(languageConfig.dropped)}`);
  }
  if (languageConfig.duplicates.length) {
    warnings.push(`ocr.languages repeats ${JSON.stringify(languageConfig.duplicates)}; each code is loaded once`);
  }
  const { known, unknown } = partitionOcrLanguages(languageConfig.languages);
  if (unknown.length) {
    warnings.push(`ocr.languages entries ignored (no Tesseract model with that code): ${JSON.stringify(unknown)}`);
  }
  let languages = known;
  if (!languages.length) {
    languages = [...DEFAULT_OCR_LANGUAGES];
    warnings.push(`ocr.languages left no known language; using the default ${JSON.stringify(languages)}`);
  }

  const baseConfig = describeOcrAssetBaseUrl(cfg);
  if (baseConfig.rejected) {
    warnings.push(`ocr.assetBaseUrl ${JSON.stringify(baseConfig.value)} ignored (${baseConfig.rejected}); using the viewer's own ocr/ folder`);
  }
  const assetUrls = resolveOcrAssetUrls(manifest, { assetBaseUrl: baseConfig.url, moduleUrl, documentBaseUrl, dev });

  for (const warning of warnings) log.warn(`OCR configuration: ${warning}`);
  return { languages, assetUrls, workerCount, warnings };
}

/**
 * Create an engine for the configured languages and asset location: one engine (engine.js)
 * for a worker count of one, otherwise a pool of that many (enginePool.js) behind the same
 * interface, which the queue uses with the matching concurrency.
 *
 * @param {Object=} cfg
 * @param {Object=} options  Passed to describeOcrSetup, plus `createWorker` for createOcrEngine
 *   and `workerCount` to override the configured count (the benchmark compares counts).
 * @returns {{ engine: Object, setup: OcrSetup, workerCount: number }}  `engine` is an OcrEngine
 *   or an OcrEnginePool; `workerCount` is how many pages it recognises at a time.
 */
export function createConfiguredOcrEngine(cfg = getRuntimeConfig(), { createWorker, workerCount, ...setupOptions } = {}) {
  const setup = describeOcrSetup(cfg, setupOptions);
  const count = Number.isInteger(workerCount) && workerCount > 0
    ? Math.min(MAX_OCR_WORKER_COUNT, workerCount)
    : setup.workerCount;
  const createEngine = () => createOcrEngine({
    languages: setup.languages,
    assetUrls: setup.assetUrls,
    ...(createWorker ? { createWorker } : {}),
    ...(setupOptions.log ? { log: setupOptions.log } : {}),
  });
  const engine = count > 1 ? createOcrEnginePool({ size: count, createEngine }) : createEngine();
  return { engine, setup, workerCount: count };
}
