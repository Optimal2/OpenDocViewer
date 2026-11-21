import { describe, expect, it } from 'vitest';
import { normalizeCustomPrintSelectionState } from '../DocumentViewer/useDocumentViewer.js';

describe('custom print selection state', () => {
  it('distinguishes an explicitly empty selection from no custom selection', () => {
    expect(normalizeCustomPrintSelectionState([], 3)).toEqual([]);
    expect(normalizeCustomPrintSelectionState(null, 3)).toBeNull();
  });

  it('keeps a reordered or partial sequence and clears only the natural full sequence', () => {
    expect(normalizeCustomPrintSelectionState([3, 1], 3)).toEqual([3, 1]);
    expect(normalizeCustomPrintSelectionState([2, 1], 3)).toEqual([2, 1]);
    expect(normalizeCustomPrintSelectionState([1, 2, 3], 3)).toBeNull();
  });
});
