# Log server notes

This document describes the two optional Node/Express services that accompany the static frontend. They are intentionally separate from the viewer bundle so the main app can still be hosted as static files.

## Services

- `server/system-log-server.js`
  - accepts structured frontend/system diagnostics
  - token-gated in production
  - writes NDJSON lines to daily rotated files
- `server/user-log-server.js`
  - accepts user-facing print intent metadata
  - same-origin oriented rather than token oriented
  - also writes daily rotated NDJSON files

## Endpoint contracts

### System log server

- `GET /healthz`
  - response: `{ "ok": true }`
- `POST /log`
  - request headers:
    - `Content-Type: application/json`
    - `x-log-token: <token>` in production
  - request body shape:

```json
{
  "level": "info",
  "message": "human readable summary",
  "context": {
    "runId": "optional",
    "pageNumber": 5
  }
}
```

  - accepted levels: `debug`, `info`, `warn`, `error`
  - response on success: HTTP `204 No Content`
  - failures:
    - `401` when the token is missing or wrong
    - `429` when the rate limit is exceeded
    - `500` if the server cannot write the log record

### User log server

- `GET /healthz`
  - response: `{ "ok": true }`
- `POST /userlog/record`
  - request content types:
    - `application/x-www-form-urlencoded`
    - `application/json`
  - supported fields:
    - `reason`
    - `forWhom`
  - response on success: JSON literal `true` with HTTP `200`
  - failures:
    - `403` for failed same-origin checks
    - `415` for unsupported content type
    - `429` when the rate limit is exceeded
    - `500` if the server cannot write the log record

## File layout and retention

Both services write under `server/logs/` and rotate by UTC date.

### System log server files

- `access-YYYY-MM-DD.log`
- `ingestion-YYYY-MM-DD.log`
- `error-YYYY-MM-DD.log`

### User log server files

- `access-YYYY-MM-DD.log`
- `print-YYYY-MM-DD.log`
- `error-YYYY-MM-DD.log`

Retention is controlled by `LOG_RETENTION_DAYS` and defaults to `14`. Old files are pruned on startup as a best-effort housekeeping step.

## Log rotation assumptions

- rotation is date-based, not size-based
- the services append to the current day file
- old streams are closed when the date rolls over
- pruning is intentionally simple and local to the service process

If a deployment needs stricter retention, central aggregation, compression, or archival, place that responsibility outside the app repo.

## Security assumptions

### System log server

- designed for same-origin or explicitly allowed browser callers
- production access is gated by `x-log-token`
- request bodies are small JSON payloads
- rate limiting and `helmet()` are always on
- CORS is opt-in via `ALLOWED_ORIGINS`

This token is a lightweight ingestion guard, not high-assurance authentication. Do not treat it as a secret equivalent to server credentials.

### User log server

- intentionally avoids cookie-based auth to keep CSRF handling simple
- relies on same-origin style checks using `Origin`, `Referer`, and `Sec-Fetch-Site`
- intended for frontend print-intent data, not privileged server commands

## Reverse proxy examples

### IIS proxy app pattern

Use the dedicated IIS proxy app described in `IIS-ODVProxyApp/README.md`. The intended public shape is:

- `POST /ODVProxy/log` -> `http://localhost:3001/log`
- `POST /ODVProxy/userlog/record` -> `http://localhost:3002/userlog/record`

This keeps the browser talking to a same-origin path even though the Node services live on localhost ports behind IIS.

### Runtime config example

```js
window.__ODV_CONFIG__ = {
  systemLog: {
    enabled: true,
    endpoint: '/ODVProxy/log',
    token: 'deployment-specific-token'
  },
  userLog: {
    enabled: true,
    endpoint: '/ODVProxy/userlog/record'
  }
};
```

## Operational checks

- `GET /healthz` returns success for both services
- the proxy forwards to the expected localhost port
- the system log token in runtime config matches the backend environment
- `server/logs/` is writable by the service identity
- retention days are appropriate for the environment
