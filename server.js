/**
 * OpenDocViewer — Log Ingestion Server (ESM)
 *
 * Purpose:
 * - Receives structured logs from the frontend via POST /log
 * - Writes logs to daily-rotated NDJSON files using the shared logger (logger.js)
 * - Provides a lightweight health endpoint at GET /healthz
 *
 * Security & Stability Highlights (please keep in sync with logger.js):
 * - Token-gated ingestion via header: x-log-token
 * - Optional, **scoped** CORS for /log (disabled by default)
 * - IP-based rate limiting (honors `app.set('trust proxy', ...)`)
 * - Small JSON body limit to reduce abuse surface
 * - Helmet baseline headers
 * - Access logs and application logs go to **separate** files (no interleaving)
 *
 * Runtime Configuration (environment variables):
 * - PORT                : number  (default: 3001)
 * - NODE_ENV            : 'development' | 'production' | ...
 * - TRUST_PROXY         : number | true | false | string (how Express trusts X-Forwarded-For)
 * - LOG_TOKEN           : required in production (shared secret for /log)
 * - ALLOWED_ORIGINS     : comma-separated list for CORS on /log (optional)
 * - JSON_LIMIT          : body size limit for JSON logs (default: '64kb')
 *
 * IMPORTANT: Keep imports from './logger.js' stable; they encapsulate rolling files and sanitation.
 * IMPORTANT (history): Do **not** attempt to write access logs and ingestion logs to the same file.
 *
 * Source (for audit tooling): :contentReference[oaicite:0]{index=0}
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { accessLogStream, logRequest, logError } from './logger.js';

dotenv.config();

/** Resolve current file/dir (ESM-safe). */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Express app bootstrap. */
const app = express();
const PORT = Number(process.env.PORT || 3001);
const NODE_ENV = process.env.NODE_ENV || 'development';

/** Security hardening: remove Express signature header. */
app.disable('x-powered-by');

/**
 * Proxy awareness:
 * When running behind a reverse proxy (nginx, IIS, Render, Vercel, etc.), configure
 * Express to trust the appropriate hop count so `req.ip` is the client IP.
 * Examples:
 *  - TRUST_PROXY=1       -> trust the first proxy (common)
 *  - TRUST_PROXY=true    -> trust all proxies (rare; be careful)
 *  - TRUST_PROXY=false   -> trust no proxy (direct connect)
 *  - TRUST_PROXY=<mask>  -> see Express docs for advanced strings
 */
const TRUST_PROXY_RAW = process.env.TRUST_PROXY ?? '1';
let TRUST_PROXY;
if (/^\d+$/.test(TRUST_PROXY_RAW)) TRUST_PROXY = Number(TRUST_PROXY_RAW);
else TRUST_PROXY = TRUST_PROXY_RAW === 'true' ? true : TRUST_PROXY_RAW === 'false' ? false : 1;
app.set('trust proxy', TRUST_PROXY);

/**
 * Authentication for ingestion:
 * In production we require a shared token to be presented as `x-log-token`.
 * This is a simple capability bearer; treat it as a guard, not a secret.
 * Rotate regularly and scope CORS appropriately.
 */
const LOG_TOKEN = process.env.LOG_TOKEN;
if (NODE_ENV === 'production' && !LOG_TOKEN) {
  throw new Error('LOG_TOKEN is required in production for /log authentication.');
}

/**
 * Optional, **scoped** CORS:
 * If ALLOWED_ORIGINS is provided, we emit CORS headers on /log for those origins.
 * If not provided, we do not emit CORS headers (non-browser clients can still POST).
 *
 * Example:
 *   ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_CORS_FOR_LOG = ALLOWED_ORIGINS.length > 0;

/* ---------------------------- Global middleware --------------------------- */

/** Baseline security headers. Note: add a CSP later when asset map is finalized. */
app.use(helmet());

/**
 * Keep the JSON body small to avoid abuse (tune via env JSON_LIMIT).
 * Typical log bodies are tiny; 64kb is generous for context.
 */
app.use(express.json({ limit: process.env.JSON_LIMIT || '64kb' }));

/**
 * Access log (Apache combined) -> **separate** rolling file via logger.js.
 * Never point this to the ingestion file to avoid concurrency/corruption issues.
 */
app.use(morgan('combined', { stream: accessLogStream }));

/** Health check (no auth, no CORS). */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* ------------------------------ Rate limiting ----------------------------- */

/**
 * Per-IP rate limiting for ingestion:
 * - 120 requests per minute per client IP
 * - Uses req.ip (honors trust proxy)
 * - Returns standard headers (RateLimit-*)
 */
const logLimiter = rateLimit({
  windowMs: 60_000,           // 1 minute window
  max: 120,                   // up to 120 log posts per IP per minute
  standardHeaders: 'draft-7', // contemporary header set
  legacyHeaders: false,
  message: { error: 'Too many log requests, please slow down.' },
  keyGenerator: (req) => req.ip, // rely on trust proxy config
});

/* ---------------------------------- CORS ---------------------------------- */

/**
 * CORS for /log only (if configured).
 * Browsers send an Origin header; non-browser clients often do not.
 * We return **no** CORS headers for requests without Origin to keep responses minimal.
 */
const corsForLog = ALLOW_CORS_FOR_LOG
  ? cors({
      origin: (origin, cb) => {
        // Non-browser requests (no Origin) skip CORS entirely.
        if (!origin) return cb(null, false);
        cb(null, ALLOWED_ORIGINS.includes(origin));
      },
      maxAge: 86_400, // cache preflight for 24h
    })
  : (_req, _res, next) => next(); // pass-through when not configured

/** Preflight for /log (only when CORS is active). */
if (ALLOW_CORS_FOR_LOG) {
  app.options('/log', corsForLog);
}

/* ------------------------------- Auth guard ------------------------------- */

/**
 * @callback NextFunction
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */

/**
 * Simple token authentication for /log.
 *
 * @param {import('express').Request} req  Express request
 * @param {import('express').Response} res Express response
 * @param {import('express').NextFunction} next Next middleware
 */
function requireLogToken(req, res, next) {
  const token = req.get('x-log-token');
  if (!token || token !== (LOG_TOKEN || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* --------------------------------- Routes --------------------------------- */

/**
 * POST /log
 * Pipeline: [CORS?] -> rate limit -> token auth -> logRequest handler
 *
 * logRequest (from logger.js) writes one sanitized NDJSON record to
 * the daily-rotated ingestion log.
 */
app.post('/log', corsForLog, logLimiter, requireLogToken, logRequest);

/* ------------------------------ Error handler ----------------------------- */

/**
 * Final error handler:
 * - Emits a generic 500 (no internal details)
 * - Sends the error to the error log via logError (logger.js)
 */
app.use((err, _req, res, _next) => {
  logError(err);
  res.status(500).send('Internal Server Error');
});

/* --------------------------------- Listen --------------------------------- */

/**
 * Start the server. In non-production we still encourage setting LOG_TOKEN:
 * this ensures you test the auth path early.
 */
app.listen(PORT, () => {
  console.log(`OpenDocViewer Log Server listening on http://localhost:${PORT}`);
  if (NODE_ENV !== 'production' && !LOG_TOKEN) {
    console.warn('WARNING: LOG_TOKEN not set (dev mode). /log will reject requests without a token.');
  }
});
