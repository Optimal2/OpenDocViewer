# OpenDocViewer / server

File count: 5. Line count: 621. JSDoc symbol count: 15.

## server/logRetention.js

Shared best\-effort retention for the optional standalone log servers.

Exports: `LOG_RETENTION_SWEEP_INTERVAL_MS`, `PRINT_LOG_RETENTION_DEFAULT_DAYS`, `resolvePrintLogRetentionDays`, `pruneRotatedLogs`, `scheduleLogRetention`

Symbols:

- `PRINT_LOG_RETENTION_DEFAULT_DAYS` (constant) - Print records \( print\-\*.log \) are the audit trail of who printed what, and for whom.
- `resolvePrintLogRetentionDays` (function) - Retention for the print records of the user log server.
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

Exports: `resolveUserLogHosts`, `isAllowedUserLogOrigin`

Symbols:

- `LOOPBACK_ADDRESSES` (constant) - Evaluate the browser origin signals used by the user print\-log endpoint.
- `resolveUserLogHosts` (function) - The hosts the browser may have addressed: the request's own Host header and, only when the request arrives over loopback, the X\-Forwarded\-Host that the reverse proxy on the same m...

## server/userLogPayload.js

Compatibility reader for form posts and the viewer's JSON print envelope.

Exports: `readPrintLogFields`, `neutralizeForWhom`

Symbols:

- `readPrintLogFields` (function) - Compatibility reader for form posts and the viewer's JSON print envelope.
- `neutralizeForWhom` (function) - The print log has never carried &quot;$&quot; or &quot;\#&quot; in the recipient.
