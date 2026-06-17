# OpenDocViewer / src/logging

File count: 2. Line count: 740. JSDoc symbol count: 46.

## src/logging/systemLogger.js

src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller (ESM) - Provide a small, dependency-light logging facade for the browser app.

Exports: logger

Symbols:

- `LogLevel` (typedef) - No description.
- `LOG_LEVELS` (constant) - Valid log levels in ascending verbosity.
- `NOOP` (function) - No-op function used when we want to swallow calls cleanly.
- `readMeta` (function) - Resolve a string from a meta tag (SSR-safe).
- `readMetaBool` (function) - Resolve a boolean from a meta tag content.
- `readRuntimeConfig` (function) - Resolve a runtime config snapshot from runtime globals (SSR-safe).
- `resolveBackendUrl` (function) - Resolve a candidate backend URL using precedence rules and make it absolute relative to document.baseURI (SSR-safe).
- `resolveAuthToken` (function) - Resolve the shared auth token used for posting to /log.
- `resolveEnabledOverride` (function) - Resolve an explicit &quot;enabled&quot; boolean if one exists.
- `normalizeLevel` (function) - Normalize and validate a log level.
- `levelGte` (function) - Compare two log levels (is a &gt;= b ?).
- `circularReplacer` (function) - Create a JSON replacer that: prevents circular references leaves values otherwise intact

## src/logging/userLogger.js

UserLogController — client-side controller for **user** print logs (backend-agnostic).

Exports: userLog

Symbols:

- `UserIdentity` (typedef) - No description.
- `BootContext` (typedef) - No description.
- `PrintLogPayload` (typedef) - No description.
- `__DEV__` (constant) - True when running in dev (for debug logging only).
- `debug` (function) - Dev-only logger.
- `getRuntimeConfig` (function) - Safely read runtime config from window.
- `toAbsoluteUrl` (function) - Make absolute using document.baseURI when available.
- `isSameOrigin` (function) - Determine if the target URL is same-origin with current document.
- `tzOffset` (function) - Return timezone offset as &quot;+HH:MM&quot; or &quot;-HH:MM&quot;.
- `abToBase64` (function) - Base64 from ArrayBuffer (for cookie fingerprint).
- `sha256Base64` (function) - Async SHA-256 of a string → &quot;sha256- &quot; (or null).
- `UserLogController#setUserResolver` (function) - Optional identity resolver supplied by host app.
