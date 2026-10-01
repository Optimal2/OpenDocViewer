// File: src/utils/ompThemePreference.js
/**
 * Shared OMP theme preference adapter (OMP_THEME_PREFERENCE).
 *
 * This module reads and writes the versioned shared preference exactly per the OMP
 * theme contract: a JSON value `{"version":1,"mode":...,"revision":...}` stored in
 * both a host-only cookie and a localStorage mirror. The newest `revision` wins and
 * is mirrored to the other store; on a tie (or when a revision cannot be read) the
 * cookie wins. Unknown versions or modes are ignored, and denied storage degrades
 * to a session-only choice instead of throwing.
 *
 * ODV mapping (ODV keeps its three palettes):
 * - shared `system` -> follow the OS/browser `prefers-color-scheme` (Light or Dark)
 * - shared `light`  -> ODV Light
 * - shared `dark`   -> ODV Dark
 * - ODV `Normal` is a viewer-specific light variant. Choosing it stores Normal
 *   locally together with the shared revision it belongs to and writes shared
 *   mode `light` (new revision) so OMP apps on the same host follow. A later
 *   explicit shared choice carries a newer revision and therefore wins over the
 *   stored Normal.
 *
 * An existing local ODV theme setting is migrated into the shared preference only
 * when no shared preference exists yet. The other ODV_USER_PREFERENCES fields
 * (language, zoom, print settings) are never touched by this module beyond a
 * merge-preserving write.
 */

import {
  setViewerPreferences,
  setThemeModePreference,
  clearThemeSharedRevision,
  getThemeModePreference,
  getThemePreference,
  getViewerPreferences,
} from './viewerPreferences.js';

/**
 * Shared OMP theme mode.
 * @typedef {('system'|'light'|'dark')} SharedThemeMode
 */

/**
 * ODV theme mode (the shared modes plus the viewer-specific Normal variant).
 * @typedef {('system'|'normal'|'light'|'dark')} OdvThemeMode
 */

/**
 * Concrete ODV palette.
 * @typedef {('normal'|'light'|'dark')} OdvThemeName
 */

/**
 * Parsed shared preference value.
 * @typedef {Object} SharedThemePreference
 * @property {SharedThemeMode} mode
 * @property {string} revision
 */

export const OMP_THEME_STORAGE_KEY = 'OMP_THEME_PREFERENCE';
const OMP_THEME_PREFERENCE_VERSION = 1;
const OMP_THEME_COOKIE_MAX_AGE_SECONDS = 31557600;
const SHARED_THEME_MODES = Object.freeze(['system', 'light', 'dark']);

/**
 * @param {*} value
 * @returns {boolean}
 */
function isSharedThemeMode(value) {
  return SHARED_THEME_MODES.includes(/** @type {any} */ (value));
}

/**
 * Parse a raw stored shared-preference value. Unknown versions, unknown modes,
 * missing revisions and malformed JSON are ignored (null).
 *
 * @param {*} raw
 * @returns {(SharedThemePreference|null)}
 */
export function parseSharedThemeValue(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.version !== OMP_THEME_PREFERENCE_VERSION) return null;
    if (!isSharedThemeMode(parsed.mode)) return null;
    if (typeof parsed.revision !== 'string' || !parsed.revision) return null;
    return { mode: parsed.mode, revision: parsed.revision };
  } catch {
    return null;
  }
}

/**
 * Read the raw shared value from the cookie (URI-encoded JSON per the contract).
 *
 * @returns {string|null}
 */
function readSharedRawFromCookie() {
  try {
    if (typeof document === 'undefined') return null;
    const match = String(document.cookie || '')
      .split('; ')
      .find((entry) => entry.startsWith(`${OMP_THEME_STORAGE_KEY}=`));
    if (!match) return null;
    return decodeURIComponent(match.slice(OMP_THEME_STORAGE_KEY.length + 1));
  } catch {
    return null;
  }
}

/**
 * Read the raw shared value from the localStorage mirror.
 *
 * @returns {string|null}
 */
function readSharedRawFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(OMP_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * @param {SharedThemePreference} value
 * @returns {void}
 */
function writeSharedToCookie(value) {
  try {
    if (typeof document === 'undefined') return;
    const payload = encodeURIComponent(JSON.stringify({
      version: OMP_THEME_PREFERENCE_VERSION,
      mode: value.mode,
      revision: value.revision,
    }));
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${OMP_THEME_STORAGE_KEY}=${payload}; Max-Age=${OMP_THEME_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Denied storage degrades to a session-only choice.
  }
}

/**
 * @param {SharedThemePreference} value
 * @returns {void}
 */
function writeSharedToStorage(value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(OMP_THEME_STORAGE_KEY, JSON.stringify({
      version: OMP_THEME_PREFERENCE_VERSION,
      mode: value.mode,
      revision: value.revision,
    }));
  } catch {
    // Denied storage degrades to a session-only choice.
  }
}

/**
 * Persist a shared value to both stores (each write tolerates denied storage).
 * Returns null when the value fails validation and nothing was written.
 *
 * @param {SharedThemePreference} value
 * @returns {(SharedThemePreference|null)}
 */
export function mirrorSharedThemePreference(value) {
  const parsed = parseSharedThemeValue({
    version: OMP_THEME_PREFERENCE_VERSION,
    mode: value?.mode,
    revision: value?.revision,
  });
  if (!parsed) return null;
  writeSharedToCookie(parsed);
  writeSharedToStorage(parsed);
  return parsed;
}

/**
 * Read the winning shared preference: newest revision wins and is mirrored to
 * the other store; on a tie (or when a revision cannot be read) the cookie wins.
 *
 * @returns {(SharedThemePreference|null)}
 */
export function getSharedThemePreference() {
  const fromCookie = parseSharedThemeValue(readSharedRawFromCookie());
  const fromStorage = parseSharedThemeValue(readSharedRawFromStorage());
  if (fromCookie && fromStorage) {
    if (fromStorage.revision === fromCookie.revision) return fromCookie;
    const winner = fromStorage.revision > fromCookie.revision ? fromStorage : fromCookie;
    // Mirror the winner so the stores converge without resurrecting stale values.
    if (winner === fromStorage) writeSharedToCookie(winner);
    else writeSharedToStorage(winner);
    return winner;
  }
  const winner = fromCookie || fromStorage;
  if (!winner) return null;
  if (winner === fromCookie) writeSharedToStorage(winner);
  else writeSharedToCookie(winner);
  return winner;
}

/**
 * Create a unique revision starting with the creation time (per the contract).
 *
 * @returns {string}
 */
export function createSharedThemeRevision() {
  const time = Date.now().toString(36);
  let random = '';
  try {
    const bytes = new Uint32Array(2);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
      random = Array.from(bytes, (part) => part.toString(36)).join('');
    }
  } catch {
    // fall through to the Math.random fallback below
  }
  if (!random) random = Math.random().toString(36).slice(2, 10);
  return `${time}-${random}`;
}

