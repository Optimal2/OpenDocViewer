// File: src/components/DocumentViewer/compareViewKeys.js
/**
 * File: src/components/DocumentViewer/compareViewKeys.js
 *
 * Keyboard targets shared by the full-surface compare views (CompareOverlayView.jsx,
 * CompareCurtainView.jsx): which focused elements keep keys for themselves, and when Escape
 * closes the view.
 *
 * @module compareViewKeys
 */

/**
 * Keys typed into fields (and controls that handle their own arrows) must not reach the view.
 *
 * @param {*} target
 * @returns {boolean}
 */
export function isOwnKeyTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [data-odv-shortcuts="off"]');
}

/**
 * Escape closes the view unless a text field has focus (Escape undoes its typed value there).
 * A range input has no text to undo, so Escape from a slider still closes the view.
 *
 * @param {*} target
 * @returns {boolean}
 */
export function shouldEscapeCloseView(target) {
  if (target instanceof HTMLInputElement && target.type === 'range') return true;
  return !isOwnKeyTarget(target);
}

/** @returns {boolean} */
export function hasActiveModalDialog() {
  return typeof document !== 'undefined'
    && !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]');
}
