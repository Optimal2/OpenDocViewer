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
/** Original formats that must remain lossless when their displayed asset is printed. @type {Map<string, string>} */
const TRACKED_URL_SOURCE_FORMATS = new Map();
const MAX_TRACKED_URLS = 16384;
let cleanupInstalled = false;

function installTrackedUrlCleanup() {
  if (cleanupInstalled || typeof globalThis?.addEventListener !== 'function') return;

  const cleanup = () => {
    revokeAllTrackedObjectUrls();
  };

  globalThis.addEventListener('beforeunload', cleanup, { once: true });
  globalThis.addEventListener('pagehide', cleanup, { once: true });
  cleanupInstalled = true;
}

/**
 * @param {Blob} blob
 * @param {Object=} metadata Original format metadata for a converted Blob.
 * @param {string=} metadata.sourceFormat Original MIME type when conversion changed the Blob MIME type.
 * @returns {string}
 */
export function createTrackedObjectUrl(blob, metadata = {}) {
  installTrackedUrlCleanup();
  const url = URL.createObjectURL(blob);
  TRACKED_URLS.add(url);
  const sourceFormat = String(metadata?.sourceFormat || blob?.type || '').toLowerCase();
  if (sourceFormat === 'image/jxl' || sourceFormat === 'image/avif') {
    TRACKED_URL_SOURCE_FORMATS.set(url, sourceFormat);
  }
  while (TRACKED_URLS.size > MAX_TRACKED_URLS) {
    const oldest = TRACKED_URLS.values().next().value;
    if (!oldest) break;
    revokeTrackedObjectUrl(oldest);
  }
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
  TRACKED_URL_SOURCE_FORMATS.delete(value);
}

/** Return the original JXL/AVIF MIME type for a tracked URL, or an empty string for other assets. */
export function getTrackedObjectUrlSourceFormat(url) {
  return TRACKED_URL_SOURCE_FORMATS.get(String(url || '').trim()) || '';
}

/**
 * @param {Iterable<string>} urls
 * @returns {void}
 */
export function revokeTrackedObjectUrls(urls) {
  for (const url of urls || []) revokeTrackedObjectUrl(url);
}

/**
 * Check whether a blob/object URL is still tracked as live by the viewer.
 * Non-blob URLs are never tracked here and therefore return false.
 *
 * @param {(string|null|undefined)} url
 * @returns {boolean}
 */
export function isTrackedObjectUrl(url) {
  const value = String(url || '').trim();
  if (!value || !/^blob:/i.test(value)) return false;
  return TRACKED_URLS.has(value);
}


/**
 * @returns {number}
 */
export function getTrackedObjectUrlCount() {
  return TRACKED_URLS.size;
}

/**
 * Revoke every tracked object URL. Mostly useful for defensive shutdown paths.
 * @returns {void}
 */
export function revokeAllTrackedObjectUrls() {
  revokeTrackedObjectUrls(Array.from(TRACKED_URLS));
}
