// File: src/i18n.js
/**
 * File: src/i18n.js
 *
 * i18n bootstrap for OpenDocViewer.
 *
 * - Uses i18next + react-i18next with ICU message format.
 * - Resolves paths correctly when the app is hosted under a virtual directory
 *   (e.g. /OpenDocViewer/) or the site root.
 * - Resolves the startup language deterministically from querystring, runtime config,
 *   browser preferences, and the current <html lang>.
 * - Diagnostics: **dev-only**. No browser console output in production (IIS build).
 *
 * CACHING:
 *   A resilient cache-busting version token is supported. The version is read,
 *   in priority order, from:
 *     1) URL query ?i18nV=...
 *     2) localStorage key 'ODV_I18N_VERSION'
 *     3) window.__ODV_CONFIG__.i18n.version (unless set to "auto")
 *     4) import.meta.env.ODV_BUILD_ID (unique per build)
 *     5) window.__APP_VERSION__ or import.meta.env.VITE_APP_VERSION / APP_VERSION
 *   If the configured template doesn't contain {{ver}}/{{version}}, a ?v=<token>
 *   parameter will be appended automatically.
 *
 * IMPORTANT: The backend loadPath is a FUNCTION so the final URL is computed
 * at request time, even if __ODV_CONFIG__ loads after the bundle.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';
import HttpBackend from 'i18next-http-backend';
import { getLanguagePreference, setLanguagePreference } from './utils/viewerPreferences.js';

/** Dev-mode detector (Vite + Node envs). */
const IS_DEV =
  import.meta?.env?.MODE === 'development' ||
  globalThis.process?.env?.NODE_ENV === 'development';

