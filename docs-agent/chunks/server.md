# OpenDocViewer / server

File count: 5. Line count: 548. JSDoc symbol count: 11.

## server/logRetention.js

Shared best\-effort retention for the optional standalone log servers.

Exports: `LOG_RETENTION_SWEEP_INTERVAL_MS`, `pruneRotatedLogs`, `scheduleLogRetention`

Symbols:

- `pruneRotatedLogs` (function) - Delete rotated log files whose modification time is beyond the retention period.
- `scheduleLogRetention` (function) - Repeat retention while a long\-running service stays up.

## server/system\-log\-server.js

System Log Server — standalone Express endpoint for structured system logs.

Local imports: `server/logRetention.js`

Symbols:

- `TRUST_PROXY_RAW` (constant) - Trust proxy for accurate req.ip
- `LOG_TOKEN` (constant) - Token gate for /log
- `ALLOWED_ORIGINS` (constant) - Optional CORS for /log
- `logLimiter` (constant) - Rate limit for ingestion
- `requireLogToken` (function) - Token auth middleware

## server/user\-log\-server.js

User Action Log Server — standalone Express endpoint for print/user\-action audit events.

Local imports: `server/logRetention.js`, `server/userLogPayload.js`, `server/userLogOrigin.js`

Symbols:

- `resolveUser` (function) - Resolve user identity without cookies.
- `sameOriginGuard` (function) - Blocks cross\-site requests using Origin/Referer/Sec\-Fetch\-Site signals.

## server/userLogOrigin.js

Evaluate the browser origin signals used by the user print\-log endpoint.

Exports: `isAllowedUserLogOrigin`

Symbols:

- `isAllowedUserLogOrigin` (function) - Evaluate the browser origin signals used by the user print\-log endpoint.

## server/userLogPayload.js

Compatibility reader for form posts and the viewer's JSON print envelope.

Exports: `readPrintLogFields`

Symbols:

- `readPrintLogFields` (function) - Compatibility reader for form posts and the viewer's JSON print envelope.
