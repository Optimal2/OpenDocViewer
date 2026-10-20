// File: src/utils/printParse.test.js
/**
 * Custom print-range parser (utils/printParse.js, printDialog "Custom pages"):
 * single pages, ascending/descending ranges, accepted separators, repeated pages,
 * out-of-range pages, empty input and malformed entries.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({ default: { t: (key, options) => options?.defaultValue ?? key } }));

import { parsePrintSequence } from './printParse.js';

const TOTAL = 10;

function expectOk(text, totalPages, sequence) {
  expect(parsePrintSequence(text, totalPages)).toEqual({ ok: true, sequence });
}

function expectFail(text, totalPages, messagePart) {
  const result = parsePrintSequence(text, totalPages);
  expect(result.ok).toBe(false);
  expect(result.sequence).toBeUndefined();
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
  if (messagePart !== undefined) expect(result.error).toContain(messagePart);
}

describe('single pages', () => {
  it('parses one page', () => {
    expectOk('3', TOTAL, [3]);
  });

  it('parses several pages', () => {
    expectOk('1 4 7', TOTAL, [1, 4, 7]);
  });

  it('accepts the boundary pages', () => {
    expectOk('1', TOTAL, [1]);
    expectOk('10', TOTAL, [10]);
  });

  it('accepts a numeric (non-string) input', () => {
    expectOk(3, TOTAL, [3]);
  });
});

describe('ranges', () => {
  it('expands an ascending range', () => {
    expectOk('2-5', TOTAL, [2, 3, 4, 5]);
  });

  it('expands a descending (reversed) range', () => {
    expectOk('5-2', TOTAL, [5, 4, 3, 2]);
  });

  it('treats equal endpoints as one page', () => {
    expectOk('4-4', TOTAL, [4]);
  });

  it('combines ranges and single pages in order', () => {
    expectOk('1-3, 5, 8-6', TOTAL, [1, 2, 3, 5, 8, 7, 6]);
  });
});

describe('separators and whitespace', () => {
  it('accepts commas as separators', () => {
    expectOk('1,2,3', TOTAL, [1, 2, 3]);
  });

  it('accepts mixed commas and spaces', () => {
    expectOk('1, 2 3 , 4-5', TOTAL, [1, 2, 3, 4, 5]);
  });

  it('ignores leading, trailing and repeated whitespace', () => {
    expectOk('  1,  2   3  ', TOTAL, [1, 2, 3]);
  });

  it('strips tabs and newlines instead of treating them as separators', () => {
    // Only literal spaces and commas separate: other characters are removed,
    // so adjacent digits fuse.
    expectOk('1\t2', 30, [12]);
  });

  it('ignores other characters', () => {
    expectOk('pages 1-3', TOTAL, [1, 2, 3]);
    expectOk('p1, p2', TOTAL, [1, 2]);
  });
});

describe('repeated pages', () => {
  it('keeps repeated single pages', () => {
    expectOk('2, 2, 2', TOTAL, [2, 2, 2]);
  });

  it('keeps pages repeated by overlapping ranges', () => {
    expectOk('1-3, 2', TOTAL, [1, 2, 3, 2]);
  });
});

describe('pages outside 1..totalPages', () => {
  it('rejects zero and ranges touching zero', () => {
    expectFail('0', TOTAL, 'Values must be positive.');
    expectFail('0-2', TOTAL, 'Values must be positive.');
    expectFail('2-0', TOTAL, 'Values must be positive.');
  });

  it('rejects pages above the total', () => {
    expectFail('11', TOTAL, 'highest allowed');
    expectFail('3-11', TOTAL, 'highest allowed');
    expectFail('11-3', TOTAL, 'highest allowed');
  });

  it('clamps a missing or falsy total to one page', () => {
    expectOk('1', 0, [1]);
    expectOk('1', undefined, [1]);
    expectFail('2', undefined, 'highest allowed');
  });
});

describe('empty input', () => {
  it.each(['', '   ', ',', ' , ', null, undefined])('rejects %s', (text) => {
    expectFail(text, TOTAL, 'Enter at least one page');
  });
});

describe('malformed entries', () => {
  it.each(['-', '1-', '-1', '1--2', '1 - 2'])('rejects "%s"', (text) => {
    expectFail(text, TOTAL, 'Invalid token');
  });

  it('rejects a range with more than two endpoints', () => {
    expectFail('1-2-3', TOTAL, 'Invalid range');
  });
});
