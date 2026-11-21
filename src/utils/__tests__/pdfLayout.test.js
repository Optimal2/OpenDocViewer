import { describe, expect, it } from 'vitest';
import { normalizePdfLayoutValue } from '../pdfLayout.js';

describe('PDF layout values', () => {
  it('preserves an explicit numeric zero', () => {
    expect(normalizePdfLayoutValue(0, 8)).toBe(0);
  });

  it('keeps the previous defaults for missing and invalid values', () => {
    for (const value of [undefined, null, '', 'not-a-number', '0']) {
      expect(normalizePdfLayoutValue(value, 18)).toBe(18);
    }
  });

  it('keeps positive values and clamps negative values to zero', () => {
    expect(normalizePdfLayoutValue(12.5, 8)).toBe(12.5);
    expect(normalizePdfLayoutValue(-4, 8)).toBe(0);
  });
});
