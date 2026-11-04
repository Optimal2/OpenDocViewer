// File: src/utils/keyTipLayout.js
/**
 * Where the key tips go (components/KeyTips.jsx): one label under each toolbar button, centred
 * on the button, packed into rows so that the labels of neighbouring buttons do not cover each
 * other. The labels are laid left to right in the order of the buttons; each takes the first
 * row (from the top) whose last label ends before it starts, and when every row is taken it
 * goes to the row that ends first. The rows start under the buttons' lowest edge, so a tip
 * never covers its button. Pure geometry, no DOM: the component measures and this places.
 */

/** Gap between two labels in a row and between the rows (CSS px). */
export const KEY_TIP_GAP = 4;
/** Rows the labels may spread over before they are allowed to overlap. */
export const KEY_TIP_MAX_ROWS = 4;

/**
 * @typedef {Object} KeyTipInput
 * @property {string} label
 * @property {{ left:number, top:number, width:number, height:number }} rect  The button's viewport rect.
 * @property {number} width  The label's width (measured, or estimated from its length).
 * @property {number} height  The label's height.
 */

/**
 * @typedef {Object} KeyTipPlacement
 * @property {string} label
 * @property {number} left  Viewport px of the label's left edge.
 * @property {number} top
 * @property {number} row
 */

/**
 * @param {Array<KeyTipInput>} tips
 * @param {number} viewportWidth  Labels are kept inside [0, viewportWidth].
 * @param {Object=} options
 * @param {number=} options.gap  Default KEY_TIP_GAP.
 * @param {number=} options.maxRows  Default KEY_TIP_MAX_ROWS.
 * @returns {Array<KeyTipPlacement>}
 */
export function packKeyTips(tips, viewportWidth, { gap = KEY_TIP_GAP, maxRows = KEY_TIP_MAX_ROWS } = {}) {
  const list = Array.isArray(tips) ? tips.filter((tip) => tip && tip.rect && tip.label) : [];
  if (list.length === 0) return [];
  const width = Math.max(0, Number(viewportWidth) || 0);
  const baseline = Math.max(...list.map((tip) => tip.rect.top + tip.rect.height)) + gap;
  const rowHeight = Math.max(...list.map((tip) => Number(tip.height) || 0)) + gap;
  /** Right edge of the last label in each row. */
  const rowEnds = [];
  return list.map((tip) => {
    const labelWidth = Math.max(0, Number(tip.width) || 0);
    let left = tip.rect.left + tip.rect.width / 2 - labelWidth / 2;
    if (width > 0) left = Math.min(Math.max(0, left), Math.max(0, width - labelWidth));
    let row = rowEnds.findIndex((end) => end + gap <= left);
    if (row < 0) {
      if (rowEnds.length < maxRows) {
        row = rowEnds.length;
        rowEnds.push(-Infinity);
      } else {
        row = rowEnds.indexOf(Math.min(...rowEnds));
      }
    }
    rowEnds[row] = left + labelWidth;
    return { label: tip.label, left, top: baseline + row * rowHeight, row };
  });
}
