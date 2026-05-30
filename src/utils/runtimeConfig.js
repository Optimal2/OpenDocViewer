// File: src/utils/runtimeConfig.js
/**
 * Runtime configuration helpers.
 *
 * Keeps read access to `public/odv.config.js` / `odv.site.config.js` in one place so UI modules can
 * consistently resolve optional runtime flags without duplicating window access logic.
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */
/** @typedef {'FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'} ViewerDefaultZoomMode */

/**
 * @typedef {Object} ViewerEdgeScrollPageTurnConfig
 * @property {boolean} enabled
 * @property {number} thresholdPx
 * @property {number} decayMs
 * @property {number} quietMs
 */

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
 * @property {boolean} showResetSessionButton
 * @property {boolean} showTechnicalDetails
 * @property {*} title
 * @property {*} message
 * @property {*} reloadLabel
 * @property {*} resetSessionLabel
 * @property {*} closeLabel
 * @property {*} detailsLabel
 * @property {string} resetSessionTarget
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

function normalizeResetSessionTarget(value, fallback) {
  const raw = String(value || fallback || '').trim().toLowerCase();
  if (raw === 'current' || raw === 'parent' || raw === 'none') return raw;
  return 'parent-or-current';
}

function normalizeDefaultZoomMode(value, fallback = 'fit-page') {
  const raw = String(value || fallback || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw === 'fit-width' || raw === 'fitwidth' || raw === 'fit-to-width' || raw === 'width') return 'FIT_WIDTH';
  if (raw === 'actual-size' || raw === 'actualsize' || raw === 'actual' || raw === '100%' || raw === '1:1') {
    return 'ACTUAL_SIZE';
  }
  return 'FIT_PAGE';
}

/**
 * Resolve the initial page zoom mode.
 *
 * Runtime config value: `viewer.defaultZoomMode`
 * Supported values:
 * - `fit-page`: fit the full page inside the viewport
 * - `fit-width`: fit the page width to the viewport
 * - `actual-size`: start at 100%
 *
 * @param {Object=} cfg
 * @returns {ViewerDefaultZoomMode}
 */
export function getViewerDefaultZoomMode(cfg = getRuntimeConfig()) {
  return normalizeDefaultZoomMode(cfg?.viewer?.defaultZoomMode, 'fit-page');
}

/**
 * Resolve the optional scroll-at-edge page turn gesture.
 *
 * Runtime config value: `viewer.edgeScrollPageTurn`
 * Supported shape:
 * `{ enabled: true, thresholdPx: 720, quietMs: 140, decayMs: 650 }`
 *
 * @param {Object=} cfg
 * @returns {ViewerEdgeScrollPageTurnConfig}
 */
export function getViewerEdgeScrollPageTurnConfig(cfg = getRuntimeConfig()) {
  const rawValue = cfg?.viewer?.edgeScrollPageTurn ?? cfg?.edgeScrollPageTurn ?? {};
  const raw = typeof rawValue === 'boolean' ? { enabled: rawValue } : (rawValue || {});
  return {
    enabled: normalizeBoolean(raw.enabled, false),
    thresholdPx: normalizeInteger(raw.thresholdPx, 720, 120, 5000),
    quietMs: normalizeInteger(raw.quietMs, 140, 0, 2000),
    decayMs: normalizeInteger(raw.decayMs, 650, 100, 5000),
  };
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
    showResetSessionButton: normalizeBoolean(raw.showResetSessionButton, true),
    showTechnicalDetails: normalizeBoolean(raw.showTechnicalDetails, false),
    title: raw.title,
    message: raw.message,
    reloadLabel: raw.reloadLabel,
    resetSessionLabel: raw.resetSessionLabel,
    closeLabel: raw.closeLabel,
    detailsLabel: raw.detailsLabel,
    resetSessionTarget: normalizeResetSessionTarget(raw.resetSessionTarget, 'parent-or-current'),
  };
}
