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
/** @typedef {'mirror'|'hide'} CompareAdjustToolbarMode */
/** @typedef {'ok'|'warning'} PdfSignatureUncheckedSeverity */
/**
 * Session-reset target for the support/problem notice.
 *
 * - `current`: reload only the current viewer frame/window.
 * - `parent`: ask the parent window to reload/navigate if the viewer is embedded.
 * - `parent-or-current`: prefer the parent window, then fall back to current.
 * - `none`: disable the reset action even if the notice is shown.
 *
 * @typedef {'current'|'parent'|'parent-or-current'|'none'} ResetSessionTarget
 */

const DEFAULT_RESET_SESSION_TARGET = 'parent-or-current';
const DEFAULT_ZOOM_MODE_TEXT = 'fit-width';
const DEFAULT_ZOOM_MODE = 'FIT_WIDTH';
// Start custom width below full fit-width so switching to custom mode is visibly distinct
// while still keeping the document readable on normal desktop viewports.
const DEFAULT_CUSTOM_FIT_WIDTH_FACTOR_PERCENT = 70;
/** Runtime validation values for KeyboardPrintShortcutBehavior; the typedef documents the public contract. */
const KEYBOARD_PRINT_SHORTCUT_BEHAVIORS = Object.freeze(['browser', 'disable', 'dialog']);
/** Runtime validation values for CompareAdjustToolbarMode; the first one is the default. */
export const COMPARE_ADJUST_TOOLBAR_MODES = Object.freeze(['mirror', 'hide']);
/** Runtime validation values for PdfSignatureUncheckedSeverity; the first one is the default. */
export const PDF_SIGNATURE_UNCHECKED_SEVERITIES = Object.freeze(['ok', 'warning']);
/** Runtime validation values for ResetSessionTarget; the typedef documents the public contract. */
const RESET_SESSION_TARGETS = Object.freeze(['current', 'parent', 'parent-or-current', 'none']);
/** User-facing print default mode aliases mapped to persisted PrintDefaultMode values. */
const PRINT_DEFAULT_MODE_ALIASES = Object.freeze({
  all: 'all',
  'all-pages': 'all',
  everything: 'all',
  active: 'active',
  'active-page': 'active',
  current: 'active',
  'current-page': 'active',
});
/** User-facing zoom-mode aliases mapped to ViewerDefaultZoomMode values. */
const DEFAULT_ZOOM_MODE_ALIAS_ENTRIES = Object.freeze([
  Object.freeze(['fit-page', 'FIT_PAGE']),
  Object.freeze(['fitpage', 'FIT_PAGE']),
  Object.freeze(['page', 'FIT_PAGE']),
  Object.freeze([DEFAULT_ZOOM_MODE_TEXT, DEFAULT_ZOOM_MODE]),
  Object.freeze(['fitwidth', DEFAULT_ZOOM_MODE]),
  Object.freeze(['fit-to-width', DEFAULT_ZOOM_MODE]),
  Object.freeze(['width', DEFAULT_ZOOM_MODE]),
  Object.freeze(['fit-custom', 'FIT_CUSTOM']),
  Object.freeze(['custom-fit', 'FIT_CUSTOM']),
  Object.freeze(['custom-fit-width', 'FIT_CUSTOM']),
  Object.freeze(['fit-width-factor', 'FIT_CUSTOM']),
  Object.freeze(['user-zoom', 'FIT_CUSTOM']),
  Object.freeze(['custom-width', 'FIT_CUSTOM']),
  Object.freeze(['actual-size', 'ACTUAL_SIZE']),
  Object.freeze(['actualsize', 'ACTUAL_SIZE']),
  Object.freeze(['actual', 'ACTUAL_SIZE']),
  Object.freeze(['100%', 'ACTUAL_SIZE']),
  Object.freeze(['1:1', 'ACTUAL_SIZE']),
]);

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
 * @property {ResetSessionTarget} resetSessionTarget
 * @property {string} resetSessionAllowedOrigin
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
  const raw = String(cfg?.shortcuts?.print?.ctrlOrCmdP || 'browser').trim().toLowerCase();
  return KEYBOARD_PRINT_SHORTCUT_BEHAVIORS.includes(raw) ? raw : 'browser';
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

/**
 * Read a strict boolean switch: only a real boolean counts, anything else (missing, strings such as
 * "false", numbers, null, objects) falls back to `defaultValue`.
 *
 * @param {*} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function readBooleanSwitch(value, defaultValue) {
  return typeof value === 'boolean' ? value : defaultValue;
}

/**
 * Master capability for page fine tuning and calibration-dependent compare views.
 * Only boolean false disables it; missing or malformed values default to true.
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isFineTuneEnabled(cfg = getRuntimeConfig()) {
  return readBooleanSwitch(cfg?.fineTune?.enabled, true);
}

/**
 * Resolve whether the compare overlay view is available (`compare.overlay.enabled`).
 * Only an explicit `false` removes the view (toolbar entry, open action and render); missing or
 * non-boolean values fall back to the default `true`. The calibration kept in the viewer context
 * and the curtain view are not affected by this child switch. fineTune.enabled gates both views.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isCompareOverlayEnabled(cfg = getRuntimeConfig()) {
  return isFineTuneEnabled(cfg) && readBooleanSwitch(cfg?.compare?.overlay?.enabled, true);
}

/**
 * Resolve whether the compare overlay view offers its print action (`compare.overlay.print.enabled`).
 * Only an explicit `false` removes the action; missing or non-boolean values fall back to `true`.
 * The side-by-side compare print is not affected. The master fineTune capability also gates this action.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isCompareOverlayPrintEnabled(cfg = getRuntimeConfig()) {
  return isFineTuneEnabled(cfg) && readBooleanSwitch(cfg?.compare?.overlay?.print?.enabled, true);
}

/**
 * Resolve whether the compare curtain view is available (`compare.curtain.enabled`).
 * Only an explicit `false` removes the view (toolbar and overlay-view entries, open action and
 * render); missing or non-boolean values fall back to the default `true`.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isCompareCurtainEnabled(cfg = getRuntimeConfig()) {
  return isFineTuneEnabled(cfg) && readBooleanSwitch(cfg?.compare?.curtain?.enabled, true);
}

/**
 * Resolve whether the compare curtain view offers its print action (`compare.curtain.print.enabled`).
 * Only an explicit `false` removes the action; missing or non-boolean values fall back to `true`.
 * The side-by-side compare print is not affected.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isCompareCurtainPrintEnabled(cfg = getRuntimeConfig()) {
  return isFineTuneEnabled(cfg) && readBooleanSwitch(cfg?.compare?.curtain?.print?.enabled, true);
}

/**
 * Resolve how the main toolbar's image controls behave in compare mode (`compare.adjust.toolbarMode`).
 * Supported values:
 * - `mirror`: the controls stay, change the same pane state as the pane panel and show its values
 * - `hide`: the controls are hidden while a pane's adjustment panel is expanded
 * Missing or non-matching values (non-strings, `'Hidden'`, `'mirrored'`, …) fall back to `mirror`.
 * Outside compare mode the key has no effect.
 *
 * @param {Object=} cfg
 * @returns {CompareAdjustToolbarMode}
 */
