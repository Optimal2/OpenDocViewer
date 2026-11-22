import { describe, expect, it } from 'vitest';
import { neutralizeForWhom, readPrintLogFields } from '../userLogPayload.js';

describe('user log payload compatibility', () => {
  it('reads reason and recipient from the viewer JSON envelope', () => {
    expect(readPrintLogFields({ meta: { reason: 'review', forWhom: 'recipient' } })).toEqual({
      reason: 'review',
      forWhom: 'recipient',
    });
  });

  it('keeps accepting the original top-level form fields', () => {
    expect(readPrintLogFields({ reason: 'review', forWhom: 'recipient' })).toEqual({
      reason: 'review',
      forWhom: 'recipient',
    });
  });

  it('replaces $ and # in the recipient instead of dropping the record', () => {
    expect(neutralizeForWhom('Ward #3 $A')).toBe('Ward _3 _A');
    expect(neutralizeForWhom('Ward 3')).toBe('Ward 3');
    expect(neutralizeForWhom('##$$')).toBe('____');
  });
});
