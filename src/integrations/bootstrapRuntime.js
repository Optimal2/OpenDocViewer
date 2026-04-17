// File: src/integrations/bootstrapRuntime.js
/**
 * File: src/integrations/bootstrapRuntime.js
 *
 * Startup mode detection and host-integration entry point.
 *
 * Responsibilities:
 * - expose a tiny `window.ODV.start(...)` host API
 * - probe all supported startup sources in priority order
 * - normalize host payloads into a single bundle shape when possible
 * - report the selected bootstrap mode back to `AppBootstrap`
 */

import { readFromParent } from './parentBridge.js';
import { readFromSessionToken } from './sessionToken.js';
import { readFromUrlParams } from './urlParams.js';
import { normalizeToPortableBundle } from './normalizePortableBundle.js';

/**
 * Canonical bootstrap modes.
 * @readonly
 */
export const ODV_BOOTSTRAP_MODES = Object.freeze({
  PARENT_PAGE: 'parent-page',
  SESSION_TOKEN: 'session-token',
  URL_PARAMS: 'url-params',
  JS_API: 'js-api',
  DEMO: 'demo'
});

/**
 * Opaque information about how startup data reached the viewer.
 * Exposed only for diagnostics / support UI and kept transport-focused.
 *
 * @typedef {Object} BootstrapDebugInfo
 * @property {string} mode
 * @property {(string|undefined)} hostPayloadSource
 * @property {*=} hostPayload
 */

/**
 * @typedef {{ mode: ('parent-page'|'session-token'|'js-api'), bundle: PortableDocumentBundle, debugInfo: BootstrapDebugInfo }} BootstrapFromHost
 * @typedef {{ mode: 'url-params', urlConfig: { folder: string, extension: string, endNumber: number }, debugInfo: BootstrapDebugInfo }} BootstrapFromUrlParams
 * @typedef {{ mode: 'demo', debugInfo: BootstrapDebugInfo }} BootstrapDemo
 * @typedef {(BootstrapFromHost|BootstrapFromUrlParams|BootstrapDemo)} BootstrapAny
 */

/**
 * Host API shape exposed on window.ODV.
 * @typedef {Object} ODVHostApi
 * @property {(function(*): void|undefined)} start
 * @property {(*|undefined)} __pending
 */

/**
 * Options controlling bootstrap diagnostics collection.
 *
 * @typedef {Object} BootstrapDetectOptions
 * @property {boolean=} diagnosticsEnabled
 */

// Expose a tiny host API on window.ODV
(function exposeApi() {
  try {
    if (typeof window === 'undefined') return;
    if (window.ODV?.start) return;

    /** @type {ODVHostApi} */
    // @ts-ignore - allow assigning onto window
    const api = (window.ODV = window.ODV || /** @type {*} */ ({}));
    api.__pending = undefined;

    /**
     * Queue a start payload to be consumed by bootstrapDetect().
     * @param {*} payload
     * @returns {void}
     */
    api.start = (payload = {}) => {
      api.__pending = payload; // consumed once by bootstrapDetect
    };
  } catch {
    // ignore
  }
})();

/**
 * Try to normalize a candidate payload into a bundle with documents.
 * @param {*} candidate
 * @returns {(PortableDocumentBundle|null)}
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
 * Build the debug envelope returned to the app shell.
 * Host payloads are only retained when diagnostics are enabled.
 *
 * @param {string} mode
 * @param {(string|undefined)} hostPayloadSource
 * @param {*} hostPayload
 * @param {boolean} diagnosticsEnabled
 * @returns {BootstrapDebugInfo}
 */
function makeDebugInfo(mode, hostPayloadSource, hostPayload, diagnosticsEnabled) {
  return diagnosticsEnabled
    ? { mode, hostPayloadSource, hostPayload }
    : { mode, hostPayloadSource };
}

/**
 * Detect the best available bootstrap mode.
 *
 * `debugInfo` is intentionally a shallow diagnostic envelope so optional tools such as the
 * performance overlay can show what the viewer actually received from the host transport.
 * The potentially large raw host payload is only retained when diagnostics are explicitly enabled.
 *
 * @param {BootstrapDetectOptions=} options
 * @returns {Promise.<BootstrapAny>}
 */
