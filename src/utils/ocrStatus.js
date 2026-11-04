// File: src/utils/ocrStatus.js
/**
 * The per-page OCR status the toolbar's search button shows
 * (components/DocumentToolbar/OcrSearchBar.jsx): one key per outcome state, its English fallback
 * text (public/locales/<lng>/common.json, `ocr.status`) and the LED state that paints it.
 */

/** Status keys and their English fallbacks. */
export const OCR_STATUS_FALLBACK = Object.freeze({
  working: 'Recognising text…',
  done: 'Text recognised',
  pdfText: 'The page has its own text',
  noText: 'No text found',
  skippedTextLayer: 'Not recognised: the page has its own text',
  skipped: 'Not recognised: nothing to recognise on this page',
  failed: 'The text could not be recognised',
  unavailable: 'Text recognition is unavailable',
});

/**
 * LED state (components/common/StatusLed.jsx) per status key; '' (no outcome yet) is off.
 * @type {Readonly<Object<string, ('off'|'pending'|'ready'|'active'|'warning'|'error')>>}
 */
export const OCR_STATUS_LED = Object.freeze({
  working: 'pending',
  done: 'ready',
  pdfText: 'ready',
  noText: 'off',
  skippedTextLayer: 'off',
  skipped: 'off',
  failed: 'error',
  unavailable: 'error',
});

/**
 * Status key of a page's OCR outcome.
 *
 * @param {(Object|null|undefined)} entry  The page's outcome (`status` done/skipped/failed, or a
 *   transient queued/probing/recognizing state), or null before the page joined the window. A
 *   done outcome whose `source` is `pdf-text` holds the PDF page's own text (src/ocr/queue.js).
 * @param {(string|null|undefined)} engineFailure  Set when the engine cannot serve this session;
 *   a page that is already `done` keeps its own status (its text is there, and a PDF page's own
 *   text never needed the engine), every other page reports the failure.
 * @returns {('working'|'done'|'pdfText'|'noText'|'skippedTextLayer'|'skipped'|'failed'|'unavailable'|'')}
 */
export function ocrStatusKeyOf(entry, engineFailure) {
  if (engineFailure && entry?.status !== 'done') return 'unavailable';
  switch (entry?.status) {
    case 'queued':
    case 'probing':
    case 'recognizing':
      return 'working';
    case 'done':
      if (!Array.isArray(entry.words) || entry.words.length === 0) return 'noText';
      return entry.source === 'pdf-text' ? 'pdfText' : 'done';
    case 'skipped':
      return entry.reason === 'text-layer' ? 'skippedTextLayer' : 'skipped';
    case 'failed':
      return 'failed';
    default:
      return '';
  }
}

/**
 * Whether a page's recognised text can be searched: the outcome is final and holds words.
 * @param {(Object|null|undefined)} entry
 * @returns {boolean}
 */
export function hasSearchableOcrText(entry) {
  return entry?.status === 'done' && Array.isArray(entry.words) && entry.words.length > 0;
}
