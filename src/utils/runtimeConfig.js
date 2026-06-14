// File: src/utils/runtimeConfig.js
/**
 * Runtime configuration helpers.
 *
 * Keeps read access to `public/odv.config.js` / `odv.site.config.js` in one place so UI modules can
 * consistently resolve optional runtime flags without duplicating window access logic.
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */
/** @typedef {'FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'} ViewerDefaultZoomMode */
/** @typedef {'active'|'all'} PrintDefaultMode */
/**
 * @typedef {Object} ViewerCustomFitSizeLimits
 * @property {number=} widthFactorPercent
 * @property {(number|null)=} heightFactorPercent
 * @property {(number|null)=} actualSizeFactorPercent
 */

/**
 * @typedef {Object} PrintSelectionWorkspaceConfig
 * @property {boolean} enabled
 * @property {*} documentHeaderTemplate
 * @property {*} previewInfoTemplate
 */

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

function normalizeBoolean(value, defaultValue) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function clampNumber(value, min, max) {
  const lowerBounded = Math.max(min, value);
  return typeof max === 'number' ? Math.min(max, lowerBounded) : lowerBounded;
}

function normalizeInteger(value, defaultValue, min, max) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return defaultValue;
  return clampNumber(next, min, max);
}

function normalizeFloat(value, defaultValue, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return defaultValue;
  return clampNumber(next, min, max);
}

function normalizeResetSessionTarget(value, defaultTarget) {
  const raw = String(value || defaultTarget || '').trim().toLowerCase();
  if (raw === 'current' || raw === 'parent' || raw === 'none') return raw;
  return 'parent-or-current';
}

function normalizeDefaultZoomMode(value, defaultMode = 'fit-width') {
  const raw = String(value || defaultMode || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw === 'fit-width' || raw === 'fitwidth' || raw === 'fit-to-width' || raw === 'width') return 'FIT_WIDTH';
  if (
    raw === 'fit-custom'
    || raw === 'custom-fit'
    || raw === 'custom-fit-width'
    || raw === 'fit-width-factor'
    || raw === 'user-zoom'
    || raw === 'custom-width'
  ) {
    return 'FIT_CUSTOM';
  }
  if (raw === 'actual-size' || raw === 'actualsize' || raw === 'actual' || raw === '100%' || raw === '1:1') {
    return 'ACTUAL_SIZE';
  }
  return 'FIT_PAGE';
}

/**
 * Normalize a user-facing print default mode. Only active page and all pages are allowed as
 * persistent defaults; range/custom choices remain one-off dialog choices.
 *
 * @param {*} value
 * @param {PrintDefaultMode} defaultMode
 * @returns {PrintDefaultMode}
 */
export function normalizePrintDefaultMode(value, defaultMode = 'active') {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw === 'all' || raw === 'all-pages' || raw === 'everything') return 'all';
  if (raw === 'active' || raw === 'active-page' || raw === 'current' || raw === 'current-page') return 'active';
  return defaultMode === 'all' ? 'all' : 'active';
}

/**
 * Normalize a custom fit-width factor. The public config/preference value is an integer percentage
 * of the calculated fit-width zoom, not a direct zoom percentage.
 *
 * @param {*} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function normalizeCustomFitWidthFactorPercent(value, defaultValue = 70) {
  return normalizeInteger(value, defaultValue, 1, 100);
}

/**
 * Normalize an optional custom-size limit percentage. Blank values mean "no user limit".
 *
 * @param {*} value
 * @param {number} max
 * @returns {(number|null)}
 */
export function normalizeOptionalCustomFitFactorPercent(value, max = 100) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  const safeMax = Math.max(1, Math.round(Number(max)) || 100);
  return Math.max(1, Math.min(safeMax, numeric));
}

/**
 * Normalize the optional user custom-size limits.
 *
 * @param {*} value
 * @returns {{ widthFactorPercent: (number|null), heightFactorPercent: (number|null), actualSizeFactorPercent: (number|null) }}
 */
export function normalizeCustomFitSizeLimitPreference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { widthFactorPercent: null, heightFactorPercent: null, actualSizeFactorPercent: null };
  }

  return {
    widthFactorPercent: normalizeOptionalCustomFitFactorPercent(value.widthFactorPercent ?? value.widthPercent, 100),
    heightFactorPercent: normalizeOptionalCustomFitFactorPercent(value.heightFactorPercent ?? value.heightPercent, 500),
    actualSizeFactorPercent: normalizeOptionalCustomFitFactorPercent(value.actualSizeFactorPercent ?? value.actualPercent, 200),
  };
}

