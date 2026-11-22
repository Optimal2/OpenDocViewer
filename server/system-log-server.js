// File: server/system-log-server.js
/**
 * System Log Server — standalone Express endpoint for structured system logs.
 *
 * Responsibilities:
 *  - Expose POST /log for structured system logs (tiny JSON bodies)
 *  - Write NDJSON to daily-rotated files under ./logs/
 *  - Keep access, ingestion, and error logs separate to avoid interleaving
 *  - Minimal, hardened Express setup with token guard, rate limit, optional CORS
 *
 * Runtime env:
 *  - PORT=3001
 *  - NODE_ENV=production|development
 *  - TRUST_PROXY=1
 *  - LOG_TOKEN=<required in production for /log>
 *  - ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com   (optional CORS for /log)
 *  - JSON_LIMIT=64kb
 *  - LOG_RETENTION_DAYS=14
 *  - LOG_WRITE_TIMEOUT_MS=10000  (answer 500 when a record is not confirmed in the file in time)
 *  - SYSTEM_LOG_RATE_LIMIT_PER_MINUTE=120  (per client address; 0 or off = no limit)
 *
 * See also: `docs-src/log-servers.md` for endpoint contracts, retention, and proxy assumptions.
 * The shared pieces (log files, retention, client address, rate limit settings, access log)
 * are in the modules next to this file.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createAccessLogger } from './accessLog.js';
import { pruneRotatedLogs, scheduleLogRetention } from './logRetention.js';
import { decodeHeaderValue } from './headerText.js';
import { normalizeClientAddress } from './clientAddress.js';
import { createRejectionReporter, resolveRateLimitPerMinute } from './rateLimitConfig.js';
import { createRollingLog, describeWriteError, resolveLogWriteTimeoutMs } from './rollingLog.js';

dotenv.config();

/* ------------------------------ File logger ------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);
const ROTATED_LOG_FILE_PATTERN = /^(access|ingestion|error)-\d{4}-\d{2}-\d{2}\.log$/;
const pruneOldLogs = () => pruneRotatedLogs({
  logDir: LOG_DIR,
  retentionDays: RETENTION_DAYS,
  filePattern: ROTATED_LOG_FILE_PATTERN,
});

let initStarted = false;

async function initOnce() {
  if (initStarted) return;
  initStarted = true;

  await fsp.mkdir(LOG_DIR, { recursive: true });
  await pruneOldLogs();
}

// LOG_WRITE_TIMEOUT_MS: how long a request waits for its record to be confirmed in the file
// before it is answered with 500 (default 10000). A hung disk must not leave requests hanging.
const writeTimeoutSetting = resolveLogWriteTimeoutMs(process.env.LOG_WRITE_TIMEOUT_MS);
if (writeTimeoutSetting.warning) console.warn(`WARNING: ${writeTimeoutSetting.warning}`);
const rollingLog = createRollingLog({ logDir: LOG_DIR, writeTimeoutMs: writeTimeoutSetting.timeoutMs });

/**
 * Write a line that must not be lost quietly (an error-log line). When the file cannot be
 * written the line goes to standard error. Never rejects.
 */
function writeRolling(prefix, line) { return rollingLog.writeOrStderr(prefix, line); }

/**
 * Error-log line for a record that could not be written: which log and why, never the record.
 * @returns {Promise<boolean>}
 */
function reportWriteFailure(log, error) {
  const { code, message } = describeWriteError(error);
  return writeRolling('error', safeJson({
    ts: new Date().toISOString(),
    level: 'error',
    event: 'log-write-failed',
    log,
    code,
    message: safeString(message, 500),
    note: 'A record could not be written and the request was answered with 500. The record is not repeated here.',
  }) + '\n');
}

function truncate(str, max = 4000) {
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function sanitizeString(str) {
  return String(str)
    // U+0085, U+2028 and U+2029 are line breaks too, and JSON.stringify leaves them as they are.
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
function safeString(str, max = 4000) {
  return truncate(sanitizeString(str), max);
}
function safeJson(obj) {
  const seen = new WeakSet();
  const MAX_STR = 1000;
  const json = JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string') return truncate(sanitizeString(v), MAX_STR);
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object') { if (seen.has(v)) return '[Circular]'; seen.add(v); }
    return v;
  });
  // Object keys do not pass through the replacer. JSON.stringify escapes CR and LF in them
  // but writes U+0085, U+2028 and U+2029 as they are, so those are escaped here: a record is
  // one line whatever a key contains, and the key itself is kept.
  return typeof json === 'string'
    ? json.replace(/[\u0085\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    : json;
}

/* ------------------------------- Express app ------------------------------ */

await initOnce();
scheduleLogRetention(pruneOldLogs);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');

/** Trust proxy for accurate req.ip */
const TRUST_PROXY_RAW = process.env.TRUST_PROXY ?? '1';
let TRUST_PROXY;
if (/^\d+$/.test(TRUST_PROXY_RAW)) TRUST_PROXY = Number(TRUST_PROXY_RAW);
else TRUST_PROXY = TRUST_PROXY_RAW === 'true' ? true : TRUST_PROXY_RAW === 'false' ? false : 1;
app.set('trust proxy', TRUST_PROXY);

/** Token gate for /log */
const LOG_TOKEN = process.env.LOG_TOKEN;
if (NODE_ENV === 'production' && !LOG_TOKEN) {
  throw new Error('LOG_TOKEN is required in production for /log authentication.');
}

/** Optional CORS for /log */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_CORS_FOR_LOG = ALLOWED_ORIGINS.length > 0;
const corsForLog = ALLOW_CORS_FOR_LOG
  ? cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, false);
        cb(null, ALLOWED_ORIGINS.includes(origin));
      },
      maxAge: 86_400
    })
  : (_req, _res, next) => next();

