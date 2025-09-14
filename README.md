# OpenDocViewer

OpenDocViewer is a fast, lightweight, MIT-licensed **React + Vite** viewer for **PDF**, **TIFF**, and common images (**JPG/PNG**). It ships with thumbnails, sticky zoom modes, comparison view, printing helpers, localized UI (i18next), and optional logging. It is 100% client-side and deploys as static files.

---

## Table of contents

* [Features](#features)
* [What’s new](#whats-new)
* [Architecture overview](#architecture-overview)
* [Requirements](#requirements)
* [Quick start (development)](#quick-start-development)
* [Build & preview (production)](#build--preview-production)
* [Hosting & deployment](#hosting--deployment)
* [Runtime configuration](#runtime-configuration)
* [Internationalization (i18n)](#internationalization-i18n)
* [Printing](#printing)
* [Logging (optional)](#logging-optional)
* [Keyboard & mouse shortcuts](#keyboard--mouse-shortcuts)
* [Accessibility](#accessibility)
* [Project structure](#project-structure)
* [Contributing & quality](#contributing--quality)
* [License](#license)

---

## Features

* **Formats**

  * PDF and multi-page TIFF render reliably (main thread), single images use a worker pipeline
  * JPG/PNG render via `<img>` or `<canvas>` as needed (rotation/filters)
* **Viewer**

  * **Sticky Fit** modes: **Fit to page** and **Fit to width** re-compute on page/rotate/resize
  * **Zoom**: +/− buttons, **Ctrl/Cmd + mouse wheel**, and editable **percentage** field
  * **Compare mode**: side-by-side pages with **per-pane post-zoom** (floating controls)
  * **Thumbnails** with keyboard activation and stable scrolling
  * **Edit tools** (per page): rotate ±90°, brightness, contrast (visual only; printing unaffected)
  * **Focus warning** button appears when shortcuts are inactive (focus left the viewer)
* **Printing**

  * Active page / All / Range (ascending/descending) / **Custom sequence**
  * Optional **header overlay** with tokens (date/time/page/reason/forWhom/etc.)
* **Runtime configurable**

  * `/odv.config.js` with optional site overrides in `/odv.site.config.js` (no rebuild)
* **Optional logging**

  * **User Print Log** (reason/for whom), **System Log** (structured events)

---

## What’s new

Recent highlights:

* **Per-pane post-zoom in comparison view**
  Floating overlay per pane (top-center) applies a multiplicative factor on top of base zoom. Independent left/right fine-tuning without altering sticky fit or global zoom.

* **Editable zoom with a `%` suffix**
  Zoom box always shows percent when unfocused (e.g., `125%`), and allows numeric editing when focused (e.g., `125`).

* **Unified, grouped toolbar controls**
  Paging and edit controls are presented in compact “white areas” similar to the zoom group. The **page field is editable**: unfocused shows `X / Y`; focused shows just `X`. Enter/blur applies (clamped), Esc cancels.

* **Compare ↔ Edit mutual exclusivity**
  Edit button disabled while Compare is active and vice versa—no special-case handling required.

* **CSS refactor**
  `src/styles.css` now aggregates modular files: `styles/theme.css`, `styles/layout.css`, `styles/toolbar.css`, `styles/dialogs.css`, `styles/print.css`. The print dialog moved from a CSS Module to global styles under `styles/dialogs.css`.

---

## Architecture overview

* **SPA** built with **React + Vite**

  * Entry: `src/index.jsx`
  * Root: `src/OpenDocViewer.jsx`
* **Rendering**

  * PDF via `pdfjs-dist` (ESM worker configured once, dev == prod)
  * TIFF via `utif2`
  * Images via worker pipeline (batching tuned by cores/device memory)
* **Viewer components**

  * `DocumentViewer/*` — container, renderer, thumbnails, toolbar
  * `DocumentToolbar/*` — zoom, paging, print dialog, theme toggle
  * Hooks split for clarity: `useDocumentViewer`, `hooks/useViewerEffects`, `hooks/useViewerPostZoom`

---

## Requirements

* **Node.js 18+**
* Modern browsers (Chromium/Firefox/Safari). IE is not supported.

---

## Quick start (development)

```bash
git clone https://github.com/Optimal2/OpenDocViewer.git
cd OpenDocViewer
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

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

The build is **static**. Deploy `dist/` to any static host (IIS, Nginx, Apache, S3/CloudFront, GitHub Pages, …).

* **SPA fallback:** serve `index.html` for unknown routes.
* **Caching:** long-cache fingerprinted assets; **do not** long-cache `index.html` or `odv.config.js` (serve with `Cache-Control: no-store`).

### IIS

A production `web.config` is included (SPA fallback, MIME types, compression, security headers). Keep Node log servers (if used) as **separate apps** and proxy them (e.g., `/ODVProxy/log`, `/ODVProxy/userlog/record`).

---

## Runtime configuration

Loaded **before** the app starts:

1. Determine base path (supports virtual directories).
2. Load optional site overrides: `/odv.site.config.js`.
3. Load required defaults: `/odv.config.js`.

Config covers:

* **Diagnostics:** `exposeStackTraces`, `showPerfOverlay`
* **Mount:** `basePath`, `baseHref`
* **i18n:** `default`, `supported`, `loadPath`, `version`
* **User Print Log:** `enabled`, `endpoint`, `transport`, UI policy & validation
* **Print header overlay:** `enabled`, `position`, `applyTo`, `heightPx`, `template`, `css`
* **System Log:** `enabled`, `endpoint`, `token`

Admins can use `/odv-admin.html` to inspect and save site overrides (File System Access API where supported).

---

## Internationalization (i18n)

* Libraries: `i18next`, `react-i18next`, `i18next-icu`
* Early language/meta applied in `index.html` for localized shell
* Translations under `public/locales/{lng}/common.json`
* Set `i18n.version` in config to bust caches

---

## Printing

* **Modes:** Active page / All / Range / Custom sequence
* **Dialog UX:** Basic and Advanced sections, optional **Reason** and **For whom** inputs (policy driven)
* **Transport:** Prefers `sendBeacon` for same-origin; falls back to `fetch({keepalive:true})`
* **Header overlay:** Tokenized template (e.g., `page`, `totalPages`, `date`, `reason`, `forWhom`, `viewer.version`) and scoped print CSS

Developer helpers (`src/utils/printUtils.js`):

```js
import {
  handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence, parsePrintSequence
} from './src/utils/printUtils.js';
```

---

## Logging (optional)

### User Print Log

* Client in `UserLogController` posts to configurable endpoint
* JSON or form transports
* Non-blocking; printing proceeds even if logging fails

### System Log

* Simple Node/Express ingestion with token auth, rate limiting, rotation & retention
* Intended for infrastructure logs; usually proxied behind IIS

---

## Keyboard & mouse shortcuts

* **General navigation**

  * `PageDown`/`ArrowRight`/`ArrowDown` → next page
  * `PageUp`/`ArrowLeft`/`ArrowUp` → previous page
  * `Home` → first page
  * `End` → last page
* **Zoom**

  * `Ctrl/Cmd + Wheel` → zoom document (prevents browser zoom)
  * `+ / -` or Numpad `+ / -` → zoom in/out
  * `1` → **1:1 (100%)** and switch to custom zoom
  * `2` → **Fit to page**
  * `3` → **Fit to width**
* **Modes**

  * `4` → Toggle **Compare**
  * `5` → Toggle **Edit tools**
  * `6` → Toggle **Theme**

> While in **Compare**, edit is disabled. While in **Edit**, compare is disabled.

---

## Accessibility

* Thumbnails use listbox semantics with keyboard activation
* Toolbar buttons include `aria-label`/`title`
* Compare overlay buttons are reachable and labeled
* Dialogs are focus-trapped, labeled, and keyboard-operable
* Inputs expose `spinbutton` semantics where appropriate

---

## Project structure

```
OpenDocViewer/
├─ public/
│  ├─ locales/{en,sv}/common.json
│  ├─ odv.config.js
│  ├─ odv.site.config.sample.js
│  └─ assets for demo/tests…
├─ src/
│  ├─ index.jsx, OpenDocViewer.jsx
│  ├─ styles.css                   # aggregator only
│  ├─ styles/
│  │  ├─ theme.css                 # variables, base, dark/light
│  │  ├─ layout.css                # viewer shell, renderers, thumbnails, overlays
│  │  ├─ toolbar.css               # toolbar groups, zoom/page inputs, edit tools
│  │  ├─ dialogs.css               # global dialog styles (print dialog, etc.)
│  │  └─ print.css                 # @media print rules
│  ├─ components/
│  │  ├─ DocumentViewer/
│  │  │  ├─ useDocumentViewer.js
│  │  │  ├─ hooks/useViewerEffects.js
│  │  │  ├─ hooks/useViewerPostZoom.js
│  │  │  ├─ DocumentViewer.jsx / DocumentViewerRender.jsx / …
│  │  │  └─ CompareZoomOverlay.jsx
│  │  └─ DocumentToolbar/
│  │     ├─ DocumentToolbar.jsx
│  │     ├─ ZoomButtons.jsx
│  │     ├─ PageNavigationButtons.jsx
│  │     ├─ PrintRangeDialog.jsx
│  │     └─ PrintRangeDialog.controller.js
│  ├─ utils/ (printing, zoom, navigation…)
│  └─ integrations/ (normalization, bridges, token boot, URL patterns…)
└─ dist/ (after build)
```

---

## Contributing & quality

* **Type & API docs:** `npm run doc` (JSDoc + docdash)
* **Lint & format:** `npm run lint`, `npm run lint:fix`, `npm run format`
* **PR guidelines**

  * Keep components small; prefer hooks for cross-cutting effects
  * Maintain JSDoc comments (no TS types required)
  * Favor accessible labels/roles and keyboard paths
  * Add i18n keys for new strings in `public/locales/*/common.json`

---

## License

MIT — see `LICENSE`.
