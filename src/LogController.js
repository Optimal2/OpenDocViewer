// File: src/LogController.js

import axios from 'axios';

// Define available log levels
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * LogController class for managing logging.
 */
class LogController {
  constructor() {
    // Default to console-only; backend logging is opt-in via env/meta/global.
    // 1) <meta name="odv-log-endpoint" content="/relative/or/absolute/url">
    // 2) window.__ODV_CONFIG__ = { logEndpoint: '...' }
    // 3) Vite env: import.meta.env.VITE_LOG_ENDPOINT
    const metaLogUrl =
      (typeof document !== 'undefined' &&
        document.querySelector('meta[name="odv-log-endpoint"]')?.getAttribute('content')) || '';

    const globalLogUrl =
      (typeof window !== 'undefined' && window.__ODV_CONFIG__ && window.__ODV_CONFIG__.logEndpoint) || '';

    // Vite/ESM-safe: check import.meta directly
    const envLogUrl =
      (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LOG_ENDPOINT) || '';

    // Pick the first defined value. If it's relative, resolve it against <base href> / document.baseURI.
    const candidate = globalLogUrl || metaLogUrl || envLogUrl || '';
    const absolute = candidate ? new URL(candidate, document.baseURI).toString() : '';

    // Log level: dev = debug, otherwise warn (you can tweak if you prefer).
    this.logLevel = (import.meta?.env?.MODE === 'development') ? 'debug' : 'warn';
    this.currentLogLevel = this.logLevel;

    // Allow disabling via <meta name="odv-log-enabled" content="false"> (default true if present/omitted)
	const metaEnabled =
	  (typeof document !== 'undefined' &&
		document.querySelector('meta[name="odv-log-enabled"]')?.getAttribute('content')) || 'false';

    this.backendUrl = absolute;      // absolute URL or ''
    this.logToBackend = !!absolute && String(metaEnabled).toLowerCase() !== 'false';

    this.authToken = ''; // optional
    this.retryLimit = 3;
    this.retryInterval = 1000; // ms
  }

  /**
   * Enable or disable logging to backend.
   * @param {boolean} value - Whether to log to the backend.
   */
  setLogToBackend = (value) => {
    this.logToBackend = value;
  };

  /**
   * Set the backend URL for logging.
   * @param {string} url - The backend URL.
   */
  setBackendUrl = (url) => {
    this.backendUrl = url;
  };

  /**
   * Set the current log level.
   * @param {string} level - The log level to set.
   * @throws {Error} If the log level is invalid.
   */
  setLogLevel = (level) => {
    if (LOG_LEVELS.includes(level)) {
      this.currentLogLevel = level;
    } else {
      throw new Error(`Invalid log level: ${level}`);
    }
  };

  /**
   * Set retry limit for logging to backend.
   * @param {number} limit - The retry limit.
   */
  setRetryLimit = (limit) => {
    this.retryLimit = limit;
  };

  /**
   * Set retry interval for logging to backend.
   * @param {number} interval - The retry interval in milliseconds.
   */
  setRetryInterval = (interval) => {
    this.retryInterval = interval;
  };

  /**
   * Log a message with the given level and context.
   * @param {string} level - The log level.
   * @param {string} message - The log message.
   * @param {Object} [context={}] - Additional context for the log message.
   * @throws {Error} If the log level is invalid.
   */
  log = async (level, message, context = {}) => {
    if (!LOG_LEVELS.includes(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }

    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.currentLogLevel)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(context, this.replacer(), 2)}`;

    if (this.logToBackend) {
      try {
        await this.sendLogToBackend(level, message, context, 0);
      } catch (error) {
        console.error('Failed to send log to backend after retries', error);
        console[level](logMessage);
      }
    } else {
      console[level](logMessage);
    }
  };

  /**
   * Retry sending log to backend.
   * @param {string} level - The log level.
   * @param {string} message - The log message.
   * @param {Object} context - Additional context for the log message.
   * @param {number} attempt - The current attempt number.
   * @throws {Error} If all retry attempts fail.
   */
  sendLogToBackend = async (level, message, context, attempt) => {
    // No-op unless explicitly enabled and a URL is configured.
    if (!this.logToBackend || !this.backendUrl) return;

    try {
      await axios.post(this.backendUrl, { level, message, context });
    } catch (error) {
      if (attempt < this.retryLimit) {
        setTimeout(() => {
          this.sendLogToBackend(level, message, context, attempt + 1);
        }, this.retryInterval);
      } else {
        this.consoleLog('error', 'Failed to send log to backend after retries', { error: error.message });
      }
    }
  };

  /**
   * Handle circular references in JSON.stringify.
   * @returns {function} A replacer function for JSON.stringify.
   */
  replacer = () => {
    const cache = new Set();
    return (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      return value;
    };
  };

  /**
   * Log a debug level message.
   * @param {string} message - The log message.
   * @param {Object} [context={}] - Additional context for the log message.
   */
  debug = (message, context = {}) => {
    this.log('debug', message, context);
  };

  /**
   * Log an info level message.
   * @param {string} message - The log message.
   * @param {Object} [context={}] - Additional context for the log message.
   */
  info = (message, context = {}) => {
    this.log('info', message, context);
  };

  /**
   * Log a warn level message.
   * @param {string} message - The log message.
   * @param {Object} [context={}] - Additional context for the log message.
   */
  warn = (message, context = {}) => {
    this.log('warn', message, context);
  };

  /**
   * Log an error level message.
   * @param {string} message - The log message.
   * @param {Object} [context={}] - Additional context for the log message.
   */
  error = (message, context = {}) => {
    this.log('error', message, context);
  };
}

// Export a singleton instance of LogController
const logger = new LogController();
export default logger;
