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
  - response on success: HTTP `204 No Content`, sent only after the record has been written to the file
  - failures:
    - `401` when the token is missing or wrong
    - `429` when the rate limit is exceeded
    - `500` when the record could not be written (a full disk, a log folder that cannot be written). The record is not stored, and the server writes a `log-write-failed` line with the error code to `error-*.log`, or to standard error when that file cannot be written either.

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
  - response on success: JSON literal `true` with HTTP `200`, sent only after the record has been written to the file
  - a caller that closes its connection or its sending side before the response gets no response, but the record is written
  - `$` and `#` in `forWhom` are stored as `_`. The request is not rejected for them: the viewer
    sends the record without reading the response, so a rejection would lose the print record
    without anyone noticing.
  - line breaks and control characters in `reason` and `forWhom` are removed before the record
    is written as one JSON line
  - failures:
    - `403` for failed same-origin checks
    - `415` for unsupported content type
    - `429` when a rate limit is set and exceeded (none by default)
    - `500` when the record could not be written (a full disk, a log folder that cannot be written). The record is not stored; the server never answers `200` for a record it did not write. It writes a `log-write-failed` line with the error code, not the record, to `error-*.log`, or to standard error when that file cannot be written either. After the fault is remedied the next record is written again without a restart.

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

The access log (`access-*.log`) has one line per HTTP request in the common "combined" shape:
client address, user, time, request line, status, size, referrer and user agent. The client
address is written without the source port that IIS ARR adds. Referrer and user agent are
decoded like the other log fields, and control characters and Unicode line separators in a field
are written as escape sequences, so one request is always one line.

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
| `USER_LOG_RATE_LIMIT_PER_MINUTE` | User | No limit (`0`). A positive number sets requests per minute and client address. See "Rate limits". |
| `SYSTEM_LOG_RATE_LIMIT_PER_MINUTE` | System | `120` requests per minute and client address; `0` or `off` means no limit. |
| `LOG_WRITE_TIMEOUT_MS` | Both | `10000`. How long a request waits for its record to be confirmed in the log file before it is answered with `500`; a whole number of milliseconds from 100 to 600000. Any other value keeps the default, with a warning at start. |
| `ODV_STRICT_ORIGIN` | User | `false` in the code; **`true` in the recommended deployment** and in services installed by `scripts/Manage-ODV-LogServers.ps1`. With `true` a request without `Origin`, `Referer` and `Sec-Fetch-Site` is rejected. See "Strict origin". |

Both use `helmet()` and daily UTC rotation.

## Rate limits

| Server | Variable | Default |
| --- | --- | --- |
| User log (`POST /userlog/record`) | `USER_LOG_RATE_LIMIT_PER_MINUTE` | No limit (`0`). |
| System log (`POST /log`) | `SYSTEM_LOG_RATE_LIMIT_PER_MINUTE` | `120` requests per minute per client address. |

A request over a limit is answered with `429` and its record is not written.

**Why the print log has no limit by default.** Every line in the print log is an audit record
that a document was printed. Sites run many users behind terminal servers or NAT, where they
share one address and would share one allowance. A print record that is silently lost is worse
than the load a limit protects against, and the same-origin check already restricts who can post
to the endpoint. Earlier versions had a fixed limit of 60 per minute, which never applied behind
IIS ARR (see below).

**What a client is.** A client is its address without a port: IIS ARR adds the client's source
port to the address it puts in `X-Forwarded-For` (`203.0.113.5:49152`, `[2001:db8::1]:49152`),
and with `TRUST_PROXY` that value becomes the request's address. Both servers remove the port
(`server/clientAddress.js`) before they use the address as the rate limit key and before they
write it to a log line; otherwise a limit would count per connection, which is why the limits
never applied behind ARR before. With `TRUST_PROXY=1` the address is the last entry of
`X-Forwarded-For`, the one the proxy added, never an entry the client sent.

**Shared addresses share one allowance.** Users on a terminal server, behind NAT, or behind a
load balancer in front of IIS reach the log servers with the same address. With a limit set they
get one allowance per minute together. When it is used up, further records are answered with
`429` and are lost: the viewer sends the record without reading the response, so no user
notices. This applies to the system log by default, and to the print log as soon as a limit is
set for it.

**Setting the limits.**

- Both variables take a positive whole number of requests per minute and client address.
- `0` or `off` means no limit. The limiter is then not mounted at all.
- Any other value keeps that server's default (no limit for the user log, `120` for the system
  log), and the server writes a warning line when it starts.
- `scripts/Manage-ODV-LogServers.ps1` installs the services with the values of
  `$Script:USER_LOG_RATE_LIMIT_PER_MINUTE` (`0`) and `$Script:SYSTEM_LOG_RATE_LIMIT_PER_MINUTE`
  (`120`) near the top of the script; edit them there before installing, or change the service
  environment afterwards.

