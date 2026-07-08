# Deployment and operations notes

This document collects operational notes that were previously spread across `README.md`, `public/web.config`, `IIS-ODVProxyApp/`, and the PowerShell scripts.

## Deployment shape

The recommended production topology is:

1. build the frontend with Vite
2. host the generated static files on IIS
3. run the optional log servers as separate Node processes or Windows services
4. expose the log servers through the dedicated IIS proxy app

This keeps the viewer itself static while still allowing same-origin logging endpoints.

## Browser targeting

The operational target for OpenDocViewer is Chromium-based desktop browsers:

- Microsoft Edge
- Google Chrome

Firefox may work for basic viewing, but it is not the primary support target. Expect some differences in browser console output, HTML input-validation warnings, and availability of non-standard diagnostics APIs such as `performance.memory`.

If a deployment must be validated formally, test Edge and Chrome first. Treat Firefox as best-effort unless the deployment explicitly chooses to support it.

## Static frontend on IIS

`public/web.config` is designed for the built SPA and encodes the intended hosting rules.

### Cache rules

- `index.html`: `no-store, no-cache, must-revalidate`
- `odv.config.js`: `no-store, no-cache, must-revalidate`
- `odv.site.config.js`: `no-store, no-cache, must-revalidate`
- hashed static assets: `public, max-age=31536000, immutable`

That split is important:

- the shell HTML and runtime config must reflect the newest deployment immediately
- hashed JS/CSS assets are safe to long-cache

### CSP and runtime-config trust

OpenDocViewer now ships with a baseline Content Security Policy on `index.html` and the same policy
as a fallback `<meta>` tag in the shell. The baseline is intentionally focused on the browser
execution boundary:

- scripts are limited to same-origin files plus the hashed inline i18n bootstrap block
- plugin/object content is disabled
- workers and print iframes remain allowed from same-origin and `blob:`
- `connect-src` and `img-src` remain broad enough for existing host-owned document endpoints,
  proxy paths, and dev-server WebSockets

This baseline is not a substitute for deployment review. The viewer executes `index.html`,
`odv.config.js`, and optional `odv.site.config.js` as first-party code. Treat all three files as
the same trust boundary as the shipped bundle: same write controls, same deployment review, and no
secrets.

If a deployment platform can emit a stricter per-site CSP header, prefer doing that at the host
layer. Typical follow-ups are:

- narrow `connect-src` and `img-src` to the exact host domains used in that environment
- add per-request script nonces or hashes at the host layer
- pin runtime-config files with SRI hashes when packaging or site-deployment automation can refresh
  those hashes atomically with the config content

OMP package builds can now compute SRI hashes for `odv.config.js` and optional
`odv.site.config.js` and inject them into the deployed `index.html`. Treat `index.html`,
`odv.config.js`, and `odv.site.config.js` as the same trust boundary and deployment unit: if a site
override is changed after packaging without rebuilding the package or redeploying synchronized
markup, the browser will refuse to load that config file.

### Per-deployment CSP tightening

Keep the shipped baseline permissive enough for static hosting, host-owned document endpoints, and
existing embedded deployments. Tighten it per environment at the IIS or reverse-proxy header layer
once the real origins and paths are known.

For production tightening:

- replace `connect-src 'self' http: https: ws: wss:` with the exact viewer, host, document,
  bundle, source-pack, and log-proxy origins used in that environment
- replace `img-src 'self' blob: data: http: https:` with `'self' blob: data:` plus only the image
  origins that remain necessary after deployment review
- remove `ws:` and `wss:` unless the deployment intentionally uses WebSockets outside local Vite
  development
- keep `worker-src 'self' blob:` and `frame-src 'self' blob:` because worker startup, rendered
  page blobs, and print flows depend on them
- do not remove `blob:` or `data:` from image/print-related directives while OpenDocViewer still
  renders pages and print output through object URLs and data URLs