export function getCompareAdjustToolbarMode(cfg = getRuntimeConfig()) {
  const value = cfg?.compare?.adjust?.toolbarMode;
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return COMPARE_ADJUST_TOOLBAR_MODES.includes(raw) ? /** @type {CompareAdjustToolbarMode} */ (raw) : 'mirror';
}

/**
 * Resolve whether every page thumbnail of a signed PDF file shows the small signature symbol.
 * Only an explicit `false` hides it; the document-level symbol and the toolbar signature
 * overview are not affected by this flag.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isSignatureThumbnailPageBadgeEnabled(cfg = getRuntimeConfig()) {
  return cfg?.pdfSignatures?.thumbnailPageBadge !== false;
}

/**
 * Resolve whether PDF signature inspection runs at all (`pdfSignatures.enabled`).
 * Only an explicit `false` turns it off; then no PDF bytes are handed to the signature worker
 * and no signature symbols or overview button appear. Loading and rendering are never affected
 * either way — inspection always waits for pages first (see getPdfSignatureInspectionStart).
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isPdfSignatureInspectionEnabled(cfg = getRuntimeConfig()) {
  return cfg?.pdfSignatures?.enabled !== false;
}

/**
 * Resolve when PDF signature inspection may start (`pdfSignatures.inspectAfter`):
 * `'firstPage'` (default) starts once the first page is shown, `'allPages'` waits until every
 * page of the loading run is ready, so a site that puts total load time first can keep the
 * worker idle until the viewer is fully loaded. Unknown values fall back to `'firstPage'`.
 *
 * @param {Object=} cfg
 * @returns {'firstPage'|'allPages'}
 */
export function getPdfSignatureInspectionStart(cfg = getRuntimeConfig()) {
  const raw = String(cfg?.pdfSignatures?.inspectAfter || '').trim().toLowerCase();
  return raw === 'allpages' ? 'allPages' : 'firstPage';
}

/**
 * Resolve the symbol severity for a signature the viewer could not check itself (integrity
 * `not-checked-in-viewer`: format, algorithm, budget, encryption, worker failure), from
 * `pdfSignatures.uncheckedSeverity`. Supported values:
 * - `ok` (default): such a signature shows the OK symbol with an information line
 * - `warning`: such a signature shows the warning symbol
 * Missing or non-matching values (non-strings, `'error'`, `'warn'`, …) fall back to `ok`. Intact
 * signatures and integrity problems are never affected (see utils/pdfSignatureStatus.js).
 *
 * @param {Object=} cfg
 * @returns {PdfSignatureUncheckedSeverity}
 */
export function getPdfSignatureUncheckedSeverity(cfg = getRuntimeConfig()) {
  const value = cfg?.pdfSignatures?.uncheckedSeverity;
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PDF_SIGNATURE_UNCHECKED_SEVERITIES.includes(raw)
    ? /** @type {PdfSignatureUncheckedSeverity} */ (raw) : 'ok';
}

/** Default OCR languages (Tesseract language codes), tried together on every text line. */
export const DEFAULT_OCR_LANGUAGES = Object.freeze(['swe', 'eng']);
/**
 * Named forms of `ocr.languages`: a string a site writes instead of an array of codes. `auto`
 * is the default pair (Swedish and English tried together), `swedish` and `english` load that
 * one model alone, so the other model is never requested.
 */
export const OCR_LANGUAGE_PRESETS = Object.freeze({
  auto: DEFAULT_OCR_LANGUAGES,
  swedish: Object.freeze(['swe']),
  english: Object.freeze(['eng']),
});
/** Tesseract language codes: three lower-case letters, optionally with _suffixes (chi_sim, aze_cyrl). */
const OCR_LANGUAGE_CODE_PATTERN = /^[a-z]{3}(?:_[a-z]+)*$/;

