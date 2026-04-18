// File: src/utils/viewerPreferences.js
/**
 * Lightweight persisted viewer preferences.
 *
 * Preferences are stored in both localStorage and a same-origin cookie so the viewer can remember
 * language/theme choices across reloads while still degrading gracefully when one storage backend is
 * unavailable. The cookie intentionally uses a compact JSON payload because the current preference
 * surface is tiny (language + theme only).
 */

/**
 * @typedef {Object} ViewerPreferences
 * @property {('light'|'dark')=} theme
 * @property {string=} language
 */

const STORAGE_KEY = 'ODV_USER_PREFERENCES';
const COOKIE_KEY = 'ODV_USER_PREFERENCES';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * @param {*} value
 * @returns {ViewerPreferences}
 */
function normalizePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = /** @type {Record<string, any>} */ (value);
  const next = {};
  if (source.theme === 'light' || source.theme === 'dark') next.theme = source.theme;
  if (typeof source.language === 'string' && source.language.trim()) next.language = source.language.trim().toLowerCase();
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
 * @returns {(('light'|'dark')|null)}
 */
export function getThemePreference() {
  const prefs = getViewerPreferences();
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const legacy = window.localStorage.getItem('theme');
      if (legacy === 'light' || legacy === 'dark') return legacy;
    }
  } catch {}

  return null;
}

/**
 * @param {('light'|'dark')} theme
 * @returns {ViewerPreferences}
 */
export function setThemePreference(theme) {
  return setViewerPreferences({ theme });
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
