// File: src/utils/__tests__/pdfPrebuildPlan.test.js
/**
 * The all-pages PDF prebuild plans the variant the print dialog will actually produce.
 */

import { describe, it, expect } from 'vitest';
import { createPdfPrebuildAllPagesVariants } from '../pdfPrebuildPlan.js';

function config({ userLog, printHeader } = {}) {
  return {
    print: { pdf: { prebuildAllPages: { enabled: true, languages: ['sv'] } } },
    userLog,
    printHeader,
  };
}

const REASON_OPTIONS = [
  { value: 'care', label: 'Care' },
  { value: 'audit', label: 'Audit' },
];

describe('createPdfPrebuildAllPagesVariants', () => {
  it('plans one variant without a reason when the dialog shows no reason field', () => {
    const plan = createPdfPrebuildAllPagesVariants(config(), 'sv');
    expect(plan.enabled).toBe(true);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0]).toMatchObject({ reason: null, forWhom: null, mode: 'all' });
    expect(plan.variants[0].reasonSelection.value).toBe('');
  });

  it('plans one variant per fixed reason option when the reason field is shown', () => {
    const plan = createPdfPrebuildAllPagesVariants(config({
      userLog: { enabled: true, ui: { fields: { reason: { source: { options: REASON_OPTIONS } } } } },
    }), 'sv');
    expect(plan.variants.map((variant) => variant.reasonSelection.value)).toEqual(['care', 'audit']);
  });

  it('plans nothing when the reason field is shown but has only free text', () => {
    const plan = createPdfPrebuildAllPagesVariants(config({ printHeader: { enabled: true } }), 'sv');
    expect(plan.variants).toEqual([]);
  });
});
