// File: src/i18n.js
/**
 * File: src/i18n.js
 *
 * i18n bootstrap for OpenDocViewer.
 *
 * - Uses i18next + react-i18next with ICU message format.
 * - Resolves paths correctly when the app is hosted under a virtual directory
 *   (e.g. /OpenDocViewer/) or the site root.
 * - Diagnostics: **dev-only**. No browser console output in production (IIS build).
 *
 * CACHING:
 *   A resilient cache-busting version token is supported. The version is read,
 *   in priority order, from:
 *     1) URL query ?i18nV=...
 *     2) localStorage key 'ODV_I18N_VERSION'
 *     3) window.__ODV_CONFIG__.i18n.version
 *     4) window.__APP_VERSION__  or  import.meta.env.VITE_APP_VERSION / APP_VERSION
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
import LanguageDetector from 'i18next-browser-languagedetector';

/** Dev-mode detector (Vite + Node envs). */
const IS_DEV =
  (typeof import.meta !== 'undefined' && import.meta?.env?.MODE === 'development') ||
  (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development');

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

/** Return cache-busting version token (see header). */
function getI18nVersion() {
  try {
    const q = readQuery('i18nV'); if (q) return q;
    try { const v = localStorage.getItem('ODV_I18N_VERSION'); if (v) return v; } catch {}
    const w = typeof window !== 'undefined' ? window : /** @type {*} */ ({});
    const cfg = (w.__ODV_CONFIG__ && w.__ODV_CONFIG__.i18n) || {};
    if (cfg.version) return String(cfg.version);
    const globalVer = w.__APP_VERSION__ ||
      (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_APP_VERSION || import.meta.env.APP_VERSION));
    if (globalVer) return String(globalVer);
  } catch {}
  return '';
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
 * Compute app config & defaults safely.
 * @returns {{fallbackLng:string, supportedLngs:string[]}} */
function getStaticI18nDefaults() {
  const appCfg = typeof window !== 'undefined' ? (window.__ODV_CONFIG__ || {}) : {};
  const cfg = appCfg.i18n || {};
  const fallbackLng = cfg.default || 'en';
  const supportedLngs = Array.isArray(cfg.supported) && cfg.supported.length ? cfg.supported : ['en'];
  return { fallbackLng, supportedLngs };
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
  return String(baseGuess || '/').replace(/\/+$/, '/'); // ensure trailing slash
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

  // Normalize language (respect i18next `load: 'languageOnly'`)
  const rawLng = Array.isArray(lngs) ? (lngs[0] || '') : (lngs || '');
  const lng = String(rawLng || '').split('-')[0] || 'en';
  const ns = Array.isArray(namespaces) ? (namespaces[0] || 'common') : (namespaces || 'common');

  // 1) If config provides a static template string, expand placeholders.
  if (cfg.loadPath && typeof cfg.loadPath === 'string') {
    let out = cfg.loadPath
      .replace('{{lng}}', lng)
      .replace('{{ns}}', ns)
      .replace('{{ver}}', ver)
      .replace('{{version}}', ver);
    if (!/\{\{ver(sion)?\}\}/.test(cfg.loadPath) && ver) out = appendQuery(out, { v: ver });
    if (WANT_DIAG) console.info('[i18n] loadPath (from config):', out);
    return out;
  }

  // 2) Otherwise, build from baseHref (works under virtual dirs, e.g. /OpenDocViewer/)
  let out = computeBaseHref() + 'locales/' + lng + '/' + ns + '.json';
  if (ver) out = appendQuery(out, { v: ver });
  if (WANT_DIAG) console.info('[i18n] loadPath (computed):', out, { lng, ns });
  return out;
}

/** Pull early defaults (fallback + supported list). */
const { fallbackLng, supportedLngs } = getStaticI18nDefaults();

/** Diagnostics (attach only in dev). */
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

  // DevTools helper (dev-only).
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
        setVer: (v) => { try { localStorage.setItem('ODV_I18N_VERSION', String(v)); location.reload(); } catch {} },
        bump: () => {
          try {
            const ts = new Date();
            const ver = ts.getFullYear().toString()
              + String(ts.getMonth()+1).padStart(2,'0')
              + String(ts.getDate()).padStart(2,'0')
              + String(ts.getHours()).padStart(2,'0')
              + String(ts.getMinutes()).padStart(2,'0')
              + String(ts.getSeconds()).padStart(2,'0');
            localStorage.setItem('ODV_I18N_VERSION', ver);
            console.info('[i18n] bump to', ver);
            location.reload();
          } catch {}
        }
      };
    }
  } catch { /* noop */ }
} else {
  // Ensure the helper is not present in production builds.
  try {
    if (typeof window !== 'undefined' && window.__I18N_DIAG__) delete window.__I18N_DIAG__;
  } catch { /* noop */ }
}

/** One-time init. Keep suspense off so UI renders immediately and updates when ready. */
i18next
  .use(HttpBackend)
  .use(ICU) // enables {count, plural, ...} etc.
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    debug: IS_DEV,                // i18next’s own logs only in dev
    fallbackLng,
    supportedLngs,
    load: 'languageOnly',
    ns: ['common'],               // add more namespaces as you scale
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['querystring', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    backend: {
      // Resolve the URL per request so it respects the IIS app path in prod
      // AND always includes a cache-busting version token.
      loadPath: (lngs, namespaces) => resolveLoadPath(lngs, namespaces),
      // Client-side cache bypass only in dev.
      requestOptions: IS_DEV ? { cache: 'no-store' } : {}
    },
    react: { useSuspense: false } // render immediately; update when resources load
  })
  .then(() => {
    if (WANT_DIAG) {
      try {
        console.info('[i18n] ready', {
          resolvedLanguage: i18next.language,
          usingLoadPath: resolveLoadPath(i18next.language, 'common'),
          versionToken: getI18nVersion()
        });
      } catch {}
    }
  });

export default i18next;
