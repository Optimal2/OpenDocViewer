// File: src/integration/parentBridge.js

// Safely check same-origin parent access
function getSameOriginParent() {
  try {
    if (window.parent && window.parent !== window) {
      // Will throw on cross-origin
      void window.parent.location.href;
      return window.parent;
    }
  } catch (_) { /* cross-origin */ }
  return null;
}

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
 * Try to read a neutral bootstrap object from a same-origin parent.
 * Priority:
 *   1) parent.ODV_BOOTSTRAP   (generic, recommended)
 *   2) parent.modelRaw/model  (legacy-ish, auto-mapped below)
 * Returns: { source: 'parent', data: <any> } or null
 */
export function readFromParent() {
  const p = getSameOriginParent();
  if (!p) return null;

  // Preferred generic surface
  if (p.ODV_BOOTSTRAP && typeof p.ODV_BOOTSTRAP === 'object') {
    return { source: 'parent', data: structuredClone(p.ODV_BOOTSTRAP) };
  }

  // Graceful legacy compatibility (neutralized): base64 JSON + expanded object
  if (typeof p.modelRaw === 'string') {
    const json = b64DecodeUnicode(p.modelRaw);
    if (json) {
      try {
        const obj = JSON.parse(json);
        return { source: 'parent', data: obj };
      } catch { /* ignore */ }
    }
  }
  if (p.model && typeof p.model === 'object') {
    return { source: 'parent', data: structuredClone(p.model) };
  }

  return null;
}
