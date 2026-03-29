// File: src/utils/idUtils.js
/**
 * OpenDocViewer — small opaque identifier helpers.
 *
 * These helpers prefer Web Crypto when available and otherwise fall back to a monotonic
 * time/counter scheme. The fallback deliberately avoids `Math.random()` so identifier creation
 * uses a monotonic fallback and lint/security tooling does not interpret it as
 * security-sensitive randomness.
 */

let fallbackCounter = 0;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an opaque identifier fragment suitable for synthetic keys and document ids.
 *
 * @param {number=} byteLength Number of random bytes to encode (clamped to 4..32).
 * @returns {string}
 */
export function createOpaqueIdFragment(byteLength = 8) {
  const size = Math.max(4, Math.min(32, Math.floor(Number(byteLength) || 8)));

  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID().replace(/-/g, '').slice(0, size * 2);
    }
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      return bytesToHex(cryptoObj.getRandomValues(new Uint8Array(size)));
    }
  } catch {}

  fallbackCounter += 1;
  const perfNow = typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;
  return [
    Date.now().toString(36),
    Math.floor(perfNow * 1000).toString(36),
    fallbackCounter.toString(36),
  ].join('');
}

/**
 * Create a prefixed opaque identifier.
 *
 * @param {string} prefix
 * @param {number=} byteLength Number of random bytes to encode in the suffix.
 * @returns {string}
 */
export function createOpaqueId(prefix, byteLength = 8) {
  const normalizedPrefix = String(prefix || 'id')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'id';

  return `${normalizedPrefix}-${createOpaqueIdFragment(byteLength)}`;
}
