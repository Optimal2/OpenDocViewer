/**
 * Generated-PDF cache key helpers.
 *
 * Background prebuild and foreground print dispatch must use the same key shape.
 * Otherwise the toolbar can report a ready prebuild while the print action misses
 * the cache and starts a new PDF generation run.
 */

/**
 * @param {*} value
 * @returns {string}
 */
function stablePrintText(value) {
  return value == null ? '' : String(value);
}

/**
 * @param {Array<number>=} pageNumbers
 * @returns {Array<number>}
 */
export function normalizePdfPrintCachePageNumbers(pageNumbers = []) {
  return (Array.isArray(pageNumbers) ? pageNumbers : [])
    .map((value) => Math.floor(Number(value) || 0))
    .filter((value) => value > 0);
}

/**
 * Compare the content-affecting print settings that determine whether an existing
 * generated PDF can be reused. `printAction` is intentionally excluded because
 * printing and saving the same prepared PDF use identical PDF bytes.
 * @param {*} detail
 * @param {Array<number>=} pageNumbers
 * @returns {string}
 */
export function getPdfPrintCacheKey(detail, pageNumbers = []) {
  return JSON.stringify({
    pageScope: detail?.activeScope === 'compare-both' ? 'compare-both' : 'pages',
    pages: normalizePdfPrintCachePageNumbers(pageNumbers),
    reason: stablePrintText(detail?.reason),
    reasonValue: stablePrintText(detail?.reasonSelection?.value),
    reasonFreeText: stablePrintText(detail?.reasonSelection?.freeText),
    forWhom: stablePrintText(detail?.forWhom),
    printFormat: stablePrintText(detail?.printFormat),
    printFormatValue: stablePrintText(detail?.printFormatValue),
    printFormatSelectionValue: stablePrintText(detail?.printFormatSelection?.value),
    pdfOrientation: stablePrintText(detail?.pdfOrientation || 'auto'),
  });
}

/**
 * Active-page PDF output is based on the current rendered surface, including transient
 * client-side edits such as rotation, brightness and contrast. It must not be reused
 * as a later print cache entry because the same page number can represent different
 * output bytes after those view edits change.
 * @param {*} detail
 * @returns {boolean}
 */
export function canReuseGeneratedPdfPrint(detail) {
  return detail?.printBackend === 'pdf' && detail?.mode !== 'active';
}

/**
 * @param {Array<number>=} pageNumbers
 * @param {number=} sessionTotalPages
 * @returns {boolean}
 */
export function isFullSessionPageSequence(pageNumbers = [], sessionTotalPages = 0) {
  const total = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
  const pages = normalizePdfPrintCachePageNumbers(pageNumbers);
  return total > 0
    && pages.length === total
    && pages.every((pageNumber, index) => pageNumber === index + 1);
}
