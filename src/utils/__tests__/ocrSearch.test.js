// File: src/utils/__tests__/ocrSearch.test.js
/**
 * The OCR search index and matcher (utils/ocrSearch.js): reading order with word indexes, a
 * single lower-cased text with one space per word boundary (so a phrase is found across a line
 * break), case-insensitive and whitespace-collapsed terms, no overlapping matches, matches mapped
 * back to the words they reach into, and the document-wide search in page order.
 */
import { describe, expect, it } from 'vitest';
import { findOcrMatches, findOcrMatchesInOutcome, normalizeOcrSearchTerm, ocrSearchIndexOf, searchOcrPages } from '../ocrSearch.js';
import { ocrReadingOrder } from '../ocrTextLayout.js';

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const WORDS = [
  { text: 'Hej', bbox: box(100, 100, 200, 150) },
  { text: '', bbox: box(0, 0, 10, 10) },
  { text: 'världen', bbox: box(220, 100, 400, 150) },
  { text: 'nobox' },
  { text: 'Hej', bbox: box(100, 200, 200, 250) },
  { text: 'igen,', bbox: box(220, 200, 300, 250) },
  { text: 'hej', bbox: box(320, 200, 400, 250) },
];
const OUTCOME = { status: 'done', words: WORDS, imageWidth: 1000, imageHeight: 1000 };

describe('ocrReadingOrder', () => {
  it('groups words into lines by the layer rule and keeps each word\'s index in the outcome', () => {
    const lines = ocrReadingOrder(WORDS);
    expect(lines.map((line) => line.map((word) => word.index))).toEqual([[0, 2], [4, 5, 6]]);
    expect(lines[0][1]).toEqual({ index: 2, text: 'världen', x0: 220, y0: 100, x1: 400, y1: 150 });
  });

  it('tolerates missing or empty input', () => {
    expect(ocrReadingOrder(undefined)).toEqual([]);
    expect(ocrReadingOrder([{ text: 'flat', bbox: box(0, 0, 0, 10) }])).toEqual([]);
  });
});

describe('normalizeOcrSearchTerm', () => {
  it('collapses whitespace, trims and lower-cases', () => {
    expect(normalizeOcrSearchTerm('  Hej \n  VÄRLDEN ')).toBe('hej världen');
    expect(normalizeOcrSearchTerm(null)).toBe('');
  });
});

describe('ocrSearchIndexOf', () => {
  it('builds one lower-cased text with a space at every word boundary, line breaks included', () => {
    const index = ocrSearchIndexOf(OUTCOME);
    expect(index.text).toBe('hej världen hej igen, hej');
    expect(index.spans).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 2, start: 4, end: 11 },
      { index: 4, start: 12, end: 15 },
      { index: 5, start: 16, end: 21 },
      { index: 6, start: 22, end: 25 },
    ]);
  });

  it('is built once per outcome', () => {
    expect(ocrSearchIndexOf(OUTCOME)).toBe(ocrSearchIndexOf(OUTCOME));
    expect(ocrSearchIndexOf(null)).toEqual({ text: '', spans: [] });
  });
});

describe('findOcrMatches', () => {
  const index = ocrSearchIndexOf(OUTCOME);

  it('finds every occurrence case-insensitively and maps it to the words it reaches into', () => {
    expect(findOcrMatches(index, 'HEJ')).toEqual([
      { start: 0, end: 3, wordIndexes: [0] },
      { start: 12, end: 15, wordIndexes: [4] },
      { start: 22, end: 25, wordIndexes: [6] },
    ]);
  });

  it('finds a phrase across the line break and a term inside a word', () => {
    expect(findOcrMatches(index, 'världen  hej')).toEqual([{ start: 4, end: 15, wordIndexes: [2, 4] }]);
    expect(findOcrMatches(index, 'rld')).toEqual([{ start: 6, end: 9, wordIndexes: [2] }]);
  });

  it('never overlaps matches and returns nothing for an empty term or text', () => {
    const repeated = ocrSearchIndexOf({ status: 'done', words: [{ text: 'aaa', bbox: box(0, 0, 10, 10) }] });
    expect(findOcrMatches(repeated, 'aa')).toEqual([{ start: 0, end: 2, wordIndexes: [0] }]);
    expect(findOcrMatches(index, '   ')).toEqual([]);
    expect(findOcrMatches({ text: '', spans: [] }, 'hej')).toEqual([]);
  });

  it('skips outcomes that are not done', () => {
    expect(findOcrMatchesInOutcome({ status: 'failed' }, 'hej')).toEqual([]);
    expect(findOcrMatchesInOutcome(OUTCOME, 'igen')).toHaveLength(1);
  });
});

describe('searchOcrPages', () => {
  it('lists matches page by page with the page and the ordinal on its page', () => {
    const pages = [
      { pageKey: 'a', pageIndex: 0, pageNumber: 1, outcome: OUTCOME },
      { pageKey: 'b', pageIndex: 1, pageNumber: 2, outcome: null },
      { pageKey: 'c', pageIndex: 2, pageNumber: 3, outcome: { status: 'done', words: [{ text: 'HEJ', bbox: box(0, 0, 10, 10) }] } },
    ];
    expect(searchOcrPages(pages, 'hej')).toEqual([
      { pageKey: 'a', pageIndex: 0, pageNumber: 1, ordinal: 0, wordIndexes: [0] },
      { pageKey: 'a', pageIndex: 0, pageNumber: 1, ordinal: 1, wordIndexes: [4] },
      { pageKey: 'a', pageIndex: 0, pageNumber: 1, ordinal: 2, wordIndexes: [6] },
      { pageKey: 'c', pageIndex: 2, pageNumber: 3, ordinal: 0, wordIndexes: [0] },
    ]);
    expect(searchOcrPages(pages, '')).toEqual([]);
    expect(searchOcrPages(undefined, 'hej')).toEqual([]);
  });
});
