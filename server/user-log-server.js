// File: server/user-log-server.js
/**
 * User Action Log Server — standalone Express endpoint for print/user-action audit events.
 *
 * Endpoint:
 *   POST /userlog/record
 *     - Body: application/x-www-form-urlencoded or JSON
 *       - reason: string|null
 *       - forWhom: string|null  ("$" and "#" are stored as "_")
 *     - Response: 200 OK with body: true   (JSON boolean literal), sent only after the record
 *       is written; 500 when the record could not be written
 *
 * Security posture (no client changes required):
 *   - No cookies are read or set (cookie-based auth removed to avoid CSRF lint).
 *   - Same-origin guard: Origin/Referer must match Host, or the X-Forwarded-Host set by a
 *     reverse proxy on loopback; Sec-Fetch-Site must be same-origin.
 *     Requests with none of these signals are accepted by default for compatibility.
 *   - Accepts only form or JSON content types; a rate limit per client address is optional.
 *
 * Runtime env (optional):
 *   - PORT=3002
 *   - NODE_ENV=production|development
 *   - TRUST_PROXY=1
 *   - LOG_RETENTION_DAYS=14        (access and error logs)
 *   - PRINT_LOG_RETENTION_DAYS=30  (print records; never below 30 unless set here)
 *   - USER_LOG_RATE_LIMIT_PER_MINUTE=0  (no limit by default; a number sets one per client address)
 *   - ODV_STRICT_ORIGIN=true  (if set, requests missing Origin/Referer/Sec-Fetch-Site are rejected)
 * See also: `docs-src/log-servers.md` for endpoint contracts, retention, and proxy assumptions.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createAccessLogger } from './accessLog.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { pruneRotatedLogs, resolvePrintLogRetentionDays, scheduleLogRetention } from './logRetention.js';
import { neutralizeForWhom, readPrintLogFields } from './userLogPayload.js';
import { isAllowedUserLogOrigin } from './userLogOrigin.js';
import { decodeHeaderValue } from './headerText.js';
import { normalizeClientAddress } from './clientAddress.js';
import { createRejectionReporter, resolveRateLimitPerMinute } from './rateLimitConfig.js';
import { createRollingLog, describeWriteError } from './rollingLog.js';

dotenv.config();

/* ------------------------------ File logger ------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);
// The print records are the audit trail and are kept longer than the access and error logs.
const PRINT_RETENTION_DAYS = resolvePrintLogRetentionDays(process.env);
const GENERAL_LOG_FILE_PATTERN = /^(access|error)-\d{4}-\d{2}-\d{2}\.log$/;
const PRINT_LOG_FILE_PATTERN = /^print-\d{4}-\d{2}-\d{2}\.log$/;
const pruneOldLogs = async () => {
  await pruneRotatedLogs({
    logDir: LOG_DIR,
    retentionDays: RETENTION_DAYS,
    filePattern: GENERAL_LOG_FILE_PATTERN,
  });
  await pruneRotatedLogs({
    logDir: LOG_DIR,
    retentionDays: PRINT_RETENTION_DAYS,
    filePattern: PRINT_LOG_FILE_PATTERN,
  });
};

let initStarted = false;

async function initOnce() {
  if (initStarted) return;
  initStarted = true;

  await fsp.mkdir(LOG_DIR, { recursive: true });
  await pruneOldLogs();
}

const rollingLog = createRollingLog({ logDir: LOG_DIR });

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
function safeString(str, max = 4000) { return truncate(sanitizeString(str), max); }
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

/* ----------------------------- User resolution ---------------------------- */
/**
 * Resolve user identity without cookies. Prefer headers injected by a trusted
 * reverse proxy or upstream middleware (e.g., auth gateway).
 */
function resolveUser(req) {
  // 1) Upstream-authenticated user object (if any)
  const fromReq = /** @type {any} */ (req)?.user?.id || /** @type {any} */ (req)?.user?.name;
  if (fromReq) return String(fromReq);

  // 2) Trusted reverse proxy can inject a header
  const headerUser = req.get('x-user-id') || req.get('x-remote-user') || req.get('remote-user');
  // Decoded before sanitising: see decodeHeaderValue.
  if (headerUser) return sanitizeString(decodeHeaderValue(headerUser));

  // 3) Fallback
  return 'anonymous';
}

/* ------------------------ Same-origin protection -------------------------- */
/**
 * Blocks cross-site requests using Origin/Referer/Sec-Fetch-Site signals.
 * No client changes needed for same-origin form posts.
 */
function sameOriginGuard(req, res, next) {
  const strict = String(process.env.ODV_STRICT_ORIGIN || '').toLowerCase() === 'true';
  const allowed = isAllowedUserLogOrigin({
    host: req.get('host') || '',
    // Trusted only when the request arrives over loopback; see resolveUserLogHosts.
    forwardedHost: req.get('x-forwarded-host') || '',
    remoteAddress: req.socket?.remoteAddress || '',
    origin: req.get('origin') || '',
    referer: req.get('referer') || '',
    secFetchSite: req.get('sec-fetch-site') || '',
    strict,
  });
  if (!allowed) return res.status(403).send('Forbidden');
  next();
}