/** Read a query parameter by name (no deps). */
function readQuery(name) {
  try {
    const q = typeof location !== 'undefined' ? location.search : '';
    const m = new RegExp('(?:[?&])' + name + '=([^&]+)', 'i').exec(q);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

/** Diagnostics ON only in dev builds. */
const WANT_DIAG = IS_DEV;

/**
 * Fallback cache-busting token for bundled locale resources.
 *
 * Some deployments do not inject a per-build ID. Bump this revision whenever locale placeholders or
 * message syntax changes so browsers do not keep serving stale JSON after a viewer upgrade.
 */
const BUNDLED_I18N_RESOURCE_REVISION = '20250418-01';

/** Normalize optional version tokens from runtime config or globals. */
function normalizeVersionToken(value) {
  if (value == null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'auto') return '';
  return normalized;
}


/** Return cache-busting version token (see header). */
function getI18nVersion() {
  try {
    const q = readQuery('i18nV');
    if (q) return q;

    try {
      const v = localStorage.getItem('ODV_I18N_VERSION');
      if (v) return v;
    } catch {}

    const w = typeof window !== 'undefined' ? window : /** @type {*} */ ({});
    const cfg = (w.__ODV_CONFIG__ && w.__ODV_CONFIG__.i18n) || {};
    const cfgVersion = normalizeVersionToken(cfg.version);
    if (cfgVersion) return cfgVersion;

    const globalVer =
      (typeof import.meta !== 'undefined' && import.meta.env && (
        import.meta.env.ODV_BUILD_ID ||
        import.meta.env.VITE_APP_VERSION ||
        import.meta.env.APP_VERSION
      )) ||
      w.__APP_VERSION__ ||
      w.__ODV_APP_VERSION__;

    const normalizedGlobalVer = normalizeVersionToken(globalVer);
    if (normalizedGlobalVer) return normalizedGlobalVer;
  } catch {}
  return BUNDLED_I18N_RESOURCE_REVISION;
}

/** Helper: append query params safely to a URL. */
function appendQuery(url, params) {
  const hasQuery = url.includes('?');
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
  if (!q) return url;
  return url + (hasQuery ? '&' : '?') + q;
}

/**
 * Keep i18n URL template substitutions constrained to plain path segments.
 *
 * This is intentionally stricter than URL encoding alone: language and namespace
 * values are used inside configurable path templates, so path separators, dots,
 * query delimiters, and absolute-URL markers must never survive into the final URL.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeI18nPathSegment(value, fallback) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw;
  return fallback;
}

/**
 * Reload after a diagnostic localStorage write.
 *
 * localStorage.setItem() is synchronous in supported browsers, but this dev-only helper
 * delays navigation slightly so the persistence step is complete before reload-sensitive tooling runs.
 *
 * @returns {void}
 */
function reloadAfterDiagnosticStorageWrite() {
  try {
    setTimeout(() => { location.reload(); }, 25);
  } catch {
    try { location.reload(); } catch {}
  }
}

/**
 * Compute app config & defaults safely.
 * @returns {{fallbackLng:string, supportedLngs:string[]}}
 */
function getStaticI18nDefaults() {
  const appCfg = typeof window !== 'undefined' ? (window.__ODV_CONFIG__ || {}) : {};
  const cfg = appCfg.i18n || {};
  const supportedLngs = Array.isArray(cfg.supported) && cfg.supported.length ? cfg.supported : ['en'];
  const configuredDefault = String(cfg.default || '').trim().toLowerCase();
  const fallbackLng = configuredDefault && configuredDefault !== 'auto'
    ? configuredDefault
    : (supportedLngs.includes('en') ? 'en' : String(supportedLngs[0] || 'en').toLowerCase());
  return { fallbackLng, supportedLngs };
}

/**
 * Normalize an arbitrary language candidate to a supported base language.
 *
 * @param {*} value
 * @param {string[]} supported
 * @returns {(string|null)}
 */
function normalizeSupportedLanguage(value, supported) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const base = raw.toLowerCase().split('-')[0];
  if (!base) return null;
  const supportedList = Array.isArray(supported) ? supported : [];
  const exact = supportedList.find((entry) => String(entry || '').toLowerCase() === base);
  return exact || null;
}

/**
 * Resolve the initial UI language without relying on persisted i18next cache state.
 *
 * Priority order:
 *   1) querystring (?lng=sv or ?lang=sv)
 *   2) previously persisted viewer preference
 *   3) configured runtime default (`odv.site.config.js` / `odv.config.js`)
 *   4) a previously persisted i18next language (`localStorage.i18nextLng`)
 *   5) browser-reported preferred languages
 *   6) <html lang="...">
 *   7) English / first supported fallback
 *
 * A configured default of "auto" skips step 2 and lets browser/html decide.
 * This keeps deployments predictable: when a site explicitly says default=sv, the viewer starts in
 * Swedish even on English Windows/Edge installations.
 *
 * @param {{ fallbackLng: string, supportedLngs: string[] }} options
 * @returns {string}
 */
function resolveInitialLanguage({ fallbackLng, supportedLngs }) {
  const supported = Array.isArray(supportedLngs) ? supportedLngs : [];
  const fallbackFromConfig = normalizeSupportedLanguage(fallbackLng, supported);
  const normalizedFallback = fallbackFromConfig
    || normalizeSupportedLanguage('en', supported)
    || (supported.length ? String(supported[0] || '').toLowerCase() : 'en');

  const queryCandidate = normalizeSupportedLanguage(readQuery('lng') || readQuery('lang'), supported);
  if (queryCandidate) return queryCandidate;

  const persistedPreference = normalizeSupportedLanguage(getLanguagePreference(), supported);
  if (persistedPreference) return persistedPreference;

  const rawConfiguredDefault = String(fallbackLng || '').trim().toLowerCase();
  if (fallbackFromConfig && rawConfiguredDefault !== 'auto') return fallbackFromConfig;

  try {
    const persistedCandidate = normalizeSupportedLanguage(localStorage.getItem('i18nextLng'), supported);
    if (persistedCandidate) return persistedCandidate;
  } catch {}

  try {
    const nav = typeof navigator !== 'undefined' ? navigator : /** @type {*} */ ({});
    const navCandidates = Array.isArray(nav.languages) && nav.languages.length
      ? nav.languages
      : [nav.language, nav.userLanguage].filter(Boolean);
    for (const candidate of navCandidates) {
      const normalized = normalizeSupportedLanguage(candidate, supported);
      if (normalized) return normalized;
    }
  } catch {}

  try {
    const htmlCandidate = normalizeSupportedLanguage(document?.documentElement?.lang, supported);
    if (htmlCandidate) return htmlCandidate;
  } catch {}

  return normalizedFallback;
}

/**
 * Keep the document language synchronized with the active UI language.
 *
 * @param {string} language
 * @param {string[]} supportedLngs
 * @param {string} fallbackLng
 * @returns {void}
 */
function syncDocumentLanguage(language, supportedLngs, fallbackLng) {
  try {
    if (typeof document === 'undefined') return;
    const next = normalizeSupportedLanguage(language, supportedLngs)
      || normalizeSupportedLanguage(fallbackLng, supportedLngs)
      || normalizeSupportedLanguage('en', supportedLngs)
      || 'en';
    document.documentElement.setAttribute('lang', next);
  } catch {}
}

/**
 * Compute a normalized base href. Uses (in order):
 *   1) window.__ODV_CONFIG__.baseHref
 *   2) import.meta.env.BASE_URL (Vite)
 *   3) '/'
 * Returned WITHOUT duplicate slashes and WITH a trailing slash.
 * @returns {string}
 */
function computeBaseHref() {
  const w = typeof window !== 'undefined' ? window : /** @type {*} */ ({});
  const appCfg = w.__ODV_CONFIG__ || {};
  const baseGuess =
    appCfg.baseHref ||
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ||
    '/';
  return String(baseGuess || '/').replace(/\/+$/, '') + '/';
}

/**
 * Resolve the final translation URL at request time (with cache buster).
 * Supports config templates with {{lng}}, {{ns}}, and {{ver}} / {{version}}.
 *
 * @param {string|string[]} lngs
 * @param {string|string[]} namespaces
 * @returns {string} Absolute or app-relative URL to a JSON file.
 */
function resolveLoadPath(lngs, namespaces) {
  const w = typeof window !== 'undefined' ? window : /** @type {*} */ ({});
  const appCfg = w.__ODV_CONFIG__ || {};
  const cfg = appCfg.i18n || {};
  const ver = getI18nVersion();

  const rawLng = Array.isArray(lngs) ? (lngs[0] || '') : (lngs || '');
  const rawNs = Array.isArray(namespaces) ? (namespaces[0] || 'common') : (namespaces || 'common');
  const lng = sanitizeI18nPathSegment(String(rawLng || '').split('-')[0].toLowerCase(), 'en');
  const ns = sanitizeI18nPathSegment(rawNs, 'common');
  const encodedLng = encodeURIComponent(lng);
  const encodedNs = encodeURIComponent(ns);

  if (cfg.loadPath && typeof cfg.loadPath === 'string') {
    const hasSupportedVersionToken = /\{\{ver(sion)?\}\}/.test(cfg.loadPath);
    let out = cfg.loadPath
      .replace('{{lng}}', encodedLng)
      .replace('{{ns}}', encodedNs)
      .replace('{{ver}}', ver)
      .replace('{{version}}', ver);

    // Append a query fallback only when the original template did not use a supported version token.
    // Malformed placeholders such as {{verison}} are intentionally not treated as cache busters.
    if (!hasSupportedVersionToken && ver) out = appendQuery(out, { v: ver });
    if (WANT_DIAG) console.info('[i18n] loadPath (from config):', out);
    return out;
  }

  let out = computeBaseHref() + 'locales/' + encodedLng + '/' + encodedNs + '.json';
  if (ver) out = appendQuery(out, { v: ver });
  if (WANT_DIAG) console.info('[i18n] loadPath (computed):', out, { lng, ns });
  return out;
}

const { fallbackLng, supportedLngs } = getStaticI18nDefaults();
const initialLanguage = resolveInitialLanguage({ fallbackLng, supportedLngs });

if (WANT_DIAG) {
  i18next
    .on('initialized', (opts) => {
      try {
        console.info('[i18n] initialized', {
          language: i18next.language,
          languages: i18next.languages,
          opts: {
            fallbackLng: opts?.fallbackLng,
            ns: opts?.ns,
            defaultNS: opts?.defaultNS,
            supportedLngs: opts?.supportedLngs
          }
        });
      } catch {}
    })
    .on('loaded', (loaded) => {
      try { console.info('[i18n] resources loaded', loaded); } catch {}
    })
    .on('failedLoading', (lng, ns, msg) => {
      try {
        console.error('[i18n] failedLoading', {
          lng, ns, msg,
          loadPathResolved: resolveLoadPath(lng, ns)
        });
      } catch {}
    })
    .on('missingKey', (lngs, ns, key) => {
      try { console.warn('[i18n] missingKey', { lngs, ns, key }); } catch {}
    })
    .on('languageChanged', (lng) => {
      try { console.info('[i18n] languageChanged', { lng }); } catch {}
    });

  try {
    if (typeof window !== 'undefined') {
      window.__I18N_DIAG__ = {
        lang: () => i18next.language,
        langs: () => i18next.languages,
        t: (k, o) => i18next.t(String(k), o),
        reload: async (ns = 'common') => {
          try {
            await i18next.reloadResources([i18next.language], [ns]);
            console.info('[i18n] resources reloaded', { lng: i18next.language, ns });
          } catch (e) {
            console.error('[i18n] reload failed', e);
          }
        },
        loadPathNow: (lng = i18next.language || 'en', ns = 'common') => resolveLoadPath(lng, ns),
        getVer: () => getI18nVersion(),
        setVer: (v) => {
          try {
            localStorage.setItem('ODV_I18N_VERSION', String(v));
            reloadAfterDiagnosticStorageWrite();
          } catch {}
        },
        bump: () => {
          try {
            const ts = new Date();
            const ver = ts.getFullYear().toString()
              + String(ts.getMonth() + 1).padStart(2, '0')
              + String(ts.getDate()).padStart(2, '0')
              + String(ts.getHours()).padStart(2, '0')
              + String(ts.getMinutes()).padStart(2, '0')
              + String(ts.getSeconds()).padStart(2, '0');
            localStorage.setItem('ODV_I18N_VERSION', ver);
            console.info('[i18n] bump to', ver);
            reloadAfterDiagnosticStorageWrite();
          } catch {}
        }
      };
    }
  } catch {}
} else {
  try {
    if (typeof window !== 'undefined' && window.__I18N_DIAG__) delete window.__I18N_DIAG__;
  } catch {}
}

i18next
  .use(HttpBackend)
  .use(ICU)
  .use(initReactI18next)
  .init({
    debug: IS_DEV,
    lng: initialLanguage,
    fallbackLng,
    supportedLngs,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    backend: {
      loadPath: (lngs, namespaces) => resolveLoadPath(lngs, namespaces),
      requestOptions: IS_DEV ? { cache: 'no-store' } : {}
    },
    react: { useSuspense: false }
  })
  .then(() => {
    syncDocumentLanguage(i18next.language, supportedLngs, fallbackLng);
    if (WANT_DIAG) {
      try {
        console.info('[i18n] ready', {
          resolvedLanguage: i18next.language,
          initialLanguage,
          usingLoadPath: resolveLoadPath(i18next.language, 'common'),
          versionToken: getI18nVersion()
        });
      } catch {}
    }
  });

i18next.on('languageChanged', (lng) => {
  syncDocumentLanguage(lng, supportedLngs, fallbackLng);
  try {
    const normalized = normalizeSupportedLanguage(lng, supportedLngs);
    if (normalized) setLanguagePreference(normalized);
  } catch {}
});

export default i18next;
