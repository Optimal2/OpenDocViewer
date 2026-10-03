// File: src/utils/toolbarDensity.js
/**
 * Toolbar density on the document root. The "Larger toolbar buttons" preference becomes
 * `data-toolbar-density="large|compact"`; src/styles/toolbar.css maps it to size variables, so no
 * component needs per-size logic.
 */

/**
 * @param {boolean} largeButtons
 * @returns {('large'|'compact')}
 */
export function toolbarDensityFor(largeButtons) {
  return largeButtons === false ? 'compact' : 'large';
}

/**
 * Apply the toolbar density to the document root (SSR-safe).
 *
 * @param {boolean} largeButtons
 * @returns {void}
 */
export function applyToolbarDensityToDocument(largeButtons) {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-toolbar-density', toolbarDensityFor(largeButtons));
  } catch {
    // ignore; DOM not available or locked down
  }
}