**A limit never loses records silently.** When a record is rejected, the server writes one line
to `error-*.log` with `"event":"rate-limit-rejected"`, the client address and the limit, at most
once per client and minute. A client here is what the limit counts: one IPv4 address, or one
`/56` block of IPv6 addresses. The line names the address of the request that was rejected.
Such a line means that records were lost for that client.

**A decision for each site.** Setting a limit for the print log, or changing the one for the
system log, has to be decided for each installation with its shared addresses in mind.

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
- `helmet()` is always on; the rate limit is on by default (120 per minute and client address) and can be changed or switched off with `SYSTEM_LOG_RATE_LIMIT_PER_MINUTE`
- CORS is opt-in via `ALLOWED_ORIGINS`

This token is a lightweight ingestion guard, not high-assurance authentication. Do not treat it as a secret equivalent to server credentials.

### User log server

- intentionally avoids cookie-based auth to keep CSRF handling simple
- relies on same-origin style checks using `Origin`, `Referer`, and `Sec-Fetch-Site`; `Sec-Fetch-Site: same-site` is not sufficient
- compares `Origin`/`Referer` with the request's `Host` and, only when the request arrives over loopback (`127.0.0.1`, `::1`), with the `X-Forwarded-Host` set by the reverse proxy on the same machine; a forwarded host from any other address is ignored
- allows requests with none of those signals unless `ODV_STRICT_ORIGIN=true`, which the recommended deployment sets (see "Strict origin")
- intended for frontend print-intent data, not privileged server commands

## Reverse proxy examples

### IIS proxy app pattern

Use the dedicated IIS proxy app described in `IIS-ODVProxyApp/README.md`. The intended public shape is:

- `POST /ODVProxy/log` -> `http://localhost:3001/log`
- `POST /ODVProxy/userlog/record` -> `http://localhost:3002/userlog/record`

This keeps the browser talking to a same-origin path even though the Node services live on localhost ports behind IIS.

ARR replaces `Host` with the upstream address, while the user-log origin check needs the public host. The user-log rule therefore sets `X-Forwarded-Host` to the public host (overwriting any value the client sent), and the user log server trusts that header only from loopback. URL Rewrite sets a request header only when its server variable is allowed, so `scripts/Setup-IIS-ODVProxy.ps1` adds `HTTP_X_FORWARDED_HOST` to `allowedServerVariables` for the proxy application's location only.

What the setup script changes:

- For the whole server, one thing: when a proxy rule is enabled it turns ARR proxying on (`system.webServer/proxy`, `enabled`). It unlocks no configuration section.
- For the proxy application only: it allows exactly the server variables that the enabled rules set, as entries for the application's location in `applicationHost.config`. The application's own `web.config` never declares `allowedServerVariables`, and a variable that the server or the site already allows is left alone. With `-ForwardClientHeaders` both rules also set `X-Forwarded-For` and `X-Forwarded-Proto`, and the system-log rule sets `X-Forwarded-Host`.

Operational notes:

- The script runs in Windows PowerShell 5.1 (`powershell.exe`) as administrator. It uses the `IIS:` drive of the WebAdministration module, carries `#requires -PSEdition Desktop`, and refuses to start in PowerShell 7 before it has changed anything.
- The script is idempotent: the same switches give the same `web.config`, byte for byte, and the same allow list, however often it runs. Switching `-ForwardClientHeaders` on or off rewrites the rules to match.
- The script ends with a check: it reads the allow list back and fails if a server variable that a rule sets is not allowed, because IIS would then answer every proxied request with `500`.
- Run `scripts/Setup-IIS-ODVProxy.ps1` again after an upgrade, so that the generated `web.config` gets the user-log rule that forwards `X-Forwarded-Host`. Without it the user log server answers browser posts with `403`, as it did before the forwarded host existed, unless ARR's `preserveHostHeader` is on. A rerun also repairs an installation where an earlier version had written `web.config` without the variables its rules set.
- The user-log upstream (`-UserLogUrl`) must be a loopback address (`localhost`, `127.0.0.1` or `[::1]`), because the forwarded host is trusted from loopback only. The script warns about any other address.
- What the script does not undo: a server where an earlier version of the script was run with `-ForwardClientHeaders` has the configuration section `system.webServer/rewrite/allowedServerVariables` unlocked for the whole server, and it stays unlocked. The script no longer unlocks it and does not lock it again, since other applications may rely on it by now.
- If an administrator later allows one of the variables for the whole server or the site, the entry for the application's location becomes a second entry for the same name. IIS treats that as a configuration error and the proxy answers `500.19` until the entry for the application's location is removed.
- `-WhatIf` shows what would be done and changes nothing; the final check is skipped then. Every changing step in the script is behind its own `ShouldProcess` check, and a test on the script's syntax tree requires that for a list of known changing commands. The test does not catch a new changing command that is not on its list, an external program started without the call operator, or a write made through .NET; such a step needs its own `ShouldProcess` check and an entry in the list when it is added.
- The allow-list entries for the proxy application's location stay in `applicationHost.config`: the script has no uninstall, so they remain after the application is removed, and after `-ForwardClientHeaders` is switched off, until an administrator deletes them. An allowed variable that no rule sets has no effect.

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