export async function bootstrapDetect(options = {}) {
  const diagnosticsEnabled = !!options?.diagnosticsEnabled;

  let parentProbed = false;
  let sessionTokenProbed = false;
  let parent = null;
  let sessionTok = null;

  /**
   * @returns {*}
   */
  const probeParent = () => {
    if (parentProbed) return parent;
    parentProbed = true;
    try {
      parent = readFromParent();
    } catch {
      parent = null;
    }
    return parent;
  };

  /**
   * @returns {*}
   */
  const probeSessionToken = () => {
    if (sessionTokenProbed) return sessionTok;
    sessionTokenProbed = true;
    try {
      sessionTok = readFromSessionToken();
    } catch {
      sessionTok = null;
    }
    return sessionTok;
  };

  // When diagnostics are enabled we probe once up front so the optional overlay can still show the
  // original host payload even if another startup surface (for example pattern-mode URL params)
  // ultimately drives the viewer. Without diagnostics we stay minimal and only read each source when
  // it is needed for actual startup selection.
  if (diagnosticsEnabled) {
    probeParent();
    probeSessionToken();
  }

  // 1) Parent page (same-origin bridge)
  try {
    const parentCandidate = probeParent();
    if (parentCandidate?.data) {
      const bundle = tryNormalizeBundle(parentCandidate.data);
      if (bundle) {
        return {
          mode: ODV_BOOTSTRAP_MODES.PARENT_PAGE,
          bundle,
          debugInfo: makeDebugInfo(
            ODV_BOOTSTRAP_MODES.PARENT_PAGE,
            String(parentCandidate.source || 'parent'),
            parentCandidate.data,
            diagnosticsEnabled
          ),
        };
      }
    }
  } catch {}

  // 2) Session token (?sessiondata=…)
  try {
    const sessionCandidate = probeSessionToken();
    if (sessionCandidate?.data) {
      const bundle = tryNormalizeBundle(sessionCandidate.data);
      if (bundle) {
        return {
          mode: ODV_BOOTSTRAP_MODES.SESSION_TOKEN,
          bundle,
          debugInfo: makeDebugInfo(
            ODV_BOOTSTRAP_MODES.SESSION_TOKEN,
            String(sessionCandidate.source || 'sessiondata'),
            sessionCandidate.data,
            diagnosticsEnabled
          ),
        };
      }
    }
  } catch {}

  // 3) URL params (pattern mode)
  try {
    const urlp = readFromUrlParams();
    if (urlp?.data && urlp.data.folder && urlp.data.extension && urlp.data.endNumber) {
      const sessionCandidate = diagnosticsEnabled ? probeSessionToken() : null;
      return {
        mode: ODV_BOOTSTRAP_MODES.URL_PARAMS,
        urlConfig: urlp.data,
        debugInfo: makeDebugInfo(
          ODV_BOOTSTRAP_MODES.URL_PARAMS,
          sessionCandidate?.data ? String(sessionCandidate.source || 'sessiondata') : undefined,
          sessionCandidate?.data ?? undefined,
          diagnosticsEnabled
        ),
      };
    }
  } catch {}

  // 4) JS API (window.ODV.start)
  try {
    if (typeof window !== 'undefined' && window.ODV?.__pending) {
      const pending = window.ODV.__pending;
      window.ODV.__pending = undefined; // consume once

      // Try bundle first
      const bundle = tryNormalizeBundle(pending?.bundle ?? pending);
      if (bundle) {
        return {
          mode: ODV_BOOTSTRAP_MODES.JS_API,
          bundle,
          debugInfo: makeDebugInfo(
            ODV_BOOTSTRAP_MODES.JS_API,
            'js-api',
            pending,
            diagnosticsEnabled
          ),
        };
      }

      // Else minimal pattern config
      if (pending && pending.folder && pending.extension && pending.endNumber != null) {
        return {
          mode: ODV_BOOTSTRAP_MODES.JS_API,
          urlConfig: {
            folder: String(pending.folder),
            extension: String(pending.extension),
            endNumber: Number(pending.endNumber)
          },
          debugInfo: makeDebugInfo(
            ODV_BOOTSTRAP_MODES.JS_API,
            'js-api',
            pending,
            diagnosticsEnabled
          ),
        };
      }
    }
  } catch {}

  // 5) Fallback: demo
  return {
    mode: ODV_BOOTSTRAP_MODES.DEMO,
    debugInfo: makeDebugInfo(
      ODV_BOOTSTRAP_MODES.DEMO,
      'demo',
      undefined,
      diagnosticsEnabled
    ),
  };
}
