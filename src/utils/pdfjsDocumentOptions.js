/**
 * Shared pdf.js document-loading options.
 *
 * pdf.js loads optional codecs such as JBIG2 and OpenJPEG by appending fixed filenames to
 * `wasmUrl`. Keep these resources in a stable static folder instead of fingerprinted assets.
 */

const PDFJS_WASM_BASE_URL = (() => {
  try {
    const basePath = import.meta.env?.DEV ? '/pdfjs/wasm/' : '../pdfjs/wasm/';
    return new URL(basePath, import.meta.url).href;
  } catch {
    return '';
  }
})();

/**
 * @param {Record<string, any>} options
 * @returns {Record<string, any>}
 */
export function withPdfJsDocumentOptions(options) {
  const next = { ...(options || {}) };
  if (!next.wasmUrl && PDFJS_WASM_BASE_URL) {
    next.wasmUrl = PDFJS_WASM_BASE_URL;
  }
  return next;
}

export { PDFJS_WASM_BASE_URL };
