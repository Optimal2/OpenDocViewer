# OpenDocViewer / server

File count: 2. Line count: 508. JSDoc symbol count: 7.

## server/system-log-server.js

System Log Server — Single-file, standalone (ESM) Responsibilities: - Expose POST /log for structured system logs (tiny JSON bodies) - Write NDJSON to daily-rotated files under ./logs/ - Keep access, ingestion, and error

Symbols:

- `TRUST_PROXY_RAW` (constant) - Trust proxy for accurate req.ip
- `LOG_TOKEN` (constant) - Token gate for /log
- `ALLOWED_ORIGINS` (constant) - Optional CORS for /log
- `logLimiter` (constant) - Rate limit for ingestion
- `requireLogToken` (function) - Token auth middleware

## server/user-log-server.js

User Action Log Server — Single-file, standalone (ESM) Endpoint: POST /userlog/record - Body: application/x-www-form-urlencoded or JSON - reason: string|null - forWhom: string|null - Response: 200 OK with body: true (JSO

Symbols:

- `resolveUser` (function) - Resolve user identity without cookies.
- `sameOriginGuard` (function) - Blocks cross-site requests using Origin/Referer/Sec-Fetch-Site signals.
