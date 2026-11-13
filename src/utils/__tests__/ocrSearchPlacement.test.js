// @vitest-environment jsdom
// File: src/utils/__tests__/ocrSearchPlacement.test.js
/**
 * Where the OCR search field goes (utils/ocrSearchPlacement.js): the full width when the
 * toolbar's spacer leaves room, a narrower field when it leaves less, hanging under the toolbar
 * when it leaves too little, an open inline field counting as room when re-placed, an
 * overflowing toolbar counting against it, and the inline default without layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  measureOcrSearchContentWidth,
  OCR_SEARCH_INPUT_MIN_WIDTH,
  OCR_SEARCH_INPUT_PREFERRED_WIDTH,
  OCR_SEARCH_PANEL_HANG_INSET,
  OCR_SEARCH_PANEL_MARGIN,
  OCR_SEARCH_PANEL_MIN_INLINE_WIDTH,
  OCR_SEARCH_PANEL_WIDTH,
  resolveOcrSearchPlacement,
} from '../ocrSearchPlacement.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const base = { toolbarWidth: 1400, toolbarScrollWidth: 1400, spacerWidth: 0, inlinePanelWidth: 0, viewportWidth: 1400 };

describe('resolveOcrSearchPlacement', () => {
  it('gives the full width when the spacer leaves room for it', () => {
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600 })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: OCR_SEARCH_PANEL_WIDTH + OCR_SEARCH_PANEL_MARGIN })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
  });

  it('narrows the field to the room, down to the inline minimum', () => {
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 250.7 })).toEqual({ mode: 'inline', width: 234, offset: 0, top: 0 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: OCR_SEARCH_PANEL_MIN_INLINE_WIDTH + OCR_SEARCH_PANEL_MARGIN })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_MIN_INLINE_WIDTH, offset: 0, top: 0 });
  });

  it('hangs the field under the toolbar when the room is below the minimum, capped to the viewport', () => {
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 215 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 300 })).toEqual({ mode: 'hanging', width: 284, offset: 0, top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 100 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_MIN_INLINE_WIDTH, offset: 0, top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 0 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 6 });
  });

  it('counts an open inline field as room when re-placing, and an overflowing toolbar against it', () => {
    // Open at 340 with the spacer at 0: still room for 340 (the field itself).
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, inlinePanelWidth: 344 })).toEqual({ mode: 'inline', width: 328, offset: 0, top: 0 });
    // The toolbar overflows by 100 px with the field open: that much less room.
    expect(resolveOcrSearchPlacement({ ...base, toolbarScrollWidth: 1500, spacerWidth: 0, inlinePanelWidth: 344 })).toEqual({ mode: 'inline', width: 228, offset: 0, top: 0 });
    expect(resolveOcrSearchPlacement({ ...base, toolbarScrollWidth: 1600, spacerWidth: 0, inlinePanelWidth: 344 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 6 });
  });

  it('pulls a hanging field left when its anchor lies beyond the viewport', () => {
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 1000, anchorRight: 1167.8 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 176, top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 1000, anchorRight: 900 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, viewportWidth: 1000, anchorRight: 1167.8 })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
  });

  it('starts a hanging field below the toolbar\'s lower edge, with a gap', () => {
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, anchorBottom: 47, toolbarBottom: 62 })).toMatchObject({ mode: 'hanging', top: 21 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, anchorBottom: 62, toolbarBottom: 62 })).toMatchObject({ mode: 'hanging', top: 6 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, anchorBottom: 70, toolbarBottom: 62 })).toMatchObject({ mode: 'hanging', top: 6 });
  });

  it('is the inline default without a laid-out toolbar', () => {
    expect(resolveOcrSearchPlacement({ toolbarWidth: 0 })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
    expect(resolveOcrSearchPlacement({})).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
  });

  it('is never narrower than its contents need, and asks for a comfortable input: wider inline when the room allows, hanging when it does not, a wider hanging field, capped to the viewport', () => {
    // Measured contents count the input at its minimum (48 by default); the field asks for 200
    // for it, 152 more, as far as the room allows.
    const extra = OCR_SEARCH_INPUT_PREFERRED_WIDTH - OCR_SEARCH_INPUT_MIN_WIDTH;
    // Contents below the inline minimum in 234 px of room: all of the room, as before.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 250, contentWidth: 200 })).toEqual({ mode: 'inline', width: 234, offset: 0, top: 0 });
    // 300 px of contents in 600 px of room: inline, 452 wide (300 + 152 for the input).
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, contentWidth: 300 })).toEqual({ mode: 'inline', width: 300 + extra, offset: 0, top: 0 });
    // 380.2 px of contents in 600 px of room: inline and 533 wide.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, contentWidth: 380.2 })).toEqual({ mode: 'inline', width: 381 + extra, offset: 0, top: 0 });
    // 300 px of contents in 400 px of room: inline, all of the room (the input gets what is left).
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 416, contentWidth: 300 })).toEqual({ mode: 'inline', width: 400, offset: 0, top: 0 });
    // The input's laid-out minimum counts: 62 of the 300 are the input, so 138 more is asked for.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, contentWidth: 300, inputMinWidth: 62 })).toEqual({ mode: 'inline', width: 300 + OCR_SEARCH_INPUT_PREFERRED_WIDTH - 62, offset: 0, top: 0 });
    // An input already at its preferred width or wider asks for nothing more.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, contentWidth: 300, inputMinWidth: 240 })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
    // 300 px of contents in 284 px of room: hanging, 462 wide (300 + 152, padding and border).
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 300, contentWidth: 300 })).toEqual({ mode: 'hanging', width: 300 + extra + OCR_SEARCH_PANEL_HANG_INSET, offset: 0, top: 6 });
    // 400 px of contents: a hanging field of 562.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 300, contentWidth: 400 })).toEqual({ mode: 'hanging', width: 400 + extra + OCR_SEARCH_PANEL_HANG_INSET, offset: 0, top: 6 });
    // The viewport caps a hanging field whatever its contents need.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, viewportWidth: 300, contentWidth: 400 })).toEqual({ mode: 'hanging', width: 284, offset: 0, top: 6 });
    // Nothing measured: the usual 340 and no preferred width.
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 600, contentWidth: 0, inputMinWidth: 62 })).toEqual({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
    expect(resolveOcrSearchPlacement({ ...base, spacerWidth: 0, inputMinWidth: 62 })).toEqual({ mode: 'hanging', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 6 });
  });
});

describe('measureOcrSearchContentWidth', () => {
  const child = (className, width) => {
    const element = document.createElement(className === 'toolbar-ocr-search-input' ? 'input' : 'span');
    element.className = className;
    element.getBoundingClientRect = () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0 });
    return element;
  };

  it('sums every child but the input at its width, the input at its least laid-out width, and the gaps', () => {
    const panel = document.createElement('div');
    const input = child('toolbar-ocr-search-input', 150);
    // jsdom computes nothing from a stylesheet: the field's 2 px gap and the input's min-width,
    // padding and border (content-box: 48 + 6 + 6 + 1 + 1 = 62) are lent to it.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === panel) return { columnGap: '2px' };
      if (element === input) return { minWidth: '48px', boxSizing: 'content-box', paddingLeft: '6px', paddingRight: '6px', borderLeftWidth: '1px', borderRightWidth: '1px' };
      return computed(element, pseudo);
    });
    panel.append(input, child('toolbar-ocr-search-status', 120.5), child('odv-btn', 28), child('odv-btn', 28));
    expect(measureOcrSearchContentWidth(panel)).toBeCloseTo(62 + 120.5 + 28 + 28 + 3 * 2, 5);
  });

  it('takes the input at its min-width alone when that is border-box, and at 48 px without computed style', () => {
    const panel = document.createElement('div');
    const input = child('toolbar-ocr-search-input', 150);
    panel.append(input, child('odv-btn', 28));
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (
      element === input ? { minWidth: '50px', boxSizing: 'border-box', paddingLeft: '6px', paddingRight: '6px' } : computed(element, pseudo)
    ));
    expect(measureOcrSearchContentWidth(panel)).toBe(50 + 28);
    vi.restoreAllMocks();
    expect(measureOcrSearchContentWidth(panel)).toBe(OCR_SEARCH_INPUT_MIN_WIDTH + 28);
  });

  it('is 0 without a field or children', () => {
    expect(measureOcrSearchContentWidth(null)).toBe(0);
    expect(measureOcrSearchContentWidth(document.createElement('div'))).toBe(0);
  });
});

describe('resolveOcrDetailsWidth', () => {
  it('unfolds to the last detail when the room holds them all', async () => {
    const { resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    expect(resolveOcrDetailsWidth({ room: 300, edges: [60, 140, 220] })).toBe(220);
    expect(resolveOcrDetailsWidth({ room: 220, edges: [60, 140, 220] })).toBe(220);
    expect(resolveOcrDetailsWidth({ room: 500, edges: [58.4] })).toBe(59);
  });

  it('drops details whole from the end when the room is too small, and never the first', async () => {
    const { resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    expect(resolveOcrDetailsWidth({ room: 219.9, edges: [60, 140, 220] })).toBe(140);
    expect(resolveOcrDetailsWidth({ room: 100, edges: [60, 140, 220] })).toBe(60);
    expect(resolveOcrDetailsWidth({ room: 0, edges: [60, 140, 220] })).toBe(60);
    expect(resolveOcrDetailsWidth({ room: -8, edges: [60, 140, 220] })).toBe(60);
    expect(resolveOcrDetailsWidth({ room: Number.NaN, edges: [60, 140] })).toBe(60);
  });

  it('is nothing without a detail to measure', async () => {
    const { resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    expect(resolveOcrDetailsWidth({ room: 300, edges: [] })).toBe(0);
    expect(resolveOcrDetailsWidth({ room: 300, edges: undefined })).toBe(0);
    expect(resolveOcrDetailsWidth({ room: 300, edges: [0, Number.NaN] })).toBe(0);
  });
});

describe('measureOcrDetailsWidth', () => {
  it('has nothing to say without a root, the details or a toolbar spacer', async () => {
    const { measureOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    expect(measureOcrDetailsWidth(null)).toBeNull();
    expect(measureOcrDetailsWidth({})).toBeNull();
  });
});

describe('resolveOcrDetailsRoom', () => {
  const MARGIN = 7.5;

  it('is what the spacer has left, less the margin the details will take', async () => {
    const { resolveOcrDetailsRoom } = await import('../ocrSearchPlacement.js');
    expect(resolveOcrDetailsRoom({ spacerWidth: 300, detailsWidth: 0, marginRight: 0, unfoldedMargin: MARGIN, overflow: 0 })).toBe(292.5);
  });

  it('is the same folded, unfolded and in between: the spacer gives what the details take', async () => {
    const { resolveOcrDetailsRoom, resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    const edges = [60, 140, 220];
    const folded = resolveOcrDetailsRoom({ spacerWidth: 300, detailsWidth: 0, marginRight: 0, unfoldedMargin: MARGIN, overflow: 0 });
    const halfway = resolveOcrDetailsRoom({ spacerWidth: 300 - 110 - 3, detailsWidth: 110, marginRight: 3, unfoldedMargin: MARGIN, overflow: 0 });
    const unfolded = resolveOcrDetailsRoom({ spacerWidth: 300 - 220 - MARGIN, detailsWidth: 220, marginRight: MARGIN, unfoldedMargin: MARGIN, overflow: 0 });
    expect(halfway).toBe(folded);
    expect(unfolded).toBe(folded);
    expect(resolveOcrDetailsWidth({ room: unfolded, edges })).toBe(220);
  });

  it('counts what the toolbar overflows by: unfolded details shrink when the room does', async () => {
    const { resolveOcrDetailsRoom, resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    const edges = [60, 140, 220];
    // Unfolded to all three, then the window narrows until the toolbar's end is 50 px outside:
    // the spacer is at nothing and cannot say so, the overflow does.
    const squeezed = resolveOcrDetailsRoom({ spacerWidth: 0, detailsWidth: 220, marginRight: MARGIN, unfoldedMargin: MARGIN, overflow: 50 });
    expect(squeezed).toBe(170);
    expect(resolveOcrDetailsWidth({ room: squeezed, edges })).toBe(140);
    // Shrunk to two, the spacer has the 30 px that are over: the same room, the same answer.
    const settled = resolveOcrDetailsRoom({ spacerWidth: 30, detailsWidth: 140, marginRight: MARGIN, unfoldedMargin: MARGIN, overflow: 0 });
    expect(settled).toBe(squeezed);
  });

  it('is negative in a toolbar that overflows without the details, folded or unfolded to the count alone', async () => {
    const { resolveOcrDetailsRoom, resolveOcrDetailsWidth } = await import('../ocrSearchPlacement.js');
    const folded = resolveOcrDetailsRoom({ spacerWidth: 0, detailsWidth: 0, marginRight: 0, unfoldedMargin: MARGIN, overflow: 80 });
    const countOnly = resolveOcrDetailsRoom({ spacerWidth: 0, detailsWidth: 60, marginRight: MARGIN, unfoldedMargin: MARGIN, overflow: 80 + 60 + MARGIN });
    expect(folded).toBe(-87.5);
    expect(countOnly).toBe(folded);
    expect(resolveOcrDetailsWidth({ room: folded, edges: [60, 140, 220] })).toBe(60);
  });

  it('reads what is no number as nothing', async () => {
    const { resolveOcrDetailsRoom } = await import('../ocrSearchPlacement.js');
    expect(resolveOcrDetailsRoom({ spacerWidth: 100, detailsWidth: undefined, marginRight: Number.NaN, unfoldedMargin: undefined, overflow: -5 })).toBe(100);
  });
});
