# OpenDocViewer / server

File count: 10. Line count: 1059. JSDoc symbol count: 32.

## server/accessLog.js

HTTP access log of the log servers: the "combined" line, with a clean address and one line.

Exports: `createAccessLogger`

Local imports: `server/clientAddress.js`, `server/headerText.js`

Symbols:

- `createAccessLogger` (function) - No description.

## server/clientAddress.js

The client's address without a port, for the rate limit key and the log records.

Exports: `normalizeClientAddress`

Symbols:

- `normalizeClientAddress` (function) - A reverse proxy may add the client's source port to the address it forwards \(IIS ARR does by default: &quot;203.0.113.5:49152&quot;, &quot;\[2001:db8::1\]:49152&quot;\).

## server/headerText.js

Text of an HTTP header value as the sender wrote it.

Exports: `decodeHeaderValue`

Symbols:

- `strictUtf8` (constant) - Text of an HTTP header value as the sender wrote it.
- `decodeHeaderValue` (function) - Node hands header values over decoded as latin1, one character per byte.

## server/logRetention.js

Shared best\-effort retention for the optional standalone log servers.

Exports: `LOG_RETENTION_SWEEP_INTERVAL_MS`, `PRINT_LOG_RETENTION_DEFAULT_DAYS`, `resolvePrintLogRetentionDays`, `pruneRotatedLogs`, `scheduleLogRetention`

Symbols:

- `PRINT_LOG_RETENTION_DEFAULT_DAYS` (constant) - Print records \( print\-\*.log \) are the audit trail of who printed what, and for whom.
- `resolvePrintLogRetentionDays` (function) - Retention for the print records of the user log server.
- `pruneRotatedLogs` (function) - Delete rotated log files whose modification time is beyond the retention period.
- `scheduleLogRetention` (function) - Repeat retention while a long\-running service stays up.

## server/rateLimitConfig.js

Settings and reporting for the per\-client rate limits of the log servers.

Exports: `resolveRateLimitPerMinute`, `createRejectionReporter`

Symbols:

- `resolveRateLimitPerMinute` (function) - Read a requests\-per\-minute limit from an environment value.
- `createRejectionReporter` (function) - Report a rejected client at most once per window, so that records lost to the rate limit are visible in the error log without one line per rejected request.

## server/rollingLog.js

Daily rotating log files for the log servers, with a write that reports its outcome.

Exports: `createRollingLog`, `describeWriteError`

Symbols:

- `createRollingLog` (function) - No description.
- `createRollingLog~write` (function) - Append one line to today's file for the prefix.
- `createRollingLog~toStderr` (function) - Last resort when a log line cannot be written to its file.
- `createRollingLog~writeOrStderr` (function) - Write a line that must not be lost quietly \(an error\-log line\).
- `createRollingLog~writeBestEffort` (function) - Write a line whose loss is tolerable \(an access\-log line\).
- `createRollingLog~closeAll` (function) - Close every open file \(for a clean shutdown and for tests\).
- `describeWriteError` (function) - What to put in the error log about a failed write: the error code and message, never the record that could not be written.

## server/system\-log\-server.js

System Log Server — standalone Express endpoint for structured system logs.

Local imports: `server/accessLog.js`, `server/logRetention.js`, `server/headerText.js`, `server/clientAddress.js`, `server/rateLimitConfig.js`, `server/rollingLog.js`

Symbols:

- `writeRolling` (function) - Write a line that must not be lost quietly \(an error\-log line\).
- `reportWriteFailure` (function) - Error\-log line for a record that could not be written: which log and why, never the record.
- `TRUST_PROXY_RAW` (constant) - Trust proxy for accurate req.ip
- `LOG_TOKEN` (constant) - Token gate for /log
- `ALLOWED_ORIGINS` (constant) - Optional CORS for /log
- `rateLimitSetting` (constant) - Rate limit for ingestion
- `requireLogToken` (function) - Token auth middleware

## server/user\-log\-server.js

User Action Log Server — standalone Express endpoint for print/user\-action audit events.

Local imports: `server/accessLog.js`, `server/logRetention.js`, `server/userLogPayload.js`, `server/userLogOrigin.js`, `server/headerText.js`, `server/clientAddress.js`, `server/rateLimitConfig.js`, `server/rollingLog.js`

Symbols:

- `writeRolling` (function) - Write a line that must not be lost quietly \(an error\-log line\).
- `reportWriteFailure` (function) - Error\-log line for a record that could not be written: which log and why, never the record.
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
