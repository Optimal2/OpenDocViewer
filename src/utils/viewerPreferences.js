// File: src/utils/viewerPreferences.js
/**
 * Lightweight persisted viewer preferences.
 *
 * Preferences are stored in both localStorage and a same-origin cookie so the viewer can remember
 * language choices across reloads while still degrading gracefully when one storage backend is
 * unavailable. Legacy theme values are still tolerated for backwards compatibility with older builds.
 */

import {
  normalizeCustomFitWidthFactorPercent,
  normalizePrintDefaultMode,
} from './runtimeConfig.js';

/**
 * @typedef {Object} ViewerPreferences
 * @property {('normal'|'light'|'dark')=} theme
 * @property {('system'|'normal'|'light'|'dark')=} themeMode
 * @property {string=} language
 * @property {('active'|'all')=} printDefaultMode
 * @property {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')=} defaultZoomMode
 * @property {number=} customFitWidthFactorPercent
 */

const STORAGE_KEY = 'ODV_USER_PREFERENCES';
const COOKIE_KEY = 'ODV_USER_PREFERENCES';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const EXPLICIT_THEMES = Object.freeze(['normal', 'light', 'dark']);
const THEME_MODES = Object.freeze(['system', 'normal', 'light', 'dark']);
const DEFAULT_ZOOM_MODES = Object.freeze(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE']);

/**
 * @param {*} value
 * @returns {boolean}
 */
function isExplicitTheme(value) {
  return EXPLICIT_THEMES.includes(/** @type {any} */ (value));
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isThemeMode(value) {
  return THEME_MODES.includes(/** @type {any} */ (value));
}

/**
 * Normalize legacy theme-mode values.
 *
 * @param {*} value
 * @returns {('system'|'normal'|'light'|'dark'|null)}
 */
function normalizeThemeModeValue(value) {
  if (value === 'auto') return 'system';
  if (isThemeMode(value)) return value;
  return null;
}

/**
 * @param {*} value
 * @returns {(('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')|null)}
 */
function normalizeDefaultZoomModePreference(value) {
  const raw = String(value || '').trim();
  if (DEFAULT_ZOOM_MODES.includes(/** @type {any} */ (raw))) return /** @type {any} */ (raw);

  const normalized = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'fit-page' || normalized === 'fit-screen' || normalized === 'page') return 'FIT_PAGE';
  if (normalized === 'fit-width' || normalized === 'fit-to-width' || normalized === 'width') return 'FIT_WIDTH';
  if (
    normalized === 'fit-custom'
    || normalized === 'custom-fit'
    || normalized === 'custom-fit-width'
    || normalized === 'fit-width-factor'
    || normalized === 'user-zoom'
    || normalized === 'custom-width'
  ) {
    return 'FIT_CUSTOM';
  }
  if (normalized === 'actual-size' || normalized === 'actual' || normalized === '100%' || normalized === '1:1') {
    return 'ACTUAL_SIZE';
  }
  return null;
}

/**
 * @param {*} value
 * @returns {ViewerPreferences}
 */
function normalizePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = /** @type {Record<string, any>} */ (value);
  const next = {};
  if (isExplicitTheme(source.theme)) next.theme = source.theme;
  const normalizedThemeMode = normalizeThemeModeValue(source.themeMode);
  if (normalizedThemeMode) next.themeMode = normalizedThemeMode;
  if (typeof source.language === 'string') {
    const trimmedLanguage = source.language.trim();
    if (trimmedLanguage) next.language = trimmedLanguage.toLowerCase();
  }
  if (source.printDefaultMode != null) {
    next.printDefaultMode = normalizePrintDefaultMode(source.printDefaultMode, 'active');
  }
  const normalizedDefaultZoomMode = normalizeDefaultZoomModePreference(source.defaultZoomMode);
  if (normalizedDefaultZoomMode) next.defaultZoomMode = normalizedDefaultZoomMode;
  if (source.customFitWidthFactorPercent != null) {
    next.customFitWidthFactorPercent = normalizeCustomFitWidthFactorPercent(source.customFitWidthFactorPercent, 70);
  }
  return next;
}

/**
 * @param {string} raw
 * @returns {ViewerPreferences}
 */
function parsePreferences(raw) {
  if (!raw) return {};
  try {
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * @returns {ViewerPreferences}
 */
function readPreferencesFromCookie() {
  try {
    if (typeof document === 'undefined') return {};
    const match = String(document.cookie || '')
      .split('; ')
      .find((entry) => entry.startsWith(`${COOKIE_KEY}=`));
    if (!match) return {};
    const encoded = match.slice(COOKIE_KEY.length + 1);
    return parsePreferences(decodeURIComponent(encoded));
  } catch {
    return {};
  }
}

/**
 * @returns {ViewerPreferences}
 */
function readPreferencesFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY) || '');
  } catch {
    return {};
  }
}

/**
 * @param {ViewerPreferences} prefs
 * @returns {void}
 */
function writePreferencesToCookie(prefs) {
  try {
    if (typeof document === 'undefined') return;
    const payload = encodeURIComponent(JSON.stringify(normalizePreferences(prefs)));
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_KEY}=${payload}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {}
}

/**
 * @param {ViewerPreferences} prefs
 * @returns {void}
 */
function writePreferencesToStorage(prefs) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(prefs)));
  } catch {}
}

/**
 * @returns {ViewerPreferences}
 */
export function getViewerPreferences() {
  const fromStorage = readPreferencesFromStorage();
  const fromCookie = readPreferencesFromCookie();
  return normalizePreferences({ ...fromCookie, ...fromStorage });
}

/**
 * @param {ViewerPreferences} next
 * @returns {ViewerPreferences}
 */
