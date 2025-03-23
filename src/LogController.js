// File: src/LogController.js

import axios from 'axios';

// Define available log levels
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * LogController class for managing logging.
 */
class LogController {
  constructor() {
    this.logToBackend = true;
    this.backendUrl = 'http://localhost:3001/log';
    this.currentLogLevel = 'warn';
    this.retryLimit = 3;
    this.retryInterval = 1000; // in milliseconds
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
    try {
      await axios.post(this.backendUrl, { level, message, context });
    } catch (error) {
      if (attempt < this.retryLimit) {
        setTimeout(() => {
          this.sendLogToBackend(level, message, context, attempt + 1);
        }, this.retryInterval);
      } else {
        throw error;
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
