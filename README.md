# OpenDocViewer

OpenDocViewer is a fast, lightweight, MIT-licensed document viewer built with **React + Vite**. It supports PDFs, TIFFs, and common image formats (JPG/PNG), with thumbnails, zoom, fit-to-screen/width, keyboard navigation, and a side-by-side comparison mode.

The viewer ships with:

* an optional **System Log** (token-gated, JSON; typically proxied to a bundled Node service), and
* an optional **User Print Log** (backend-agnostic; posts when a user prints from the viewer, using `sendBeacon`/`keepalive`).

Both are controlled at **runtime** via `/odv.config.js` — no rebuild required.

---

## Table of contents

* [Features](#features)
* [Requirements](#requirements)
* [Quick start (development)](#quick-start-development)
* [Build & preview (production)](#build--preview-production)
* [Deploying the build](#deploying-the-build)
* [Runtime config (`/odv.config.js`)](#runtime-config-odvconfigjs)
* [User print log (client → configurable endpoint)](#user-print-log-client--configurable-endpoint)
* [System log (bundled Node server, optional)](#system-log-bundled-node-server-optional)
* [Embedding & usage](#embedding--usage)
* [JSDoc (API docs)](#jsdoc-api-docs)
* [Linting & formatting](#linting--formatting)
* [Project structure](#project-structure)
* [Design notes & gotchas](#design-notes--gotchas)
* [License](#license)

---

## Features

* **PDF, TIFF, JPG/PNG** viewing with main-thread fallbacks when workers are unavailable
* **Thumbnail list** with keyboard and mouse navigation
* **Zoom, fit-to-screen/width**, and **comparison mode**
* **Portable build** (static assets in `dist/`) that runs on any static host
* **Runtime configuration** via `/odv.config.js` (**no rebuild required**)
* **User Print Log** (optional): non-blocking client POST on *Print* (JSON or form, cookies included)
* **System Log** (optional): token-gated JSON ingestion endpoint (typically proxied via IIS ARR)

---

## Requirements

* **Node.js 18+** and npm
* A modern browser (Chromium / Firefox / Safari)

---

## Quick start (development)

```bash
git clone https://github.com/Optimal2/OpenDocViewer.git
cd OpenDocViewer
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

---

## Build & preview (production)

```bash
# Build optimized assets into dist/
npm run build

# Preview the production build locally
npm run preview
```

These scripts are preconfigured in `package.json`.

---

## Deploying the build

The production build is static. Deploy the `dist/` folder to any static host (IIS, Nginx, Apache, S3/CloudFront, GitHub Pages, etc.).

* **SPA routing:** Configure a fallback so unknown routes serve `index.html`.
* **Caching:** Long-cache hashed assets; **do not** long-cache `index.html` or `odv.config.js`. Recommended header for both: `Cache-Control: no-store`.

> **IIS:** `web.config` is included with:
>
> * SPA fallback and trailing-slash fix
> * MIME types for modern assets
> * Global cache policy (overridden by `<location>` for `index.html` and `odv.config.js`)
> * **Mode 2** proxy rules (commented by default) for `/log` and `/userlog/record`

---

## Runtime config (`/odv.config.js`)

`public/odv.config.js` is fetched at runtime and must be loaded **before** the app bundle in `index.html`. Three deployment **modes** are supported:

* **Mode 1 (default):** No logging (system & user disabled)
* **Mode 2:** ODV bundled Node log servers via IIS **ARR proxy**
* **Mode 3:** External **user-log** only (no ARR required)

`odv.config.js` ships in **Mode 1**. Switch modes by uncommenting the relevant block in that file.

**Mode 1 (default – no logging):**

```js
window.__ODV_CONFIG__ = {
  exposeStackTraces: false,
  showPerfOverlay:   false,

  userLog:  { enabled: false, endpoint: "" },
  systemLog:{ enabled: false, endpoint: "", token: "" }
};
```

**Mode 2 (ODV Node via IIS ARR):**

```js
window.__ODV_CONFIG__ = {
  exposeStackTraces: false,
  showPerfOverlay:   false,

  userLog: {
    enabled:   true,
    endpoint:  "/OpenDocViewer/userlog/record", // proxied to http://localhost:3002/userlog/record
    transport: "json"
  },

  systemLog: {
    enabled:   true,
    endpoint:  "/OpenDocViewer/log",            // proxied to http://localhost:3001/log
    token:     "REPLACE_WITH_SYSTEM_LOG_TOKEN"
  }
};
```

**Mode 3 (External user-log only):**

```js
window.__ODV_CONFIG__ = {
  exposeStackTraces: false,
  showPerfOverlay:   false,

  userLog: {
    enabled:   true,
    endpoint:  "/path/to/your/DocumentView/LogPrint", // or any same-origin user-log endpoint
    transport: "form" // sends application/x-www-form-urlencoded with reason & forWhom
  },

  systemLog:{ enabled: false, endpoint: "", token: "" }
};
```

> `/odv.config.js` is served with `Cache-Control: no-store`, so ops can switch modes without rebuilding.

---

## User print log (client → configurable endpoint)

When the user triggers **Print** inside the viewer, the client can **optionally** POST a small event to a configured endpoint.

**Where it’s implemented**

* UI collects **Reason** and **For whom** in `PrintRangeDialog.jsx`.
* `DocumentToolbar.jsx` receives these values on submit, triggers printing, and **fire-and-forgets** a log via `src/UserLogController.js`.
* Printing is **never blocked** by logging.

**Transport**

* Uses `navigator.sendBeacon` when possible; otherwise `fetch` with `{ keepalive: true, credentials: 'include' }` and a short abort (4s).
* Cookies/session are **always included** (either implicitly by `sendBeacon` on same-origin or explicitly by `fetch`).

**Payload**

* **Mode 2 (JSON):**

  ```json
  {
    "event":  { "name": "print", "ts": "2025-08-31T12:34:56.789Z" },
    "doc":    { "id": null, "title": null, "pageCount": 10 },
    "user":   { "id": null, "name": null },
    "client": { "userAgent": "...", "language": "en-US", "timezone": "+02:00" },
    "meta":   { "reason": "string|null", "forWhom": "string|null", "viewerVersion": "x.y.z", "pages": "1-3,7", "copies": 1 },
    "session":{ "id": null, "iframeId": null, "createdAt": "ISO", "cookieFingerprint": "sha256-..." }
  }
  ```
* **Mode 3 (form):** sends `reason=<...>&forWhom=<...>` only (legacy compatibility).

**Acceptance checklist**

* **Mode 1:** No network call on print.
* **Mode 2:** POST `/OpenDocViewer/userlog/record` → 200/204 (IIS proxies to Node user-log on `:3002`).
* **Mode 3:** POST to configured external path → 200/204.
* Printing continues even if the endpoint is down.

---

## System log (bundled Node server, optional)

A small Node/Express service ingests **system** logs (structured JSON/NDJSON) with rotation/retention and a shared token. It’s usually enabled only in **Mode 2** behind IIS ARR.

**Scripts**

```bash
# Start the system log server (example)
npm run start:log-server

# Run viewer dev + log server together
npm run dev:both
```

**IIS (Mode 2)**

* Uncomment the two proxy rules in `web.config`:

  * `/OpenDocViewer/log            → http://localhost:3001/log`
  * `/OpenDocViewer/userlog/record → http://localhost:3002/userlog/record`
* (Optional) Uncomment `allowedServerVariables` to forward `X-Forwarded-*`.

---

## Embedding & usage

The main component is `OpenDocViewer.jsx`. You can provide sources in two ways:

1. **Pattern mode** (legacy/demo): `{ folder, extension, endNumber }`
2. **Explicit list mode** (recommended): `{ sourceList: [{ url, ext?, fileIndex? }, ...], bundle? }`

**Example (explicit list):**

```jsx
import React from 'react';
import OpenDocViewer from './src/OpenDocViewer.jsx';

export default function Demo() {
  const files = [
    { url: '/docs/spec.pdf' },      // PDF (auto-detected)
    { url: '/scans/scan01.tif' },   // single-page TIFF
    { url: '/images/page-01.png' }, // PNG
  ];

  return (
    <OpenDocViewer
      sourceList={files}
      bundle={{ title: 'Demo bundle' }}
    />
  );
}
```

---

## JSDoc (API docs)

```bash
npm run doc
```

Writes developer docs into `./docs/`.

---

## Linting & formatting

```bash
npm run lint
npm run lint:fix
npm run format
```

---

## Project structure

```
OpenDocViewer/
├─ public/
│  ├─ odv.config.js                 # runtime config (Mode 1/2/3)
├─ src/
│  ├─ components/
│  │  ├─ DocumentToolbar/
│  │  │  ├─ DocumentToolbar.jsx
│  │  │  ├─ PrintRangeDialog.jsx
│  │  │  └─ PrintRangeDialog.module.css
│  │  └─ ... (viewer, thumbnails, zoom, etc.)
│  ├─ utils/
│  │  ├─ printCore.js
│  │  ├─ printParse.js
│  │  └─ printUtils.js             # public facade
│  ├─ UserLogController.js         # user-print logging (client-only)
│  ├─ LogController.js             # system logging (client → Node)
│  ├─ index.jsx, OpenDocViewer.jsx, ... (other app files)
├─ web.config                       # IIS config (SPA + optional Mode 2 proxies)
├─ scripts/
│  ├─ ODV-DevMenu.ps1              # optional helper menu (dev/build/tools)
│  ├─ Manage-ODV-LogServers.ps1    # (existing) manage Node services
│  ├─ Setup-IIS-ODVProxy.ps1       # (existing) configure IIS proxies
│  └─ Test-ODV-IISProxy.ps1        # (existing) smoke-tests proxies
├─ package.json, vite.config.js, eslint.config.js, jsdoc.json, …
└─ dist/                            # production build (after `npm run build`)
```

---

## Design notes & gotchas

* **Modes:** The app ships in **Mode 1**. Switch to **Mode 2 or 3** by uncommenting the relevant blocks in `odv.config.js` (and in `web.config` for Mode 2). No rebuild needed.
* **Non-blocking printing:** Logging uses `sendBeacon`/`keepalive` and never awaits; print flow cannot be delayed by network issues.
* **Cookies & session:** User-log requests always include cookies (for same-origin endpoints). No tokens are sent for user-log.
* **Caching:** Keep `index.html` and `odv.config.js` **uncached**; long-cache hashed assets.
* **PDF worker parity:** Keep `pdfjs-dist` worker version aligned with the API version.
* **TIFF memory:** Multi-page TIFFs render on the main thread to reduce peak memory.

---

## License

MIT — see `LICENSE`.