/**
 * Resolve the initial page zoom mode.
 *
 * Runtime config value: `viewer.defaultZoomMode`
 * Supported values:
 * - `fit-page`: fit the full page inside the viewport
 * - `fit-width`: fit the page width to the viewport
 * - `custom-fit-width`: use the custom size caps from `viewer.customFit*FactorPercent`
 * - `actual-size`: start at 100%
 *
 * @param {Object=} cfg
 * @returns {ViewerDefaultZoomMode}
 */
export function getViewerDefaultZoomMode(cfg = getRuntimeConfig()) {
  return normalizeDefaultZoomMode(cfg?.viewer?.defaultZoomMode, 'fit-width');
}

/**
 * Resolve the custom-size width factor percentage.
 *
 * Runtime config value: `viewer.customFitWidthFactorPercent`
 * Supported range: 1..100, where 70 means 70% of the calculated fit-width zoom.
 *
 * @param {Object=} cfg
 * @returns {number}
 */
export function getViewerCustomFitWidthFactorPercent(cfg = getRuntimeConfig()) {
  return normalizeCustomFitWidthFactorPercent(
    cfg?.viewer?.customFitWidthFactorPercent ?? cfg?.viewer?.customFitWidthPercent,
    70
  );
}

/**
 * Resolve the configured custom-size limits. Width defaults to the legacy site.config value;
 * height and actual-size limits are opt-in only.
 *
 * @param {Object=} cfg
 * @returns {{ widthFactorPercent: number, heightFactorPercent: (number|null), actualSizeFactorPercent: (number|null) }}
 */
export function getViewerCustomFitSizeLimits(cfg = getRuntimeConfig()) {
  return {
    widthFactorPercent: getViewerCustomFitWidthFactorPercent(cfg),
    heightFactorPercent: normalizeOptionalCustomFitFactorPercent(
      cfg?.viewer?.customFitHeightFactorPercent ?? cfg?.viewer?.customFitHeightPercent,
      500
    ),
    actualSizeFactorPercent: normalizeOptionalCustomFitFactorPercent(
      cfg?.viewer?.customFitActualSizeFactorPercent ?? cfg?.viewer?.customFitActualPercent,
      200
    ),
  };
}

/**
 * Resolve the default print page mode used when the user has not stored an override.
 *
 * Runtime config value: `print.defaultPageMode`
 * Supported values: `active` / `all`
 *
 * @param {Object=} cfg
 * @returns {PrintDefaultMode}
 */
export function getPrintDefaultMode(cfg = getRuntimeConfig()) {
  return normalizePrintDefaultMode(
    cfg?.print?.defaultPageMode ?? cfg?.print?.defaultPrintMode ?? cfg?.viewer?.print?.defaultPageMode,
    'active'
  );
}

/**
 * Resolve the print-selection workspace configuration.
 *
 * Runtime config values:
 * - `print.selectionWorkspace.enabled`
 * - `print.selectionWorkspace.documentHeaderTemplate`
 * - `print.selectionWorkspace.previewInfoTemplate`
 *
 * The document header template supports simple tokens such as `{documentNumber}`,
 * `{totalDocuments}`, `{documentId}`, `{pageCount}`, `{metadata.caseNumber}`, and
 * `{metaById.123.selectedValue}`. The preview info template supports the same metadata tokens
 * plus page-oriented values such as `{sourcePage}`, `{printPage}`, `{documentPageNumber}`, and
 * `{documentPageCount}`. Tokens may use a small filter pipeline, for example
 * `{metadata.documentDate|date:yyyy-MM-dd}` or `{metadata.documentDate|substring:0,10}`.
 *
 * @param {Object=} cfg
 * @returns {PrintSelectionWorkspaceConfig}
 */
export function getPrintSelectionWorkspaceConfig(cfg = getRuntimeConfig()) {
  const raw = cfg?.print?.selectionWorkspace ?? cfg?.viewer?.printSelectionWorkspace ?? {};
  const defaultHeaderTemplate = 'Document {documentNumber} of {totalDocuments} · {pageCount} pages';
  const defaultPreviewInfoTemplate = 'Page {sourcePage} of {totalPages} · {documentNumber}-{documentPageNumber}';
  const documentHeaderTemplate = raw?.documentHeaderTemplate ?? raw?.headerTemplate ?? defaultHeaderTemplate;
  const previewInfoTemplate = raw?.previewInfoTemplate ?? raw?.lightboxInfoTemplate ?? defaultPreviewInfoTemplate;

  return {
    enabled: normalizeBoolean(raw?.enabled, true),
    documentHeaderTemplate: documentHeaderTemplate || defaultHeaderTemplate,
    previewInfoTemplate: previewInfoTemplate || defaultPreviewInfoTemplate,
  };
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
    enabled: normalizeBoolean(raw.enabled, true),
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
