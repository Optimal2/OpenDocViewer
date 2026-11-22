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
  - `$` and `#` in `forWhom` are stored as `_`. The request is not rejected for them: the viewer
    sends the record without reading the response, so a rejection would lose the print record
    without anyone noticing.
  - line breaks and control characters in `reason` and `forWhom` are removed before the record
    is written as one JSON line
  - failures:
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

Retention of the access, ingestion and error logs is controlled by `LOG_RETENTION_DAYS` and defaults to `14`.

The print records (`print-*.log`) are the audit trail and are kept for `30` days by default:

- `PRINT_LOG_RETENTION_DAYS`, when set to a positive number, decides.
- Otherwise they follow `LOG_RETENTION_DAYS` when it is higher than 30, and are never pruned earlier than 30 days. A service installed with `LOG_RETENTION_DAYS=14` therefore still keeps its print records for 30 days.

`scripts/Manage-ODV-LogServers.ps1` installs both services with `LOG_RETENTION_DAYS=14` and the user log service with `PRINT_LOG_RETENTION_DAYS=30`.

Old files are pruned on startup and once every 24 hours while the service remains running, as a best-effort housekeeping step. Pruning deletes the files; it cannot be undone.

## Environment settings

| Variable | Services | Default / rule |
| --- | --- | --- |
| `PORT` | Both | `3001` for system log, `3002` for user log. |
| `NODE_ENV` | Both | `development`; production requires `LOG_TOKEN` for the system service. |
| `TRUST_PROXY` | Both | `1`; set this deliberately for the actual proxy topology. |
| `LOG_TOKEN` | System | Required at production startup and matched against `x-log-token` on every `/log` request. |
| `ALLOWED_ORIGINS` | System | Empty (no CORS); otherwise a comma-separated exact-origin allowlist for `/log`. |
| `JSON_LIMIT` | System | `64kb`. The user service uses fixed 64 kb JSON and 16 kb form limits. |
| `LOG_RETENTION_DAYS` | Both | `14`. Access, ingestion and error logs. |
| `PRINT_LOG_RETENTION_DAYS` | User | `30`. Print records; without it they follow `LOG_RETENTION_DAYS` but never below 30. |
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
- compares `Origin`/`Referer` with the request's `Host` and, only when the request arrives over loopback (`127.0.0.1`, `::1`), with the `X-Forwarded-Host` set by the reverse proxy on the same machine; a forwarded host from any other address is ignored
- intentionally allows requests with none of those signals by default for non-browser compatibility; set `ODV_STRICT_ORIGIN=true` to reject them
- intended for frontend print-intent data, not privileged server commands

## Reverse proxy examples

### IIS proxy app pattern

Use the dedicated IIS proxy app described in `IIS-ODVProxyApp/README.md`. The intended public shape is:

- `POST /ODVProxy/log` -> `http://localhost:3001/log`
- `POST /ODVProxy/userlog/record` -> `http://localhost:3002/userlog/record`

This keeps the browser talking to a same-origin path even though the Node services live on localhost ports behind IIS.

ARR replaces `Host` with the upstream address, while the user-log origin check needs the public host. The user-log rule therefore sets `X-Forwarded-Host` to the public host (overwriting any value the client sent), and the user log server trusts that header only from loopback. URL Rewrite sets a request header only when its server variable is allowed, so `scripts/Setup-IIS-ODVProxy.ps1` adds `HTTP_X_FORWARDED_HOST` to `allowedServerVariables` for the proxy application's location only.

What the setup script changes for the whole server depends on its switches:

- Always, when a proxy rule is enabled: it turns ARR proxying on (`system.webServer/proxy`, `enabled`).
- Only with `-ForwardClientHeaders`: it unlocks the configuration section `system.webServer/rewrite/allowedServerVariables` (`appcmd unlock config`), which lets every site and application on the server define that section in its own `web.config`. With the switch both rules also set `X-Forwarded-For` and `X-Forwarded-Proto`, and the system-log rule sets `X-Forwarded-Host`.

Operational notes:

- Run `scripts/Setup-IIS-ODVProxy.ps1` again after an upgrade, so that the generated `web.config` gets the user-log rule that forwards `X-Forwarded-Host`. Without it the user log server answers browser posts with `403`, as it did before the forwarded host existed, unless ARR's `preserveHostHeader` is on.
- The user-log upstream (`-UserLogUrl`) must be a loopback address (`localhost`, `127.0.0.1` or `[::1]`), because the forwarded host is trusted from loopback only. The script warns about any other address.
- The `allowedServerVariables` entry for the proxy application's location is written to `applicationHost.config` and stays there: the script has no uninstall, so the entry remains after the application is removed until an administrator deletes it.

The setup script does not set ARR's server-wide `preserveHostHeader`, which would change the `Host` header that every other proxied application on the server receives. A server where an earlier version of the script set `preserveHostHeader=true` keeps working, because the `Host` header itself is still accepted; whether to set it back is a decision for the server's administrator, since other applications may rely on it by now.

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
