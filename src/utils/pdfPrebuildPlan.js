// File: src/utils/pdfPrebuildPlan.js
/**
 * OpenDocViewer - generated-PDF prebuild planning.
 *
 * This module only plans cacheable "all pages" PDF variants. Background
 * generation and cache lookup are wired separately so the initial feature can be
 * validated without changing print behavior.
 */

import { resolveLocalizedValue, resolveOptionLabel } from './localizedValue.js';

const DEFAULT_PREBUILD_MAX_PAGES = 500;
const DEFAULT_PREBUILD_MAX_VARIANTS = 12;
const DEFAULT_PREBUILD_START_DELAY_MS = 1500;
const DEFAULT_PREBUILD_CONCURRENCY = 1;
const VALID_COPY_MARKER_STATES = Object.freeze(['default', 'on', 'off']);
const VALID_PREBUILD_COPY_MARKER_MODES = Object.freeze(['default', 'on', 'off', 'both']);
const VALID_PDF_ORIENTATION_MODES = Object.freeze(['auto', 'portrait', 'landscape']);

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInteger(value, fallback, min, max) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value
 * @returns {Array<string>}
 */
function normalizeLanguageList(value) {
  const raw = Array.isArray(value) ? value : [value || 'current'];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const language = String(item || '').trim();
    const key = language.toLowerCase();
    if (!language || seen.has(key)) continue;
    seen.add(key);
    out.push(language);
  }
  return out.length ? out : ['current'];
}

/**
 * @param {*} value
 * @returns {Array<'default'|'on'|'off'>}
 */
function normalizeCopyMarkerStates(value) {
  if (Array.isArray(value)) {
    const out = [];
    const seen = new Set();
    value.forEach((item) => {
      const state = String(item || '').trim().toLowerCase();
      if (!VALID_COPY_MARKER_STATES.includes(state) || seen.has(state)) return;
      seen.add(state);
      out.push(/** @type {'default'|'on'|'off'} */ (state));
    });
    return out.length ? out : ['default'];
  }

  const mode = String(value || 'default').trim().toLowerCase();
  if (mode === 'both') return ['off', 'on'];
  if (VALID_PREBUILD_COPY_MARKER_MODES.includes(mode)) return [/** @type {'default'|'on'|'off'} */ (mode)];
  return ['default'];
}

/**
 * @param {*} value
 * @param {'auto'|'portrait'|'landscape'} fallback
 * @returns {'auto'|'portrait'|'landscape'}
 */
function normalizePdfOrientationMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase();
  if (VALID_PDF_ORIENTATION_MODES.includes(mode)) return /** @type {'auto'|'portrait'|'landscape'} */ (mode);
  return fallback;
}

/**
 * @param {*} pdfCfg
 * @returns {'auto'|'portrait'|'landscape'}
 */
function resolvePrebuildPdfOrientation(pdfCfg = {}) {
  const orientationCfg = pdfCfg?.orientation || {};
  const fixedMode = normalizePdfOrientationMode(orientationCfg.fixedMode || orientationCfg.fixed || 'portrait', 'portrait');
  return normalizePdfOrientationMode(
    orientationCfg.mode
      || pdfCfg?.orientationMode
      || (orientationCfg.defaultAuto === false ? fixedMode : 'auto'),
    'auto'
  );
}

/**
 * Resolve the string that should be used on physical print output for an option.
 * @param {*} option
 * @param {(string|Object|null)} languageOrI18n
 * @param {boolean} useValueForOutput
 * @returns {string}
 */
function resolveOptionPrintText(option, languageOrI18n, useValueForOutput) {
  if (!option) return '';
  if (option.printValue !== undefined) {
    return resolveLocalizedValue(option.printValue, languageOrI18n) || String(option.value ?? '');
  }
  if (option.output !== undefined) {
    return resolveLocalizedValue(option.output, languageOrI18n) || String(option.value ?? '');
  }
  if (option.printLabel !== undefined) {
    return resolveLocalizedValue(option.printLabel, languageOrI18n) || String(option.value ?? '');
  }
  if (useValueForOutput) return String(option.value ?? '');
  return resolveOptionLabel(option, languageOrI18n) || String(option.value ?? '');
}

/**
 * @param {*} option
 * @param {(string|Object|null)} languageOrI18n
 * @param {string} output
 * @param {Object=} extra
 * @returns {Object}
 */
function buildSelectedOptionDetails(option, languageOrI18n, output, extra = {}) {
  const value = option?.value == null ? '' : String(option.value);
  return {
    value,
    label: option?.label ?? value,
    uiLabel: resolveOptionLabel(option || { value }, languageOrI18n) || value,
    printValue: option?.printValue ?? option?.output ?? option?.printLabel ?? value,
    output: output || '',
    selectedText: output || '',
    option: option || null,
    ...extra,
  };
}

/**
 * @param {*} prebuildCfg
 * @returns {Object}
 */
export function normalizePdfPrebuildAllPagesConfig(prebuildCfg = {}) {
  const cfg = isNonEmptyObject(prebuildCfg) ? prebuildCfg : {};
  const copyMarkerSource = cfg.copyMarkerStates ?? cfg.copyMarker ?? cfg.watermark ?? cfg.watermarkStates;
  return {
    enabled: cfg.enabled === true,
    languages: normalizeLanguageList(cfg.languages ?? cfg.language),
    copyMarkerStates: normalizeCopyMarkerStates(copyMarkerSource),
    includeFixedReasons: cfg.includeFixedReasons !== false,
    includeEmptyReason: cfg.includeEmptyReason === true,
    includeFreeTextReasons: cfg.includeFreeTextReasons === true,
    allowDateTimeTokens: cfg.allowDateTimeTokens !== false,
    maxPages: clampInteger(cfg.maxPages, DEFAULT_PREBUILD_MAX_PAGES, 1, 100000),
    maxVariants: clampInteger(cfg.maxVariants, DEFAULT_PREBUILD_MAX_VARIANTS, 1, 1000),
    startDelayMs: clampInteger(cfg.startDelayMs, DEFAULT_PREBUILD_START_DELAY_MS, 0, 600000),
    concurrency: clampInteger(cfg.concurrency, DEFAULT_PREBUILD_CONCURRENCY, 1, 32),
  };
}

