// File: server/user-log-server.js
/**
 * User Action Log Server — Single-file, standalone (ESM)
 *
 * Goal:
 *  - Provide a same-origin endpoint compatible with a generic viewer that posts user "print reason" records.
 *  - Mirror the semantics often used by server-rendered apps: the *user identity is not in the POST body*,
 *    it is derived from the server-side context (session / headers), while body carries only reason/forWhom.
 *
 * Endpoint:
 *  - POST /userlog/record
 *      Body (application/x-www-form-urlencoded or JSON):
 *        - reason: string|null
 *        - forWhom: string|null
 *      Returns: 204 No Content
 *
 * Logging:
 *  - Writes NDJSON to ./logs/print-YYYY-MM-DD.log
 *  - Also writes access and error logs separately
 *
 * Runtime env:
 *  - PORT=3002
 *  - NODE_ENV=production|development
 *  - TRUST_PROXY=1
 *  - LOG_RETENTION_DAYS=14
 *
 * User resolution (generic, no product-specific assumptions):
 *  - req.user?.id (if upstream auth middleware populates it)
 *  - X-User-Id header (for simple deployments/testing behind a trusted reverse proxy)
 *  - Signed/unsigned cookie "userId" or "uid" (if present)
 *  - Otherwise "anonymous"
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
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

function resolveUser(req) {
  // 1) Upstream-authenticated user object (if any)
  const userIdFromReq = /** @type {any} */ (req)?.user?.id || /** @type {any} */ (req)?.user?.name;
  if (userIdFromReq) return String(userIdFromReq);

  // 2) Trusted reverse proxy can inject a header
  const headerUser = req.get('x-user-id') || req.get('x-remote-user') || req.get('remote-user');
  if (headerUser) return sanitizeString(headerUser);

  // 3) Cookie (unsigned or signed)
  const ck = req.signedCookies?.userId || req.signedCookies?.uid || req.cookies?.userId || req.cookies?.uid;
  if (ck) return sanitizeString(ck);

  // 4) Fallback
  return 'anonymous';
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
app.use(cookieParser()); // if you configure a signing secret, pass it here
app.use(express.urlencoded({ extended: false })); // for form POSTs
app.use(express.json({ limit: '64kb' }));         // for JSON POSTs
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
 * Returns 204 No Content for iframe-friendly "fire-and-forget".
 */
app.post('/userlog/record', printLimiter, (req, res) => {
  try {
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

    // Optional server-side input policy similar to typical implementations:
    // block '$' and '#' in "forWhom" (adjust to your policy)
    if (typeof rec.forWhom === 'string' && /[$#]/.test(rec.forWhom)) {
      return res.status(400).send('Invalid characters in forWhom');
    }

    writeRolling('print', safeJson(rec) + '\n');
    res.status(204).end(); // empty response fits hidden-iframe or fetch no-cors
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
