// File: src/utils/printSanitize.js
/**
 * File: src/utils/printSanitize.js
 *
 * OpenDocViewer — Print Sanitization Helpers
 *
 * PURPOSE
 *   Small helpers for URL and HTML value safety used by printing modules.
 */

/**
 * Allow-list image sources used for printing.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeImageSrc(url) {
  try {
    return /^data:image\/|^blob:|^https?:\/\//i.test(String(url || ''));
  } catch {
    return false;
  }
}
