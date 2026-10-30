// File: src/ocr/__tests__/window.test.js
/**
 * The OCR window: focus pages first, then the following pages nearest first, then the preceding
 * page; never the whole document, and never more than focus × (1 + ahead + behind) pages.
 */
import { describe, expect, it } from 'vitest';
import { OCR_WINDOW_AHEAD, OCR_WINDOW_BEHIND, maxOcrWindowSize, planOcrWindow } from '../window.js';

describe('planOcrWindow', () => {
  it('queues the focus page, two ahead and one behind, in that order', () => {
    expect(OCR_WINDOW_AHEAD).toBe(2);
    expect(OCR_WINDOW_BEHIND).toBe(1);
    expect(planOcrWindow({ focusIndexes: [10], pageCount: 100 })).toEqual([10, 11, 12, 9]);
  });

  it('clips the window at the document edges', () => {
    expect(planOcrWindow({ focusIndexes: [0], pageCount: 2 })).toEqual([0, 1]);
    expect(planOcrWindow({ focusIndexes: [4], pageCount: 5 })).toEqual([4, 3]);
    expect(planOcrWindow({ focusIndexes: [0], pageCount: 1 })).toEqual([0]);
  });

  it('interleaves two focus pages (compare view) and drops duplicates', () => {
    expect(planOcrWindow({ focusIndexes: [3, 4], pageCount: 50 })).toEqual([3, 4, 5, 6, 2]);
    expect(planOcrWindow({ focusIndexes: [3, 3], pageCount: 50 })).toEqual([3, 4, 5, 2]);
    expect(planOcrWindow({ focusIndexes: [20, 3], pageCount: 50 })).toEqual([20, 3, 21, 4, 22, 5, 19, 2]);
  });

  it('ignores focus values that are not page indexes', () => {
    expect(planOcrWindow({ focusIndexes: [-1, 1.5, NaN, 'x', 70, 2], pageCount: 50 })).toEqual([2, 3, 4, 1]);
    expect(planOcrWindow({ focusIndexes: [], pageCount: 50 })).toEqual([]);
    expect(planOcrWindow({ focusIndexes: [1], pageCount: 0 })).toEqual([]);
  });

  it('never exceeds the cap however long the document is (the bound Linus asked for)', () => {
    for (const pageCount of [1, 4, 87, 5000]) {
      for (const focus of [[0], [1234], [pageCount - 1], [10, 11], [5, 4000]]) {
        const order = planOcrWindow({ focusIndexes: focus, pageCount });
        const cap = maxOcrWindowSize(focus.length);
        expect(order.length).toBeLessThanOrEqual(cap);
        expect(order.length).toBeLessThanOrEqual(pageCount);
        expect(new Set(order).size).toBe(order.length);
      }
    }
    expect(maxOcrWindowSize(1)).toBe(4);
    expect(maxOcrWindowSize(2)).toBe(8);
    expect(maxOcrWindowSize(1, { ahead: 5, behind: 0 })).toBe(6);
  });

  it('accepts other radii', () => {
    expect(planOcrWindow({ focusIndexes: [5], pageCount: 20, ahead: 0, behind: 2 })).toEqual([5, 4, 3]);
    expect(planOcrWindow({ focusIndexes: [5], pageCount: 20, ahead: 1, behind: 0 })).toEqual([5, 6]);
  });
});
