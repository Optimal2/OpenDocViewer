import { describe, expect, it } from 'vitest';
import { readPrintLogFields } from '../userLogPayload.js';

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
});