/**
 * Resolve whether in-browser OCR of scanned pages is turned on (`ocr.enabled`).
 * Only the boolean literal `true` turns it on; a missing section, `false`, strings such as
 * `"true"`, numbers and objects all keep it off. While off, the OCR module is never imported, so
 * no engine or language file is downloaded, no worker starts and no OCR UI exists.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isOcrEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.enabled === true;
}

/**
 * Resolve whether the ruling lines of tables and forms are removed from a copy of the page
 * image before recognition (`ocr.removeRulingLines`). On by default; only the boolean literal
 * `false` turns it off, so a missing key keeps the step. Meaningless while OCR is off: the step
 * lives in the OCR module, which is never imported then.
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function isOcrLineRemovalEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.removeRulingLines !== false;
}

/**
 * Resolve whether the OCR queue works through the whole document in the background
 * (`ocr.recognizeWholeDocument`): after the window around the shown page, the remaining pages
 * in reading order (as many at a time as the worker count allows), while the viewer is open, so
 * the search covers every page in time. Off by default (only the window is recognised); only the boolean literal `true` turns it
 * on. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrWholeDocumentEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.recognizeWholeDocument === true;
}

/**
 * Resolve whether the opt-in OCR benchmark is offered under About -> Diagnostics
 * (`ocr.benchmark.enabled`). Off by default; only the boolean literal `true` turns it on, and
 * only while OCR itself is on (`ocr.enabled`), since the benchmark lives in the OCR module. The
 * rest of `ocr.benchmark` is read by the module (src/ocr/benchmark.js).
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrBenchmarkEnabled(cfg = getRuntimeConfig()) {
  return isOcrEnabled(cfg) && cfg?.ocr?.benchmark?.enabled === true;
}

/**
 * Resolve whether the opt-in OCR boost benchmark is offered under About -> Diagnostics
 * (`ocr.boostBenchmark.enabled`). Off by default; only the boolean literal `true` turns it on,
 * and only while OCR itself is on (`ocr.enabled`), since the boost benchmark lives in the OCR
 * module. The rest of `ocr.boostBenchmark` is read by the module (src/ocr/boostBenchmark.js).
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrBoostBenchmarkEnabled(cfg = getRuntimeConfig()) {
  return isOcrEnabled(cfg) && cfg?.ocr?.boostBenchmark?.enabled === true;
}

/** Most workers the boost may ever use, whatever a client reports (`ocr.boost.maxWorkerCount` is clamped to it). */
export const OCR_BOOST_HARD_MAX_WORKER_COUNT = 32;

/**
 * @typedef {Object} OcrBoostConfig  `ocr.boost`: more workers while the user is idle (src/ocr/boost.js).
 * @property {boolean} enabled  Only the literal `true` turns the boost on.
 * @property {number} idleAfterMs  Milliseconds without input before the boost may start.
 * @property {number} maxWorkerCount  Ceiling of the boost; the thread count and the memory budget bound it further.
 * @property {number} slowdownFraction  How much longer the reference page may take before the climb stops.
 * @property {{ idle: boolean, hidden: boolean, search: boolean }} triggers  Which of the ways in are open.
 */

/**
 * Defaults of `ocr.boost`. Off: a site turns the boost on once it has seen the boost benchmark
 * on its own clients. The thresholds follow the agreed model (2026-11-11): four seconds of
 * idleness, a quarter longer reference recognition as the stop, and the hard ceiling of 32.
 */
export const OCR_BOOST_DEFAULTS = Object.freeze(/** @type {OcrBoostConfig} */ ({
  enabled: false,
  idleAfterMs: 4000,
  maxWorkerCount: OCR_BOOST_HARD_MAX_WORKER_COUNT,
  slowdownFraction: 0.25,
  triggers: Object.freeze({ idle: true, hidden: true, search: true }),
}));

/**
 * Resolve whether the OCR boost runs (`ocr.boost.enabled`): only the boolean literal `true`, and
 * only while OCR itself is on. With it off the cautious worker count applies throughout, and
 * the viewer listens to no input for it.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrBoostEnabled(cfg = getRuntimeConfig()) {
  return isOcrEnabled(cfg) && cfg?.ocr?.boost?.enabled === true;
}

/**
 * Read `ocr.boost`: a number out of range is clamped to the nearest bound, whatever is missing
 * or not a finite number gets the default, and a trigger is open unless it is the literal
 * `false`. Means nothing while OCR or the boost is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {OcrBoostConfig}
 */
export function normalizeOcrBoostConfig(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.boost && typeof cfg.ocr.boost === 'object' ? cfg.ocr.boost : {};
  const triggers = raw.triggers && typeof raw.triggers === 'object' ? raw.triggers : {};
  const base = OCR_BOOST_DEFAULTS;
  return {
    enabled: raw.enabled === true,
    idleAfterMs: boundedNumber(raw.idleAfterMs, base.idleAfterMs, 500, 600000),
    maxWorkerCount: boundedNumber(raw.maxWorkerCount, base.maxWorkerCount, 1, OCR_BOOST_HARD_MAX_WORKER_COUNT),
    slowdownFraction: boundedNumber(raw.slowdownFraction, base.slowdownFraction, 0.05, 2, false),
    triggers: { idle: triggers.idle !== false, hidden: triggers.hidden !== false, search: triggers.search !== false },
  };
}

/**
 * `ocr.workerCount` when the key is missing: 0, the automatic choice of resolveOcrWorkerPlan.
 * (Up to 2.4.311 the default was one worker.)
 */
export const DEFAULT_OCR_WORKER_COUNT = 0;
/** Most workers a site may ask for with an explicit `ocr.workerCount`; larger values are clamped. */
export const MAX_OCR_WORKER_COUNT = 8;

/**
 * @typedef {Object} OcrWorkerPolicy  The thresholds the automatic worker count is made from (`ocr.workerPolicy`).
 * @property {number} reservedCores  Logical cores left to the page itself; the rest may each run a worker.
 * @property {number} maxWorkerCount  Ceiling of the automatic choice (a manual `ocr.workerCount` may exceed it).
 * @property {number} pagesPerWorker  Pending pages a worker needs to pay for its start.
 * @property {number} memoryPerWorkerMiB  Memory one engine with its first language model takes.
 * @property {number} memoryPerLanguageMiB  Memory each further language model adds per engine.
 * @property {number} memoryBudgetFraction  Share of the device memory the workers together may take.
 * @property {number} assumedDeviceMemoryGiB  Device memory assumed when the browser reports none.
 */