## Strict origin

`ODV_STRICT_ORIGIN=true` is the standard in the recommended deployment.

- **What it does.** The user log server always rejects a request whose `Origin` or `Referer` points to another host, and one whose `Sec-Fetch-Site` is not `same-origin`. A request that carries none of the three headers is a different case: with `ODV_STRICT_ORIGIN=true` it is rejected with `403`, without it the request is accepted. Browsers send `Origin` with the viewer's print record, so the viewer is not affected.
- **When it may have to be off.** A caller that is not a browser and sends none of the three headers (a script, an older host application that posts the record itself, a monitoring probe) is rejected with strict origin. Either let that caller send an `Origin` header that matches the public host, or set `ODV_STRICT_ORIGIN=false` for that installation.
- **Running the service script again switches it on.** `scripts/Manage-ODV-LogServers.ps1` writes the whole environment of the services each time it installs them. Running it against services that are already installed therefore overwrites their environment variables, and the user log service starts with `ODV_STRICT_ORIGIN=true` the next time. An existing caller that sends none of `Origin`, `Referer` and `Sec-Fetch-Site` is rejected from then on. Check for such callers before the script is run again, or set `$Script:STRICT_ORIGIN` to `'false'` first.
- **Where it is set.** `scripts/Manage-ODV-LogServers.ps1` installs the user log service with `ODV_STRICT_ORIGIN=true`, from the constant `$Script:STRICT_ORIGIN` near the top of the script. The default in the server code is unchanged (`false`): changing it would change the behaviour of existing installations that start the server in another way, which then have to set the variable themselves.

## When a record counts as written

Both endpoints answer success only when the record is in its log file, and `500` otherwise.

- **Written and still at the path.** After each write the server compares the log file's path with the file it has open. If the file was removed, moved or replaced while the service ran, also together with the whole log folder, the server opens the file again at the path (creating the folder) and writes the record there before it answers. A record is not acknowledged from a file that is no longer at the path. This costs one `stat` per record.
- **Time limit.** If the write is not confirmed within `LOG_WRITE_TIMEOUT_MS` (default 10 seconds), for example on a hung disk or network share, the request is answered with `500` and a `log-write-failed` line with the code `ELOGTIMEOUT` is written, to standard error if the error log is on the same hung disk. The file is opened again by the next record.
- **After a fault.** A file whose write failed is opened again by the next record, without a restart. If part of a line reached the file before the fault, the next record starts on a new line, so it stays a valid line of its own; the incomplete line before it is left as it is.
- **A caller that does not wait.** A caller that closes its connection, or its sending side, right after sending the request gets no answer, but the record is written. The viewer works this way: it sends the print record without reading the response.

Remaining limitations:

- There is no `fsync` per record. A record is acknowledged when the operating system has accepted it; a crash of the machine or a power failure right after can still lose it.
- A file that is removed or replaced *after* the check of a record is not noticed until the next record is written, and that next record then goes to the file at the path. The record before it was in the file at the path when it was acknowledged.
- If an outside tool moves the log file away at the very moment a record is written, the record may be in both the moved file and the new one.
- A tool that rotates or removes the log files from outside is not needed and not recommended; the servers rotate by date and prune by age themselves.

## Disk space is a requirement

The free space of the disk that holds `server/logs/` **must be monitored**.

- The print log has no limit per client address by default, and every line is an audit record.
- When the disk is full the servers answer `500` and the record is **not** written. The viewer does not read the answer, so no user notices.
- A `log-write-failed` line in `error-*.log` (or on the service's standard error when that file cannot be written either) is the sign that records are being lost.
- Retention removes files only by age (see "File layout and retention"); it does not react to a full disk.

## Operational checks

- `GET /healthz` returns success for both services
- the proxy forwards to the expected localhost port
- the system log token in runtime config matches the backend environment
- `server/logs/` is writable by the service identity
- the free space of the disk that holds `server/logs/` is monitored
- `ODV_STRICT_ORIGIN=true` is set for the user log service
- `error-*.log` has no `log-write-failed` or `rate-limit-rejected` lines
- retention days are appropriate for the environment
