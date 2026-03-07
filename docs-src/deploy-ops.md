# Deployment and operations notes

This document collects operational notes that were previously spread across `README.md`, `public/web.config`, `IIS-ODVProxyApp/`, and the PowerShell scripts.

## Deployment shape

The recommended production topology is:

1. build the frontend with Vite
2. host the generated static files on IIS
3. run the optional log servers as separate Node processes or Windows services
4. expose the log servers through the dedicated IIS proxy app

This keeps the viewer itself static while still allowing same-origin logging endpoints.

## Static frontend on IIS

`public/web.config` is designed for the built SPA and encodes the intended hosting rules.

### Cache rules

- `index.html`: `no-store, no-cache, must-revalidate`
- `odv.config.js`: `no-store, no-cache, must-revalidate`
- hashed static assets: `public, max-age=31536000, immutable`

That split is important:

- the shell HTML and runtime config must reflect the newest deployment immediately
- hashed JS/CSS assets are safe to long-cache

### SPA routing

The IIS rewrite rules:

- add a trailing slash for directory-like routes
- rewrite unknown paths to `index.html`

### Compression and MIME types

The IIS config also establishes:

- MIME types for `.mjs`, `.wasm`, `.svg`, `.json`, `.webmanifest`, `.woff`, `.woff2`
- static and dynamic compression for JS, CSS, JSON, and SVG

## IIS proxy app

The dedicated proxy app under `IIS-ODVProxyApp/` exists only to forward logging traffic.

Recommended public paths:

- `/ODVProxy/log`
- `/ODVProxy/userlog/record`

The setup script `scripts/Setup-IIS-ODVProxy.ps1` is the main entry point for:

- creating the IIS app
- generating `web.config` from the template
- enabling or disabling proxy rules
- pointing those rules at the correct localhost Node endpoints

## Windows service management

`scripts/Manage-ODV-LogServers.ps1` provides service-oriented helpers for the Node log servers.

Main responsibilities of that script:

- locate or install NSSM
- run `npm ci` or fall back to `npm install` when the lock file is out of sync
- install or update Windows services for the two Node servers
- set environment variables for the service definitions

## Recommended deployment checklist

### Frontend

- build output copied to the IIS app root
- `index.html` and `odv.config.js` are not cached
- runtime config values are deployment-local and correct
- URL Rewrite module is installed

### Proxy

- ARR proxying is enabled
- `POST /ODVProxy/log` reaches the system log server
- `POST /ODVProxy/userlog/record` reaches the user log server
- proxy targets point to the intended localhost ports

### Node services

- the service account can write to `server/logs/`
- `LOG_TOKEN` is present in production for the system log server
- retention days and proxy trust are configured intentionally

## Troubleshooting notes

### Logging works locally but not behind IIS

Check, in order:

1. browser runtime config endpoint
2. IIS proxy rewrite target
3. Node service health endpoint
4. service environment variables
5. write permissions on `server/logs/`

### New deploy still serves old config

Usually this means `odv.config.js` is cached somewhere despite the intended IIS headers.

### SPA routes 404 on refresh

Usually this means the IIS rewrite rule for SPA fallback is missing or disabled.
