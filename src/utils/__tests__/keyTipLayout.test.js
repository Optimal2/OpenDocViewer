// File: src/utils/__tests__/keyTipLayout.test.js
/**
 * Key tip placement (utils/keyTipLayout.js): labels centred under their buttons, packed into
 * rows so neighbours do not overlap, kept inside the viewport, and overlapping only when the
 * rows run out.
 */
import { describe, expect, it } from 'vitest';
import { KEY_TIP_GAP, KEY_TIP_MAX_ROWS, packKeyTips } from '../keyTipLayout.js';

const button = (left, width = 32) => ({ left, top: 10, width, height: 32 });
const tip = (label, left, width) => ({ label, rect: button(left), width, height: 16 });

describe('packKeyTips', () => {
  it('centres each label under its button, below the lowest button edge', () => {
    const [placed] = packKeyTips([tip('Zooma in', 100, 60)], 1000);
    expect(placed).toEqual({ label: 'Zooma in', left: 86, top: 42 + KEY_TIP_GAP, row: 0 });
  });

  it('moves a label that would cover its neighbour down a row, and reuses a row once it is free', () => {
    // Three buttons 36 px apart with 60 px labels: the second cannot sit beside the first (row 0
    // ends at 86 + 60 = 146, the second starts at 122), the third fits after the first.
    const placed = packKeyTips([tip('Ett', 100, 60), tip('Två', 136, 60), tip('Tre', 172, 60)], 1000);
    expect(placed.map((entry) => entry.row)).toEqual([0, 1, 0]);
    expect(placed[0].left).toBe(86);
    expect(placed[1].left).toBe(122);
    expect(placed[2].left).toBe(158);
    expect(placed[1].top).toBe(placed[0].top + 16 + KEY_TIP_GAP);
  });

  it('keeps a label inside the viewport', () => {
    const placed = packKeyTips([tip('Första', 0, 80), tip('Sista', 980, 80)], 1000);
    expect(placed[0].left).toBe(0);
    expect(placed[1].left).toBe(920);
  });

  it('lets labels overlap only when every row is taken, on the row that ends first', () => {
    const tips = Array.from({ length: KEY_TIP_MAX_ROWS + 1 }, (_, index) => tip(`K${index}`, 100 + index * 10, 100));
    const placed = packKeyTips(tips, 2000);
    expect(placed.slice(0, KEY_TIP_MAX_ROWS).map((entry) => entry.row)).toEqual([0, 1, 2, 3]);
    expect(placed[KEY_TIP_MAX_ROWS].row).toBe(0);
  });

  it('ignores entries without a label or a rect and tolerates no input', () => {
    expect(packKeyTips([{ label: '', rect: button(0) }, { label: 'x' }, null], 100)).toEqual([]);
    expect(packKeyTips(null, 100)).toEqual([]);
  });
});
