// File: src/components/DocumentToolbar/printRangeDialogHelpers.js
/**
 * Pure helpers and shared constants for the print-range dialog.
 *
 * @module printRangeDialogHelpers
 */

import { resolveLocalizedValue, resolveOptionLabel } from '../../utils/localizedValue.js';

/**
 * Read the runtime configuration (merged defaults + site overrides).
 * @returns {Object}
 */
export function getCfg() {
  const w = typeof window !== 'undefined' ? window : {};
  return (w.__ODV_GET_CONFIG__ ? w.__ODV_GET_CONFIG__() : (w.__ODV_CONFIG__ || {})) || {};
}

/**
 * Build a safe RegExp from optional pattern/flags.
 * @param {string|null|undefined} pattern
 * @param {string|null|undefined} flags
 * @returns {(RegExp|null)}
 */
export function safeRegex(pattern, flags) {
  if (!pattern) return null;
  try { return new RegExp(pattern, flags || ''); } catch { return null; }
}

/**
 * @param {*} value
 * @returns {boolean}
 */
export function hasTextValue(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return lowered !== 'null' && lowered !== 'undefined';
}

/**
 * Resolve the string that should be used on physical print/log output for an option.
 * `printValue` may be localized and is preferred over legacy value/label behavior.
 * @param {*} option
 * @param {*} i18n
 * @param {boolean} useValueForOutput
 * @returns {string}
 */
export function resolveOptionPrintText(option, i18n, useValueForOutput) {
  if (!option) return '';
  if (option.printValue !== undefined) {
    return resolveLocalizedValue(option.printValue, i18n) || String(option.value ?? '');
  }
  if (option.output !== undefined) {
    return resolveLocalizedValue(option.output, i18n) || String(option.value ?? '');
  }
  if (option.printLabel !== undefined) {
    return resolveLocalizedValue(option.printLabel, i18n) || String(option.value ?? '');
  }
  if (useValueForOutput) return String(option.value ?? '');
  return resolveOptionLabel(option, i18n) || String(option.value ?? '');
}

/**
 * Resolve a configurable print dialog action.
 * @param {*} actionsCfg
 * @param {string} name
 * @param {*} i18n
 * @param {Object} fallback
 * @returns {{ enabled: boolean, label: string, tooltip: string }}
 */
export function resolvePrintAction(actionsCfg, name, i18n, fallback) {
  const cfg = actionsCfg?.[name] || {};
  return {
    enabled: cfg.enabled !== false,
    label: resolveLocalizedValue(cfg.label, i18n) || fallback.label,
    tooltip: resolveLocalizedValue(cfg.tooltip ?? cfg.title, i18n) || fallback.tooltip || fallback.label,
  };
}

/**
 * @param {*} value
 * @param {'auto'|'portrait'|'landscape'} fallback
 * @returns {'auto'|'portrait'|'landscape'}
 */
export function normalizePdfOrientationMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'auto' || mode === 'portrait' || mode === 'landscape') return mode;
  return fallback;
}

/**
 * Build token-friendly details for the selected option without forcing templates to use list indexes.
 * @param {*} option
 * @param {*} i18n
 * @param {string} output
 * @param {Object=} extra
 * @returns {Object}
 */
export function buildSelectedOptionDetails(option, i18n, output, extra = {}) {
  const value = option?.value == null ? '' : String(option.value);
  return {
    value,
    label: option?.label ?? value,
    uiLabel: resolveOptionLabel(option || { value }, i18n) || value,
    printValue: option?.printValue ?? option?.output ?? option?.printLabel ?? value,
    output: output || '',
    selectedText: output || '',
    option: option || null,
    ...extra,
  };
}

const ODV_PRINT_CSS = `
@media print {
  @page { margin: 0; size: A4 portrait; }
  html, body { margin: 0 !important; padding: 0 !important; }
  #odv-print-root, [data-odv-print-root] { width: 100vw; height: 100vh; }
  .odv-print-page, [data-odv-print-page] {
    page-break-after: always; break-after: page; break-inside: avoid;
    display: grid; place-items: center;
    box-sizing: border-box; width: 100vw; height: 100vh; padding: 8mm; overflow: hidden;
  }
  .odv-print-page img, .odv-print-page canvas,
  [data-odv-print-page] img, [data-odv-print-page] canvas {
    display: block; max-width: 100%; max-height: 100%; object-fit: contain;
  }
  img[data-odv-print-page], canvas[data-odv-print-page] {
    page-break-after: always; break-inside: avoid; display: block; margin: 0 auto;
    max-width: calc(100% - 10mm); max-height: 95vh; object-fit: contain;
  }
}
`;

/**
 * Ensure base print CSS is injected once per document.
 * @returns {void}
 */
export function ensureODVPrintCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('odv-print-css')) return;
  const style = document.createElement('style');
  style.id = 'odv-print-css';
  style.type = 'text/css';
  style.appendChild(document.createTextNode(ODV_PRINT_CSS));
  document.head.appendChild(style);
}
