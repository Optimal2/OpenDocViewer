// File: src/ocr/window.js
/**
 * Which pages are queued for OCR: the visible page(s) and a fixed number of neighbours.
 *
 * The queue never covers the whole document. Each focus page (the displayed page, and the
 * compare page while comparing) is followed by the next OCR_WINDOW_AHEAD pages in reading
 * direction and then the OCR_WINDOW_BEHIND page(s) before it, so the window holds at most
 * `focus × (1 + ahead + behind)` pages however long the document is. Pages outside the window
 * are not recognised until they come into it. Part of the lazy OCR chunk.
 */

/** Pages queued after each focus page. */
export const OCR_WINDOW_AHEAD = 2;
/** Pages queued before each focus page. */
export const OCR_WINDOW_BEHIND = 1;

/**
 * @param {number} focusCount
 * @param {Object=} options
 * @param {number=} options.ahead
 * @param {number=} options.behind
 * @returns {number} The most pages a window of that many focus pages can hold.
 */
export function maxOcrWindowSize(focusCount, { ahead = OCR_WINDOW_AHEAD, behind = OCR_WINDOW_BEHIND } = {}) {
  return Math.max(0, focusCount) * (1 + Math.max(0, ahead) + Math.max(0, behind));
}

/**
 * Ordered page indexes to process: focus pages first, then the pages after them (nearest first),
 * then the pages before them. Indexes outside `[0, pageCount)` and duplicates are dropped.
 *
 * @param {Object} options
 * @param {Array<number>} options.focusIndexes  Indexes into the viewer's page list, primary first.
 * @param {number} options.pageCount
 * @param {number=} options.ahead  Default OCR_WINDOW_AHEAD.
 * @param {number=} options.behind  Default OCR_WINDOW_BEHIND.
 * @returns {Array<number>}
 */
export function planOcrWindow({ focusIndexes, pageCount, ahead = OCR_WINDOW_AHEAD, behind = OCR_WINDOW_BEHIND }) {
  const total = Math.max(0, Math.floor(Number(pageCount)) || 0);
  const order = [];
  const seen = new Set();
  const push = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= total || seen.has(index)) return;
    seen.add(index);
    order.push(index);
  };
  const focus = [];
  for (const raw of Array.isArray(focusIndexes) ? focusIndexes : []) {
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0 && index < total && !focus.includes(index)) focus.push(index);
  }
  for (const index of focus) push(index);
  for (let step = 1; step <= Math.max(0, ahead); step += 1) {
    for (const index of focus) push(index + step);
  }
  for (let step = 1; step <= Math.max(0, behind); step += 1) {
    for (const index of focus) push(index - step);
  }
  return order;
}
