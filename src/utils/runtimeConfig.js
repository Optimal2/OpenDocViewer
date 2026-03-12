// File: src/utils/runtimeConfig.js
/**
 * Runtime configuration helpers.
 *
 * Keeps read access to `public/odv.config.js` / `odv.site.config.js` in one place so UI modules can
 * consistently resolve optional runtime flags without duplicating window access logic.
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */

/**
 * Read the merged runtime configuration from the browser environment.
 * @returns {Object}
 */
export function getRuntimeConfig() {
  try {
    if (typeof window !== 'undefined') {
      if (typeof window.__ODV_GET_CONFIG__ === 'function') return window.__ODV_GET_CONFIG__() || {};
      if (window.__ODV_CONFIG__) return window.__ODV_CONFIG__ || {};
    }
  } catch {}
  return {};
}

/**
 * Resolve the configured Ctrl/Cmd+P behavior.
 * Supported values:
 * - `browser`: keep native browser behavior
 * - `disable`: cancel the shortcut without opening any dialog
 * - `dialog`: cancel the shortcut and open OpenDocViewer's print dialog
 *
 * @param {Object=} cfg
 * @returns {KeyboardPrintShortcutBehavior}
 */
export function getKeyboardPrintShortcutBehavior(cfg = getRuntimeConfig()) {
  const raw = String(cfg?.shortcuts?.print?.ctrlOrCmdP || 'browser').toLowerCase();
  if (raw === 'disable' || raw === 'dialog') return raw;
  return 'browser';
}
