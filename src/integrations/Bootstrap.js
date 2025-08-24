// File: src/integrations/Bootstrap.js

/**
 * File: src/integrations/Bootstrap.js
 *
 * OpenDocViewer — Bootstrap Detection & Host Integration
 *
 * PURPOSE
 *   Determine how the viewer should be initialized at runtime by probing:
 *     1) Parent page (same-origin bridge)
 *     2) Session token in URL (?sessiondata=…)
 *     3) URL params (pattern mode)
 *     4) JS API (window.ODV.start(...))
 *     5) Fallback demo mode
 */

import { readFromParent } from './parentBridge.js';
import { readFromSessionToken } from './sessionToken.js';
import { readFromUrlParams } from './urlParams.js';
import { normalizeToPortableBundle } from './normalizeBundle.js';

/**
 * Canonical bootstrap modes.
 */
export const ODV_BOOTSTRAP_MODES = Object.freeze({
  PARENT_PAGE: 'parent-page',
  SESSION_TOKEN: 'session-token',
  URL_PARAMS: 'url-params',
  JS_API: 'js-api',
  DEMO: 'demo',
});

// Expose a tiny host API on window.ODV
(function exposeApi() {
  try {
    if (typeof window === 'undefined') return;
    if (window.ODV?.start) return;

    /** @type {{ start?: (payload?: any) => void, __pending?: any }} */
    const api = (window.ODV = window.ODV || {});
    api.__pending = null;

    api.start = (payload = {}) => {
      api.__pending = payload; // consumed once by bootstrapDetect
    };
  } catch {
    // ignore
  }
})();

/**
 * Try to normalize a candidate payload into a bundle with documents.
 * @param {any} candidate
 * @returns {import('./normalizeBundle.js').PortableDocumentBundle | null}
 */
function tryNormalizeBundle(candidate) {
  try {
    const bundle = normalizeToPortableBundle(candidate);
    if (bundle && Array.isArray(bundle.documents) && bundle.documents.length > 0) {
      return bundle;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Detect the best available bootstrap mode.
 * @returns {Promise<
 *   | { mode: 'parent-page'|'session-token'|'js-api', bundle: any }
 *   | { mode: 'url-params', urlConfig: { folder:string, extension:string, endNumber:number } }
 *   | { mode: 'demo' }
 * >}
 */
export async function bootstrapDetect() {
  // 1) Parent page (same-origin bridge)
  try {
    const parent = readFromParent();
    if (parent?.data) {
      const bundle = tryNormalizeBundle(parent.data);
      if (bundle) {
        return { mode: ODV_BOOTSTRAP_MODES.PARENT_PAGE, bundle };
      }
    }
  } catch {}

  // 2) Session token (?sessiondata=…)
  try {
    const sessionTok = readFromSessionToken();
    if (sessionTok?.data) {
      const bundle = tryNormalizeBundle(sessionTok.data);
      if (bundle) {
        return { mode: ODV_BOOTSTRAP_MODES.SESSION_TOKEN, bundle };
      }
    }
  } catch {}

  // 3) URL params (pattern mode)
  try {
    const urlp = readFromUrlParams();
    if (urlp?.data && urlp.data.folder && urlp.data.extension && urlp.data.endNumber) {
      return { mode: ODV_BOOTSTRAP_MODES.URL_PARAMS, urlConfig: urlp.data };
    }
  } catch {}

  // 4) JS API (window.ODV.start)
  try {
    if (typeof window !== 'undefined' && window.ODV?.__pending) {
      const p = window.ODV.__pending;
      window.ODV.__pending = null; // consume once

      // Try bundle first
      const bundle = tryNormalizeBundle(p?.bundle ?? p);
      if (bundle) return { mode: ODV_BOOTSTRAP_MODES.JS_API, bundle };

      // Else minimal pattern config
      if (p && p.folder && p.extension && p.endNumber != null) {
        return {
          mode: ODV_BOOTSTRAP_MODES.JS_API,
          urlConfig: {
            folder: String(p.folder),
            extension: String(p.extension),
            endNumber: Number(p.endNumber),
          },
        };
      }
    }
  } catch {}

  // 5) Fallback: demo
  return { mode: ODV_BOOTSTRAP_MODES.DEMO };
}
