// File: src/utils/i18nVersion.js
/**
 * Cache-busting version token for the locale files (`locales/<lng>/common.json?v=<token>`).
 *
 * Priority (first non-empty value wins):
 *   1. URL query `?i18nV=` - explicit, per-page-load override for diagnostics.
 *   2. `__ODV_CONFIG__.i18n.version` when the operator pins a value (anything but "auto").
 *   3. The build's locale token: the Vite build id plus a hash of the locale files' content.
 *   4. localStorage `ODV_I18N_VERSION` - a persisted diagnostic value; only used when the bundle
 *      carries no build token, so it can never freeze the locale URL across upgrades.
 *   5. The application version, then the bundled resource revision.
 *
 * The build id alone is deterministic by default (`<version>-stable`) and does not change
 * between builds of the same package version; the content hash does, whenever a locale file
 * changes, so a module upgrade with new strings always gets a new locale URL.
 *
 * @module utils/i18nVersion
 */

/**
 * Normalize optional version tokens; "auto" and blank values mean "not set".
 * @param {*} value
 * @returns {string}
 */
export function normalizeVersionToken(value) {
  if (value == null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'auto') return '';
  return normalized;
}

/**
 * Join the build id and the locale content hash into one token.
 * @param {*} buildId
 * @param {*} resourceHash
 * @returns {string}
 */
export function getBuildLocaleToken(buildId, resourceHash) {
  return [normalizeVersionToken(buildId), normalizeVersionToken(resourceHash)].filter(Boolean).join('.');
}

/**
 * @param {Object} sources
 * @param {*} [sources.query] `?i18nV` value.
 * @param {*} [sources.configVersion] `__ODV_CONFIG__.i18n.version`.
 * @param {*} [sources.buildId] Vite `ODV_BUILD_ID`.
 * @param {*} [sources.resourceHash] Vite `ODV_I18N_RESOURCE_HASH` (locale content hash).
 * @param {*} [sources.storedVersion] localStorage `ODV_I18N_VERSION`.
 * @param {*} [sources.appVersion] Application version.
 * @param {string} sources.fallback Bundled resource revision.
 * @returns {string}
 */
export function resolveI18nVersion({
  query = null,
  configVersion = null,
  buildId = null,
  resourceHash = null,
  storedVersion = null,
  appVersion = null,
  fallback,
}) {
  return String(query || '').trim()
    || normalizeVersionToken(configVersion)
    || getBuildLocaleToken(buildId, resourceHash)
    || String(storedVersion || '').trim()
    || normalizeVersionToken(appVersion)
    || fallback;
}