`frame-ancestors` is now shipped as a default in `public/web.config` (`frame-ancestors 'self'`).
This prevents cross-origin embedding by default. If a deployment needs to allow embedding from a
specific host, override the CSP header in IIS or the reverse proxy with the additional allowed
origin, e.g. `frame-ancestors 'self' https://allowed-host.example;`. The
`<meta http-equiv="Content-Security-Policy">` tag in `index.html` cannot enforce `frame-ancestors`
— this must remain an HTTP response header.

Embedded deployments also need to review the parent page's own CSP. If a host page loads
OpenDocViewer in an `<iframe>`, the host CSP must allow:

- the viewer origin in `frame-src` or `child-src`
- the bundle, document, source-pack, and log endpoints in `connect-src`
- any direct image/document origins that the parent page itself loads in `img-src`
- any inline bootstrap script only when the host intentionally uses it and provides a matching
  nonce or hash

Example same-origin OMP host header:

```xml
<add
  name="Content-Security-Policy"
  value="default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'sha256-VLp8cNctLQHS+quZb8UEJAQpLDhxTlAGTn8HeEru0Zs='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://host.example; font-src 'self' data:; connect-src 'self' https://host.example https://host.example/opendocviewer-demo/bundle https://host.example/ODVProxy/log https://host.example/ODVProxy/userlog/record; worker-src 'self' blob:; frame-src 'self' blob:; form-action 'self'; frame-ancestors 'self' https://host.example;" />
```

Treat that example as a template, not a default. Replace the sample host and endpoint values with
the exact deployment URLs before enabling it.

### SPA routing

The IIS rewrite rules:

- add a trailing slash for directory-like routes
- rewrite unknown paths to `index.html`

### Compression and MIME types

The IIS config also establishes:

- MIME types for `.mjs`, `.wasm`, `.svg`, `.json`, `.webmanifest`, `.woff`, `.woff2`
- static and dynamic compression for JS, CSS, JSON, and SVG

### PDF.js codec resources

OpenDocViewer's Vite build emits the optional PDF.js codec resources under
`dist/pdfjs/wasm/`. These files include JBIG2 and OpenJPEG WASM/fallback modules
used by scanned or image-heavy PDFs. Deploy this folder together with the rest
of `dist/`; otherwise affected PDFs may load as blank pages and the browser
console may show `JBig2 failed to initialize` or missing `wasmUrl` warnings.

### Prefetch tuning for proxied source endpoints

If the upstream document endpoint sits behind IIS, ARR, smart-card SSO, SSL inspection, or another proxy/security layer, keep `documentLoading.fetch.prefetchConcurrency` conservative unless you have measured headroom in that exact environment. This customer-focused bundle keeps concurrency moderate at `4`, disables retries, and aborts individual prefetch requests after `10000` ms so one stalled upstream request does not hold the UI for long. The profile assumes the main VPN/proxy timeout issue has been resolved and now optimizes harder for responsiveness.

If an environment still shows intermittent `GetStream`-style timeouts, lower concurrency first. Only re-enable retries if you have measured that the backend usually recovers quickly and users prefer waiting over surfacing a failed page faster.

OpenDocViewer bypasses the browser HTTP cache for source-file fetches and validates that fetched
bytes look like a supported PDF/image before writing them to its temporary source store. If users see
many failed-page placeholders after a session has been open for a while, inspect the browser console
or system log for `Fetched source looked like text/HTML/JSON` or `could not be verified as a
supported PDF/image payload`. Those messages usually mean the upstream host session or preparation
endpoint is returning an error/login payload with HTTP 200 instead of the original document bytes.

If the console instead shows repeated `GetStream` failures with `status 404` and the IIS error page
says `FileTicket could not be resolved`, the upstream file tickets have expired or were generated
for a host session that can no longer resolve them. ODV cannot renew those tickets by itself. It will
stop early after `documentLoading.fetch.abortOnSourceUnavailableCount` initial unavailable sources
and show the configured problem notice so the user can start a fresh host session.

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
- `odv.site.config.js` is not cached when site overrides are used
- runtime config values are deployment-local and correct
- CSP reviewed for the target environment; `connect-src` and `img-src` narrowed where possible
- `frame-ancestors 'self'` is now shipped by default in `public/web.config`; override it in IIS or the reverse proxy if cross-origin embedding is required
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
