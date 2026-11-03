// File: src/utils/__tests__/ocrStatus.test.js
/**
 * The per-page OCR status the toolbar's search button shows (utils/ocrStatus.js): one key per
 * outcome state, an English fallback and an LED state for each, and the searchable test.
 */
import { describe, expect, it } from 'vitest';
import { hasSearchableOcrText, OCR_STATUS_FALLBACK, OCR_STATUS_LED, ocrStatusKeyOf } from '../ocrStatus.js';

describe('ocrStatusKeyOf', () => {
  it('maps every outcome state to a status key', () => {
    expect(ocrStatusKeyOf(null, null)).toBe('');
    expect(ocrStatusKeyOf({ status: 'queued' }, null)).toBe('working');
    expect(ocrStatusKeyOf({ status: 'probing' }, null)).toBe('working');
    expect(ocrStatusKeyOf({ status: 'recognizing' }, null)).toBe('working');
    expect(ocrStatusKeyOf({ status: 'done', words: [{ text: 'a' }] }, null)).toBe('done');
    expect(ocrStatusKeyOf({ status: 'done', words: [] }, null)).toBe('noText');
    expect(ocrStatusKeyOf({ status: 'skipped', reason: 'text-layer' }, null)).toBe('skippedTextLayer');
    expect(ocrStatusKeyOf({ status: 'skipped', reason: 'unsupported' }, null)).toBe('skipped');
    expect(ocrStatusKeyOf({ status: 'failed' }, null)).toBe('failed');
  });

  it('reports the engine failure over any page state', () => {
    expect(ocrStatusKeyOf({ status: 'done', words: [{ text: 'a' }] }, 'csp')).toBe('unavailable');
    expect(ocrStatusKeyOf(null, 'csp')).toBe('unavailable');
  });

  it('has a fallback text and an LED state for every key', () => {
    for (const key of ['working', 'done', 'noText', 'skippedTextLayer', 'skipped', 'failed', 'unavailable']) {
      expect(typeof OCR_STATUS_FALLBACK[key]).toBe('string');
      expect(['off', 'pending', 'ready', 'active', 'warning', 'error']).toContain(OCR_STATUS_LED[key]);
    }
    expect(OCR_STATUS_LED.done).toBe('ready');
    expect(OCR_STATUS_LED.working).toBe('pending');
    expect(OCR_STATUS_LED.failed).toBe('error');
  });
});

describe('hasSearchableOcrText', () => {
  it('is true only for a done outcome with words', () => {
    expect(hasSearchableOcrText({ status: 'done', words: [{ text: 'a' }] })).toBe(true);
    expect(hasSearchableOcrText({ status: 'done', words: [] })).toBe(false);
    expect(hasSearchableOcrText({ status: 'recognizing' })).toBe(false);
    expect(hasSearchableOcrText(null)).toBe(false);
  });
});
