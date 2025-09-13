// File: src/utils/localizedValue.js
/**
 * Localized string resolver for admin-supplied config values.
 * Any config field documented as `LocalizedString` may be:
 *   - a plain string (legacy/back-compat), or
 *   - a map of language → string, e.g. { en: "...", sv: "..." }.
 *
 * @typedef {string | Object.<string,string>} LocalizedString
 */

/**
 * A subset of the i18next `options` object we care about.
 * @typedef {Object} I18nOptionsLike
 * @property {(string|Array.<string>|Object.<string,(string|Array.<string>)>)} [fallbackLng]
 */

/**
 * Minimal shape of an i18n instance used by this module.
 * @typedef {Object} I18nLike
 * @property {string} [language]
 * @property {I18nOptionsLike} [options]
 */

/**
 * Option-like shape used by the print reason selector.
 * Keep `value` as a stable identifier; `label` is optional and may be localized.
 * @typedef {Object} OptionLike
 * @property {LocalizedString} [label]
 * @property {(string|LocalizedString)} value
 */

/**
 * Return the best string for the active language.
 * Tries full code (sv-SE), then base (sv), then i18n fallbackLng, then first entry, then "".
 *
 * @param {LocalizedString} value
 * @param {(I18nLike|string|null)} [i18nOrLang]
 * @param {(string|Array.<string>)} [fallback='en']
 * @returns {string}
 */
export function resolveLocalizedValue(value, i18nOrLang, fallback = 'en') {
  if (value == null) return '';
  if (typeof value === 'string') return value;

  /** @type {Record<string,string>} */
  const map = value || {};

  /** @type {string} */
  let lang = 'en';
  if (i18nOrLang && typeof i18nOrLang === 'object' && typeof /** @type {I18nLike} */ (i18nOrLang).language === 'string') {
    lang = /** @type {I18nLike} */ (i18nOrLang).language;
  } else if (typeof i18nOrLang === 'string' && i18nOrLang) {
    lang = i18nOrLang;
  } else if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
    lang = document.documentElement.lang;
  } else if (typeof navigator !== 'undefined' && navigator.language) {
    lang = navigator.language;
  }

  const full = String(lang).toLowerCase();
  const base = full.split('-')[0];

  /** @type {Array.<string>} */
  let fallbacks = [];
  const fromI18n =
    (i18nOrLang && typeof i18nOrLang === 'object' && /** @type {I18nLike} */ (i18nOrLang).options
      ? /** @type {I18nLike} */ (i18nOrLang).options.fallbackLng
      : null) ?? fallback ?? 'en';

  if (Array.isArray(fromI18n)) {
    fallbacks = fromI18n.map((x) => String(x).toLowerCase());
  } else if (typeof fromI18n === 'string') {
    fallbacks = [fromI18n.toLowerCase()];
  } else if (fromI18n && typeof fromI18n === 'object') {
    // i18next allows object fallbacks (per language). Flatten unique values.
    fallbacks = Array.from(
      new Set(
        Object.values(/** @type {Object.<string,(string|Array.<string>)>} */ (fromI18n))
          .flat()
          .map(String)
      )
    ).map((s) => s.toLowerCase());
  }

  /** @type {Array.<string>} */
  const candidates = [full, base];
  for (const f of fallbacks) {
    const ffull = f;
    const fbase = f.split('-')[0];
    if (!candidates.includes(ffull)) candidates.push(ffull);
    if (!candidates.includes(fbase)) candidates.push(fbase);
  }

  for (const c of candidates) {
    if (c && Object.prototype.hasOwnProperty.call(map, c) && typeof map[c] === 'string') return map[c];
  }
  const first = Object.values(map).find((v) => typeof v === 'string');
  return first ?? '';
}

/**
 * Resolve a label for a reason option.
 * Uses `option.label` when present; otherwise falls back to `option.value`.
 *
 * @param {OptionLike} option
 * @param {I18nLike} [i18n]
 * @returns {string}
 */
export function resolveOptionLabel(option, i18n) {
  const source = option && (option.label ?? option.value);
  return resolveLocalizedValue(/** @type {LocalizedString} */ (source), i18n);
}
