// File: src/utils/ocrSearchPlacement.js
/**
 * Where the toolbar's OCR search field goes and how wide it is
 * (components/DocumentToolbar/OcrSearchBar.jsx): inline in the toolbar, grown out of the button
 * to the right into the room the toolbar's spacer leaves, or, when that room is too small,
 * hanging under the toolbar at the button's right edge. The toolbar never overflows for the
 * field (an overflowing toolbar is shifted as a whole, as measured). The field is never
 * narrower than its contents need with the input at its minimum: its status ("Match 3/12 ·
 * 118/300 pages searched") is never cut short, the field grows for it instead, and hangs when
 * the toolbar has no room for it. Pure: the component gathers the numbers.
 */

/** Full width of the field (CSS px). */
export const OCR_SEARCH_PANEL_WIDTH = 340;
/**
 * Below this inline width the field hangs under the toolbar instead: the field's contents (the
 * input at its minimum, an empty status, the four buttons and their gaps) need about 210 px, and
 * a hanging field spends 10 px more on padding and border.
 */
export const OCR_SEARCH_PANEL_MIN_INLINE_WIDTH = 220;
/** The input's least width (CSS px), as `.toolbar-ocr-search-input` has it. */
export const OCR_SEARCH_INPUT_MIN_WIDTH = 48;
/** Padding and border a hanging field adds around its contents (CSS px, both sides). */
export const OCR_SEARCH_PANEL_HANG_INSET = 10;
/** Air kept between the field and the rest of the toolbar; half of it to the viewport edge when hanging. */
export const OCR_SEARCH_PANEL_MARGIN = 16;
/** Air between the toolbar's lower edge and a hanging field. */
export const OCR_SEARCH_PANEL_HANG_GAP = 6;

/**
 * @typedef {Object} OcrSearchPlacement
 * @property {('inline'|'hanging')} mode
 * @property {number} width  CSS px of the open field.
 * @property {number} offset  Hanging only: CSS px the field is pulled left of its anchor (the
 *   button's right edge) so that it ends inside the viewport when the anchor itself lies
 *   outside (a toolbar that overflows on its own). 0 inline.
 * @property {number} top  Hanging only: CSS px between the search's lower edge and the field's
 *   top, so that the field starts below the toolbar's lower edge (the search sits inside the
 *   toolbar's padding) with OCR_SEARCH_PANEL_HANG_GAP of air. 0 inline.
 */

/**
 * @param {Object} measures
 * @param {number} measures.toolbarWidth  The toolbar's client width; 0 or less means no layout
 *   (jsdom), which gives the inline default.
 * @param {number} measures.toolbarScrollWidth  The toolbar's scroll width (overflow shows here).
 * @param {number} measures.spacerWidth  Width of the toolbar's spacer (the free room).
 * @param {number} measures.inlinePanelWidth  What the field takes inline right now (0 when closed
 *   or hanging): it is room too, since the field is being re-placed.
 * @param {number} measures.viewportWidth  For the hanging field's cap and offset.
 * @param {number=} measures.anchorRight  Right edge of the button (the hanging field's anchor) in
 *   viewport px; beyond the viewport, the field is pulled left by the difference.
 * @param {number=} measures.anchorBottom  Lower edge of the button in viewport px.
 * @param {number=} measures.toolbarBottom  Lower edge of the toolbar in viewport px; a hanging
 *   field starts below it.
 * @param {number=} measures.contentWidth  CSS px the field's contents need with the input at
 *   its minimum (the status at its full width, the buttons, the gaps); the field is never
 *   narrower inline, and hangs when the room is. 0 or omitted: the inline minimum.
 * @returns {OcrSearchPlacement}
 */
