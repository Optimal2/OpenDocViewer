// File: src/ocr/classify.js
/**
 * Decides, per page, whether OCR is worth running.
 *
 * Raster pages (TIFF, JPEG, PNG and the other image formats the viewer shows) are pixels only and
 * are always recognised. A PDF page may already carry a usable text layer, which the viewer can
 * read through pdf.js in milliseconds, so it is probed first (see pdfTextProbe.js) and recognised
 * only when that layer is empty or garbled (a scanned page wrapped in a PDF, or text drawn with a
 * font that has no usable ToUnicode map). Everything else is skipped. Part of the lazy OCR chunk.
 */

export const OCR_PAGE_DECISION = Object.freeze({
  /** Pixels only: recognise. */
  RECOGNIZE: 'recognize',
  /** PDF: read the text layer first, recognise only when it is not usable. */
  PROBE_TEXT: 'probe-text',
  /** Not a page OCR can work on. */
  SKIP: 'skip',
});

export const OCR_SKIP_REASON = Object.freeze({
  /** The PDF page has a usable text layer; the viewer's own text wins. */
  TEXT_LAYER: 'text-layer',
  /** A format the viewer does not rasterise into a page image. */
  UNSUPPORTED: 'unsupported',
  /** The page failed to load; there is no image to recognise. */
  FAILED_PAGE: 'failed-page',
});

/** The image formats the viewer rasterises (utils/documentLoadingConfig.js isRasterImageExtension). */
const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'tif', 'tiff', 'bmp', 'gif', 'webp', 'avif']);

/** Thresholds of assessPdfTextLayer; exported so the documentation and tests state the same numbers. */
export const PDF_TEXT_LAYER_THRESHOLDS = Object.freeze({
  /**
   * Fewer visible characters than this counts as an empty layer: page numbers, a stray header,
   * or a short stamp on an otherwise scanned page. A page of running text has hundreds, so the
   * cost of the bound is at most one unneeded recognition of a very short real page.
   */
  minCharacters: 50,
  /** Below this share of letters and digits among visible characters the layer is garbled. */
  minLetterShare: 0.5,
  /** Above this share of private-use or replacement characters the layer is garbled. */
  maxPrivateUseShare: 0.2,
});

/**
 * @param {*} page  Viewer page entry (`fileExtension`, `status`).
 * @returns {{ decision: string, reason: (string|undefined) }}
 */
export function classifyPageSource(page) {
  if (!page || Number(page.status) === -1) {
    return { decision: OCR_PAGE_DECISION.SKIP, reason: OCR_SKIP_REASON.FAILED_PAGE };
  }
  const extension = String(page.fileExtension || '').trim().toLowerCase();
  if (extension === 'pdf') return { decision: OCR_PAGE_DECISION.PROBE_TEXT, reason: undefined };
  if (RASTER_EXTENSIONS.has(extension)) return { decision: OCR_PAGE_DECISION.RECOGNIZE, reason: undefined };
  return { decision: OCR_PAGE_DECISION.SKIP, reason: OCR_SKIP_REASON.UNSUPPORTED };
}

const PRIVATE_USE_OR_REPLACEMENT = /[-�]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/u;

/**
 * @typedef {Object} PdfTextLayerAssessment
 * @property {boolean} usable  True when the page's own text should be used instead of OCR.
 * @property {('usable'|'empty'|'garbled')} verdict
 * @property {number} characters  Visible (non-whitespace) characters.
 * @property {number} letters  Letters and digits among them.
 * @property {number} privateUse  Private-use and replacement characters among them.
 */

/**
 * Judge the text pdf.js extracted from one page.
 *
 * @param {Array<string>} strings  The `str` of every text item of the page, in content order.
 * @param {Object=} thresholds  Overrides of PDF_TEXT_LAYER_THRESHOLDS.
 * @returns {PdfTextLayerAssessment}
 */
export function assessPdfTextLayer(strings, thresholds = {}) {
  const limits = { ...PDF_TEXT_LAYER_THRESHOLDS, ...thresholds };
  let characters = 0;
  let letters = 0;
  let privateUse = 0;
  for (const value of Array.isArray(strings) ? strings : []) {
    for (const character of String(value ?? '')) {
      if (WHITESPACE.test(character)) continue;
      characters += 1;
      if (PRIVATE_USE_OR_REPLACEMENT.test(character)) privateUse += 1;
      else if (LETTER_OR_DIGIT.test(character)) letters += 1;
    }
  }
  const counts = { characters, letters, privateUse };
  if (characters < limits.minCharacters) return { usable: false, verdict: 'empty', ...counts };
  if (privateUse / characters > limits.maxPrivateUseShare) return { usable: false, verdict: 'garbled', ...counts };
  if (letters / characters < limits.minLetterShare) return { usable: false, verdict: 'garbled', ...counts };
  return { usable: true, verdict: 'usable', ...counts };
}
