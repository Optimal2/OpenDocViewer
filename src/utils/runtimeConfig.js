// File: src/utils/runtimeConfig.js
/**
 * Runtime configuration helpers.
 *
 * Keeps read access to `public/odv.config.js` / `odv.site.config.js` in one place so UI modules can
 * consistently resolve optional runtime flags without duplicating window access logic.
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */

/**
 * @typedef {Object} ViewerProblemNoticeConfig
 * @property {boolean} enabled
 * @property {boolean} showForLoaderError
 * @property {boolean} showForFailedPages
 * @property {number} minFailedPages
 * @property {number} failedPageRatio
 * @property {boolean} requireLoadComplete
 * @property {boolean} dismissible
 * @property {boolean} showReloadButton
 * @property {boolean} showTechnicalDetails
 * @property {*} title
 * @property {*} message
 * @property {*} reloadLabel
 * @property {*} closeLabel
 * @property {*} detailsLabel
 */

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
  } catch {
    // Runtime config globals are host-owned and can be unavailable during early bootstrap,
    // tests, or restricted embedding. Falling back to defaults keeps the viewer usable.
  }
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

/**
 * Resolve whether document metadata UI affordances should be available.
 * The host payload may still contain metadata for sorting, printing, logging, or diagnostics; this
 * flag only controls user-facing metadata overlays and metadata context-menu actions.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isDocumentMetadataUiEnabled(cfg = getRuntimeConfig()) {
  return cfg?.metadata?.enabled !== false;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value, min, max) {
  const lowerBounded = Math.max(min, value);
  return typeof max === 'number' ? Math.min(max, lowerBounded) : lowerBounded;
}

function normalizeInteger(value, fallback, min, max) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return clampNumber(next, min, max);
}

function normalizeFloat(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return clampNumber(next, min, max);
}

/**
 * Resolve the configurable viewer-level problem notice. The notice is intended for serious support
 * situations, for example when host-provided source URLs expire and many pages fail at once.
 *
 * @param {Object=} cfg
 * @returns {ViewerProblemNoticeConfig}
 */
export function getViewerProblemNoticeConfig(cfg = getRuntimeConfig()) {
  const raw = cfg?.viewer?.problemNotice || cfg?.problemNotice || {};
  return {
    enabled: normalizeBoolean(raw.enabled, true),
    showForLoaderError: normalizeBoolean(raw.showForLoaderError, true),
    showForFailedPages: normalizeBoolean(raw.showForFailedPages, true),
    minFailedPages: normalizeInteger(raw.minFailedPages, 1, 1, 1000000),
    failedPageRatio: normalizeFloat(raw.failedPageRatio, 0.5, 0, 1),
    requireLoadComplete: normalizeBoolean(raw.requireLoadComplete, false),
    dismissible: normalizeBoolean(raw.dismissible, true),
    showReloadButton: normalizeBoolean(raw.showReloadButton, true),
    showTechnicalDetails: normalizeBoolean(raw.showTechnicalDetails, false),
    title: raw.title,
    message: raw.message,
    reloadLabel: raw.reloadLabel,
    closeLabel: raw.closeLabel,
    detailsLabel: raw.detailsLabel,
  };
}
