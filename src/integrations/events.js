// File: src/integrations/events.js
/**
 * File: src/integrations/events.js
 *
 * OpenDocViewer — Tiny Event Emitter/Listener Utilities (Browser-only)
 *
 * PURPOSE
 *   Lightweight helpers for broadcasting and listening to app-level DOM events.
 *   These utilities centralize our patterns and add a few safety nets (SSR checks,
 *   handler guards, and optional one-shot listener with timeout).
 *
 * DESIGN NOTES
 *   - Events are dispatched on `window` as `CustomEvent` with a structured `detail` object.
 *   - Handlers receive two args: (event, detail). We wrap the raw listener so app code
 *     can focus on the payload while still having access to the original event.
 *   - All functions no-op gracefully when `window` is unavailable (e.g., SSR).
 *
 * RUNTIME COMPAT
 *   - Uses `CustomEvent`. For very old engines, we fall back to `document.createEvent`.
 *
 * PROJECT GOTCHA (reminder for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, *not* 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *
 * Provenance / original baseline reference: :contentReference[oaicite:0]{index=0}
 */

import logger from '../LogController';

/**
 * Listener signature for ODV events.
 * @callback ODVEventHandler
 * @param {Event} event
 * @param {*} detail
 * @returns {void}
 */

/**
 * Options for onceODVEvent.
 * @typedef {Object} OnceOptions
 * @property {(number|undefined)} timeoutMs
 */

/**
 * Result returned by onceODVEvent when the event fires.
 * @typedef {Object} OnceEventResult
 * @property {Event} event
 * @property {*} detail
 */

/**
 * Create a CustomEvent with best-effort fallback for older browsers.
 * @param {string} name
 * @param {*} detail
 * @returns {CustomEvent}
 */
function createCustomEvent(name, detail) {
  try {
    return new CustomEvent(name, { detail });
  } catch {
    // Fallback (IE11-era). Safe to keep as best effort; modern engines ignore.
    try {
      const evt = document.createEvent('CustomEvent');
      // @ts-ignore - legacy API
      evt.initCustomEvent(name, false, false, detail);
      return evt;
    } catch (e) {
      // As a last resort, rethrow so caller can log and bail.
      throw e;
    }
  }
}

/**
 * Emit a namespaced OpenDocViewer event with an optional detail payload.
 * Returns true when the event was dispatched; false when not (e.g., SSR).
 *
 * @example
 *   emitODVEvent('odv:page-change', { page: 7 });
 *
 * @param {string} name    Event name (recommend a namespace like "odv:*").
 * @param {Object.<string, *>} [detail={}]  Structured payload for listeners.
 * @returns {boolean}       True if dispatched, false if `window` unavailable.
 */
export function emitODVEvent(name, detail = {}) {
  if (!name || typeof name !== 'string') {
    logger.warn('emitODVEvent called with invalid name', { name });
    return false;
  }
  if (typeof window === 'undefined') return false;

  try {
    const evt = createCustomEvent(name, detail);
    window.dispatchEvent(evt);
    return true;
  } catch (e) {
    logger.warn('emitODVEvent failed', { name, error: String(e?.message || e) });
    return false;
  }
}

/**
 * Attach a listener for a given OpenDocViewer event.
 * Returns an unsubscribe function you MUST call when done to avoid leaks.
 *
 * @example
 *   const off = onODVEvent('odv:page-change', (_ev, d) => console.log(d.page));
 *   // later...
 *   off();
 *
 * @param {string} name
 * @param {ODVEventHandler} handler
 * @param {(*|boolean)} [options]  addEventListener options (e.g., { passive: true })
 * @returns {function(): void} Unsubscribe function
 */
export function onODVEvent(name, handler, options) {
  if (typeof window === 'undefined') return function () {};
  if (typeof handler !== 'function') {
    logger.warn('onODVEvent called without a valid handler', { name });
    return function () {};
  }

  const wrapped = (ev) => {
    try {
      // CustomEvent has .detail; for plain Event it will be undefined.
      // @ts-ignore
      const detail = ev?.detail;
      handler(ev, detail);
    } catch (e) {
      logger.error('onODVEvent handler threw', { name, error: String(e?.message || e) });
    }
  };

  try {
    window.addEventListener(name, wrapped, options ?? { passive: true });
  } catch {
    // In case options object not supported in a very old browser
    try { window.addEventListener(name, wrapped); } catch {}
  }

  return function () {
    try { window.removeEventListener(name, wrapped, options ?? { passive: true }); }
    catch { try { window.removeEventListener(name, wrapped); } catch {} }
  };
}

/**
 * Wait for a single occurrence of an event and resolve with `{ event, detail }`.
 * Optionally rejects after `timeoutMs` if the event does not arrive in time.
 *
 * @example
 *   await onceODVEvent('odv:ready', { timeoutMs: 5000 });
 *
 * @param {string} name
 * @param {OnceOptions} [opts]
 * @returns {Promise.<OnceEventResult>}
 */
export function onceODVEvent(name, opts = {}) {
  const { timeoutMs = 0 } = opts;

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window unavailable (SSR)'));
      return;
    }

    let done = false;
    const off = onODVEvent(name, (ev, detail) => {
      if (done) return;
      done = true;
      clearTimeoutSafe(timer);
      off();
      resolve({ event: ev, detail });
    }, { passive: true, once: true });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(new Error('Event "' + name + '" timed out after ' + timeoutMs + ' ms'));
      }, timeoutMs);
    }
  });
}

/**
 * Clear a timer if it exists (tiny helper).
 * @param {*} t
 * @returns {void}
 */
function clearTimeoutSafe(t) {
  try { if (t) clearTimeout(t); } catch {}
}

export default { emitODVEvent, onODVEvent, onceODVEvent };
