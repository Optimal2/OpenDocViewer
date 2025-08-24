/**
 * src/LogController.js
 *
 * OpenDocViewer — Frontend Logging Controller (ESM)
 *
 * PURPOSE
 *   - Provide a small, dependency-light logging facade for the browser app.
 *   - Log locally to the console at a configurable level.
 *   - Optionally forward structured logs to a backend ingestion endpoint (server.js).
 *
 * RUNTIME CONFIG SOURCES (highest precedence first)
 *   1) window.__ODV_CONFIG__:
 *        - logEndpoint: string (absolute or relative)
 *        - logToken:    string (sent as 'x-log-token')
 *        - logEnabled:  boolean (optional override; default: true when URL exists)
 *   2) <meta> tags in index.html:
 *        - <meta name="odv-log-endpoint" content="...">
 *        - <meta name="odv-log-token" content="...">
 *        - <meta name="odv-log-enabled" content="true|false">
 *   3) Vite env (build-time):
 *        - import.meta.env.VITE_LOG_ENDPOINT
 *        - import.meta.env.VITE_LOG_TOKEN
 *
 * DEFAULTS
 *   - Log level defaults to 'debug' in dev (import.meta.env.MODE === 'development'), else 'warn'.
 *   - Backend logging is enabled IFF a backend URL exists (unless explicitly disabled).
 *   - Retries: 3 attempts, 1000 ms between attempts.
 *
 * IMPORTANT (project-wide gotcha retained here for future reviewers):
 *   - In other parts of the app we import from 'file-type' (root), NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break the Vite build.
 *     See README “Design notes & gotchas” before changing that.
 */

import axios from 'axios';

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

/** Valid log levels in ascending verbosity. */
const LOG_LEVELS /** @type {LogLevel[]} */ = ['debug', 'info', 'warn', 'error'];

/** No-op function used when we want to swallow calls cleanly. */
const NOOP = () => {};

/**
 * Resolve a string from a meta tag (SSR-safe).
 * @param {string} name
 * @returns {string}
 */
function readMeta(name) {
  try {
    if (typeof document === 'undefined') return '';
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? String(el.getAttribute('content') || '') : '';
  } catch {
    return '';
  }
}

/**
 * Resolve a boolean from a meta tag content.
 * @param {string} name
 * @returns {boolean|null} true/false if present, otherwise null
 */
function readMetaBool(name) {
  const raw = readMeta(name);
  if (!raw) return null;
  const v = raw.toLowerCase();
  return v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : null;
}

/**
 * Resolve a runtime config snapshot from window.__ODV_CONFIG__ (SSR-safe).
 * @returns {{ logEndpoint?: string, logToken?: string, logEnabled?: boolean }}
 */
