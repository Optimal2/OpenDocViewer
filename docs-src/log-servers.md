# Log server notes

This document describes the two optional Node/Express services that accompany the static frontend. They are intentionally separate from the viewer bundle so the main app can still be hosted as static files.

## Services

- `server/system-log-server.js`
  - accepts structured frontend/system diagnostics
  - token-gated on every ingestion request; production startup requires a configured token
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
    - `x-log-token: <token>` on every request; production startup also requires `LOG_TOKEN`
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
  - supported JSON fields:
    - `meta.reason` and `meta.forWhom` from the bundled viewer's JSON envelope
    - top-level `reason` and `forWhom` remain accepted for compatibility with form posts and older callers
  - response on success: JSON literal `true` with HTTP `200`
  - failures:
    - `400` when `forWhom` contains `$` or `#`
    - `403` for failed same-origin checks
    - `415` for unsupported content type
    - `429` when the rate limit is exceeded
    - `500` if the server cannot write the log record

## File layout and retention

Both services write under `server/logs/` and rotate by UTC date. When both run from this repository,
they share the `access-*` and `error-*` files; `ingestion-*` belongs to the system log and `print-*`
to the user log.

### System log server files

- `access-YYYY-MM-DD.log`
- `ingestion-YYYY-MM-DD.log`
- `error-YYYY-MM-DD.log`

### User log server files

- `access-YYYY-MM-DD.log`
- `print-YYYY-MM-DD.log`
- `error-YYYY-MM-DD.log`

Retention is controlled by `LOG_RETENTION_DAYS` and defaults to `14`. Old files are pruned on startup and once every 24 hours while the service remains running, as a best-effort housekeeping step.

## Environment settings

| Variable | Services | Default / rule |
| --- | --- | --- |
| `PORT` | Both | `3001` for system log, `3002` for user log. |
| `NODE_ENV` | Both | `development`; production requires `LOG_TOKEN` for the system service. |
| `TRUST_PROXY` | Both | `1`; set this deliberately for the actual proxy topology. |
| `LOG_TOKEN` | System | Required at production startup and matched against `x-log-token` on every `/log` request. |
| `ALLOWED_ORIGINS` | System | Empty (no CORS); otherwise a comma-separated exact-origin allowlist for `/log`. |
| `JSON_LIMIT` | System | `64kb`. The user service uses fixed 64 kb JSON and 16 kb form limits. |
| `LOG_RETENTION_DAYS` | Both | `14`. |
| `ODV_STRICT_ORIGIN` | User | `false`; set to `true` to reject requests without `Origin`, `Referer` or `Sec-Fetch-Site`. |

The system endpoint allows 120 requests per minute per client. The user endpoint allows 60. Both use
`helmet()` and daily UTC rotation.

## Log rotation assumptions

- rotation is date-based, not size-based
- the services append to the current day file
- old streams are closed when the date rolls over
- pruning is intentionally simple and local to the service process

If a deployment needs stricter retention, central aggregation, compression, or archival, place that responsibility outside the app repo.

## Security assumptions

### System log server

- designed for same-origin or explicitly allowed browser callers
- every `/log` request is gated by `x-log-token`; production cannot start without `LOG_TOKEN`
- request bodies are small JSON payloads
- rate limiting and `helmet()` are always on
- CORS is opt-in via `ALLOWED_ORIGINS`

This token is a lightweight ingestion guard, not high-assurance authentication. Do not treat it as a secret equivalent to server credentials.

### User log server

- intentionally avoids cookie-based auth to keep CSRF handling simple
- relies on same-origin style checks using `Origin`, `Referer`, and `Sec-Fetch-Site`; `Sec-Fetch-Site: same-site` is not sufficient
- intentionally allows requests with none of those signals by default for non-browser compatibility; set `ODV_STRICT_ORIGIN=true` to reject them
- intended for frontend print-intent data, not privileged server commands

## Reverse proxy examples

### IIS proxy app pattern

Use the dedicated IIS proxy app described in `IIS-ODVProxyApp/README.md`. The intended public shape is:

- `POST /ODVProxy/log` -> `http://localhost:3001/log`
- `POST /ODVProxy/userlog/record` -> `http://localhost:3002/userlog/record`

This keeps the browser talking to a same-origin path even though the Node services live on localhost ports behind IIS. ARR must preserve the original Host header (`preserveHostHeader=true`); the repository setup script enables it because the user-log origin check compares Host with Origin/Referer.

### Runtime config example

The shipped frontend defaults keep both log channels disabled. Enable them explicitly in your deployment override file when the corresponding backend service and proxy route are ready.


```js
window.__ODV_SITE_CONFIG__ = {
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
