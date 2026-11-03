// File: src/utils/ocrSearchPlacement.js
/**
 * Where the toolbar's OCR search field goes and how wide it is
 * (components/DocumentToolbar/OcrSearchBar.jsx): inline in the toolbar, grown out of the button
 * to the right into the room the toolbar's spacer leaves, or, when that room is too small,
 * hanging under the toolbar at the button's right edge. The toolbar never overflows for the
 * field (an overflowing toolbar is shifted as a whole, as measured). Pure: the component
 * gathers the numbers.
 */

/** Full width of the field (CSS px). */
export const OCR_SEARCH_PANEL_WIDTH = 340;
/** Below this inline width the field hangs under the toolbar instead. */
export const OCR_SEARCH_PANEL_MIN_INLINE_WIDTH = 200;
/** Air kept between the field and the rest of the toolbar, or the viewport edge when hanging. */
export const OCR_SEARCH_PANEL_MARGIN = 16;
/** Air between the toolbar's lower edge and a hanging field. */
export const OCR_SEARCH_PANEL_HANG_GAP = 6;

/**
 * @typedef {Object} OcrSearchPlacement
 * @property {('inline'|'hanging')} mode
 * @property {number} width  CSS px of the open field.
 * @property {number} offset  Hanging only: CSS px the field is pulled left of its anchor (the
 *   search's right edge) so that it ends inside the viewport when the anchor itself lies
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
 * @param {number=} measures.anchorRight  Right edge of the search (the hanging field's anchor) in
 *   viewport px; beyond the viewport, the field is pulled left by the difference.
 * @param {number=} measures.anchorBottom  Lower edge of the search in viewport px.
 * @param {number=} measures.toolbarBottom  Lower edge of the toolbar in viewport px; a hanging
 *   field starts below it.
 * @returns {OcrSearchPlacement}
 */
export function resolveOcrSearchPlacement({
  toolbarWidth, toolbarScrollWidth, spacerWidth, inlinePanelWidth, viewportWidth, anchorRight, anchorBottom, toolbarBottom,
}) {
  const width = Number(toolbarWidth) || 0;
  if (!(width > 0)) return { mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 };
  const overflow = Math.max(0, (Number(toolbarScrollWidth) || 0) - width);
  const room = (Number(spacerWidth) || 0) + (Number(inlinePanelWidth) || 0) - overflow - OCR_SEARCH_PANEL_MARGIN;
  if (room >= OCR_SEARCH_PANEL_MIN_INLINE_WIDTH) {
    return { mode: 'inline', width: Math.min(OCR_SEARCH_PANEL_WIDTH, Math.floor(room)), offset: 0, top: 0 };
  }
  const viewport = Number(viewportWidth) || 0;
  const cap = viewport > 0 ? viewport - OCR_SEARCH_PANEL_MARGIN : OCR_SEARCH_PANEL_WIDTH;
  const anchor = Number(anchorRight) || 0;
  const offset = viewport > 0 && anchor > viewport - OCR_SEARCH_PANEL_MARGIN / 2
    ? Math.ceil(anchor - (viewport - OCR_SEARCH_PANEL_MARGIN / 2))
    : 0;
  const top = Math.max(0, Math.ceil((Number(toolbarBottom) || 0) - (Number(anchorBottom) || 0))) + OCR_SEARCH_PANEL_HANG_GAP;
  return {
    mode: 'hanging',
    width: Math.max(OCR_SEARCH_PANEL_MIN_INLINE_WIDTH, Math.min(OCR_SEARCH_PANEL_WIDTH, Math.floor(cap))),
    offset,
    top,
  };
}

/**
 * Gather the measures for `resolveOcrSearchPlacement` from the DOM around the search's root.
 *
 * @param {(HTMLElement|null)} root  The `.toolbar-ocr-search` element.
 * @param {(HTMLElement|null)} panel  Its field element.
 * @returns {OcrSearchPlacement}
 */
export function measureOcrSearchPlacement(root, panel) {
  const toolbar = root && typeof root.closest === 'function' ? root.closest('.toolbar') : null;
  const spacer = toolbar ? toolbar.querySelector('.toolbar-spacer') : null;
  if (!toolbar || !spacer || !panel) return resolveOcrSearchPlacement({ toolbarWidth: 0 });
  const inline = !panel.classList.contains('is-hanging');
  const panelStyle = typeof getComputedStyle === 'function' ? getComputedStyle(panel) : null;
  const inlinePanelWidth = inline
    ? panel.getBoundingClientRect().width + (Number.parseFloat(panelStyle?.marginLeft || '0') || 0)
    : 0;
  const rootRect = root.getBoundingClientRect();
  return resolveOcrSearchPlacement({
    toolbarWidth: toolbar.clientWidth,
    toolbarScrollWidth: toolbar.scrollWidth,
    spacerWidth: spacer.getBoundingClientRect().width,
    inlinePanelWidth,
    viewportWidth: typeof document !== 'undefined' ? document.documentElement.clientWidth : 0,
    anchorRight: rootRect.right,
    anchorBottom: rootRect.bottom,
    toolbarBottom: toolbar.getBoundingClientRect().bottom,
  });
}