export function resolveOcrSearchPlacement({
  toolbarWidth, toolbarScrollWidth, spacerWidth, inlinePanelWidth, viewportWidth, anchorRight, anchorBottom, toolbarBottom, contentWidth,
}) {
  const width = Number(toolbarWidth) || 0;
  if (!(width > 0)) return { mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 };
  const needed = Math.max(OCR_SEARCH_PANEL_MIN_INLINE_WIDTH, Math.ceil(Number(contentWidth) || 0));
  const overflow = Math.max(0, (Number(toolbarScrollWidth) || 0) - width);
  const room = (Number(spacerWidth) || 0) + (Number(inlinePanelWidth) || 0) - overflow - OCR_SEARCH_PANEL_MARGIN;
  if (room >= needed) {
    return { mode: 'inline', width: Math.min(Math.max(OCR_SEARCH_PANEL_WIDTH, needed), Math.floor(room)), offset: 0, top: 0 };
  }
  const viewport = Number(viewportWidth) || 0;
  const cap = viewport > 0 ? viewport - OCR_SEARCH_PANEL_MARGIN : OCR_SEARCH_PANEL_WIDTH;
  const anchor = Number(anchorRight) || 0;
  const offset = viewport > 0 && anchor > viewport - OCR_SEARCH_PANEL_MARGIN / 2
    ? Math.ceil(anchor - (viewport - OCR_SEARCH_PANEL_MARGIN / 2))
    : 0;
  const top = Math.max(0, Math.ceil((Number(toolbarBottom) || 0) - (Number(anchorBottom) || 0))) + OCR_SEARCH_PANEL_HANG_GAP;
  // A hanging field holds its contents inside its padding and border; the viewport caps it
  // (a status wider than the viewport is cut, there is nowhere else for it).
  const hanging = Math.max(OCR_SEARCH_PANEL_WIDTH, needed + OCR_SEARCH_PANEL_HANG_INSET);
  return {
    mode: 'hanging',
    width: Math.max(OCR_SEARCH_PANEL_MIN_INLINE_WIDTH, Math.min(hanging, Math.floor(cap))),
    offset,
    top,
  };
}

/**
 * The input's least width as laid out (CSS px): its `min-width`, plus its padding and border
 * when they lie outside it (the input is content-box: 48 px of content and 14 px around it).
 *
 * @param {HTMLElement} input
 * @returns {number}
 */
function measureOcrSearchInputMinWidth(input) {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(input) : null;
  const min = Number.parseFloat(style?.minWidth || '') || OCR_SEARCH_INPUT_MIN_WIDTH;
  if (!style || style.boxSizing === 'border-box') return min;
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'];
  return min + edges.reduce((sum, edge) => sum + (Number.parseFloat(style[edge] || '') || 0), 0);
}

/**
 * CSS px the field's contents need with the input at its minimum: every child but the input at
 * its width (the status is not shrunk, so its width is its text's), the gaps between them, and
 * the input's least laid-out width. 0 without a laid-out field.
 *
 * @param {(HTMLElement|null)} panel  The `.toolbar-ocr-search-panel` element.
 * @returns {number}
 */
export function measureOcrSearchContentWidth(panel) {
  if (!panel || typeof panel.getBoundingClientRect !== 'function') return 0;
  const children = Array.from(panel.children || []);
  if (children.length === 0) return 0;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(panel) : null;
  const gap = Number.parseFloat(style?.columnGap || style?.gap || '0') || 0;
  let total = gap * (children.length - 1);
  for (const child of children) {
    total += child.classList?.contains('toolbar-ocr-search-input')
      ? measureOcrSearchInputMinWidth(child)
      : (child.getBoundingClientRect?.().width || 0);
  }
  return total;
}

/**
 * Gather the measures for `resolveOcrSearchPlacement` from the DOM around the search's root.
 *
 * @param {(HTMLElement|null)} root  The `.toolbar-ocr-search` element.
 * @param {(HTMLElement|null)} panel  Its field element.
 * @param {(HTMLElement|null)=} anchor  The button the field hangs from; the root when omitted.
 *   Measured on its own because the root also holds the open inline field: re-placed from
 *   inline to hanging on a resize, the root's right edge would be the field's, not the button's.
 * @returns {OcrSearchPlacement}
 */
export function measureOcrSearchPlacement(root, panel, anchor = null) {
  const toolbar = root && typeof root.closest === 'function' ? root.closest('.toolbar') : null;
  const spacer = toolbar ? toolbar.querySelector('.toolbar-spacer') : null;
  if (!toolbar || !spacer || !panel) return resolveOcrSearchPlacement({ toolbarWidth: 0 });
  const inline = !panel.classList.contains('is-hanging');
  const panelStyle = typeof getComputedStyle === 'function' ? getComputedStyle(panel) : null;
  const inlinePanelWidth = inline
    ? panel.getBoundingClientRect().width + (Number.parseFloat(panelStyle?.marginLeft || '0') || 0)
    : 0;
  const rootRect = (anchor || root).getBoundingClientRect();
  return resolveOcrSearchPlacement({
    toolbarWidth: toolbar.clientWidth,
    toolbarScrollWidth: toolbar.scrollWidth,
    spacerWidth: spacer.getBoundingClientRect().width,
    inlinePanelWidth,
    viewportWidth: typeof document !== 'undefined' ? document.documentElement.clientWidth : 0,
    anchorRight: rootRect.right,
    anchorBottom: rootRect.bottom,
    toolbarBottom: toolbar.getBoundingClientRect().bottom,
    contentWidth: measureOcrSearchContentWidth(panel),
  });
}
