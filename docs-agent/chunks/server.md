# OpenDocViewer / server

File count: 2. Line count: 508. JSDoc symbol count: 7.

## server/system\-log\-server.js

System Log Server — standalone Express endpoint for structured system logs.

Symbols:

- `TRUST_PROXY_RAW` (constant) - Trust proxy for accurate req.ip
- `LOG_TOKEN` (constant) - Token gate for /log
- `ALLOWED_ORIGINS` (constant) - Optional CORS for /log
- `logLimiter` (constant) - Rate limit for ingestion
- `requireLogToken` (function) - Token auth middleware

## server/user\-log\-server.js

User Action Log Server — standalone Express endpoint for print/user\-action audit events.

Symbols:

- `resolveUser` (function) - Resolve user identity without cookies.
- `sameOriginGuard` (function) - Blocks cross\-site requests using Origin/Referer/Sec\-Fetch\-Site signals.