export function setViewerPreferences(next) {
  const merged = normalizePreferences({ ...getViewerPreferences(), ...normalizePreferences(next) });
  writePreferencesToStorage(merged);
  writePreferencesToCookie(merged);

  // Legacy theme key retained for backwards compatibility with older builds.
  try {
    if (typeof window !== 'undefined' && window.localStorage && merged.theme) {
      window.localStorage.setItem('theme', merged.theme);
    }
  } catch {}

  return merged;
}

/**
 * Persist an already-normalized full preference object. This is used by clear helpers because
 * setViewerPreferences intentionally merges partial updates.
 *
 * @param {ViewerPreferences} next
 * @returns {ViewerPreferences}
 */
function replaceViewerPreferences(next) {
  const normalized = normalizePreferences(next);
  writePreferencesToStorage(normalized);
  writePreferencesToCookie(normalized);
  return normalized;
}

/**
 * @returns {(('normal'|'light'|'dark')|null)}
 */
export function getThemePreference() {
  const prefs = getViewerPreferences();
  if (isExplicitTheme(prefs.themeMode)) return prefs.themeMode;
  if (isExplicitTheme(prefs.theme)) return prefs.theme;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const legacy = window.localStorage.getItem('theme');
      if (isExplicitTheme(legacy)) return legacy;
    }
  } catch {}

  return null;
}

/**
 * @param {('normal'|'light'|'dark')} theme
 * @returns {ViewerPreferences}
 */
export function setThemePreference(theme) {
  let normalized = 'light';
  if (theme === 'dark') normalized = 'dark';
  else if (theme === 'normal') normalized = 'normal';
  return setViewerPreferences({ theme: normalized, themeMode: normalized });
}

/**
 * @returns {(('system'|'normal'|'light'|'dark')|null)}
 */
export function getThemeModePreference() {
  const prefs = getViewerPreferences();
  const normalizedThemeMode = normalizeThemeModeValue(prefs.themeMode);
  if (normalizedThemeMode) return normalizedThemeMode;
  if (isExplicitTheme(prefs.theme)) return prefs.theme;
  return null;
}

/**
 * Persist the user's theme mode preference.
 * - 'system' follows the current browser/OS preference and falls back to light when unavailable.
 * - explicit 'normal' / 'light' / 'dark' modes override the system preference.
 * - legacy callers may still pass 'auto', which is normalized to 'system'.
 *
 * @param {('system'|'normal'|'light'|'dark'|'auto')} mode
 * @returns {ViewerPreferences}
 */
export function setThemeModePreference(mode) {
  const normalized = normalizeThemeModeValue(mode) || 'system';
  const next = normalizePreferences({ ...getViewerPreferences(), themeMode: normalized });
  if (normalized === 'system') delete next.theme;
  else next.theme = normalized;

  writePreferencesToStorage(next);
  writePreferencesToCookie(next);

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (normalized === 'system') window.localStorage.removeItem('theme');
      else window.localStorage.setItem('theme', normalized);
    }
  } catch {}

  return next;
}

/**
 * @returns {(string|null)}
 */
export function getLanguagePreference() {
  const prefs = getViewerPreferences();
  return typeof prefs.language === 'string' && prefs.language ? prefs.language : null;
}

/**
 * @param {string} language
 * @returns {ViewerPreferences}
 */
export function setLanguagePreference(language) {
  return setViewerPreferences({ language: String(language || '').trim().toLowerCase() });
}

/**
 * @returns {(('active'|'all')|null)}
 */
export function getPrintDefaultModePreference() {
  const prefs = getViewerPreferences();
  return prefs.printDefaultMode === 'all' || prefs.printDefaultMode === 'active'
    ? prefs.printDefaultMode
    : null;
}

/**
 * @param {('active'|'all')} mode
 * @returns {ViewerPreferences}
 */
export function setPrintDefaultModePreference(mode) {
  return setViewerPreferences({ printDefaultMode: normalizePrintDefaultMode(mode, 'active') });
}

/**
 * @returns {ViewerPreferences}
 */
export function clearPrintDefaultModePreference() {
  const next = { ...getViewerPreferences() };
  delete next.printDefaultMode;
  return replaceViewerPreferences(next);
}

/**
 * @returns {(('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')|null)}
 */
export function getDefaultZoomModePreference() {
  return normalizeDefaultZoomModePreference(getViewerPreferences().defaultZoomMode);
}

/**
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')} mode
 * @returns {ViewerPreferences}
 */
export function setDefaultZoomModePreference(mode) {
  const normalized = normalizeDefaultZoomModePreference(mode) || 'FIT_WIDTH';
  return setViewerPreferences({ defaultZoomMode: normalized });
}

/**
 * @returns {ViewerPreferences}
 */
export function clearDefaultZoomModePreference() {
  const next = { ...getViewerPreferences() };
  delete next.defaultZoomMode;
  return replaceViewerPreferences(next);
}

/**
 * @returns {(number|null)}
 */
export function getCustomFitWidthFactorPreference() {
  const prefs = getViewerPreferences();
  return typeof prefs.customFitWidthFactorPercent === 'number'
    ? prefs.customFitWidthFactorPercent
    : null;
}

/**
 * @param {number} percent
 * @returns {ViewerPreferences}
 */
export function setCustomFitWidthFactorPreference(percent) {
  return setViewerPreferences({
    customFitWidthFactorPercent: normalizeCustomFitWidthFactorPercent(percent, 70),
  });
}

/**
 * @returns {ViewerPreferences}
 */
export function clearCustomFitWidthFactorPreference() {
  const next = { ...getViewerPreferences() };
  delete next.customFitWidthFactorPercent;
  return replaceViewerPreferences(next);
}