/**
 * Defaults of `ocr.workerPolicy`, set from the OCR benchmark (About -> Diagnostics) on a 4-core,
 * 16 GB client (Chromium, 2026-11-10): 40 evenly spaced pages of a 300-page scanned document at
 * 1654x2339, Swedish and English models. Each line says what was measured and what is a margin
 * or an assumption on top of it.
 * - Throughput grew with every worker up to the cores minus one (2.0x with two, 2.8x with three
 *   workers on four cores), so one core is reserved for the page and each other core may run a
 *   worker (`reservedCores`).
 * - An engine took 0.4 to 0.65 s to start against 2.4 s to recognise a page, about a quarter
 *   of a page, so one pending page would already pay for a worker's start; `pagesPerWorker: 2`
 *   doubles that as a margin, since the extra engines start while the first page is being
 *   recognised and compete with it for the cores. A margin on a measurement, not a measurement.
 * - The renderer process grew by about 130 MiB per engine holding two models (private bytes 469
 *   MiB without an engine, 596, 769 and 856 MiB with one, two and three: steps of 127, 173 and
 *   87 MiB), read from the process since a page cannot see its workers' WebAssembly heaps. The
 *   second model's share is within that noise and is taken as 20 MiB (`memoryPerWorkerMiB` 110
 *   for the engine with one model, `memoryPerLanguageMiB` 20 for each further one). A quarter of
 *   the device memory is left to the workers (`memoryBudgetFraction`, a chosen margin), which on
 *   an 8 GB client allows more workers than the cores do and binds only on small devices; a
 *   browser that does not report the memory (Firefox, Safari) is taken as a 4 GB client
 *   (`assumedDeviceMemoryGiB`, an assumption).
 * - The page image's preparation then ran on the main thread (0.37 s per page on average, 1.6 s
 *   at p90 on ruled table pages, against 2.4 s of recognition), so three workers kept the main
 *   thread about half busy: no long task, stalls up to 136 ms. That is why `maxWorkerCount`
 *   stayed at 4 through 2.4.320. That version moved the preparation to its own worker
 *   (src/ocr/prepareWorker.js), and the OCR boost benchmark (About -> Diagnostics; evenly
 *   spaced pages of the same document, 120 and 32 of them, 2026-11-10 and -11, both runs still
 *   with the preparation on the main thread) measured the counts above four: on a 24-thread
 *   client with twelve physical cores eight workers doubled the throughput of four (100 -> 199
 *   pages/min) while the median recognition grew 9 % (1.85 -> 2.01 s), and above eight the
 *   recognitions slowed markedly as the physical cores ran out (2.57 s at twelve, 3.18 s at 24
 *   workers), so on that client eight is where more workers still buy about what they cost. An
 *   18-core client without SMT went from 286 to 456 pages/min at eight with 11 % longer
 *   recognitions and kept scaling to 660 at eighteen, which a later adaptive count is for.
 *   Hence `maxWorkerCount: 8` since 2.4.321, the hard MAX_OCR_WORKER_COUNT. Two things are not
 *   measured: the main thread's lag with eight workers now that the preparation is off it (with
 *   it on, 448 ms at worst against 235 with four on the 24-thread client), and the counts
 *   between four and eight that clients with six to eight logical threads now get (eight
 *   threads over four physical cores give seven workers). The memory bound still keeps the
 *   count lower on small devices.
 */
export const OCR_WORKER_POLICY_DEFAULTS = Object.freeze(/** @type {OcrWorkerPolicy} */ ({
  reservedCores: 1,
  maxWorkerCount: 8,
  pagesPerWorker: 2,
  memoryPerWorkerMiB: 110,
  memoryPerLanguageMiB: 20,
  memoryBudgetFraction: 0.25,
  assumedDeviceMemoryGiB: 4,
}));

/**
 * @typedef {Object} OcrWorkerCountConfig
 * @property {(number|'auto')} value  The count to use, or 'auto' for the integer literal 0 and for the default.
 * @property {boolean} configured  True when the key is present.
 * @property {boolean} clamped  True when an integer above MAX_OCR_WORKER_COUNT was lowered to it.
 * @property {*} rejected  The configured value when it was not an integer literal 0 or above
 *   (a string, a fraction, a negative number, a boolean); the automatic choice is used then. Absent otherwise.
 */

/**
 * Describe `ocr.workerCount` (how many tesseract.js workers recognise pages at the same time)
 * without resolving the automatic choice, so the caller can report a rejected or clamped value.
 * Only an integer literal counts: 1 to MAX_OCR_WORKER_COUNT is taken as it is (a manual
 * override of the automatic choice), a larger integer is clamped, 0 means automatic, and
 * anything else (a missing key, a string such as `"2"`, a fraction, a negative number, a
 * boolean) gives the default, which is the automatic choice too. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {OcrWorkerCountConfig}
 */
export function describeOcrWorkerCount(cfg = getRuntimeConfig()) {
  const section = cfg?.ocr;
  const configured = Boolean(section) && typeof section === 'object' && Object.prototype.hasOwnProperty.call(section, 'workerCount');
  const raw = configured ? section.workerCount : undefined;
  if (!configured) return { value: 'auto', configured: false, clamped: false };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return { value: 'auto', configured: true, clamped: false, rejected: raw };
  }
  if (raw === 0) return { value: 'auto', configured: true, clamped: false };
  if (raw > MAX_OCR_WORKER_COUNT) return { value: MAX_OCR_WORKER_COUNT, configured: true, clamped: true };
  return { value: raw, configured: true, clamped: false };
}

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @param {boolean=} integer
 * @returns {number}
 */
function boundedNumber(value, fallback, min, max, integer = true) {
  const numeric = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(numeric)) return fallback;
  const bounded = Math.max(min, Math.min(max, numeric));
  return integer ? Math.floor(bounded) : bounded;
}

/**
 * Read `ocr.workerPolicy`: a number out of range is clamped to the nearest bound, and whatever
 * is missing or not a finite number (a numeric string included) gets the default. Means nothing
 * while OCR is off or with a manual `ocr.workerCount`.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {OcrWorkerPolicy}
 */
