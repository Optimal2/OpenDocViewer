# OpenDocViewer

OpenDocViewer is a fast, lightweight, MIT-licensed document viewer built with **React + Vite**. It supports **PDF**, **TIFF**, and common image formats (**JPG/PNG**), with thumbnails, zoom, fit-to-screen/width, keyboard navigation, optional image adjustments (rotation, brightness, contrast), and a compare mode.

The app is **runtime-configurable** via `/odv.config.js` (with optional site overrides in `/odv.site.config.js`)—no rebuild required. Optional log servers are included for operational telemetry:

* **System Log** (token-gated JSON ingestion; intended for infrastructure logs)
* **User Print Log** (records end-user print reasons; non-blocking and backend-agnostic)

---

## Table of contents

* [Features](#features)
* [Architecture overview](#architecture-overview)
* [Requirements](#requirements)
* [Quick start (development)](#quick-start-development)
* [Build & preview (production)](#build--preview-production)
* [Hosting & deployment](#hosting--deployment)
* [Runtime configuration](#runtime-configuration)
* [Site overrides & admin tool](#site-overrides--admin-tool)
* [Printing (range, sequence, header overlay)](#printing-range-sequence-header-overlay)
* [Logging (optional)](#logging-optional)
* [Embedding & integration patterns](#embedding--integration-patterns)
* [Internationalization (i18n)](#internationalization-i18n)
* [JSDoc (API docs)](#jsdoc-api-docs)
* [Linting & formatting](#linting--formatting)
* [Project structure](#project-structure)
* [Security & privacy notes](#security--privacy-notes)
* [Design notes & gotchas](#design-notes--gotchas)
* [License](#license)

---

## Features

* **PDF, TIFF, JPG/PNG** viewing with robust fallbacks

  * PDF & multi-page TIFF rasterized on the **main thread** for consistent behavior (dev = prod)
  * Single-page images processed in **Web Workers** (when available)
* **Thumbnails** with accessible listbox semantics, keyboard activation, and stable scroll position
* **Zoom**, **fit to screen/width**, and **compare mode** (pick two pages to view side-by-side)
* **Image adjustments** (per-page): rotate ±90°, brightness, contrast
* **Printing**:

  * Current page / all pages / range (ascending or descending) / custom **sequence**
  * Non-blocking client (never delays printing)
  * Optional **header overlay** stamped on printed pages (tokens & localization supported)
* **Keyboard navigation**: PageDown/Right/Down → next, PageUp/Left/Up → previous, Home/End → first/last
* **Portable build** (static assets in `dist/`) that runs on any static host
* **Runtime configuration** via `/odv.config.js` and optional `/odv.site.config.js` (no rebuild)
* **Optional logging**:

  * **User Print Log** (same-origin `sendBeacon`/`keepalive` with JSON or form transport)
  * **System Log** (token-gated JSON ingestion server; typically proxied behind IIS)

---

## Architecture overview

* **Viewer SPA** (React + Vite)

  * Entry: `src/index.jsx` mounts `<AppBootstrap/>`, which detects how to start the viewer
  * Top-level component: `src/OpenDocViewer.jsx` wires providers, toggles, and performance HUD
  * Rendering:

    * **PDF** via `pdfjs-dist` API with an **ESM worker** configured once (dev = prod)
    * **TIFF** via `utif2`
    * Images via a worker pipeline (batching tuned by cores/device memory)
* **Boot/integration paths** (detected automatically in `src/integrations/Bootstrap.js`)

  1. **Same-origin parent bridge** (reads `parent.ODV_BOOTSTRAP` or legacy shapes)
  2. **Session token** in URL (`?sessiondata=<base64-json>`)
  3. **URL params** (pattern mode: `folder`, `extension`, `endNumber`)
  4. **JS API** (`window.ODV.start(payload)`)
  5. **Demo** (sample assets in `/public`)
* **Runtime config**: `public/odv.config.js` (active defaults) + optional `public/odv.site.config.js` (overrides)

---

## Requirements

* **Node.js 18+** and npm
* Modern browser (Chromium/Firefox/Safari). ES modules and Web Workers are used; IE is not supported.

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

---

## Hosting & deployment

The production build is **static**. Deploy the `dist/` folder to any static host (IIS, Nginx, Apache, S3/CloudFront, GitHub Pages, …).

**SPA routing:** configure a fallback so unknown routes serve `index.html`.

**Caching:** long-cache hashed assets; **do not** long-cache `index.html` or `odv.config.js` (serve both with `Cache-Control: no-store`).

### IIS

A production-ready `web.config` is included (SPA fallback, MIME types, compression, security headers). It is **mode-less**:

* This app **does not** proxy logs directly.
* If you want to expose the optional Node log servers behind IIS, deploy a **separate IIS app** (for example at `/ODVProxy`) and point the runtime config endpoints there (e.g., `/ODVProxy/log`, `/ODVProxy/userlog/record`). See [Logging](#logging-optional).

---

## Runtime configuration

Runtime config is loaded **before** the app via a tiny bootstrap (`src/boot-config.js`) that:

1. Determines the app base path (works under IIS virtual directories).
2. Loads optional **site overrides** from `/odv.site.config.js`.
3. Loads required **defaults** from `/odv.config.js`.
4. Starts the app.

`/odv.config.js` exports a single “active” config object (no historical “modes”) covering:

* **Diagnostics**

  * `exposeStackTraces: boolean` – show/hide error stacks in the UI
  * `showPerfOverlay: boolean` – toggle the performance HUD
* **Mount info**

  * `basePath`, `baseHref` (automatically derived; used by i18n and routerless asset URLs)
* **Internationalization (i18n)**

  * `default`, `supported`, `loadPath`, `version` (cache-busting token)
* **User Print Log**

  * `enabled`, `endpoint` (absolute or app-relative), `transport: 'json'|'form'`
  * UI policy (`ui.showReasonWhen`, `ui.showForWhomWhen`) and validation
* **Print header overlay**

  * `enabled`, `position: "top"|"bottom"`, `applyTo: "all"|"first"|"last"`, `heightPx`
  * `template` (tokens; supports localized strings), `css` (print-only)
* **System Log**

  * `enabled`, `endpoint`, `token`

The config is read at runtime by the viewer and by integration controllers—**no rebuild needed** to change behavior.

---

## Site overrides & admin tool

* Put site-specific changes in **`/odv.site.config.js`** (same folder as `odv.config.js`). This file is **optional**.
* A helper UI **`/odv-admin.html`** lets administrators:

  * Load the current effective config
  * Edit User Print Log fields, Print Header template/CSS, System Log settings, toggles
  * **Save directly** to `public/odv.site.config.js` via the File System Access API (Edge/Chrome) or **download** the file

---

## Printing (range, sequence, header overlay)

OpenDocViewer provides a complete print pipeline:

* **What you can print**

  * **Active page**, **All pages**
  * **Range** (ascending `2→5` or descending `5→2`)
  * **Custom sequence** (e.g., `"1-3, 2, 2, 7-5"`)
* **UX**

  * Print dialog collects **Reason** and **For whom** (policy controlled via runtime config)
  * Printing is **non-blocking**: the log call (if enabled) is fire-and-forget
* **Transport**

  * Prefers `navigator.sendBeacon` for same-origin; otherwise `fetch({ keepalive: true, credentials: 'include' })` with a short abort
  * **Cookies are included** for same-origin requests
* **Header overlay**

  * When enabled, a lightweight header is **stamped** on printed pages
  * Template supports tokens (HTML-escaped at render time):

    * `date`, `time`, `now`
    * `page`, `totalPages`
    * `reason`, `forWhom`
    * `user.id`, `user.name`
    * `doc.id`, `doc.title`, `doc.pageCount`
    * `viewer.version`
  * Admins may localize the template and style it via print-scoped CSS

Developers can also call the public helpers exported by `src/utils/printUtils.js`:

```js
import { handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence, parsePrintSequence } from './src/utils/printUtils.js';
```

---

## Logging (optional)

### User Print Log (client → configurable endpoint)

* Implemented in `src/integration/UserLogController.js`
* Reads `userLog` from runtime config:

  * `enabled: boolean`
  * `endpoint: string`
  * `transport: 'json'|'form'`
* **Payloads**

  * **JSON** (rich details, including page count and environment snapshot)
  * **Form** (compat path for legacy endpoints: `reason`/`forWhom` only)
* **Resilience**

  * Uses `sendBeacon` when same-origin; else `fetch` with `keepalive`
  * Exceptions are swallowed; printing proceeds regardless of network state

### System Log (bundled Node server)

A hardened, single-file Node/Express service that ingests structured logs:

* **Endpoint**: `POST /log` (token-gated via `x-log-token`)
* **Files**: daily-rotated NDJSON logs under `server/logs/` with retention
* **Rate limiting**, **helmet**, and optional **CORS** (allowlist)
* **Health**: `GET /healthz`

Start it locally:

```bash
npm run dev:system-log   # PORT=3001 (dev defaults)
```

### User Log Server (bundled Node server)

* **Endpoint**: `POST /userlog/record`

  * Content types: `application/json` or `application/x-www-form-urlencoded`
  * Returns `200 true` for maximum tolerance
* **Same-origin guard** (Origin/Referer/Sec-Fetch-Site), **rate limiting**, **helmet**
* **Health**: `GET /healthz`

Start it locally:

```bash
npm run dev:user-log     # PORT=3002 (dev defaults)
```

### Running everything together (dev)

```bash
npm run dev:both         # Vite dev server + both log servers
```

> **IIS:** Proxy the Node servers through a separate app (e.g. `/ODVProxy`) and point `odv.config.js` to `/ODVProxy/log` and `/ODVProxy/userlog/record`. Helper scripts are in `scripts/` to set up and test the proxies.

---

## Embedding & integration patterns

### 1) React (explicit list; recommended)

```jsx
import OpenDocViewer from './src/OpenDocViewer.jsx';

const files = [
  { url: '/docs/spec.pdf' },
  { url: '/scans/scan01.tif' },
  { url: '/images/page-01.png' }
];

export default function Demo() {
  return <OpenDocViewer sourceList={files} bundle={{ title: 'Demo bundle' }} />;
}
```

### 2) Pattern mode (legacy/demo)

```jsx
<OpenDocViewer folder="/images/page-" extension="png" endNumber={12} />
```

### 3) Same-origin parent bridge

Place a normalized **portable bundle** (see below) on `parent.ODV_BOOTSTRAP` and host the viewer in an iframe. The viewer will detect and start.

### 4) Session token in URL

Encode a bundle as Base64 JSON and pass `?sessiondata=<token>`. The viewer decodes it on load.

### 5) JS API (no iframe required)

```html
<script>
  // Provide normalized data before or after the SPA loads:
  window.ODV = window.ODV || {};
  window.ODV.start({
    session: { id: 'sess-123', userId: 'alice' },
    documents: [
      { documentId: 'doc-1', files: [{ url: '/docs/spec.pdf' }] }
    ]
  });
</script>
```

### Portable bundle (v1, normalized shape)

```json
{
  "session": { "id": "string", "userId": "string?" },
  "documents": [
    {
      "documentId": "string",
      "files": [ "url-or-path", { "url": "/path/file.png", "ext": "png", "id": "optional" } ],
      "meta": { "title": "optional", "pageCount": 10 }
    }
  ]
}
```

---

## Internationalization (i18n)

* **Libraries**: `i18next`, `react-i18next`, `i18next-icu`
* **Runtime-computed load path** that respects the app base (`/` or virtual directory)
* **Versioned resources**: set `i18n.version` in config to force refresh
* Early **language and meta tags** are set in `index.html` before React mounts, so titles/descriptions are localized for SEO/shell.
* Translation files live under `public/locales/{lng}/common.json`. (Sample Swedish `common.json` is included.)

---

## JSDoc (API docs)

```bash
npm run doc
```

Outputs to `./docs/` using `jsdoc` + `docdash`. (Sources are limited to `src/**/*.js|jsx`.)

---

## Linting & formatting

```bash
npm run lint
npm run lint:fix
npm run format
```

Flat-config ESLint with React hooks and Refresh safety; Prettier for formatting.

---

## Project structure

```
OpenDocViewer/
├─ public/
│  ├─ favicon.ico, logo192.png, logo512.png
│  ├─ manifest.json
│  ├─ odv.config.js                 # active runtime defaults (mode-less)
│  ├─ odv.site.config.sample.js     # copy → odv.site.config.js for site overrides
│  ├─ odv-admin.html                # admin UI to edit/save site overrides
│  ├─ locales/{en,sv}/common.json   # translations
│  └─ sample.{jpg,png,tif,pdf}      # demo assets
├─ server/
│  ├─ system-log-server.js          # POST /log (token-gated), health, rotation, retention
│  └─ user-log-server.js            # POST /userlog/record (form or JSON), same-origin guard
├─ src/
│  ├─ index.jsx, OpenDocViewer.jsx, styles.css, i18n.js
│  ├─ components/
│  │  ├─ AppBootstrap.jsx
│  │  ├─ DocumentViewer/…           # viewer container, toolbar, thumbnails
│  │  └─ DocumentToolbar/…          # print dialog, zoom, theme toggle
│  ├─ integrations/
│  │  ├─ Bootstrap.js, parentBridge.js, sessionToken.js, urlParams.js
│  │  ├─ normalizeBundle.js
│  │  └─ UserLogController.js
│  ├─ utils/
│  │  ├─ printCore.js, printDom.js, printParse.js, printTemplate.js, printSanitize.js, printUtils.js
│  │  └─ zoomUtils.js, navigationUtils.js
│  ├─ LogController.js              # console + optional HTTP forwarding
│  └─ PerformanceMonitor.jsx
├─ scripts/
│  ├─ Manage-ODV-LogServers.ps1     # start/stop Node log servers (Windows)
│  ├─ Setup-IIS-ODVProxy.ps1        # create IIS app that proxies → Node servers
│  └─ Test-ODV-IISProxy.ps1         # smoke-tests proxy endpoints
├─ web.config                        # SPA hosting on IIS (no proxy rules here; use separate app)
├─ package.json, vite.config.js, eslint.config.js, jsdoc.json
└─ dist/                             # production build (after `npm run build`)
```

---

## Security & privacy notes

* **System Log server** requires a shared token via `x-log-token`. Never expose it to untrusted clients.
* **User Log server** performs a **same-origin check** and rate limits inputs; it does not read/set cookies.
* **Print overlay tokens** are HTML-escaped before substitution.
* **IIS security headers** (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) are set by default; HSTS is commented (enable only on always-HTTPS sites).
* **Caching**: `index.html` and `odv.config.js` are served with `no-store`.

---

## Design notes & gotchas

* **pdf.js worker parity**: The app sets a single `pdfjs-dist` worker URL so **dev == prod**. Keep the worker version aligned with the API version.
* **TIFF memory**: Multi-page TIFFs render on the main thread to minimize peak memory and differences between environments.
* **Worker batching**: Image processing scales with logical cores and device memory; low-core devices use a sequential scheduler to preserve responsiveness.
* **`file-type` import**: Elsewhere in the project we import from the **root** `'file-type'` package, **not** `'file-type/browser'`. With v21 the `/browser` subpath is not exported and will break Vite builds.
* **No rebuilds for ops**: Most operational tweaks (endpoints, policies, i18n version, toggles) live in runtime config.

---

## License

MIT — see `LICENSE`.
