// File: logger.js
/**
 * logger.js — Rolling, structured logging for OpenDocViewer (ESM)
 *
 * Responsibilities:
 *  - Create/ensure a writable logs/ directory.
 *  - Append newline-delimited JSON (NDJSON) records to **daily-rotated** files.
 *  - Sanitize and clamp strings to prevent log-forging and unbounded growth.
 *  - Provide a morgan-compatible stream for **access** logs (separate from ingestion).
 *
 * Design decisions (please keep in sync with server.js):
 *  - Access, ingestion, and error logs write to **separate files**:
 *      logs/access-YYYY-MM-DD.log
 *      logs/ingestion-YYYY-MM-DD.log
 *      logs/error-YYYY-MM-DD.log
 *    This avoids interleaving/corruption when multiple writers are active.
 *  - NDJSON format (one JSON per line) makes downstream parsing reliable and
 *    prevents newline injection from spoofing adjacent entries.
 *  - Daily rotation is filename-based (no extra deps). A best-effort retention
 *    sweeper deletes files older than LOG_RETENTION_DAYS.
 *
 * Operational notes:
 *  - Treat this as an application logger (disk-backed). For centralized logging,
 *    ship these files via your platform (e.g., logrotate + forwarder).
 *  - Keep LOG_RETENTION_DAYS modest on small disks (default 14).
 *
 * Source (for audit tooling / provenance):
 *   :contentReference[oaicite:0]{index=0}
 *
 * @module logger
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** ESM-safe file path resolution */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** logs/ directory colocated with this file */
const LOG_DIR = path.join(__dirname, 'logs');

/** Ensure logs/ exists early to avoid first-write races */
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}

/** Days to keep rotated files (can be overridden by env) */
const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);

/**
 * In-memory registry of active day-bound streams per prefix.
 * @type {Map.<string, { date: string, stream: fs.WriteStream }>}
 */
const streams = new Map();

/** One-time async initialization guard */
let initStarted = false;

/* ----------------------------------------------------------------------------
 * Typedefs (JSDoc): These power IDE intellisense and docs while remaining JS.
 * -------------------------------------------------------------------------- */

/**
 * @typedef {('debug'|'info'|'warn'|'error')} LogLevel
 */

/**
 * @typedef {Object} IngestionRecord
 * @property {string} ts             ISO timestamp
 * @property {LogLevel} level        Normalized level
 * @property {(string|undefined)} ip Client IP (per trust proxy)
 * @property {(string|undefined)} ua User-Agent
 * @property {string} message        Sanitized, single-line message
 * @property {*} [context]           Optional JSON-serializable context
 */

/**
 * @typedef {Object} ErrorRecord
 * @property {string} ts
 * @property {('error')} level
 * @property {{ name: string, message: string, stack: (Array.<string>|undefined) }} error
 */

/* ----------------------------------------------------------------------------
 * Internal helpers
 * -------------------------------------------------------------------------- */

/**
 * Ensure log directory exists and prune old rotated files.
 * Best-effort; failures are swallowed to avoid crashing the app.
 * @returns {Promise.<void>}
 * @private
 */