export function normalizeOcrWorkerPolicy(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.workerPolicy && typeof cfg.ocr.workerPolicy === 'object' ? cfg.ocr.workerPolicy : {};
  const base = OCR_WORKER_POLICY_DEFAULTS;
  return {
    reservedCores: boundedNumber(raw.reservedCores, base.reservedCores, 0, 64),
    maxWorkerCount: boundedNumber(raw.maxWorkerCount, base.maxWorkerCount, 1, MAX_OCR_WORKER_COUNT),
    pagesPerWorker: boundedNumber(raw.pagesPerWorker, base.pagesPerWorker, 1, 100000),
    memoryPerWorkerMiB: boundedNumber(raw.memoryPerWorkerMiB, base.memoryPerWorkerMiB, 1, 65536, false),
    memoryPerLanguageMiB: boundedNumber(raw.memoryPerLanguageMiB, base.memoryPerLanguageMiB, 0, 65536, false),
    memoryBudgetFraction: boundedNumber(raw.memoryBudgetFraction, base.memoryBudgetFraction, 0.01, 1, false),
    assumedDeviceMemoryGiB: boundedNumber(raw.assumedDeviceMemoryGiB, base.assumedDeviceMemoryGiB, 0.25, 4096, false),
  };
}

/**
 * @typedef {Object} OcrWorkerPlan
 * @property {number} workerCount  Workers to run: the manual count, or the automatic choice.
 * @property {boolean} automatic  False when `ocr.workerCount` gave an explicit count.
 * @property {OcrWorkerPolicy} policy  The thresholds used.
 * @property {({ cores: number, memory: number, pages: (number|null), max: number }|null)} caps
 *   The bound each input gave (`pages` null when the page count was unknown); null for a manual count.
 * @property {{ cores: number, deviceMemoryGiB: number, deviceMemoryReported: boolean, pageCount: number, languageCount: number, memoryPerWorkerMiB: number }} inputs
 *   What the plan was made from, for diagnostics.
 */

/**
 * Resolve how many OCR workers to run. A manual `ocr.workerCount` (1 to MAX_OCR_WORKER_COUNT)
 * is taken as it is. Otherwise the count is the smallest of four bounds from `ocr.workerPolicy`
 * (the same shape as the PDF worker policy in documentLoadingConfig.js: thresholds fed by the
 * page count and the client's capacity):
 * - the cores: the reported logical cores less `reservedCores`, so the page keeps a core; an
 *   unknown core count (0, missing) gives one worker;
 * - the memory: `memoryBudgetFraction` of the device memory (reported, else
 *   `assumedDeviceMemoryGiB`) over what one engine takes with the loaded models
 *   (`memoryPerWorkerMiB` plus `memoryPerLanguageMiB` per model beyond the first);
 * - the pages: one worker per `pagesPerWorker` pending pages, so a short window does not start
 *   engines it cannot feed; a page count of 0 (unknown, or "the capacity") leaves this out;
 * - `maxWorkerCount`.
 * Never below one. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @param {Object} [options]  The caller reads these from `navigator`, so this stays free of globals.
 * @param {number} [options.cores]  `navigator.hardwareConcurrency`.
 * @param {number} [options.deviceMemoryGiB]  `navigator.deviceMemory` (Chromium reports at most 8).
 * @param {number} [options.pageCount]  Pages waiting for recognition; 0 for unknown.
 * @param {number} [options.languageCount]  Models each engine loads; default 1.
 * @returns {OcrWorkerPlan}
 */
export function resolveOcrWorkerPlan(cfg = getRuntimeConfig(), { cores = 0, deviceMemoryGiB = 0, pageCount = 0, languageCount = 1 } = {}) {
  const policy = normalizeOcrWorkerPolicy(cfg);
  const reportedCores = Math.max(0, Math.floor(Number(cores) || 0));
  const reportedMemory = Math.max(0, Number(deviceMemoryGiB) || 0);
  const pending = Math.max(0, Math.floor(Number(pageCount) || 0));
  const models = Math.max(1, Math.floor(Number(languageCount) || 1));
  const memoryPerWorkerMiB = policy.memoryPerWorkerMiB + (models - 1) * policy.memoryPerLanguageMiB;
  const memoryGiB = reportedMemory > 0 ? reportedMemory : policy.assumedDeviceMemoryGiB;
  const inputs = { cores: reportedCores, deviceMemoryGiB: memoryGiB, deviceMemoryReported: reportedMemory > 0, pageCount: pending, languageCount: models, memoryPerWorkerMiB };

  const { value } = describeOcrWorkerCount(cfg);
  if (value !== 'auto') return { workerCount: value, automatic: false, policy, caps: null, inputs };

  const coreCap = reportedCores > 0 ? Math.max(1, reportedCores - policy.reservedCores) : 1;
  const memoryCap = Math.max(1, Math.floor((memoryGiB * 1024 * policy.memoryBudgetFraction) / memoryPerWorkerMiB));
  const pageCap = pending > 0 ? Math.max(1, Math.ceil(pending / policy.pagesPerWorker)) : null;
  const workerCount = Math.max(1, Math.min(policy.maxWorkerCount, coreCap, memoryCap, pageCap ?? Infinity));
  return { workerCount, automatic: true, policy, caps: { cores: coreCap, memory: memoryCap, pages: pageCap, max: policy.maxWorkerCount }, inputs };
}

/**
 * The `workerCount` of resolveOcrWorkerPlan.
 *
 * @param {RuntimeConfig} [cfg]
 * @param {Object} [options]  See resolveOcrWorkerPlan.
 * @returns {number}
 */
export function resolveOcrWorkerCount(cfg = getRuntimeConfig(), options = {}) {
  return resolveOcrWorkerPlan(cfg, options).workerCount;
}

