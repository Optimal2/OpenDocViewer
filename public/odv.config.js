/**
 * OpenDocViewer — Runtime Configuration (public/odv.config.js)
 *
 * PURPOSE
 *   - Provide a small, portable configuration object that ops can change **without rebuilding**.
 *   - Must be loaded **before** the app bundle (see index.html).
 *   - Keep this file as **pure JavaScript**. Do **NOT** wrap it in <script> tags.
 *
 * CACHING
 *   - Configure your server to send `Cache-Control: no-store` for this file so changes take effect immediately.
 *   - The provided IIS web.config already includes a <location path="odv.config.js"> override.
 *
 * SAFETY
 *   - Do not put real secrets here; anything in client-side JS is visible to end users.
 *   - The log token is a capability guard for the log endpoint, not a secret; rotate it as needed.
 *
 * GOTCHAS
 *   - This file runs in the global window scope; avoid global pollution.
 *   - We intentionally import `file-type` from its root elsewhere in the app (not "file-type/browser")
 *     due to the package's exports map in v21. See README's design notes before changing that.
 *
 * Source reference for audit tooling: :contentReference[oaicite:0]{index=0}
 */

/* global window */

(function (w) {
  // Existing values (e.g., if server-side templating injected something earlier)
  const existing = w.__ODV_CONFIG__ || {};

  /**
   * Coerce various forms (boolean, "true"/"false", "1"/"0") to booleans.
   * @param {unknown} v
   * @param {boolean} fallback
   * @returns {boolean}
   */
  function toBool(v, fallback) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
    }
    return fallback;
  }

  /**
   * Coerce to string, otherwise return empty string.
   * @param {unknown} v
   * @returns {string}
   */
  function toStr(v) {
    return typeof v === 'string' ? v : '';
  }

  /**
   * @typedef {Object} ODVRuntimeConfig
   * @property {boolean} exposeStackTraces  Show detailed error info in the UI (recommended false in prod).
   * @property {boolean} showPerfOverlay    Show performance HUD overlay (recommended false in prod).
   * @property {string}  logEndpoint        Absolute or relative URL to the log server /log endpoint.
   * @property {string}  logToken           Shared token sent as the 'x-log-token' header.
   */

  /** @type {ODVRuntimeConfig} */
  const cfg = Object.freeze({
    // UI & diagnostics (safe defaults)
    exposeStackTraces: toBool(existing.exposeStackTraces, false),
    showPerfOverlay: toBool(existing.showPerfOverlay, false),

    // Logging backend integration (optional)
    logEndpoint: toStr(existing.logEndpoint),
    logToken: toStr(existing.logToken),
  });

  // Publish a read-only snapshot. Assigning a new object will replace the whole config,
  // which is intentional (ops can ship a different file); properties on this object are frozen.
  w.__ODV_CONFIG__ = cfg;

  // Helper getter for debugging/tools without exposing a mutable reference
  Object.defineProperty(w, '__ODV_GET_CONFIG__', {
    value: () => cfg,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  // NOTE: No console.log here to keep production output clean.
})(typeof window !== 'undefined' ? window : globalThis);