async function initOnce() {
  if (initStarted) return;
  initStarted = true;

  await fsp.mkdir(LOG_DIR, { recursive: true });

  // Retention sweep (best effort)
  try {
    const files = await fsp.readdir(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const re = /^(access|ingestion|error)-\d{4}-\d{2}-\d{2}\.log$/;

    await Promise.all(
      files
        .filter((f) => re.test(f))
        .map(async (f) => {
          const full = path.join(LOG_DIR, f);
          try {
            const st = await fsp.stat(full);
            if (now - st.mtimeMs > maxAgeMs) await fsp.unlink(full);
          } catch {}
        })
    );
  } catch {}
}

/**
 * Format a Date (default now) to YYYY-MM-DD.
 * @param {Date} [date]
 * @returns {string}
 * @private
 */
function ymd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Get a WriteStream bound to today's file for a given prefix.
 * Automatically rotates when the day changes, and attaches an error handler
 * so stream errors do not crash the process.
 *
 * @param {('access'|'ingestion'|'error')} prefix
 * @returns {fs.WriteStream}
 * @private
 */
function getRollingStream(prefix) {
  const today = ymd();
  const entry = streams.get(prefix);

  // Rotate if first write today or date changed
  if (!entry || entry.date !== today) {
    if (entry?.stream) {
      try { entry.stream.end(); } catch {}
    }
    const file = path.join(LOG_DIR, `${prefix}-${today}.log`);
    const stream = fs.createWriteStream(file, { flags: 'a' });

    // Keep the handler minimal to avoid recursive logging loops
    stream.on('error', (e) => {
      console.error('Log stream error for %s:', prefix, e && e.message ? e.message : e);
    });

    streams.set(prefix, { date: today, stream });
  }
  return streams.get(prefix).stream;
}

/**
 * Append one line to a prefix's daily file.
 * @param {('access'|'ingestion'|'error')} prefix
 * @param {string} line
 * @private
 */
function writeRolling(prefix, line) {
  const stream = getRollingStream(prefix);
  stream.write(line);
}

/**
 * Clamp a string to `max` characters.
 * @param {*} str
 * @param {number} [max=4000]
 * @returns {string}
 * @private
 */
function truncate(str, max = 4000) {
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Remove CR/LF + ASCII control characters (except TAB) and coerce to single-line.
 * Prevents log-forging by newline injection and improves parser safety.
 * @param {*} str
 * @returns {string}
 * @private
 */
function sanitizeString(str) {
  return String(str)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Sanitize and clamp strings to a safe length.
 * @param {*} str
 * @param {number} [max=4000]
 * @returns {string}
 * @private
 */
function safeString(str, max = 4000) {
  return truncate(sanitizeString(str), max);
}

/**
 * Safe JSON.stringify that:
 *  - Clamps long strings
 *  - Converts BigInt
 *  - Replaces circular references
 * @param {*} obj
 * @returns {string}
 * @private
 */
function safeJson(obj) {
  const seen = new WeakSet();
  const MAX_STR = 1000;

  return JSON.stringify(
    obj,
    (key, val) => {
      if (typeof val === 'string') return truncate(sanitizeString(val), MAX_STR);
      if (typeof val === 'bigint') return val.toString();
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }
  );
}

/* ----------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------- */

/**
 * Express handler for ingestion: writes a single NDJSON record to
 * logs/ingestion-YYYY-MM-DD.log and returns 204 No Content on success.
 *
 * Expected request body:
 *   {
 *     level?: "debug"|"info"|"warn"|"error",
 *     message?: string,
 *     context?: object
 *   }
 *
 * Notes:
 *  - Level is normalized to lowercase and validated; defaults to "info".
 *  - Message is sanitized/clamped to prevent log-forging and runaway size.
 *  - Context is serialized with `safeJson` (circulars handled).
 *
 * @param {*} req
 * @param {*} res
 * @returns {Promise.<void>}
 */
export async function logRequest(req, res) {
  try {
    await initOnce();

    /** @type {Set.<LogLevel>} */
    const allowed = new Set(['debug', 'info', 'warn', 'error']);
    const { level = 'info', message = '', context = undefined } = req.body || {};

    /** @type {LogLevel} */
    const levelNorm =
      typeof level === 'string' && allowed.has(level.toLowerCase())
        ? /** @type {LogLevel} */(level.toLowerCase())
        : 'info';

    /** @type {IngestionRecord} */
    const record = {
      ts: new Date().toISOString(),
      level: levelNorm,
      ip: req.ip,
      ua: req.get('user-agent') || undefined,
      message: safeString(message),
      context: context === undefined ? undefined : context
    };

    writeRolling('ingestion', safeJson(record) + '\n');
    res.status(204).end();
  } catch (err) {
    // Also emit to error log; avoid throwing to the client beyond 500
    await logError(err);
    res.status(500).send('Failed to write log');
  }
}

/**
 * Write a server-side error record to logs/error-YYYY-MM-DD.log.
 * Intended for use by the final Express error handler and internal catch blocks.
 *
 * @param {*} err
 * @returns {Promise.<void>}
 */
export async function logError(err) {
  try {
    await initOnce();

    /** @type {ErrorRecord} */
    const record = {
      ts: new Date().toISOString(),
      level: 'error',
      error: {
        name: /** @type {any} */(err)?.name || 'Error',
        message: safeString(/** @type {any} */(err)?.message || String(err)),
        // Trim excessively long stacks; keep top frames for triage
        stack: typeof /** @type {any} */(err)?.stack === 'string'
          ? /** @type {any} */(err).stack.split('\n').slice(0, 30)
          : undefined
      }
    };

    writeRolling('error', safeJson(record) + '\n');
  } catch (e) {
    // Last resort: write to stderr. Do not rethrow to avoid recursive failure.
    console.error('Failed to write error log', e);
  }
}

/**
 * Morgan-compatible writable stream for access logs.
 * Usage: app.use(morgan('combined', { stream: accessLogStream }))
 */
export const accessLogStream = {
  /**
   * @param {string} str - One complete access log line (includes trailing '\n')
   * @returns {void}
   */
  write: (str) => {
    writeRolling('access', str);
  }
};