/**
 * Resolve whether the language of a page's text is guessed among the OCR languages, for the
 * read-aloud language and the text layer's `lang` (`ocr.speech.autoDetectLanguage`). On by
 * default; only the boolean literal `false` turns it off. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isSpeechLanguageAutoDetectEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.speech?.autoDetectLanguage !== false;
}

/**
 * Resolve whether the toolbar's search in the text layers is offered (`ocr.search.enabled`). On
 * by default; only the boolean literal `false` turns it off. With it off, the toolbar keeps a
 * status-only indicator of the page's recognition in the search button's place (no field ever
 * opens, so the layers mark nothing), while the layers themselves and the browser's own find
 * stay. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrSearchEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.search?.enabled !== false;
}

/**
 * Resolve whether Ctrl+F (Cmd+F on a Mac) opens the toolbar's search in the text layers instead
 * of the browser's own find (`ocr.search.overridesCtrlF`). Off by default: only the boolean
 * literal `true` hands the shortcut over, as the portal's page search does with its user
 * setting. Means nothing while OCR or the search is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isOcrSearchCtrlFOverrideEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.search?.overridesCtrlF === true;
}

/**
 * Resolve whether read-aloud is offered (`ocr.speech.enabled`): the entry in the page's context
 * menu and the "Reading language" section in the language menu. On by default; only the boolean
 * literal `false` turns it off. With it off, the read-aloud state is never provided, so the
 * viewer neither follows the selection nor touches speech synthesis; the language guess
 * (`ocr.speech.autoDetectLanguage`) is independent and still sets the text flow's `lang` for
 * screen readers. Means nothing while OCR is off.
 *
 * @param {RuntimeConfig} [cfg]
 * @returns {boolean}
 */
export function isReadAloudEnabled(cfg = getRuntimeConfig()) {
  return cfg?.ocr?.speech?.enabled !== false;
}

/**
 * Describe how `ocr.languages` resolves: the usable codes, the entries that were ignored and
 * whether the default list stood in. This is the diagnostic form of getOcrLanguages and stays
 * side-effect free like every accessor here; the OCR module (src/ocr/setup.js) logs the outcome
 * once when it starts, so a site sees a typo instead of a silent fallback.
 *
 * The value is either one of the OCR_LANGUAGE_PRESETS names (`'auto'`, `'swedish'`,
 * `'english'`; trimmed, any case), which stands for its array and is reported as `preset`, or
 * an array of codes. Entries are trimmed and lower-cased; non-strings, malformed codes and
 * duplicates are dropped. Only the form of a code is checked (three letters plus optional
 * `_suffix`); whether a model with that code exists is known to the OCR module, which checks it
 * against tesseract.js' list. `configured` is true when the key is present at all (`undefined`
 * means unconfigured); `notArray` is true when it is present but neither an array nor a preset
 * name. `fallback` is true when the value is missing, neither an array nor a preset, or an
 * array without a usable entry (including `[]`): `languages` is then a copy of
 * DEFAULT_OCR_LANGUAGES, since an empty list could never recognize anything. `duplicates` lists
 * repeated codes (kept once). The order of valid codes is kept because Tesseract reports it as
 * the model order.
 *
 * @param {Object=} cfg
 * @returns {{ languages: Array<string>, configured: boolean, notArray: boolean, fallback: boolean, dropped: Array<*>, duplicates: Array<string>, preset: (string|undefined) }}
 *   `preset` is present only when a name matched.
 */
export function describeOcrLanguages(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.languages;
  if (typeof raw === 'string') {
    const preset = raw.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(OCR_LANGUAGE_PRESETS, preset)) {
      return { languages: [...OCR_LANGUAGE_PRESETS[preset]], configured: true, notArray: false, fallback: false, dropped: [], duplicates: [], preset };
    }
  }
  if (!Array.isArray(raw)) {
    return {
      languages: [...DEFAULT_OCR_LANGUAGES],
      configured: raw !== undefined,
      notArray: raw !== undefined,
      fallback: true,
      dropped: [],
      duplicates: [],
    };
  }
  const languages = [];
  const dropped = [];
  const duplicates = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      dropped.push(entry);
      continue;
    }
    const code = entry.trim().toLowerCase();
    if (!OCR_LANGUAGE_CODE_PATTERN.test(code)) {
      dropped.push(entry);
      continue;
    }
    if (languages.includes(code)) {
      if (!duplicates.includes(code)) duplicates.push(code);
      continue;
    }
    languages.push(code);
  }
  if (!languages.length) {
    return { languages: [...DEFAULT_OCR_LANGUAGES], configured: true, notArray: false, fallback: true, dropped, duplicates };
  }
  return { languages, configured: true, notArray: false, fallback: false, dropped, duplicates };
}

/**
 * Resolve the OCR languages (`ocr.languages`): the `languages` of describeOcrLanguages.
 *
 * @param {Object=} cfg
 * @returns {Array<string>}
 */
export function getOcrLanguages(cfg = getRuntimeConfig()) {
  return describeOcrLanguages(cfg).languages;
}

/** Why describeOcrAssetBaseUrl ignores a value; the OCR module logs the reason once. */
export const OCR_ASSET_BASE_URL_REJECTIONS = Object.freeze({
  /** The value carries `?` or `#`: file names are appended to the base, so neither can be kept. */
  QUERY_OR_FRAGMENT: 'query-or-fragment',
  /** The value has a scheme other than http or https (javascript:, data:, blob:, file:, a drive letter). */
  SCHEME: 'scheme',
  /** The value contains whitespace or a control character; the URL parser would strip them, which could hide a scheme. */
  INVALID_CHARACTERS: 'invalid-characters',
});
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
// ASCII whitespace and control characters, which the WHATWG URL parser removes before parsing.
// eslint-disable-next-line no-control-regex
const URL_UNSAFE_CHARACTER_PATTERN = /[\u0000- \u007f]/;

