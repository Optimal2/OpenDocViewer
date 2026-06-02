// File: src/integrations/sessionUrl.js
/**
 * Fetch a host-prepared Portable Document Bundle from a short URL query value.
 *
 * Hosts should use this for large or server-side prepared sessions instead of
 * embedding base64 JSON directly in the viewer URL.
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

function resolveHttpUrl(rawUrl) {
  if (!rawUrl || typeof window === 'undefined') return null;

  try {
    const url = new URL(rawUrl, window.location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url;
  } catch {
    return null;
  }
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

  let response;
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
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const fetchMs = nowMs() - startedMs;

  if (!response.ok) {
    warnSessionUrl(`Session URL returned HTTP ${response.status} ${response.statusText}.`);
    return null;
  }

  const textStartedMs = nowMs();
  const text = await response.text();
  const textMs = nowMs() - textStartedMs;
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
        responseTextBytes: text.length
      }
    };
  } catch (error) {
    warnSessionUrl('Session URL response was not valid JSON.', error);
    return null;
  }
}

export default { readFromSessionUrl };
