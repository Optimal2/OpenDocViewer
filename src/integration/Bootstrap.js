// File: src/integration/Bootstrap.js

import { readFromParent } from './parentBridge';
import { readFromSessionToken } from './sessionToken';
import { readFromUrlParams } from './urlParams';
import { normalizeToPortableBundle } from './normalizeBundle';

export const ODV_BOOTSTRAP_MODES = Object.freeze({
  PARENT_PAGE: 'parent-page',
  SESSION_TOKEN: 'session-token',
  URL_PARAMS: 'url-params',
  JS_API: 'js-api',
  DEMO: 'demo'
});

// Optional: allow host pages to call window.ODV.start(...)
(function exposeApi() {
  if (window.ODV?.start) return;
  window.ODV = window.ODV || {};
  window.ODV.__pending = null;
  window.ODV.start = (payload = {}) => {
    window.ODV.__pending = payload; // consumed by bootstrapDetect
    // A host could also re-render, but our app will poll on mount.
  };
})();

/**
 * Detect the best available bootstrap mode.
 * Returns one of:
 *   { mode: 'parent-page', bundle }
 *   { mode: 'session-token', bundle }
 *   { mode: 'url-params', urlConfig: { folder, extension, endNumber } }
 *   { mode: 'js-api', bundle | urlConfig }
 *   { mode: 'demo' }
 */
export async function bootstrapDetect() {
  // 1) Parent page (same-origin)
  const parent = readFromParent();
  if (parent?.data) {
    const bundle = normalizeToPortableBundle(parent.data);
    if (bundle) return { mode: ODV_BOOTSTRAP_MODES.PARENT_PAGE, bundle };
  }

  // 2) Session token (?sessiondata=…)
  const sessionTok = readFromSessionToken();
  if (sessionTok?.data) {
    const bundle = normalizeToPortableBundle(sessionTok.data);
    if (bundle) return { mode: ODV_BOOTSTRAP_MODES.SESSION_TOKEN, bundle };
  }

  // 3) URL params (folder/extension/endNumber)
  const urlp = readFromUrlParams();
  if (urlp?.data) {
    return { mode: ODV_BOOTSTRAP_MODES.URL_PARAMS, urlConfig: urlp.data };
  }

  // 4) JS API (window.ODV.start)
  if (window.ODV?.__pending) {
    const p = window.ODV.__pending;
    window.ODV.__pending = null;
    // Try bundle first, else assume urlConfig
    const bundle = normalizeToPortableBundle(p.bundle || p);
    if (bundle && bundle.documents?.length) {
      return { mode: ODV_BOOTSTRAP_MODES.JS_API, bundle };
    }
    if (p.folder && p.extension && p.endNumber) {
      return { mode: ODV_BOOTSTRAP_MODES.JS_API, urlConfig: { folder: p.folder, extension: p.extension, endNumber: p.endNumber } };
    }
  }

  // 5) Fallback: demo
  return { mode: ODV_BOOTSTRAP_MODES.DEMO };
}
