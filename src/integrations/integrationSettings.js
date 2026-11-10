// File: src/integrations/integrationSettings.js
/**
 * Per-integration settings carried by a Portable Document Bundle.
 *
 * One viewer installation can serve several host applications. Most of the site configuration is
 * the same for all of them, but a few values belong to the host that opened the session — the
 * address its print log is posted to is the first. Such values may travel in the bundle:
 *
 *   {
 *     "integration": {
 *       "settings": {
 *         "userLog": { "enabled": true, "endpoint": "/host-app/log-print", "transport": "form" }
 *       }
 *     }
 *   }
 *
 * RULES
 *   - Off by default. A site turns it on with
 *     `integrations.portableBundle.settingsFromBundle.enabled = true`.
 *   - Only groups named in `settingsFromBundle.allow` are read, and only the fields listed here.
 *     Everything else in `integration.settings` is ignored.
 *   - A bundle is only trusted when the viewer fetched it itself from its own origin (session URL)
 *     or received it from a same-origin parent page. A bundle that arrived inside the page address
 *     can be composed by anyone who can make a user follow a link, so its settings are ignored.
 *   - `userLog.endpoint` must resolve to the viewer's own origin. A bundle can point the log at
 *     another path of the same site, never at another site.
 *   - A bundle can only narrow or redirect logging within these rules; it cannot change what the
 *     print dialog asks for. Those fields stay with the site configuration.
 *
 * The result is an overlay on the site configuration, read through `getEffectiveUserLogConfig`.
 */

import logger from '../logging/systemLogger.js';

/** Bootstrap modes whose bundle came from the viewer's own origin. Kept as literals to avoid an import cycle. */
const TRUSTED_MODES = Object.freeze(['session-url', 'parent-page']);

/** Setting groups this module knows how to read. */
const KNOWN_GROUPS = Object.freeze(['userLog']);

const USER_LOG_TRANSPORTS = Object.freeze(['form', 'json']);

/**
 * The print-log values an integration may set.
 *
 * @typedef {Object} UserLogOverride
 * @property {boolean} [enabled]
 * @property {string} [endpoint] absolute, on the viewer's own origin
 * @property {string} [transport] 'form' or 'json'
 */

/**
 * The settings in effect for the current session.
 *
 * @typedef {Object} IntegrationSettings
 * @property {UserLogOverride} [userLog]
 */

/** @type {IntegrationSettings} */
let current = {};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Safely read the runtime configuration from the page. */
function readRuntimeConfig() {
  try {
    if (typeof window !== 'undefined') {
      if (typeof window.__ODV_GET_CONFIG__ === 'function') return window.__ODV_GET_CONFIG__() || {};
      if (window.__ODV_CONFIG__) return window.__ODV_CONFIG__ || {};
    }
  } catch {}
  return {};
}

function documentBase() {
  try {
    if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
    if (typeof window !== 'undefined' && window.location) return window.location.href;
  } catch {}
  return '';
}

/**
 * Resolve an endpoint against the document and return it only when it stays on the document's
 * own origin. Anything unparsable, non-http(s) or cross-origin gives an empty string.
 *
 * @param {*} endpoint
 * @param {string} [base]
 * @returns {string}
 */
export function resolveSameOriginEndpoint(endpoint, base = documentBase()) {
  if (typeof endpoint !== 'string') return '';
  const text = endpoint.trim();
  if (!text || !base) return '';
  try {
    const origin = new URL(base);
    const target = new URL(text, origin);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return '';
    if (target.protocol !== origin.protocol || target.host !== origin.host) return '';
    return target.toString();
  } catch {
    return '';
  }
}

/**
 * Site policy for bundle-carried settings.
 *
 * @param {Object} [cfg] runtime configuration
 * @returns {{ enabled: boolean, allow: Array<string> }}
 */
export function readSettingsPolicy(cfg = readRuntimeConfig()) {
  const policy = cfg?.integrations?.portableBundle?.settingsFromBundle;
  if (!isPlainObject(policy) || policy.enabled !== true) return { enabled: false, allow: [] };
  const allow = Array.isArray(policy.allow)
    ? policy.allow.filter((name) => typeof name === 'string' && KNOWN_GROUPS.includes(name))
    : [];
  return { enabled: allow.length > 0, allow };
}

