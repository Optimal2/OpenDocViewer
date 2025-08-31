# ODV Proxy App (IIS)

Minimal IIS application that only reverse-proxies ODV log endpoints:

- `POST ./log` → System Log server (e.g., `http://localhost:3001/log`)
- `POST ./userlog/record` → User Log server (e.g., `http://localhost:3002/userlog/record`)

## Requirements

- IIS URL Rewrite module
- IIS Application Request Routing (ARR) with proxying enabled

## Deploy

Use the script in `scripts/Setup-IIS-ODVProxy.ps1` to:
- Create the IIS application (default path `/ODVProxy`)
- Generate `web.config` from `web.config.template`
- Toggle each proxy rule on/off
- Point rules to your target backend URLs

## Test

Run `scripts/Test-ODV-IISProxy.ps1 -BaseUrl https://your-host/ODVProxy/`.
