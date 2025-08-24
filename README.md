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

* **PDF, TIFF, JPG/PNG** viewing with main-thread fallbacks when workers are unavailable.
* **Virtualized thumbnail list** for large documents.
* **Zoom, fit-to-screen/width**, keyboard navigation, and **comparison mode**.
* **Portable build** (static assets in `dist/`) that runs on any static host.
* **Runtime configuration** via `/odv.config.js` (no rebuild required).
* **Structured logging** (frontend → backend) with daily rotation, rate limiting, and token-gated ingestion.

---

## Requirements

* **Node.js 18+** and npm
* Modern browser (Chromium / Firefox / Safari) for best performance

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

* **SPA routing:** configure a fallback so unknown routes serve `index.html`.
* **Caching:** long-cache hashed assets; **do not** long-cache `index.html` or `odv.config.js`. Recommended header for both: `Cache-Control: no-store`.

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
    { url: '/docs/spec.pdf' },           // PDF (auto-detected)
    { url: '/scans/scan01.tif' },        // single-page TIFF
    { url: '/images/page-01.png' },      // PNG
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

A tiny Express app receives logs (structured NDJSON) with daily rotation and retention.

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

* **ESLint** (React + hooks + Vite refresh configs). Run:

  ```bash
  npm run lint
  npm run lint:fix
  ```

  The ESLint setup extends `@eslint/js` recommended rules, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`; it ignores `dist/` and treats UPPER\_SNAKE\_CASE globals as intentionally unused.

* **Prettier** formatting:

  ```bash
  npm run format
  ```

---

## Project structure

```
OpenDocViewer/
├─ public/                 # static assets (placeholder.png, lost.png, favicon, ...)
├─ src/
│  ├─ components/          # UI (viewer, toolbar, thumbnails, renderers)
│  ├─ integrations/        # bootstrap, parent bridge, URL/session token readers
│  ├─ hooks/               # navigation, timers
│  ├─ workers/             # image/PDF processing workers
│  ├─ utils/               # zoom/print/navigation utils
│  ├─ OpenDocViewer.jsx    # main viewer component
│  ├─ index.jsx            # app entry
│  └─ styles.css
├─ server.js               # Express log server
├─ vite.config.js          # Vite + React + SVGR; workers built as ES modules
├─ jsdoc.json              # JSDoc config (docdash)
├─ eslint.config.js        # ESLint config (React, hooks, Vite refresh)
├─ package.json            # scripts, deps, devDeps
└─ README.md               # this file
```

---

## Design notes & gotchas

* **File type detection (very important):**
  We intentionally import from `'file-type'` **not** `'file-type/browser'`. With our current version (`^21`), the `/browser` entry is **not** exported in the package’s exports map and will fail bundling in Vite. Using the root import is compatible in the browser build and our bundler includes only what’s needed. If you upgrade `file-type`, re-validate the exports and adjust imports accordingly.

* **PDF worker versioning:**
  We use `pdfjs-dist` and ensure the **API and worker versions match**. The Vite config builds web workers as **ES modules** (`worker.format = 'es'`) to avoid interop issues.

* **TIFF rendering strategy:**
  Multi-page TIFFs are processed in the **main thread** to avoid duplicating buffers per page, which reduces peak memory usage on large inputs.

* **Adaptive workers & batch size:**
  We compute worker counts from `navigator.hardwareConcurrency`, leaving one logical core for the UI when possible, and clamp the maximum on low-memory/mobile devices. On ≤3 cores, we switch to a sequential scheduler for smoother UX.

* **Security / diagnostics toggles:**

  * `exposeStackTraces` (default **false**): hides stack traces from end users in production; turn it on only for trusted dev environments.
  * `showPerfOverlay` (default **false**): performance HUD mount; useful for profiling, should remain off in prod unless needed.
  * Both toggles live in **runtime config** (`/odv.config.js`) so you can change them post-deploy.

* **Caching guidance:**
  Keep `index.html` and `odv.config.js` **uncached** (`Cache-Control: no-store`), and long-cache hashed assets generated by Vite.

---

## Available npm scripts (reference)

* `dev`, `build`, `preview` — Vite lifecycle
* `start:log-server` — start the log server (`server.js`)
* `dev:both` — run dev server + log server concurrently
* `lint`, `lint:fix`, `format` — quality & formatting
* `doc` — generate JSDoc to `docs/`
  (See `package.json` for the authoritative list.)

---

## License

MIT — see `LICENSE`.
