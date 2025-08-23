// File: src/integration/sessionToken.js

function b64DecodeUnicode(str) {
  try {
    const bin = atob(str);
    const pct = Array.prototype.map.call(bin, c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join('');
    return decodeURIComponent(pct);
  } catch {
    return null;
  }
}

/**
 * If ?sessiondata=<base64> exists, decode and parse it.
 * Returns: { source: 'sessiondata', data: <any> } or null
 */
export function readFromSessionToken() {
  const q = new URLSearchParams(window.location.search);
  const tok = q.get('sessiondata');
  if (!tok) return null;

  const json = b64DecodeUnicode(tok) ?? (() => { try { return atob(tok); } catch { return null; } })();
  if (!json) return null;

  try {
    const obj = JSON.parse(json);
    return { source: 'sessiondata', data: obj };
  } catch {
    // Allow raw strings or simple payloads too
    return { source: 'sessiondata', data: json };
  }
}
