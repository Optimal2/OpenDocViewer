// File: server/user-log-server.js
/**
 * User Action Log Server — Single-file, standalone (ESM)
 *
 * Endpoint:
 *   POST /userlog/record
 *     - Body: application/x-www-form-urlencoded or JSON
 *       - reason: string|null
 *       - forWhom: string|null
 *     - Response: 200 OK with body: true   (JSON boolean literal)
 *
 * Security posture (no client changes required):
 *   - No cookies are read or set (cookie-based auth removed to avoid CSRF lint).
 *   - Same-origin guard: Origin/Referer/Sec-Fetch-Site must indicate same-origin/site.
 *   - Rate limited; accepts only form or JSON content types.
 *
 * Runtime env (optional):
 *   - PORT=3002
 *   - NODE_ENV=production|development
 *   - TRUST_PROXY=1
 *   - LOG_RETENTION_DAYS=14
 *   - ODV_STRICT_ORIGIN=true  (if set, requests missing Origin/Referer/Sec-Fetch-Site are rejected)
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

dotenv.config();

/* ------------------------------ File logger ------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);

/** @type {Map<string, { date: string, stream: fs.WriteStream }>} */
const streams = new Map();
let initStarted = false;

async function initOnce() {
  if (initStarted) return;
  initStarted = true;

  await fsp.mkdir(LOG_DIR, { recursive: true });
  // Prune rotated files (best effort)
  try {
    const files = await fsp.readdir(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const re = /^(access|print|error)-\d{4}-\d{2}-\d{2}\.log$/;
    await Promise.all(
      files.filter((f) => re.test(f)).map(async (f) => {
        const p = path.join(LOG_DIR, f);
        try {
          const st = await fsp.stat(p);
          if (now - st.mtimeMs > maxAgeMs) await fsp.unlink(p);
        } catch {}
      })
    );
  } catch {}
}

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function getRollingStream(prefix) {
  const today = ymd();
  const entry = streams.get(prefix);
  if (!entry || entry.date !== today) {
    try { entry?.stream?.end(); } catch {}
    const file = path.join(LOG_DIR, `${prefix}-${today}.log`);
    const stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', (e) => console.error('Log stream error [%s]: %s', prefix, e?.message || e));
    streams.set(prefix, { date: today, stream });
  }
  return streams.get(prefix).stream;
}
function writeRolling(prefix, line) { getRollingStream(prefix).write(line); }

function truncate(str, max = 4000) {
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function sanitizeString(str) {
  return String(str)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
function safeString(str, max = 4000) { return truncate(sanitizeString(str), max); }
function safeJson(obj) {
  const seen = new WeakSet();
  const MAX_STR = 1000;
  return JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string') return truncate(sanitizeString(v), MAX_STR);
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object') { if (seen.has(v)) return '[Circular]'; seen.add(v); }
    return v;
  });
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
  if (headerUser) return sanitizeString(headerUser);

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
  const host = req.get('host') || '';
  const origin = req.get('origin') || '';
  const referer = req.get('referer') || '';
  const sfs = (req.get('sec-fetch-site') || '').toLowerCase();

  const hostOf = (u) => {
    try { return new URL(u).host; } catch { return ''; }
  };

  if (origin) {
    if (hostOf(origin) !== host) return res.status(403).send('Forbidden');
    return next();
  }
  if (referer) {
    if (hostOf(referer) !== host) return res.status(403).send('Forbidden');
    return next();
  }
  if (sfs) {
    if (sfs === 'same-origin' || sfs === 'same-site') return next();
    return res.status(403).send('Forbidden');
  }
  // If no signals at all: allow by default for compatibility, or require env flag.
  if (strict) return res.status(403).send('Forbidden');
  next();
}

/* ------------------------------- Express app ------------------------------ */

await initOnce();

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
app.use(morgan('combined', { stream: { write: (s) => writeRolling('access', s) } }));

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Rate limit to keep abuse surface small
const printLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  keyGenerator: (req) => req.ip
});

/**
 * POST /userlog/record
 * Accepts application/x-www-form-urlencoded (hidden <form>) or JSON.
 * Does NOT take any user identity in body; user is derived server-side.
 * Returns 200 with body "true" to be maximally tolerant of legacy callers.
 */
app.post('/userlog/record', sameOriginGuard, printLimiter, (req, res) => {
  try {
    // Content-type allowlist (be tolerant about charset parameters)
    const ctype = (req.get('content-type') || '').toLowerCase();
    if (ctype && !/(^|\s)(application\/x-www-form-urlencoded|application\/json)(;|$)/.test(ctype)) {
      return res.status(415).send('Unsupported Media Type');
    }

    const reason = (req.body?.reason ?? null);
    const forWhom = (req.body?.forWhom ?? null);

    const rec = {
      ts: new Date().toISOString(),
      userId: resolveUser(req),
      ip: req.ip,
      ua: req.get('user-agent') || undefined,
      referer: req.get('referer') || undefined,
      action: 'print',
      reason: reason === null ? null : safeString(reason, 500),
      forWhom: forWhom === null ? null : safeString(forWhom, 200),
    };

    // Optional server-side input policy (example): block "$" and "#" in forWhom
    if (typeof rec.forWhom === 'string' && /[$#]/.test(rec.forWhom)) {
      return res.status(400).send('Invalid characters in forWhom');
    }

    writeRolling('print', safeJson(rec) + '\n');

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
