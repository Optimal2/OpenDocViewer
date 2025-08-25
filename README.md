# OpenDocViewer

OpenDocViewer is a fast, lightweight, MIT-licensed document viewer built with **React + Vite**. It supports PDFs, TIFFs, and common image formats (JPG/PNG), with thumbnails, zoom, fit-to-screen/width, keyboard navigation, and a side-by-side comparison mode. A small Express log server is included for structured, token-gated frontend logging.

---

## Table of contents

* [Features](#features)
* [Requirements](#requirements)
* [Quick start (development)](#quick-start-development)
* [Build & preview (production)](#build--preview-production)
* [Deploying the build](#deploying-the-build)
* [Runtime config (`/odv.config.js`)](#runtime-config-odvconfigjs)
* [Embedding & usage](#embedding--usage)
* [Logging backend](#logging-backend)
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
* **Runtime configuration** via `/odv.config.js` (no rebuild required)
* **Structured logging** (frontend → backend) with rotation and token-gated ingestion

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

> **IIS example:** Use URL Rewrite for SPA fallback and set a `no-store` cache policy for `index.html` and `odv.config.js`. The supplied `web.config` demonstrates this pattern.

---

## Runtime config (`/odv.config.js`)

OpenDocViewer reads a tiny runtime config at page load so you can tweak behavior **without rebuilding**. Add this file to the web root and include it **before** your app bundle in `index.html`.

```html
<!-- /odv.config.js -->
<script>
  window.__ODV_CONFIG__ = {
    // UI & safety toggles (defaults are safe for production)
    exposeStackTraces: false,   // show error details (true in dev, false in prod)
    showPerfOverlay: false,     // performance HUD overlay

    // Optional logging backend (see “Logging backend” below)
    logEndpoint: "",            // e.g. "http://localhost:3001/log"
    logToken: ""                // shared token sent in x-log-token
  };
</script>
```

> You can also feed the same values through `<meta>` tags or Vite env (see `src/LogController.js`). The runtime config ensures **portable builds** can be tuned by ops without a rebuild.

---

## Embedding & usage

OpenDocViewer’s main component is `OpenDocViewer.jsx`. You can render via two input styles:

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
      bundle={{ title: 'Demo bundle' }}   // optional metadata (reserved for future)
    />
  );
}
```

**Example (pattern mode):**

```jsx
<OpenDocViewer folder="/images/pages" extension="jpg" endNumber={42} />
```

> The viewer is wrapped internally with `ThemeProvider` and `ViewerProvider`. A performance HUD can be toggled at runtime (`showPerfOverlay`), and error detail exposure (`exposeStackTraces`) is also runtime-controlled (see `/odv.config.js`).

---

## Logging backend

A tiny Express app receives logs (structured JSON/NDJSON) with rotation and retention.

```bash
# Start the log server only
npm run start:log-server

# Run dev server + log server together
npm run dev:both
```

**Environment variables** (place in `.env` next to `server.js`):

* `PORT` — log server port (default `3001`)
* `LOG_TOKEN` — required in production; the frontend sends this as `x-log-token`
* `ALLOWED_ORIGINS` — comma-separated list for CORS on `/log` (e.g., `https://yourapp.example`)
* `TRUST_PROXY` — set to your proxy hops (e.g., `1`) if behind a reverse proxy
* `LOG_RETENTION_DAYS` — rotate/delete logs after N days (default `14`)
* `JSON_LIMIT` — max JSON body size (default `64kb`)
* **Log files directory:** `./logs/` (created automatically)

**Frontend hookup:** Set `logEndpoint` and `logToken` in `/odv.config.js`, a `<meta name="odv-log-endpoint" ...>`, or Vite env (`VITE_LOG_ENDPOINT`, `VITE_LOG_TOKEN`). The viewer posts logs to `/log` with the token header.

---

## JSDoc (API docs)

Generate developer documentation into `docs/`:

```bash
npm run doc
```

This runs JSDoc with the provided `jsdoc.json` and the **docdash** template, scanning the `src/` tree for `.js/.jsx` files and writing to `./docs/`. The README is used as the landing page.

---

## Linting & formatting

* **ESLint** (React + hooks + Vite refresh configs)

  ```bash
  npm run lint
  npm run lint:fix
  ```

  The ESLint setup extends `@eslint/js` recommended rules, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`; it ignores `dist/`.

* **Prettier** formatting

  ```bash
  npm run format
  ```

---

## Project structure

```
OpenDocViewer/
├─ public/                          # static assets (placeholder.png, lost.png, favicon, ...)
│  ├─ jpg/ mix/ pdf/ png/ tif/      # sample/demo content (optional)
├─ src/
│  ├─ components/
│  │  ├─ DocumentLoader/            # fetch, detect types, schedule workers or main-thread renderers
│  │  │  ├─ sources/ExplicitListSource.js
│  │  │  ├─ BatchHandler.js
│  │  │  ├─ DocumentLoader.js
│  │  │  ├─ MainThreadRenderer.js
│  │  │  ├─ Utils.js
│  │  │  └─ WorkerHandler.js
│  │  ├─ DocumentToolbar/           # toolbar UI (paging, zoom, theme, printing)
│  │  │  ├─ DocumentToolbar.jsx
│  │  │  ├─ PageNavigationButtons.jsx
│  │  │  ├─ PrintRangeDialog.jsx
│  │  │  ├─ PrintRangeDialog.module.css
│  │  │  ├─ ThemeToggleButton.jsx
│  │  │  └─ ZoomButtons.jsx
│  │  ├─ DocumentViewer/            # container + layout for viewer panes
│  │  │  ├─ DocumentViewer.jsx
│  │  │  ├─ DocumentViewerRender.jsx
│  │  │  ├─ DocumentViewerThumbnails.jsx
│  │  │  ├─ DocumentViewerToolbar.jsx
│  │  │  └─ useDocumentViewer.js
│  │  ├─ AppBootstrap.jsx
│  │  ├─ CanvasRenderer.jsx
│  │  ├─ DocumentConsumerWrapper.jsx
│  │  ├─ DocumentRender.jsx
│  │  ├─ DocumentThumbnailList.jsx
│  │  ├─ ImageRenderer.jsx
│  │  ├─ LoadingMessage.jsx
│  │  ├─ LoadingSpinner.jsx
│  │  └─ Resizer.jsx
│  ├─ hooks/
│  │  ├─ usePageNavigation.js
│  │  └─ usePageTimer.js
│  ├─ integrations/                  # bootstrap modes, session/URL, parent bridge
│  │  ├─ Bootstrap.js
│  │  ├─ events.js
│  │  ├─ normalizeBundle.js
│  │  ├─ parentBridge.js
│  │  ├─ sessionToken.js
│  │  └─ urlParams.js
│  ├─ schemas/
│  │  └─ portableBundle.js
│  ├─ types/
│  │  └─ jsdoc-types.js
│  ├─ utils/
│  │  ├─ navigationUtils.js
│  │  ├─ printUtils.js
│  │  └─ zoomUtils.js
│  ├─ workers/
│  │  └─ imageWorker.js
│  ├─ ErrorBoundary.jsx
│  ├─ index.jsx
│  ├─ LogController.js
│  ├─ OpenDocViewer.jsx
│  ├─ OptiViewer.js
│  ├─ PerformanceMonitor.jsx
│  ├─ styles.css
│  ├─ ThemeContext.jsx
│  └─ ViewerContext.jsx
├─ logs/                            # log server output (rotated)
├─ server.js                        # Express log server
├─ vite.config.js                   # Vite + React; workers built as ES modules
├─ jsdoc.json                       # JSDoc config (docdash)
├─ eslint.config.js                 # ESLint config (React, hooks, Vite refresh)
├─ index.html
├─ logger.js                        # legacy/simple client for log server (standalone)
├─ LICENSE
├─ package.json
├─ package-lock.json
└─ README.md
```

> **Note:** The `dist/`, `docs/`, and `node_modules/` folders are generated/installed and typically excluded from source control. The `public/*` subfolders may contain demo assets.

---

## Design notes & gotchas

* **File type detection (very important):**
  Import from `'file-type'` (root) rather than `'file-type/browser'` to match the package’s exports and avoid bundling failures in Vite with the current version (`^21`). If you upgrade `file-type`, re-validate the exports and adjust imports accordingly.

* **PDF worker versioning:**
  `pdfjs-dist` API and worker versions must match. Vite is configured to build web workers as ES modules.

* **TIFF rendering strategy:**
  Multi-page TIFFs are processed in the **main thread** to avoid duplicating buffers per page, reducing peak memory usage on large inputs.

* **Adaptive workers & batch size:**
  Worker counts are derived from `navigator.hardwareConcurrency`, typically leaving one logical core for the UI and clamping on low-memory/mobile devices. On ≤ 3 cores, the scheduler prefers sequential processing for smoother UX.

* **Security / diagnostics toggles:**
  `exposeStackTraces` and `showPerfOverlay` live in **runtime config** (`/odv.config.js`), so you can change them post-deploy.

* **Caching guidance:**
  Keep `index.html` and `odv.config.js` **uncached** (`Cache-Control: no-store`), and long-cache hashed assets generated by Vite.

---

## License

MIT — see `LICENSE`.
