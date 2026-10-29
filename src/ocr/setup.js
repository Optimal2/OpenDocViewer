// File: src/ocr/setup.js
/**
 * Builds an OCR engine from the runtime configuration and reports configuration problems once.
 *
 * The runtimeConfig accessors are side-effect free, so this is where their diagnostics become
 * log lines: a `languages` array that fell back to the default, codes that were dropped (bad form
 * or no known model) and an `assetBaseUrl` that was rejected. Nothing is logged while OCR is off,
 * because this module is only imported when the switch is on.
 *
 * Part of the lazy OCR chunk.
 */
import {
  DEFAULT_OCR_LANGUAGES,
  describeOcrAssetBaseUrl,
  describeOcrLanguages,
  getRuntimeConfig,
} from '../utils/runtimeConfig.js';
import logger from '../logging/systemLogger.js';
import { readOcrAssetManifest, resolveOcrAssetUrls } from './assetUrls.js';
import { createOcrEngine } from './engine.js';
import { partitionOcrLanguages } from './languages.js';

/**
 * @typedef {Object} OcrSetup
 * @property {Array<string>} languages  The codes the engine will load.
 * @property {Object} assetUrls  Absolute `workerPath`, `corePath`, `langPath` and `base` (see assetUrls.js).
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
 * @returns {OcrSetup}
 */
export function describeOcrSetup(cfg = getRuntimeConfig(), {
  log = logger,
  manifest = readOcrAssetManifest(),
  moduleUrl = import.meta.url,
  documentBaseUrl = typeof document !== 'undefined' ? document.baseURI : undefined,
  dev = Boolean(import.meta.env?.DEV),
} = {}) {
  const warnings = [];

  const languageConfig = describeOcrLanguages(cfg);
  if (languageConfig.configured && languageConfig.fallback) {
    warnings.push(`ocr.languages has no usable entry; using the default ${JSON.stringify([...DEFAULT_OCR_LANGUAGES])}`);
  }
  if (languageConfig.dropped.length) {
    warnings.push(`ocr.languages entries ignored (not a Tesseract language code): ${JSON.stringify(languageConfig.dropped)}`);
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
  return { languages, assetUrls, warnings };
}

/**
 * Create an engine for the configured languages and asset location.
 *
 * @param {Object=} cfg
 * @param {Object=} options  Passed to describeOcrSetup, plus `createWorker` for createOcrEngine.
 * @returns {{ engine: Object, setup: OcrSetup }}  `engine` is an OcrEngine (see engine.js).
 */
export function createConfiguredOcrEngine(cfg = getRuntimeConfig(), { createWorker, ...setupOptions } = {}) {
  const setup = describeOcrSetup(cfg, setupOptions);
  const engine = createOcrEngine({
    languages: setup.languages,
    assetUrls: setup.assetUrls,
    ...(createWorker ? { createWorker } : {}),
    ...(setupOptions.log ? { log: setupOptions.log } : {}),
  });
  return { engine, setup };
}
