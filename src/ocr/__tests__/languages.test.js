// File: src/ocr/__tests__/languages.test.js
// @vitest-environment jsdom
/**
 * The membership check against tesseract.js' model list: codes that pass runtimeConfig's form
 * check but name no model (a typo such as `sve`) are reported, not sent to the worker.
 */
import { describe, expect, it } from 'vitest';
import { KNOWN_OCR_LANGUAGES, partitionOcrLanguages } from '../languages.js';

describe('KNOWN_OCR_LANGUAGES', () => {
  it('comes from tesseract.js and contains the shipped and common codes', () => {
    expect(KNOWN_OCR_LANGUAGES.size).toBeGreaterThan(100);
    for (const code of ['swe', 'eng', 'nor', 'dan', 'fin', 'deu', 'chi_sim', 'aze_cyrl']) {
      expect(KNOWN_OCR_LANGUAGES.has(code)).toBe(true);
    }
    expect(KNOWN_OCR_LANGUAGES.has('sve')).toBe(false);
    expect(KNOWN_OCR_LANGUAGES.has('zzz')).toBe(false);
  });
});

describe('partitionOcrLanguages', () => {
  it('splits known from unknown codes and keeps the order', () => {
    expect(partitionOcrLanguages(['swe', 'sve', 'eng', 'zzz', 'chi_sim'])).toEqual({
      known: ['swe', 'eng', 'chi_sim'],
      unknown: ['sve', 'zzz'],
    });
  });

  it('treats a non-array as nothing', () => {
    expect(partitionOcrLanguages(null)).toEqual({ known: [], unknown: [] });
    expect(partitionOcrLanguages('swe')).toEqual({ known: [], unknown: [] });
  });
});