/**
 * Describe how `ocr.assetBaseUrl` resolves. `url` is the usable base with a trailing slash, or
 * `null` for the viewer's own `ocr/` folder next to the application. Blank and non-string values
 * are simply unset. A string is ignored (`url` null, `rejected` set) when it carries a query
 * string or fragment, because the engine appends file names to the base, or when its scheme is
 * not http or https. Relative (`/shared/ocr/`, `ocr`) and protocol-relative (`//host/ocr/`)
 * bases are allowed and resolve against the page. Whether a cross-origin base can actually be
 * used is still decided by the browser: the site CSP must allow the host in `script-src` and the
 * host must send CORS headers for the language models.
 *
 * @param {Object=} cfg
 * @returns {{ url: (string|null), rejected: (string|null), value: (string|null) }}
 */
export function describeOcrAssetBaseUrl(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.assetBaseUrl;
  if (typeof raw !== 'string') return { url: null, rejected: null, value: null };
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, rejected: null, value: null };
  if (URL_UNSAFE_CHARACTER_PATTERN.test(trimmed)) {
    return { url: null, rejected: OCR_ASSET_BASE_URL_REJECTIONS.INVALID_CHARACTERS, value: trimmed };
  }
  if (/[?#]/.test(trimmed)) {
    return { url: null, rejected: OCR_ASSET_BASE_URL_REJECTIONS.QUERY_OR_FRAGMENT, value: trimmed };
  }
  const scheme = URL_SCHEME_PATTERN.exec(trimmed);
  if (scheme && !/^https?:$/i.test(scheme[0])) {
    return { url: null, rejected: OCR_ASSET_BASE_URL_REJECTIONS.SCHEME, value: trimmed };
  }
  return { url: trimmed.endsWith('/') ? trimmed : `${trimmed}/`, rejected: null, value: trimmed };
}

/**
 * Resolve where the OCR engine, worker and language files are served from (`ocr.assetBaseUrl`):
 * the `url` of describeOcrAssetBaseUrl, so `null` both for the default and for an ignored value.
 *
 * @param {Object=} cfg
 * @returns {(string|null)}
 */
export function getOcrAssetBaseUrl(cfg = getRuntimeConfig()) {
  return describeOcrAssetBaseUrl(cfg).url;
}

/**
 * Resolve the site default for the "Larger toolbar buttons" preference (`toolbar.largeButtons`).
 * Only an explicit `false` makes the compact toolbar the default; a user's stored choice in the
 * theme menu still outranks this value (see getEffectiveToolbarLargeButtons in viewerPreferences).
 *
 * @param {Object=} cfg
 * @returns {boolean}
 */
export function getToolbarLargeButtonsDefault(cfg = getRuntimeConfig()) {
  return cfg?.toolbar?.largeButtons !== false;
}

/**
 * Normalize a runtime flag to a boolean.
 *
 * Host configs are optional and can contain values from hand-edited JavaScript, so only real
 * booleans are accepted. A non-boolean default falls back to false to keep callers predictable
 * when a caller accidentally forwards an unvalidated config value as the fallback. This treats
 * non-boolean defaults as configuration mistakes instead of silently coercing strings like
 * `"false"` to true. Callers must pass an actual boolean default; this helper intentionally does
 * not log because it is used by normal config resolution paths and should stay side-effect free.
 *
 * @param {*} value
 * @param {*} defaultValue
 * @returns {boolean}
 */
function normalizeBoolean(value, defaultValue) {
  if (typeof value === 'boolean') return value;
  return typeof defaultValue === 'boolean' ? defaultValue : false;
}

/**
 * Clamp a numeric config value to a safe range.
 *
 * Invalid value/min/default inputs fall back to the nearest safe value instead of propagating NaN.
 * The max bound is optional; when it is invalid or lower than min, max is ignored entirely and
 * only the lower bound is applied.
 * For example, `clampNumber('x', 5, 1, 10)` returns 5, while
 * `clampNumber(20, 5, 1, 10)` returns 10. If max is lower than min, max is ignored:
 * `clampNumber(5, 10, 20, 15)` returns 20, while `clampNumber(30, 10, 20, 15)`
 * returns 30 because no upper bound is applied.
 *
 * @param {*} value
 * @param {*=} defaultValue
 * @param {*} min
 * @param {*=} max
 * @returns {number}
 */
function clampNumber(value, defaultValue, min, max) {
  const numeric = Number(value);
  const minNumber = Number(min);
  const maxNumber = Number(max);
  const safeMin = Number.isFinite(minNumber) ? minNumber : 0;
  const safeMax = Number.isFinite(maxNumber) && maxNumber >= safeMin ? maxNumber : null;
  const defaultNumber = Number(defaultValue ?? safeMin);
  const fallback = Number.isFinite(defaultNumber) ? defaultNumber : safeMin;
  const valueToClamp = Number.isFinite(numeric) ? numeric : fallback;
  const lowerBounded = Math.max(safeMin, valueToClamp);
  return safeMax === null ? lowerBounded : Math.min(safeMax, lowerBounded);
}

/**
 * Normalize an integer config value and clamp it to the supplied range.
 *
 * Use this for counts, pixel thresholds, and millisecond settings where decimals should not be
 * preserved. Non-finite values use defaultValue before clamping.
 *
 * @param {*} value
 * @param {*} defaultValue
 * @param {*} min
 * @param {*} max
 * @returns {number}
 */
function normalizeInteger(value, defaultValue, min, max) {
  const numeric = Number(value);
  const next = Number.isFinite(numeric)
    ? Math.floor(numeric)
    : undefined;
  return clampNumber(next, defaultValue, min, max);
}

/**
 * Normalize a floating-point runtime config value and clamp it to the supplied range.
 *
 * Use this entry point for ratios and percentages where fractional values are meaningful. Unlike
 * normalizeInteger, this preserves decimals before clamping. Non-finite values use defaultValue
 * before clamping.
 *
 * @param {*} value
 * @param {*} defaultValue
 * @param {*} min
 * @param {*} max
 * @returns {number}
 */
function normalizeFloat(value, defaultValue, min, max) {
  return clampNumber(value, defaultValue, min, max);
}

