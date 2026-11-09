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
  MAX_OCR_WORKER_COUNT,
  OCR_LANGUAGE_PRESETS,
  describeOcrAssetBaseUrl,
  describeOcrLanguages,
  describeOcrWorkerCount,
  getRuntimeConfig,
  resolveOcrWorkerPlan,
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
 * @property {number} workerCount  Engines to run at most at the same time: a manual
 *   `ocr.workerCount`, or the automatic plan for the client without a page count (its capacity;
 *   resolveOcrConcurrency lowers the pages in flight to what is pending).
 * @property {Object} workerPlan  How `workerCount` came about (an OcrWorkerPlan of runtimeConfig.js).
 * @property {Array<string>} warnings  Human-readable configuration problems (also logged).
 */

/** @returns {number} `navigator.hardwareConcurrency`, or 0 when unknown. */
function reportedCores() {
  return typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency) || 0 : 0;
}

/** @returns {number} `navigator.deviceMemory` in GiB, or 0 when the browser does not report it. */
function reportedDeviceMemoryGiB() {
  return typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) || 0 : 0;
}

/**
 * Resolve languages, asset URLs and the worker count from the configuration, logging each
 * problem once.
 *
 * @param {Object=} cfg  Runtime config (defaults to the viewer's).
 * @param {Object=} options  Injection points, all optional.
 * @param {Object=} options.log  Logger with `warn` (defaults to the system logger).
 * @param {Object=} options.manifest  Asset manifest (defaults to the build's).
 * @param {string=} options.moduleUrl  Caller location (defaults to this module's `import.meta.url`).
 * @param {string=} options.documentBaseUrl  Base for a relative assetBaseUrl (defaults to `document.baseURI`).
 * @param {boolean=} options.dev  Dev-server mode (defaults to `import.meta.env.DEV`).
 * @param {number=} options.cores  Logical cores for the automatic worker count (defaults to
 *   `navigator.hardwareConcurrency`).
 * @param {number=} options.deviceMemoryGiB  Device memory for the automatic worker count
 *   (defaults to `navigator.deviceMemory`; 0 when the browser does not report it).
 * @param {number=} options.pageCount  Pages pending for the automatic worker count; default 0
 *   (unknown), which plans the client's capacity.
 * @returns {OcrSetup}
 */
export function describeOcrSetup(cfg = getRuntimeConfig(), {
  log = logger,
  manifest = readOcrAssetManifest(),
  moduleUrl = import.meta.url,
  documentBaseUrl = typeof document !== 'undefined' ? document.baseURI : undefined,
  dev = Boolean(import.meta.env?.DEV),
  cores = reportedCores(),
  deviceMemoryGiB = reportedDeviceMemoryGiB(),
  pageCount = 0,
} = {}) {
  const warnings = [];

  const workerConfig = describeOcrWorkerCount(cfg);
  if (Object.prototype.hasOwnProperty.call(workerConfig, 'rejected')) {
    warnings.push(`ocr.workerCount must be an integer (0 for automatic), not ${JSON.stringify(workerConfig.rejected)}; using the automatic choice`);
  } else if (workerConfig.clamped) {
    warnings.push(`ocr.workerCount is limited to ${MAX_OCR_WORKER_COUNT}; using ${MAX_OCR_WORKER_COUNT}`);
  }

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

  // Planned after the languages, since every model an engine loads costs memory.
  const workerPlan = resolveOcrWorkerPlan(cfg, { cores, deviceMemoryGiB, pageCount, languageCount: languages.length });

  for (const warning of warnings) log.warn(`OCR configuration: ${warning}`);
  return { languages, assetUrls, workerCount: workerPlan.workerCount, workerPlan, warnings };
}

/**
 * How many pages the queue should keep in flight for `pageCount` pending pages: the automatic
 * plan for that many pages (one worker per `ocr.workerPolicy.pagesPerWorker`), never above the
 * setup's `workerCount`, which is the pool's size. A manual `ocr.workerCount` is returned as it
 * is. The pool creates its engines lazily, so a lower concurrency simply leaves engines
 * unstarted: a window of four pages gets two workers, the whole document the client's capacity.
 *
 * @param {number} pageCount  Pending pages (planned and not yet recognised); 0 for unknown.
 * @param {OcrSetup} setup  The setup the engine was created from.
 * @param {Object=} cfg
 * @param {Object=} options  `cores` and `deviceMemoryGiB`, defaulting to `navigator`'s.
 * @returns {number}
 */
export function resolveOcrConcurrency(pageCount, setup, cfg = getRuntimeConfig(), { cores = reportedCores(), deviceMemoryGiB = reportedDeviceMemoryGiB() } = {}) {
  const capacity = Math.max(1, Math.floor(Number(setup?.workerCount)) || 1);
  const languageCount = Array.isArray(setup?.languages) && setup.languages.length ? setup.languages.length : 1;
  const plan = resolveOcrWorkerPlan(cfg, { cores, deviceMemoryGiB, pageCount, languageCount });
  return Math.max(1, Math.min(capacity, plan.workerCount));
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
 *   or an OcrEnginePool; `workerCount` is how many pages it can recognise at a time.
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