function readRuntimeConfig() {
  try {
    if (typeof window !== 'undefined' && window.__ODV_CONFIG__) {
      return /** @type {*} */ (window.__ODV_CONFIG__) || {};
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Resolve a candidate backend URL using precedence rules and make it absolute
 * relative to document.baseURI (SSR-safe).
 * @returns {string} empty string if not configured or invalid
 */
function resolveBackendUrl() {
  const cfg = readRuntimeConfig();
  const globalLogUrl = typeof cfg.logEndpoint === 'string' ? cfg.logEndpoint : '';

  const metaLogUrl = readMeta('odv-log-endpoint');

  // IMPORTANT: do NOT write `typeof import !== 'undefined'` (invalid).
  // Guard with `typeof import.meta !== 'undefined'`.
  const envLogUrl =
    (typeof import.meta !== 'undefined' &&
      import.meta &&
      import.meta.env &&
      import.meta.env.VITE_LOG_ENDPOINT) ||
    '';

  const candidate = globalLogUrl || metaLogUrl || envLogUrl || '';
  if (!candidate) return '';

  // Make absolute using document.baseURI when available; fallback to localhost for SSR safety.
  const base = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : 'http://localhost/';
  try {
    return new URL(candidate, base).toString();
  } catch {
    return '';
  }
}

/**
 * Resolve the shared auth token used for posting to /log.
 * @returns {string}
 */
function resolveAuthToken() {
  const cfg = readRuntimeConfig();
  const global = (typeof cfg.logToken === 'string' && cfg.logToken) || '';
  const meta = readMeta('odv-log-token');
  const env =
    (typeof import.meta !== 'undefined' &&
      import.meta &&
      import.meta.env &&
      import.meta.env.VITE_LOG_TOKEN) ||
    '';
  return global || meta || env || '';
}

/**
 * Resolve an explicit "enabled" boolean if one exists.
 * @returns {boolean|null} true/false if present in runtime or meta, otherwise null
 */
function resolveEnabledOverride() {
  const cfg = readRuntimeConfig();
  if (typeof cfg.logEnabled === 'boolean') return cfg.logEnabled;
  const metaBool = readMetaBool('odv-log-enabled');
  return metaBool;
}

/**
 * Normalize and validate a log level.
 * @param {unknown} level
 * @returns {LogLevel}
 */
function normalizeLevel(level) {
  const s = typeof level === 'string' ? level.toLowerCase() : '';
  return /** @type {LogLevel} */ (LOG_LEVELS.includes(/** @type {*} */ (s)) ? s : 'info');
}

/**
 * Compare two log levels (is `a` >= `b`?).
 * @param {LogLevel} a
 * @param {LogLevel} b
 * @returns {boolean}
 */
function levelGte(a, b) {
  return LOG_LEVELS.indexOf(a) >= LOG_LEVELS.indexOf(b);
}

/**
 * Create a JSON replacer that:
 *  - prevents circular references
 *  - leaves values otherwise intact
 * @returns {(this:any, key:string, value:any) => any}
 */
function circularReplacer() {
  const seen = new Set();
  return function (_key, value) {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/**
 * LogController — small facade around console + optional HTTP forwarding.
 */
class LogController {
  constructor() {
    // Backend endpoint + auth token (resolved at construction; you can override later)
    const backendUrl = resolveBackendUrl();
    /** @private */ this.backendUrl = backendUrl;
    /** @private */ this.authToken = resolveAuthToken();

    // Level: development => debug, otherwise warn (tune here if you prefer)
    /** @private */ this.logLevel = (import.meta?.env?.MODE === 'development') ? 'debug' : 'warn';
    /** @private */ this.currentLogLevel = this.logLevel;

    // Whether we should POST logs to the backend
    const enabledOverride = resolveEnabledOverride();
    const enabledByDefault = !!backendUrl;
    /** @private */ this.logToBackend = !!backendUrl && (enabledOverride ?? enabledByDefault);

    // Retry policy
    /** @private */ this.retryLimit = 3;
    /** @private */ this.retryInterval = 1000; // ms

    // Axios default timeout (kept small for log fire-and-forget)
    /** @private */ this.httpTimeout = 5000; // ms
  }

  /* ------------------------------------------------------------------------ *
   * Configuration API
   * ------------------------------------------------------------------------ */

  /**
   * Enable/disable HTTP forwarding at runtime.
   * @param {boolean} value
   */
  setLogToBackend = (value) => {
    this.logToBackend = !!value;
  };

  /**
   * Set the backend ingestion URL (absolute or relative).
   * @param {string} url
   */
  setBackendUrl = (url) => {
    try {
      const base = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : 'http://localhost/';
      this.backendUrl = url ? new URL(url, base).toString() : '';
    } catch {
      this.backendUrl = '';
    }
  };

  /**
   * Set the current log level. Messages below this level are ignored.
   * @param {LogLevel} level
   */
  setLogLevel = (level) => {
    const lvl = normalizeLevel(level);
    this.currentLogLevel = lvl;
  };

  /**
   * Set retry limit for backend forwarding.
   * @param {number} limit
   */
  setRetryLimit = (limit) => {
    this.retryLimit = Math.max(0, Number(limit) || 0);
  };

  /**
   * Set retry interval (ms) for backend forwarding.
   * @param {number} interval
   */
  setRetryInterval = (interval) => {
    this.retryInterval = Math.max(0, Number(interval) || 0);
  };

  /**
   * Set axios timeout (ms) for backend posts.
   * @param {number} ms
   */
  setHttpTimeout = (ms) => {
    this.httpTimeout = Math.max(0, Number(ms) || 0);
  };

  /**
   * Update/replace the auth token used in 'x-log-token'.
   * @param {string} token
   */
  setAuthToken = (token) => {
    this.authToken = String(token || '');
  };

  /* ------------------------------------------------------------------------ *
   * Logging API
   * ------------------------------------------------------------------------ */

  /**
   * Internal: should this level be logged at all (console or backend)?
   * @param {LogLevel} level
   * @returns {boolean}
   */
  shouldLog = (level) => {
    return levelGte(normalizeLevel(level), this.currentLogLevel);
  };

  /**
   * Log a message with a given level and optional context.
   * - Always writes to the console (subject to level).
   * - Optionally POSTs to the backend (if enabled).
   *
   * @param {LogLevel} level
   * @param {string} message
   * @param {Record<string, any>} [context={}]
   */
  log = async (level, message, context = {}) => {
    const lvl = normalizeLevel(level);
    if (!this.shouldLog(lvl)) return;

    const timestamp = new Date().toISOString();
    const logMessage =
      `[${timestamp}] [${lvl.toUpperCase()}] ${String(message)} ${JSON.stringify(context, circularReplacer(), 2)}`;

    // Console first (cheap and immediate)
    (console[lvl] || console.log || NOOP).call(console, logMessage);

    // Backend forwarding (fire-and-forget with retries)
    if (this.logToBackend && this.backendUrl) {
      try {
        await this.sendLogToBackend(lvl, String(message), context, 0);
      } catch (error) {
        // If all retries failed, surface a concise console error
        console.error('Failed to send log to backend after retries', error);
      }
    }
  };

  /**
   * Attempt to POST the log to the backend, with simple linear retries.
   *
   * @param {LogLevel} level
   * @param {string} message
   * @param {Record<string, any>} context
   * @param {number} attempt
   * @returns {Promise<void>}
   */
  sendLogToBackend = async (level, message, context, attempt) => {
    if (!this.logToBackend || !this.backendUrl) return;

    try {
      await axios.post(
        this.backendUrl,
        { level, message, context },
        {
          headers: this.authToken ? { 'x-log-token': this.authToken } : undefined,
          timeout: this.httpTimeout,
        }
      );
    } catch (error) {
      if (attempt < this.retryLimit) {
        setTimeout(() => {
          // Note: this recursion is intentionally non-awaited (fire-and-forget)
          this.sendLogToBackend(level, message, context, attempt + 1);
        }, this.retryInterval);
      } else {
        // Last-chance local signal; keep it short to avoid leaking internals
        console.error('Failed to send log to backend after retries', { error: String(error?.message || error) });
      }
    }
  };

  /** Convenience wrappers */
  /** @param {string} message @param {Record<string, any>} [context] */
  debug = (message, context = {}) => this.log('debug', message, context);

  /** @param {string} message @param {Record<string, any>} [context] */
  info = (message, context = {}) => this.log('info', message, context);

  /** @param {string} message @param {Record<string, any>} [context] */
  warn = (message, context = {}) => this.log('warn', message, context);

  /** @param {string} message @param {Record<string, any>} [context] */
  error = (message, context = {}) => this.log('error', message, context);
}

/** Export a singleton instance (sufficient for app usage). */
const logger = new LogController();
export default logger;
