// File: src/integrations/sessionUrl.js
/**
 * Fetch a host-prepared Portable Document Bundle from a short URL query value.
 *
 * Hosts should use this for large or server-side prepared sessions instead of
 * embedding base64 JSON directly in the viewer URL.
 */

const MAX_RESPONSE_TEXT_LEN = 2_000_000;

/**
 * @typedef {Object} SessionUrlResult
 * @property {'sessionurl'} source
 * @property {*} data
 */

function readSessionUrlParameter() {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') {
    return null;
  }

  const q = new URLSearchParams(window.location.search);
  return q.get('sessionurl')
    || q.get('sessionUrl')
    || q.get('bundleurl')
    || q.get('bundleUrl');
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

/**
 * Read and fetch a session payload URL from the viewer query string.
 *
 * Supported query names:
 *   ?sessionurl=<url>
 *   ?sessionUrl=<url>
 *   ?bundleurl=<url>
 *   ?bundleUrl=<url>
 *
 * @returns {Promise.<(SessionUrlResult|null)>}
 */
export async function readFromSessionUrl() {
  const rawUrl = readSessionUrlParameter();
  const url = resolveHttpUrl(rawUrl);
  if (!url) return null;

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    credentials: 'same-origin',
    cache: 'no-store'
  });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  if (!text || text.length > MAX_RESPONSE_TEXT_LEN) {
    return null;
  }

  try {
    return { source: 'sessionurl', data: JSON.parse(text) };
  } catch {
    return { source: 'sessionurl', data: text };
  }
}

export default { readFromSessionUrl };
