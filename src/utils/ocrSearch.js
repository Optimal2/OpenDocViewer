// File: src/utils/ocrSearch.js
/**
 * Search in recognised text: the toolbar's OCR search (components/DocumentToolbar/OcrSearchBar.jsx)
 * and the text layer's match marks (components/OcrTextLayer.jsx) both go through these
 * functions, on the same outcomes, so the count in the bar and the marks on the page agree.
 *
 * An outcome is indexed as one lower-cased string of its words in reading order (the lines of
 * utils/ocrTextLayout.js), joined with single spaces; a line break is a space too, so a phrase
 * is found across it, like the browser's own find over the text layer. Each word keeps its
 * index in the outcome's `words`, which the layer renders as `data-word-index`. A term is
 * matched case-insensitively with its whitespace collapsed; matches never overlap. Nothing
 * here touches the DOM.
 */
import { ocrReadingOrder } from './ocrTextLayout.js';

/**
 * @typedef {Object} OcrSearchIndex
 * @property {string} text  Lower-cased words in reading order, single spaces between them.
 * @property {Array<{ index:number, start:number, end:number }>} spans  Each word's index in the
 *   outcome's `words` and its character range in `text`.
 */

/**
 * @typedef {Object} OcrSearchMatch
 * @property {number} start  Character offset in the index text.
 * @property {number} end
 * @property {Array<number>} wordIndexes  Indexes (into the outcome's `words`) of the words the
 *   match reaches into, in reading order.
 */

/** Index per outcome; outcomes are immutable objects from the result cache. */
const indexes = new WeakMap();

/**
 * The form a term is matched in: whitespace collapsed to single spaces, trimmed, lower-cased.
 * @param {*} term
 * @returns {string}
 */
export function normalizeOcrSearchTerm(term) {
  return String(term ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * Build (or reuse) the search index of a `done` outcome.
 * @param {(Object|null|undefined)} outcome
 * @returns {OcrSearchIndex}
 */
export function ocrSearchIndexOf(outcome) {
  if (!outcome || typeof outcome !== 'object') return { text: '', spans: [] };
  const cached = indexes.get(outcome);
  if (cached) return cached;
  let text = '';
  const spans = [];
  for (const line of ocrReadingOrder(outcome.words)) {
    for (const word of line) {
      if (text) text += ' ';
      const start = text.length;
      text += word.text.toLocaleLowerCase();
      spans.push({ index: word.index, start, end: text.length });
    }
  }
  const index = { text, spans };
  indexes.set(outcome, index);
  return index;
}

/**
 * All matches of a term in an index, in reading order, without overlaps.
 * @param {OcrSearchIndex} index
 * @param {*} term  Raw term; normalised here.
 * @returns {Array<OcrSearchMatch>}
 */
export function findOcrMatches(index, term) {
  const needle = normalizeOcrSearchTerm(term);
  const text = String(index?.text || '');
  if (!needle || !text) return [];
  const spans = Array.isArray(index.spans) ? index.spans : [];
  const matches = [];
  let from = 0;
  let spanCursor = 0;
  while (from <= text.length - needle.length) {
    const start = text.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    while (spanCursor < spans.length && spans[spanCursor].end <= start) spanCursor += 1;
    const wordIndexes = [];
    for (let i = spanCursor; i < spans.length && spans[i].start < end; i += 1) {
      if (spans[i].end > start) wordIndexes.push(spans[i].index);
    }
    matches.push({ start, end, wordIndexes });
    from = end;
  }
  return matches;
}

/**
 * Matches of a term in one outcome (the index is built on first use).
 * @param {(Object|null|undefined)} outcome
 * @param {*} term
 * @returns {Array<OcrSearchMatch>}
 */
export function findOcrMatchesInOutcome(outcome, term) {
  if (!outcome || outcome.status !== 'done') return [];
  return findOcrMatches(ocrSearchIndexOf(outcome), term);
}

/**
 * @typedef {Object} OcrDocumentMatch
 * @property {string} pageKey  utils/ocrPageKey.js key of the page.
 * @property {number} pageIndex  Index into the viewer's pages.
 * @property {number} pageNumber  1-based viewer page number.
 * @property {number} ordinal  Position among the page's matches (0-based).
 * @property {Array<number>} wordIndexes
 */

/**
 * Matches of a term across the recognised pages of a document, in page order, each page's
 * matches in reading order.
 *
 * @param {Array<{ pageKey:string, pageIndex:number, pageNumber:number, outcome:(Object|null) }>} pages
 *   The viewer's pages with their outcomes (pages without a `done` outcome contribute nothing).
 * @param {*} term
 * @returns {Array<OcrDocumentMatch>}
 */
export function searchOcrPages(pages, term) {
  const needle = normalizeOcrSearchTerm(term);
  if (!needle) return [];
  const result = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    const matches = findOcrMatchesInOutcome(page?.outcome, needle);
    matches.forEach((match, ordinal) => {
      result.push({
        pageKey: String(page.pageKey || ''),
        pageIndex: Number(page.pageIndex) || 0,
        pageNumber: Number(page.pageNumber) || 0,
        ordinal,
        wordIndexes: match.wordIndexes,
      });
    });
  }
  return result;
}
