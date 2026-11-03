// File: src/utils/__tests__/ocrSearchPlacement.test.js
/**
 * Where the OCR search field goes (utils/ocrSearchPlacement.js): the full width when the
 * toolbar's spacer leaves room, a narrower field when it leaves less, hanging under the toolbar
 * when it leaves too little, an open inline field counting as room when re-placed, an
 * overflowing toolbar counting against it, and the inline default without layout.
 */
import { describe, expect, it } from 'vitest';
import {
  OCR_SEARCH_PANEL_MARGIN,
  OCR_SEARCH_PANEL_MIN_INLINE_WIDTH,
  OCR_SEARCH_PANEL_WIDTH,
  resolveOcrSearchPlacement,
} from '../ocrSearchPlacement.js';

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
    // The toolbar overflows by 112 px with the field open: that much less room.
    expect(resolveOcrSearchPlacement({ ...base, toolbarScrollWidth: 1512, spacerWidth: 0, inlinePanelWidth: 344 })).toEqual({ mode: 'inline', width: 216, offset: 0, top: 0 });
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
});
