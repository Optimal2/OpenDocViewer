// File: src/utils/ocrPageKey.js
/**
 * Key of one document page in the OCR result map (`ocrPages` on the viewer context).
 *
 * The key names the page by its source document and the page's index inside that document, so it
 * survives pages being inserted before it in the viewer's page list. This helper lives outside
 * src/ocr/ because consumers on the default code path (the context, the text layer) look up
 * results by it without importing the lazy OCR chunk.
 */

const SEPARATOR = '\u001f';

/**
 * @param {*} sourceKey  The page's source document key.
 * @param {*} pageIndex  The page's index inside that document (0-based).
 * @returns {string} '' when the source key is empty.
 */
export function makeOcrPageKey(sourceKey, pageIndex) {
  const source = String(sourceKey ?? '');
  if (!source) return '';
  const index = Math.max(0, Math.floor(Number(pageIndex)) || 0);
  return `${source}${SEPARATOR}${index}`;
}

/**
 * @param {*} page  A viewer page entry (`sourceKey`, `pageIndex`).
 * @returns {string}
 */
export function ocrPageKeyOf(page) {
  return makeOcrPageKey(page?.sourceKey, page?.pageIndex);
}
