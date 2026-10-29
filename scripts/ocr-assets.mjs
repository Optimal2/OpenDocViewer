// File: scripts/ocr-assets.mjs
/**
 * Describes the OCR engine files that the build copies from node_modules into `dist/ocr/`.
 *
 * tesseract.js runs its engine in a Web Worker: the worker script (tesseract.js), the WebAssembly
 * core (tesseract.js-core, one variant: SIMD + LSTM) and one `<lang>.traineddata.gz` per language
 * (@tesseract.js-data). By default tesseract.js fetches all of them from a CDN; OpenDocViewer
 * ships them next to the application instead, so the viewer never talks to a third-party host.
 *
 * Used by vite.config.js (ocrAssetsPlugin copies the files and serves them in dev), by
 * scripts/verify-ocr-lazy-chunk.mjs (checks the built output) and, through the
 * `import.meta.env.ODV_OCR_ASSETS` define, by src/ocr/assetUrls.js at runtime.
 *
 * Folder names carry the package versions and a content hash of the language models. The shipped
 * web.config sends `Cache-Control: immutable` for everything outside index.html and the config
 * files, so every upgrade of the engine or a model must change the URL. The hash also covers the
 * language folder, which has to be one folder for all languages because tesseract.js appends
 * `<lang>.traineddata.gz` to a single `langPath`.
 *
 * This module is pure: it reads package metadata and file bytes and never writes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Output folder (relative to dist/) that holds every OCR engine file. */
export const OCR_ASSET_ROOT = 'ocr/';
/** The one engine core variant that is shipped (tesseract.js picks SIMD cores on every current browser). */
export const OCR_CORE_FILE = 'tesseract-core-simd-lstm.wasm.js';
/** The tesseract.js worker script. */
export const OCR_WORKER_FILE = 'worker.min.js';
/** Languages whose models ship inside dist/ocr/ (the `ocr.languages` default). */
export const OCR_SHIPPED_LANGUAGES = Object.freeze(['swe', 'eng']);
/** Model variant inside the @tesseract.js-data packages: integer-quantized tessdata_best. */
export const OCR_LANGUAGE_VARIANT = '4.0.0_best_int';
/** Environment variable that makes the build leave dist/ocr/ out (`ODV_OCR_ASSETS=skip`). */
export const OCR_ASSETS_ENV = 'ODV_OCR_ASSETS';

/**
 * @typedef {Object} OcrAssetManifest
 * @property {string} root        Folder under dist/, with trailing slash (`ocr/`).
 * @property {string} workerPath  dist-relative path of the worker script.
 * @property {string} corePath    dist-relative path of the engine core (`.wasm.js`).
 * @property {string} langPath    dist-relative folder of the language models, with trailing slash.
 * @property {Array<string>} languages  Language codes whose models are in `langPath`.
 * @property {Object<string, string>} versions  Package versions the paths were derived from.
 */

/**
 * @typedef {Object} OcrAssetFile
 * @property {string} fileName  dist-relative output path.
 * @property {URL} sourceUrl    file: URL of the source inside node_modules.
 */

/**
 * True when the build is told to leave the engine files out of dist/ (`ODV_OCR_ASSETS=skip`).
 * Any other value, including unset, copies them.
 *
 * @param {Object<string, (string|undefined)>} [env]
 * @returns {boolean}
 */
export function isOcrAssetCopySkipped(env = process.env) {
  return String(env[OCR_ASSETS_ENV] || '').trim().toLowerCase() === 'skip';
}

/**
 * @param {URL} nodeModulesUrl
 * @param {string} packageName
 * @returns {string}
 */
function readPackageVersion(nodeModulesUrl, packageName) {
  const pkg = JSON.parse(readFileSync(new URL(`${packageName}/package.json`, nodeModulesUrl), 'utf8'));
  return String(pkg.version || '');
}

/**
 * Describe the engine files for the installed packages.
 *
 * @param {URL} nodeModulesUrl file: URL of the node_modules folder, with trailing slash.
 * @returns {{ manifest: OcrAssetManifest, files: Array<OcrAssetFile> }}
 */
export function describeOcrAssets(nodeModulesUrl) {
  const tesseractVersion = readPackageVersion(nodeModulesUrl, 'tesseract.js');
  const coreVersion = readPackageVersion(nodeModulesUrl, 'tesseract.js-core');
  const engineDir = `${OCR_ASSET_ROOT}tesseract-${tesseractVersion}-core-${coreVersion}/`;

  /** @type {Array<OcrAssetFile>} */
  const files = [
    { fileName: `${engineDir}${OCR_WORKER_FILE}`, sourceUrl: new URL(`tesseract.js/dist/${OCR_WORKER_FILE}`, nodeModulesUrl) },
    { fileName: `${engineDir}${OCR_CORE_FILE}`, sourceUrl: new URL(`tesseract.js-core/${OCR_CORE_FILE}`, nodeModulesUrl) },
  ];

  const versions = { 'tesseract.js': tesseractVersion, 'tesseract.js-core': coreVersion };
  const hash = createHash('sha256');
  const languageFiles = [];
  for (const lang of OCR_SHIPPED_LANGUAGES) {
    const packageName = `@tesseract.js-data/${lang}`;
    const version = readPackageVersion(nodeModulesUrl, packageName);
    versions[packageName] = version;
    const sourceUrl = new URL(`${packageName}/${OCR_LANGUAGE_VARIANT}/${lang}.traineddata.gz`, nodeModulesUrl);
    hash.update(`${packageName}@${version}\n`);
    hash.update(readFileSync(sourceUrl));
    languageFiles.push({ lang, sourceUrl });
  }
  const langDir = `${OCR_ASSET_ROOT}tessdata-${OCR_LANGUAGE_VARIANT}-${hash.digest('hex').slice(0, 12)}/`;
  for (const { lang, sourceUrl } of languageFiles) {
    files.push({ fileName: `${langDir}${lang}.traineddata.gz`, sourceUrl });
  }

  return {
    manifest: {
      root: OCR_ASSET_ROOT,
      workerPath: files[0].fileName,
      corePath: files[1].fileName,
      langPath: langDir,
      languages: [...OCR_SHIPPED_LANGUAGES],
      versions,
    },
    files,
  };
}
