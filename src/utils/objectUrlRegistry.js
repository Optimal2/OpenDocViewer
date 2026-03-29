// File: src/utils/objectUrlRegistry.js
/**
 * Centralized helpers for object/blob URL lifecycle management.
 *
 * The viewer now creates many short-lived page URLs on demand. Wrapping URL creation/revocation in a
 * tiny helper makes it easier to keep cleanup logic consistent across provider resets, LRU eviction,
 * and print flows.
 */

/** @type {Set<string>} */
const TRACKED_URLS = new Set();

/**
 * @param {Blob} blob
 * @returns {string}
 */
export function createTrackedObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  TRACKED_URLS.add(url);
  return url;
}

/**
 * @param {(string|null|undefined)} url
 * @returns {void}
 */
export function revokeTrackedObjectUrl(url) {
  const value = String(url || '').trim();
  if (!value) return;
  try {
    URL.revokeObjectURL(value);
  } catch {}
  TRACKED_URLS.delete(value);
}

/**
 * @param {Iterable<string>} urls
 * @returns {void}
 */
export function revokeTrackedObjectUrls(urls) {
  for (const url of urls || []) revokeTrackedObjectUrl(url);
}

/**
 * Revoke every tracked object URL. Mostly useful for defensive shutdown paths.
 * @returns {void}
 */
export function revokeAllTrackedObjectUrls() {
  revokeTrackedObjectUrls(Array.from(TRACKED_URLS));
}
