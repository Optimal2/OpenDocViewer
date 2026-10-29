// File: src/ocr/assetUrls.js
/**
 * Resolves where the OCR worker, engine core and language models are loaded from.
 *
 * The build (vite.config.js, scripts/ocr-assets.mjs) copies the files into `dist/ocr/` under
 * versioned folder names and exposes their dist-relative paths as the virtual module
 * `virtual:odv-ocr-assets`, which only this file imports, so the manifest is bundled into the
 * lazy ocr chunk. By default the files are loaded from that folder next to the application; a
 * site can serve a copy of the folder from elsewhere through `ocr.assetBaseUrl`. Every path is
 * passed to tesseract.js explicitly, so it never falls back to its CDN defaults.
 *
 * Part of the lazy OCR chunk: nothing here is imported while `ocr.enabled` is off.
 */
import buildManifest from 'virtual:odv-ocr-assets';

/**
 * @typedef {Object} OcrAssetManifest
 * @property {string} root        Folder under dist/, with trailing slash (`ocr/`).
 * @property {string} workerPath  dist-relative path of the worker script.
 * @property {string} corePath    dist-relative path of the engine core.
 * @property {string} langPath    dist-relative folder of the language models, with trailing slash.
 * @property {Array<string>} languages  Language codes whose models are shipped.
 */

/**
 * @typedef {Object} OcrAssetUrls
 * @property {string} base        Absolute URL of the folder the files are loaded from.
 * @property {string} workerPath  Absolute URL of the worker script.
 * @property {string} corePath    Absolute URL of the engine core.
 * @property {string} langPath    Absolute URL of the language folder, without trailing slash
 *                                (tesseract.js appends `/<lang>.traineddata.gz`).
 */

/**
 * The manifest the build generated, or null when it is unusable.
 *
 * @returns {(OcrAssetManifest|null)}
 */
export function readOcrAssetManifest() {
  return buildManifest && typeof buildManifest === 'object' ? buildManifest : null;
}

/**
 * Turn the dist-relative manifest paths into absolute URLs.
 *
 * Without `assetBaseUrl` the folder is located like pdf.js' codec folder
 * (src/utils/pdfjsDocumentOptions.js): in a production build this module lives in the hashed
 * `assets/` folder one level below the application, in the dev server it is served from the root.
 * With `assetBaseUrl` (already validated by runtimeConfig) the base is resolved against the page
 * and the `ocr/` prefix is replaced by it, so the site must serve the folder with the same layout.
 *
 * @param {(OcrAssetManifest|null)} manifest
 * @param {Object} options
 * @param {(string|null)=} options.assetBaseUrl  Validated `ocr.assetBaseUrl`, or null for the viewer's own folder.
 * @param {string} options.moduleUrl  `import.meta.url` of the calling module (locates the application).
 * @param {string=} options.documentBaseUrl  `document.baseURI`, the base for a relative assetBaseUrl.
 * @param {boolean=} options.dev  True in the Vite dev server, where the folder is served from the root.
 * @returns {OcrAssetUrls}
 */
export function resolveOcrAssetUrls(manifest, { assetBaseUrl = null, moduleUrl, documentBaseUrl, dev = false }) {
  if (!manifest?.root || !manifest.workerPath || !manifest.corePath || !manifest.langPath) {
    throw new Error('OCR asset manifest is missing: the build did not inject ODV_OCR_ASSETS');
  }
  for (const key of ['workerPath', 'corePath', 'langPath']) {
    if (!manifest[key].startsWith(manifest.root)) {
      throw new Error(`OCR asset manifest path ${key} is outside ${manifest.root}: ${manifest[key]}`);
    }
  }

  const base = assetBaseUrl
    ? new URL(assetBaseUrl, documentBaseUrl).href
    : new URL(dev ? `/${manifest.root}` : `../${manifest.root}`, moduleUrl).href;
  const inside = (path) => new URL(path.slice(manifest.root.length), base).href;

  return {
    base,
    workerPath: inside(manifest.workerPath),
    corePath: inside(manifest.corePath),
    langPath: inside(manifest.langPath).replace(/\/$/, ''),
  };
}