/* ------------------------------- Express app ------------------------------ */

await initOnce();
scheduleLogRetention(pruneOldLogs);

const app = express();
const PORT = Number(process.env.PORT || 3002);
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');

const TRUST_PROXY_RAW = process.env.TRUST_PROXY ?? '1';
let TRUST_PROXY;
if (/^\d+$/.test(TRUST_PROXY_RAW)) TRUST_PROXY = Number(TRUST_PROXY_RAW);
else TRUST_PROXY = TRUST_PROXY_RAW === 'true' ? true : TRUST_PROXY_RAW === 'false' ? false : 1;
app.set('trust proxy', TRUST_PROXY);

// Security baseline + parsers + access log
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: '16kb' })); // for form POSTs
app.use(express.json({ limit: '64kb' }));                         // for JSON POSTs
app.use(createAccessLogger({ write: (line) => rollingLog.writeBestEffort('access', line), sanitize: sanitizeString }));

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Optional rate limit; not mounted at all unless a limit is set.
// USER_LOG_RATE_LIMIT_PER_MINUTE: requests per minute and client address. The default is no
// limit ("0" or "off" says the same explicitly). Every print record is an audit record that a
// document was printed. Users behind one address (terminal server, NAT, a load balancer in front
// of the proxy) would share one allowance, and a silently lost print record is worse than the
// load a limit protects against; the same-origin check already restricts who can post here.
const rateLimitSetting = resolveRateLimitPerMinute('USER_LOG_RATE_LIMIT_PER_MINUTE', process.env.USER_LOG_RATE_LIMIT_PER_MINUTE, 0);
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
      message: 'A print record was rejected by the rate limit and not written. Further rejections for this client are not reported for one minute.',
    }) + '\n';
    return rollingLog.write('error', line).catch((error) => {
      rollingLog.toStderr(`[error log not writable: ${describeWriteError(error).code}] ${line}`);
      throw error;
    });
  },
});
const printLimiter = !rateLimitSetting.enabled ? (_req, _res, next) => next() : rateLimit({
  windowMs: 60_000,
  max: rateLimitSetting.limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  // Keyed on the address without a port: a proxy that forwards address:port (IIS ARR)
  // would otherwise make this a limit per connection.
  keyGenerator: rateLimitKey,
  handler: (req, res, _next, options) => {
    // Reported per counted client: the same key as the limit, so one line per IPv6 /56 too.
    try { reportRateLimitRejection(rateLimitKey(req), normalizeClientAddress(req.ip)); } catch { /* reporting must not change the answer */ }
    res.status(options.statusCode).send(options.message);
  }
});

/**
 * POST /userlog/record
 * Accepts application/x-www-form-urlencoded (hidden <form>) or JSON.
 * Does NOT take any user identity in body; user is derived server-side.
 * Returns 200 with body "true" to be maximally tolerant of legacy callers.
 */
app.post('/userlog/record', sameOriginGuard, printLimiter, async (req, res) => {
  try {
    // Content-type allowlist (be tolerant about charset parameters)
    const ctype = (req.get('content-type') || '').toLowerCase();
    if (ctype && !/(^|\s)(application\/x-www-form-urlencoded|application\/json)(;|$)/.test(ctype)) {
      return res.status(415).send('Unsupported Media Type');
    }

    const { reason, forWhom } = readPrintLogFields(req.body);

    const rec = {
      ts: new Date().toISOString(),
      userId: resolveUser(req),
      ip: normalizeClientAddress(req.ip),
      ua: decodeHeaderValue(req.get('user-agent')) || undefined,
      referer: decodeHeaderValue(req.get('referer')) || undefined,
      action: 'print',
      reason: reason === null ? null : safeString(reason, 500),
      // "$" and "#" are replaced, never rejected: the print record is always written.
      forWhom: forWhom === null ? null : neutralizeForWhom(safeString(forWhom, 200)),
    };

    // Answer only when the record is in the file. A record that could not be written is never
    // answered as stored: the caller gets 500 and the error log says why.
    try {
      await rollingLog.write('print', safeJson(rec) + '\n');
    } catch (writeError) {
      await reportWriteFailure('print', writeError);
      return res.status(500).send('Failed to log print action');
    }

    // Return literal JSON boolean "true" (works for both fetch and very old callers)
    res.status(200).type('application/json').send('true');
  } catch (err) {
    const e = {
      ts: new Date().toISOString(),
      level: 'error',
      error: {
        name: err?.name || 'Error',
        message: safeString(err?.message || String(err)),
        stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 30) : undefined
      }
    };
    writeRolling('error', safeJson(e) + '\n');
    res.status(500).send('Failed to log print action');
  }
});

// Final error handler
app.use((err, _req, res, _next) => {
  const e = {
    ts: new Date().toISOString(),
    level: 'error',
    error: {
      name: err?.name || 'Error',
      message: safeString(err?.message || String(err)),
      stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 30) : undefined
    }
  };
  writeRolling('error', safeJson(e) + '\n');
  res.status(500).send('Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`User Log Server listening on http://localhost:${PORT}`);
  if (NODE_ENV !== 'production') {
    console.log('POST print logs to /userlog/record (form or JSON).');
  }
});
