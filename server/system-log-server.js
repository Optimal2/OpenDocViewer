// File: server/system-log-server.js
/**
 * System Log Server — Single-file, standalone (ESM)
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
 *
 * Note: This file is self-contained; no internal imports required.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

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
  // Sweep old files (best effort)
  try {
    const files = await fsp.readdir(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const re = /^(access|ingestion|error)-\d{4}-\d{2}-\d{2}\.log$/;
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

function writeRolling(prefix, line) {
  getRollingStream(prefix).write(line);
}

function truncate(str, max = 4000) {
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function sanitizeString(str) {
  return String(str)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
function safeString(str, max = 4000) {
  return truncate(sanitizeString(str), max);
}
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

/* ------------------------------- Express app ------------------------------ */

await initOnce();

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
app.use(morgan('combined', { stream: { write: (s) => writeRolling('access', s) } }));

/** Health */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/** Rate limit for ingestion */
const logLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many log requests, please slow down.' },
  keyGenerator: (req) => req.ip
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
app.post('/log', corsForLog, logLimiter, requireLogToken, (req, res) => {
  try {
    const allowed = new Set(['debug', 'info', 'warn', 'error']);
    const { level = 'info', message = '', context = undefined } = req.body || {};
    const levelNorm = (typeof level === 'string' && allowed.has(level.toLowerCase()))
      ? level.toLowerCase() : 'info';

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
