// File: src/integrations/parentBridge.js
/**
 * File: src/integrations/parentBridge.js
 *
 * OpenDocViewer — Same-Origin Parent Bridge
 *
 * PURPOSE
 *   Safely read a bootstrap payload from a same-origin parent window (when the viewer is embedded
 *   in an <iframe>). This allows a host page to pass data without relying on query strings or
 *   cross-origin messaging. If the parent is cross-origin, all access is gracefully denied.
 *
 * WHAT WE READ (in priority order)
 *   1) parent.ODV_BOOTSTRAP     — preferred, arbitrary shape (already neutral or host-specific)
 *   2) parent.modelRaw          — legacy: base64-encoded JSON string
 *   3) parent.model             — legacy: plain object (auto-cloned)
 *
 * RETURNS
 *   A normalized object on success or null when nothing usable is found.
 *
 * SSR / SAFETY
 *   - All window/parent access is guarded in try/catch to avoid cross-origin DOM exceptions.
 *   - We use `structuredClone` when available; otherwise fall back to JSON clone (drops functions).
 *
 * PROJECT GOTCHA (important for future reviewers)
 *   - Elsewhere in the project we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *     See README “Design notes & gotchas” before changing that import anywhere.
 */

/**
 * Result object when data is obtained from a same-origin parent.
 * @typedef {Object} ParentBootstrapResult
 * @property {'parent'} source
 * @property {*} data
 */

/**
 * Try to obtain a same-origin parent window reference.
 * Returns null if:
 *   - There is no parent (top-level window), or
 *   - The parent is cross-origin (any property access throws).
 *
 * @returns {(Window|null)}
 */
function getSameOriginParent() {
  try {
    if (typeof window === 'undefined') return null;
    if (window.parent && window.parent !== window) {
      // Accessing .location.href on a cross-origin parent will throw a DOMException.
      // If this line does not throw, we can safely treat the parent as same-origin.
      // eslint-disable-next-line no-void
      void window.parent.location.href;
      return window.parent;
    }
  } catch {
    // cross-origin access denied
  }
  return null;
}

/**
 * Perform a safe, structured clone of serializable data.
 * Falls back to JSON round-trip when structuredClone is unavailable.
 *
 * @template T
 * @param {T} obj
 * @returns {(T|null)}
 */
function safeClone(obj) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj)); // drops functions / non-serializables
  } catch {
    return null;
  }
}

/**
 * Decode a base64-encoded Unicode string into text (handles UTF-8).
 *
 * @param {string} str
 * @returns {(string|null)}
 */
function b64DecodeUnicode(str) {
  try {
    const bin = atob(str);
    const pct = Array.prototype.map
      .call(bin, (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('');
    return decodeURIComponent(pct);
  } catch {
    return null;
  }
}

/**
 * Attempt to read a bootstrap object from a same-origin parent.
 *
 * Priority:
 *   1) parent.ODV_BOOTSTRAP   (generic, recommended)
 *   2) parent.modelRaw/model  (legacy compatibility)
 *
 * @returns {(ParentBootstrapResult|null)}
 */
export function readFromParent() {
  const p = getSameOriginParent();
  if (!p) return null;

  // 1) Preferred generic surface
  try {
    if (p.ODV_BOOTSTRAP && typeof p.ODV_BOOTSTRAP === 'object') {
      const clone = safeClone(p.ODV_BOOTSTRAP);
      if (clone) return { source: 'parent', data: clone };
    }
  } catch {
    // ignore and continue probing
  }

  // 2a) Legacy: base64 JSON
  try {
    if (typeof p.modelRaw === 'string') {
      const json = b64DecodeUnicode(p.modelRaw);
      if (json) {
        try {
          const obj = JSON.parse(json);
          return { source: 'parent', data: obj };
        } catch {
          // fall through
        }
      }
    }
  } catch {
    // ignore and continue probing
  }

  // 2b) Legacy: expanded object
  try {
    if (p.model && typeof p.model === 'object') {
      const clone = safeClone(p.model);
      if (clone) return { source: 'parent', data: clone };
    }
  } catch {
    // ignore
  }

  return null;
}

export default { readFromParent };