if (ALLOW_CORS_FOR_LOG) app.options('/log', corsForLog);

/** Security baseline + parsers + access log */
app.use(helmet());
app.use(express.json({ limit: process.env.JSON_LIMIT || '64kb' }));
app.use(createAccessLogger({ write: (line) => rollingLog.writeBestEffort('access', line), sanitize: sanitizeString }));

/** Health */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/** Rate limit for ingestion */
// SYSTEM_LOG_RATE_LIMIT_PER_MINUTE: requests per minute and client address (default 120); "0" or "off" switches
// the limit off. Clients behind one address (terminal server, NAT, a load balancer in front of
// the proxy) share one allowance, so the value is a decision for each site.
const rateLimitSetting = resolveRateLimitPerMinute('SYSTEM_LOG_RATE_LIMIT_PER_MINUTE', process.env.SYSTEM_LOG_RATE_LIMIT_PER_MINUTE, 120);
if (rateLimitSetting.warning) console.warn(`WARNING: ${rateLimitSetting.warning}`);
// A rejected record is lost: the viewer does not read the response. One line per counted client
// (one IPv4 address, or one /56 block of IPv6 addresses) and minute in the error log makes the
// loss visible in operation. The client counts as reported only when that line was written;
// when the error log cannot be written the line goes to standard error and is tried again.
const rateLimitKey = (req) => ipKeyGenerator(normalizeClientAddress(req.ip));
const reportRateLimitRejection = createRejectionReporter({
  write: (address) => {
    const line = safeJson({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'rate-limit-rejected',
      ip: address,
      limitPerMinute: rateLimitSetting.limit,
      message: 'A log record was rejected by the rate limit and not written. Further rejections for this client are not reported for one minute.',
    }) + '\n';
    return rollingLog.write('error', line).catch((error) => {
      rollingLog.toStderr(`[error log not writable: ${describeWriteError(error).code}] ${line}`);
      throw error;
    });
  },
});
const logLimiter = !rateLimitSetting.enabled ? (_req, _res, next) => next() : rateLimit({
  windowMs: 60_000,
  max: rateLimitSetting.limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many log requests, please slow down.' },
  // Keyed on the address without a port: a proxy that forwards address:port (IIS ARR)
  // would otherwise make this a limit per connection.
  keyGenerator: rateLimitKey,
  handler: (req, res, _next, options) => {
    // Reported per counted client: the same key as the limit, so one line per IPv6 /56 too.
    try { reportRateLimitRejection(rateLimitKey(req), normalizeClientAddress(req.ip)); } catch { /* reporting must not change the answer */ }
    res.status(options.statusCode).send(options.message);
  }
});

/** Token auth middleware */
function requireLogToken(req, res, next) {
  const token = req.get('x-log-token');
  if (!token || token !== (LOG_TOKEN || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** POST /log -> logs/ingestion-YYYY-MM-DD.log */
app.post('/log', corsForLog, logLimiter, requireLogToken, async (req, res) => {
  try {
    const allowed = new Set(['debug', 'info', 'warn', 'error']);
    const { level = 'info', message = '', context = undefined } = req.body || {};
    const levelNorm = (typeof level === 'string' && allowed.has(level.toLowerCase()))
      ? level.toLowerCase() : 'info';

    const record = {
      ts: new Date().toISOString(),
      level: levelNorm,
      ip: normalizeClientAddress(req.ip),
      ua: decodeHeaderValue(req.get('user-agent')) || undefined,
      message: safeString(message),
      context: context === undefined ? undefined : context
    };
    // Answer only when the record is in the file; otherwise 500, and the error log says why.
    try {
      await rollingLog.write('ingestion', safeJson(record) + '\n');
    } catch (writeError) {
      await reportWriteFailure('ingestion', writeError);
      return res.status(500).send('Failed to write log');
    }
    res.status(204).end();
  } catch (err) {
    const rec = {
      ts: new Date().toISOString(),
      level: 'error',
      error: {
        name: err?.name || 'Error',
        message: safeString(err?.message || String(err)),
        stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 30) : undefined
      }
    };
    writeRolling('error', safeJson(rec) + '\n');
    res.status(500).send('Failed to write log');
  }
});

/** Final error handler */
app.use((err, _req, res, _next) => {
  const rec = {
    ts: new Date().toISOString(),
    level: 'error',
    error: {
      name: err?.name || 'Error',
      message: safeString(err?.message || String(err)),
      stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 30) : undefined
    }
  };
  writeRolling('error', safeJson(rec) + '\n');
  res.status(500).send('Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`System Log Server listening on http://localhost:${PORT}`);
  if (NODE_ENV !== 'production' && !LOG_TOKEN) {
    console.warn('WARNING: LOG_TOKEN not set (dev mode). /log will reject requests without a token.');
  }
});
