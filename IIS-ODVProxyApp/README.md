# ODV Proxy App (IIS)

Minimal IIS application that only reverse-proxies ODV log endpoints:

- `POST ./log` → System Log server (e.g., `http://localhost:3001/log`)
- `POST ./userlog/record` → User Log server (e.g., `http://localhost:3002/userlog/record`)

## Requirements

- IIS URL Rewrite module
- IIS Application Request Routing (ARR) with proxying enabled
- `HTTP_X_FORWARDED_HOST` in `allowedServerVariables` for this application

The setup script turns ARR proxying on at server level; that is its only server-wide change. The user-log server compares the browser's Origin/Referer host with the public host, and ARR replaces `Host` with the upstream address, so the user-log rule forwards the public host in `X-Forwarded-Host`. The setup script allows that server variable for this application's location only. ARR's server-wide `preserveHostHeader` is not changed.

## Deploy

Use the repository-root script `scripts/Setup-IIS-ODVProxy.ps1` (run from the repository root, not from this folder) to:
- Create the IIS application (default path `/ODVProxy`)
- Generate `web.config` from `web.config.template`
- Toggle each proxy rule on/off
- Point rules to your target backend URLs

## Test

From the repository root, run `scripts/Test-ODV-IISProxy.ps1 -BaseUrl https://your-host/ODVProxy/`. It posts one
system-log and one user-log request and exits 0 when both return HTTP 2xx, otherwise 1.