/**
 * Reduce a bundle's `integration.settings` to the values the site allows and this module
 * understands. Pure: no global state is read except through the arguments.
 *
 * @param {*} bundle normalized Portable Document Bundle
 * @param {Object} options
 * @param {string} options.mode bootstrap mode the bundle arrived through
 * @param {{ enabled: boolean, allow: Array<string> }} options.policy
 * @param {string} [options.base] document base used for the origin check
 * @returns {{ settings: IntegrationSettings, rejected: Array<string> }}
 */
export function sanitizeIntegrationSettings(bundle, { mode, policy, base = documentBase() }) {
  /** @type {Array<string>} */
  const rejected = [];
  const requested = bundle?.integration?.settings;
  if (!isPlainObject(requested) || Object.keys(requested).length === 0) return { settings: {}, rejected };

  if (!policy?.enabled) {
    rejected.push('settings-from-bundle-disabled');
    return { settings: {}, rejected };
  }

  if (!TRUSTED_MODES.includes(String(mode || ''))) {
    rejected.push('untrusted-bootstrap-mode');
    return { settings: {}, rejected };
  }

  /** @type {Object} */
  const settings = {};

  if (isPlainObject(requested.userLog)) {
    if (!policy.allow.includes('userLog')) {
      rejected.push('userLog:not-allowed');
    } else {
      /** @type {UserLogOverride} */
      const userLog = {};
      const source = requested.userLog;

      if (typeof source.enabled === 'boolean') userLog.enabled = source.enabled;

      if (source.endpoint !== undefined) {
        const endpoint = resolveSameOriginEndpoint(source.endpoint, base);
        if (endpoint) userLog.endpoint = endpoint;
        else rejected.push('userLog.endpoint:not-same-origin');
      }

      if (source.transport !== undefined) {
        if (USER_LOG_TRANSPORTS.includes(source.transport)) userLog.transport = source.transport;
        else rejected.push('userLog.transport:unknown');
      }

      // An endpoint that was asked for and refused must not leave logging pointed at the site's
      // default address under this integration's name: the whole group is dropped instead.
      const endpointRefused = source.endpoint !== undefined && !userLog.endpoint;
      if (!endpointRefused && Object.keys(userLog).length > 0) settings.userLog = userLog;
    }
  }

  for (const name of Object.keys(requested)) {
    if (!KNOWN_GROUPS.includes(name)) rejected.push(`${name}:unknown-group`);
  }

  return { settings, rejected };
}

/**
 * Read the settings of a newly loaded bundle and make them the current overlay. Called once per
 * bootstrap. A bundle without settings clears any earlier overlay.
 *
 * @param {*} bundle
 * @param {string} mode bootstrap mode
 * @returns {Object} the overlay now in effect
 */
export function applyIntegrationSettings(bundle, mode) {
  const { settings, rejected } = sanitizeIntegrationSettings(bundle, { mode, policy: readSettingsPolicy() });
  current = settings;
  if (rejected.length > 0) {
    // Names of rules only: a refused value may be an address that should not be repeated in a log.
    logger.warn('Integration settings from the bundle were ignored', { rejected });
  }
  if (Object.keys(settings).length > 0) {
    logger.info('Integration settings from the bundle are in effect', { groups: Object.keys(settings) });
  }
  return current;
}

/** Forget any overlay. Used by tests and when a session ends. */
export function resetIntegrationSettings() {
  current = {};
}

/** @returns {Object} the overlay in effect */
export function getIntegrationSettings() {
  return current;
}

/**
 * The print-log configuration to use: the site configuration with the current integration's
 * values on top. The dialog options under `userLog.ui` always come from the site configuration.
 *
 * @param {Object} [cfg] runtime configuration
 * @returns {Object}
 */
export function getEffectiveUserLogConfig(cfg = readRuntimeConfig()) {
  const site = isPlainObject(cfg?.userLog) ? cfg.userLog : {};
  const overlay = current.userLog;
  if (!isPlainObject(overlay)) return site;
  return { ...site, ...overlay, ui: site.ui };
}