/**
 * Store a new shared choice with a fresh revision in both stores.
 * Denied storage is tolerated: the returned value still describes the choice.
 *
 * @param {SharedThemeMode} mode
 * @returns {(SharedThemePreference|null)}
 */
export function setSharedThemePreference(mode) {
  if (!isSharedThemeMode(mode)) return null;
  return mirrorSharedThemePreference({ mode, revision: createSharedThemeRevision() });
}

/**
 * Detect the OS/browser colour scheme (SSR-safe; defaults to light).
 *
 * @returns {('light'|'dark')}
 */
export function detectSystemTheme() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Resolve the concrete ODV palette for an ODV theme mode.
 *
 * @param {OdvThemeMode} mode
 * @returns {OdvThemeName}
 */
export function resolveConcreteTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (mode === 'normal') return 'normal';
  return detectSystemTheme() === 'dark' ? 'dark' : 'light';
}

/**
 * Apply the resolved theme to the document (SSR-safe).
 *
 * @param {OdvThemeName} resolvedTheme
 * @param {OdvThemeMode} mode
 * @returns {void}
 */
export function applyOdvThemeToDocument(resolvedTheme, mode) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    root.setAttribute('data-theme-mode', mode);
    root.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  } catch {
    // ignore; DOM not available or locked down
  }
}

/**
 * Migrate an existing local ODV theme setting into the shared preference.
 * Only runs when no shared preference exists; otherwise returns null and
 * leaves the shared value untouched.
 *
 * @returns {(SharedThemePreference|null)}
 */
function migrateLocalThemeToShared() {
  if (getSharedThemePreference()) return null;
  const localMode = getThemeModePreference() || getThemePreference();
  if (!localMode || localMode === 'system') return null;
  const sharedMode = localMode === 'normal' ? 'light' : localMode;
  const written = setSharedThemePreference(/** @type {SharedThemeMode} */ (sharedMode));
  if (written && localMode === 'normal') {
    // Bind the stored Normal to the shared revision it belongs to.
    setViewerPreferences({ themeSharedRevision: written.revision });
  }
  return written;
}

/**
 * Resolve the effective ODV theme mode from the shared preference, the local
 * ODV setting and migration. A stored local Normal only applies while its
 * shared revision still matches; any later explicit shared choice (newer
 * revision) wins over it.
 *
 * @returns {OdvThemeMode}
 */
export function getEffectiveOdvThemeMode() {
  let shared = getSharedThemePreference();
  if (!shared) {
    const migrated = migrateLocalThemeToShared();
    if (migrated) {
      const localMode = getThemeModePreference() || getThemePreference();
      if (localMode === 'normal') return 'normal';
      return migrated.mode;
    }
    return 'system';
  }
  const local = getViewerPreferences();
  if (
    local.themeMode === 'normal'
    && typeof local.themeSharedRevision === 'string'
    && local.themeSharedRevision
    && local.themeSharedRevision === shared.revision
  ) {
    return 'normal';
  }
  return shared.mode;
}

/**
 * Persist a user theme choice:
 * - system/light/dark are written to the shared preference (new revision) and
 *   mirrored locally; a stale Normal binding is cleared.
 * - normal is stored locally together with the shared revision it belongs to,
 *   and shared mode `light` is written (new revision) so OMP apps follow.
 * Other ODV_USER_PREFERENCES fields are preserved by merge writes.
 *
 * @param {OdvThemeMode} mode
 * @returns {OdvThemeMode}
 */
export function setOdvThemeMode(mode) {
  const normalized = mode === 'dark'
    ? 'dark'
    : (mode === 'light' ? 'light' : (mode === 'normal' ? 'normal' : 'system'));
  if (normalized === 'normal') {
    const shared = setSharedThemePreference('light');
    const next = /** @type {any} */ ({ theme: 'normal', themeMode: 'normal' });
    if (shared) next.themeSharedRevision = shared.revision;
    setViewerPreferences(next);
    return 'normal';
  }
  setSharedThemePreference(/** @type {SharedThemeMode} */ (normalized));
  setThemeModePreference(/** @type {any} */ (normalized));
  // Drop a stale Normal binding: the explicit shared choice now governs.
  clearThemeSharedRevision();
  return normalized;
}
