// File: src/integrations/sessionUrl.js
/**
 * Fetch a host-prepared Portable Document Bundle from a short URL query value.
 *
 * Hosts should use this for large or server-side prepared sessions instead of
 * embedding base64 JSON directly in the viewer URL. The URL may be http(s) or a
 * same-origin `blob:` URL created by the host page.
 */

const MAX_RESPONSE_TEXT_LEN = 256_000_000;
const SESSION_URL_TIMEOUT_MS = 180_000;

/**
 * @typedef {Object} SessionUrlResult
 * @property {('sessionurl'|'sessionUrl'|'bundleurl'|'bundleUrl')} source
 * @property {*} data
 */

function readSessionUrlParameter() {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') {
    return null;
  }

  const q = new URLSearchParams(window.location.search);
  for (const source of ['sessionurl', 'sessionUrl', 'bundleurl', 'bundleUrl']) {
    const value = q.get(source);
    if (value) return { source, value };
  }

  return null;
}

export function hasSessionUrlParameter() {
  return !!readSessionUrlParameter();
}

function nowMs() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

/**
 * Protocols a session URL may use. `blob:` lets a same-origin host page build the bundle in the
 * browser (`URL.createObjectURL(new Blob([json]))`) and hand it over without a server endpoint;
 * blob URLs are origin-bound, so a page from another origin cannot be read this way. The fetch,
 * timeout, size cap and JSON parsing below are the same for every protocol.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

function resolveHttpUrl(rawUrl) {
  if (!rawUrl || typeof window === 'undefined') return null;

  try {
    const url = new URL(rawUrl, window.location.href);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/**
 * UTF-8 byte length of a string, without allocating an encoded copy.
 * @param {string} text
 * @returns {number}
 */
function utf8ByteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

function warnSessionUrl(message, detail) {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  if (detail === undefined) {
    console.warn(`[OpenDocViewer] ${message}`);
    return;
  }

  console.warn(`[OpenDocViewer] ${message}`, detail);
}

/**
 * Read and fetch a session payload URL from the viewer query string.
 *
 * Supported query names:
 *   ?sessionurl=<url>
 *   ?sessionUrl=<url>
 *   ?bundleurl=<url>
 *   ?bundleUrl=<url>
 *
 * The endpoint must return JSON. Network errors, timeouts, unsupported URLs,
 * non-2xx responses, oversized responses, empty responses, and invalid JSON
 * are reported as warnings and return null.
 *
 * @returns {Promise.<(SessionUrlResult|null)>}
 */
export async function readFromSessionUrl() {
  const parameter = readSessionUrlParameter();
  const url = resolveHttpUrl(parameter?.value);
  if (!url) return null;
  const startedMs = nowMs();

  const controller = typeof AbortController !== 'undefined'
    ? new AbortController()
    : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), SESSION_URL_TIMEOUT_MS)
    : null;

  // The time limit covers the whole transfer: the response headers and the body.
  let response;
  let fetchMs;
  let text;
  let textMs;
  try {
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      warnSessionUrl(`Failed to fetch session URL '${url.toString()}'.`, error);
      return null;
    }
    fetchMs = nowMs() - startedMs;

    if (!response.ok) {
      warnSessionUrl(`Session URL returned HTTP ${response.status} ${response.statusText}.`);
      return null;
    }

    const textStartedMs = nowMs();
    try {
      text = await response.text();
    } catch (error) {
      warnSessionUrl(`Failed to read the session URL response from '${url.toString()}'.`, error);
      return null;
    }
    textMs = nowMs() - textStartedMs;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (!text) {
    warnSessionUrl('Session URL returned an empty response.');
    return null;
  }

  if (text.length > MAX_RESPONSE_TEXT_LEN) {
    warnSessionUrl(`Session URL response was too large (${text.length} characters; maximum is ${MAX_RESPONSE_TEXT_LEN}).`);
    return null;
  }

  try {
    const parseStartedMs = nowMs();
    const data = JSON.parse(text);
    const parseMs = nowMs() - parseStartedMs;
    return {
      source: parameter?.source || 'sessionurl',
      data,
      timing: {
        fetchMs,
        textMs,
        parseMs,
        totalMs: nowMs() - startedMs,
        responseTextBytes: utf8ByteLength(text)
      }
    };
  } catch (error) {
    warnSessionUrl('Session URL response was not valid JSON.', error);
    return null;
  }
}

export default { readFromSessionUrl };