/**
 * @param {*} reasonCfg
 * @returns {Array<Object>}
 */
function getReasonOptions(reasonCfg) {
  const options = reasonCfg?.source?.options;
  return Array.isArray(options) ? options : [];
}

/**
 * @param {*} reasonCfg
 * @param {Object} prebuildCfg
 * @param {(string|Object|null)} languageOrI18n
 * @returns {Array<Object>}
 */
function createReasonVariants(reasonCfg, prebuildCfg, languageOrI18n) {
  if (!prebuildCfg.includeFixedReasons) return [];
  const useValueForOutput = reasonCfg?.useValueForOutput !== false;
  return getReasonOptions(reasonCfg)
    .filter((option) => {
      const value = String(option?.value ?? '').trim();
      if (!value) return prebuildCfg.includeEmptyReason;
      if (option?.allowFreeText && !prebuildCfg.includeFreeTextReasons) return false;
      return true;
    })
    .map((option) => {
      const output = String(resolveOptionPrintText(option, languageOrI18n, useValueForOutput)).trim();
      return {
        reason: output || null,
        reasonSelection: buildSelectedOptionDetails(option, languageOrI18n, output, { freeText: '' }),
      };
    });
}

/**
 * @param {*} printFormatCfg
 * @param {'default'|'on'|'off'} state
 * @param {(string|Object|null)} languageOrI18n
 * @returns {{printFormat:(string|null), printFormatValue:(string|null), printFormatSelection:Object, copyMarkerState:string}}
 */
function createPrintFormatVariant(printFormatCfg, state, languageOrI18n) {
  const watermarkCfg = printFormatCfg?.watermark || {};
  const options = Array.isArray(printFormatCfg?.options) ? printFormatCfg.options : [];
  const option = options.find((item) => String(item?.value ?? '').trim()) || null;
  const defaultChecked = watermarkCfg.defaultChecked === true;
  const active = state === 'default' ? defaultChecked : state === 'on';
  if (!printFormatCfg?.enabled || !option || !active) {
    return {
      printFormat: null,
      printFormatValue: null,
      printFormatSelection: buildSelectedOptionDetails(null, languageOrI18n, ''),
      copyMarkerState: state,
    };
  }

  const rawValue = option.value == null ? '' : String(option.value);
  const useValueForOutput = printFormatCfg?.useValueForOutput !== false;
  const text = String(resolveOptionPrintText(option, languageOrI18n, useValueForOutput)).trim();
  return {
    printFormat: text || null,
    printFormatValue: rawValue || null,
    printFormatSelection: buildSelectedOptionDetails(option, languageOrI18n, text),
    copyMarkerState: state,
  };
}

/**
 * @param {string} language
 * @param {(string|Object|null)} i18nOrLanguage
 * @returns {(string|Object|null)}
 */
function resolveVariantLanguageContext(language, i18nOrLanguage) {
  if (language !== 'current') return language;
  return i18nOrLanguage || 'current';
}

/**
 * Create all cacheable all-pages PDF variant descriptors for a runtime config.
 * @param {*} runtimeConfig
 * @param {(string|Object|null)=} i18nOrLanguage
 * @returns {{enabled:boolean, config:Object, variants:Array<Object>}}
 */
export function createPdfPrebuildAllPagesVariants(runtimeConfig, i18nOrLanguage = null) {
  const cfg = runtimeConfig || {};
  const pdfCfg = cfg?.print?.pdf || {};
  const prebuildCfg = normalizePdfPrebuildAllPagesConfig(pdfCfg?.prebuildAllPages || {});
  if (!prebuildCfg.enabled) return { enabled: false, config: prebuildCfg, variants: [] };

  const reasonCfg = cfg?.userLog?.ui?.fields?.reason || {};
  const printFormatCfg = cfg?.print?.format || {};
  const pdfOrientation = resolvePrebuildPdfOrientation(pdfCfg);
  const variants = [];
  for (const language of prebuildCfg.languages) {
    const languageContext = resolveVariantLanguageContext(language, i18nOrLanguage);
    const reasons = createReasonVariants(reasonCfg, prebuildCfg, languageContext);
    for (const reason of reasons) {
      for (const copyMarkerState of prebuildCfg.copyMarkerStates) {
        const format = createPrintFormatVariant(printFormatCfg, copyMarkerState, languageContext);
        variants.push({
          key: createPdfPrebuildVariantKey({
            language,
            reasonValue: reason.reasonSelection?.value || '',
            copyMarkerState,
            pdfOrientation,
          }),
          mode: 'all',
          language,
          pdfOrientation,
          reason: reason.reason,
          reasonSelection: reason.reasonSelection,
          forWhom: null,
          ...format,
        });
        if (variants.length >= prebuildCfg.maxVariants) {
          return { enabled: true, config: prebuildCfg, variants };
        }
      }
    }
  }

  return { enabled: true, config: prebuildCfg, variants };
}

/**
 * @param {Object} parts
 * @returns {string}
 */
export function createPdfPrebuildVariantKey(parts = {}) {
  return [
    'all',
    String(parts.language || 'current').toLowerCase(),
    String(parts.pdfOrientation || 'auto').toLowerCase(),
    String(parts.reasonValue || ''),
    String(parts.copyMarkerState || 'default'),
  ].join('|');
}