/**
 * Normalize the runtime session-reset target.
 *
 * Valid values are the ResetSessionTarget literals listed in RESET_SESSION_TARGETS. Missing,
 * blank, or unrecognized values fall back to defaultTarget when it is valid, otherwise to
 * DEFAULT_RESET_SESSION_TARGET. The fallback validation is delegated to
 * normalizeResetSessionFallbackTarget so the primary value path and defaultTarget path stay
 * explicit.
 *
 * @param {*} value
 * @param {*} defaultTarget
 * @returns {ResetSessionTarget}
 */
function normalizeResetSessionTarget(value, defaultTarget) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (RESET_SESSION_TARGETS.includes(raw)) return raw;
  return normalizeResetSessionFallbackTarget(defaultTarget);
}

/**
 * Resolve the configured reset-session fallback target.
 *
 * @param {*} defaultTarget
 * @returns {ResetSessionTarget}
 */
function normalizeResetSessionFallbackTarget(defaultTarget) {
  const fallback = String(defaultTarget ?? '').trim().toLowerCase();
  return RESET_SESSION_TARGETS.includes(fallback) ? fallback : DEFAULT_RESET_SESSION_TARGET;
}

/**
 * Normalize a user-facing zoom mode string before alias lookup.
 *
 * The transformation accepts common host config variants by trimming, lowercasing, and converting
 * underscores/whitespace to hyphen separators.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeZoomModeText(value) {
  // Empty string is the invalid sentinel for downstream fallback logic.
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

/**
 * Resolve a normalized zoom-mode alias to the internal viewer mode.
 *
 * @param {string} value
 * @returns {(ViewerDefaultZoomMode|null)}
 */
function resolveDefaultZoomModeAlias(value) {
  const entry = DEFAULT_ZOOM_MODE_ALIAS_ENTRIES.find(([alias]) => alias === value);
  return entry ? entry[1] : null;
}

/**
 * Normalize a runtime default zoom mode to the internal DocumentViewer mode.
 *
 * Unknown host values fall back to defaultMode, and an invalid defaultMode falls back to FIT_WIDTH.
 *
 * @param {*} value
 * @param {*} defaultMode
 * @returns {ViewerDefaultZoomMode}
 */
function normalizeDefaultZoomMode(value, defaultMode = DEFAULT_ZOOM_MODE_TEXT) {
  const defaultRaw = normalizeZoomModeText(defaultMode) || DEFAULT_ZOOM_MODE_TEXT;
  const defaultResolved = resolveDefaultZoomModeAlias(defaultRaw) || DEFAULT_ZOOM_MODE;
  const raw = normalizeZoomModeText(value);
  return raw ? (resolveDefaultZoomModeAlias(raw) || defaultResolved) : defaultResolved;
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
  if (Object.hasOwn(PRINT_DEFAULT_MODE_ALIASES, raw)) return PRINT_DEFAULT_MODE_ALIASES[raw];
  return defaultMode === 'all' ? 'all' : 'active';
}

/**
 * Normalize a custom fit-width factor. The public config/preference value is an integer percentage
 * of the calculated fit-width zoom, not a direct zoom percentage. The default 70 means the custom
 * size starts at 70% of the calculated fit-width zoom when no site or user preference is set.
 * Fractional values are floored to keep the persisted preference as an integer. Values outside
 * the supported 1-100 range are clamped to the nearest bound.
 *
 * @param {*} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function normalizeCustomFitWidthFactorPercent(value, defaultValue = DEFAULT_CUSTOM_FIT_WIDTH_FACTOR_PERCENT) {
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
  if (value === null || value === undefined || String(value).trim() === '') return null;
  // Optional size limits come from user-facing sliders/inputs, so nearest-integer rounding keeps
  // those controls intuitive. normalizeCustomFitWidthFactorPercent floors the base fit-width
  // factor instead to preserve its older persisted-preference behavior.
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

  // The shorter *Percent aliases are kept for backward compatibility with early user preferences.
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
  // The shorter *Percent aliases are kept for backward compatibility with early site configs.
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
    resetSessionAllowedOrigin: typeof raw.resetSessionAllowedOrigin === 'string'
      ? raw.resetSessionAllowedOrigin.trim()
      : '',
  };
}

/** @type {ReadonlyArray<'system'|'normal'|'light'|'dark'>} */
const THEME_DEFAULT_MODES = Object.freeze(['system', 'normal', 'light', 'dark']);

/**
 * Resolve the site's default theme mode — the mode used ONLY while the browser has no stored
 * theme choice (no shared OMP_THEME_PREFERENCE and no legacy local ODV setting). A user's own
 * choice in the theme menu is remembered per browser and always outranks this default.
 *
 * Runtime config value: `theme.defaultMode`
 * Supported values (case-insensitive): "system" (default; follows the OS light/dark setting),
 * "light", "dark", "normal". Unknown or missing values fall back to "system".
 *
 * @param {Object=} cfg
 * @returns {'system'|'normal'|'light'|'dark'}
 */
export function getThemeDefaultMode(cfg = getRuntimeConfig()) {
  const raw = cfg?.theme?.defaultMode;
  if (typeof raw !== 'string') return 'system';
  const mode = raw.trim().toLowerCase();
  return THEME_DEFAULT_MODES.includes(mode) ? /** @type {any} */ (mode) : 'system';
}

/**
 * Resolve the allowed origins for the opt-in cross-origin theme bridge.
 *
 * Runtime config value: `theme.bridge.allowedOrigins`
 * A list of exact parent origins (for example 'https://portal.example').
 * Empty (the default) disables the postMessage bridge entirely.
 *
 * @param {Object=} cfg
 * @returns {Array<string>}
 */
export function getOmpThemeBridgeAllowedOrigins(cfg = getRuntimeConfig()) {
  const raw = cfg?.theme?.bridge?.allowedOrigins;
  if (!Array.isArray(raw)) return [];
  const allowed = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || allowed.includes(trimmed)) continue;
    allowed.push(trimmed);
  }
  return allowed;
}
