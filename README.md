# OpenDocViewer

OpenDocViewer is a client-side **React + Vite** document viewer for **PDF**, **TIFF**, and common raster image formats. The project is designed to be deployable as static files, with optional companion log servers for operational tracing and print auditing.

The codebase now has three documentation layers:

- `README.md` — product-level overview, setup, deployment, and developer workflow
- `CONTRIBUTING.md` — repository conventions, naming rules, and review checklist
- `docs-src/` — deeper architecture and runtime-configuration notes for maintainers

---

## Table of contents

- [Features](#features)
- [Documentation map](#documentation-map)
- [Architecture overview](#architecture-overview)
- [Bootstrap modes](#bootstrap-modes)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Build, preview, and generated docs](#build-preview-and-generated-docs)
- [Hosting and deployment](#hosting-and-deployment)
- [Runtime configuration](#runtime-configuration)
- [Printing](#printing)
- [Logging](#logging)
- [Project structure](#project-structure)
- [Development conventions](#development-conventions)
- [Troubleshooting notes](#troubleshooting-notes)
- [License](#license)

---

## Features

- **Document formats**
  - PDF via `pdfjs-dist`
  - TIFF via `utif2`
  - Common image formats such as JPG and PNG
- **Viewer behavior**
  - Fit-to-page and fit-to-width sticky zoom modes
  - Explicit zoom controls, typed zoom percentage, and 1:1 mode
  - Optional comparison view with independent per-pane post-zoom
  - Thumbnail strip with keyboard-friendly selection
  - Basic visual image adjustments for raster pages (rotation, brightness, contrast)
- **Printing**
  - Current page, all pages, range, and explicit sequence printing
  - Optional print-header overlay with template tokens
- **Runtime flexibility**
  - Runtime config through `public/odv.config.js`
  - Multiple bootstrap sources: demo, URL parameters, session token, parent window, JS API
- **Optional operational support**
  - User print logging
  - System logging
  - Performance overlay for troubleshooting

---

## Documentation map

Use the following files depending on what you are trying to understand:

- `README.md`
  - product scope, setup, deployment, and quick orientation
- `CONTRIBUTING.md`
  - naming conventions, `js`/`jsx` policy, review expectations
- `docs-src/architecture.md`
  - module responsibilities and request/data flow through the app
- `docs-src/runtime-configuration.md`
  - runtime config loading order, override rules, and deployment notes
- `src/types/jsdoc-types.js`
  - shared JSDoc-only callback/type aliases used across the UI

---

## Architecture overview

At a high level the application is split into five layers:

1. **Boot and startup**
   - `src/app/bootConfig.js`
   - `src/app/AppBootstrap.jsx`
   - `src/integrations/*`
2. **Application shell and providers**
   - `src/app/OpenDocViewer.jsx`
   - `src/contexts/*`
3. **Document loading and rendering**
   - `src/components/DocumentLoader/*`
   - `src/components/DocumentRender.jsx`
   - `src/components/ImageRenderer.jsx`
   - `src/components/CanvasRenderer.jsx`
4. **Viewer interaction**
   - `src/components/DocumentViewer/*`
   - `src/components/DocumentToolbar/*`
   - `src/hooks/*`
   - `src/utils/*`
5. **Operational support**
   - `src/logging/*`
   - `server/*`
   - `public/odv-admin.html`

For a deeper walkthrough, see `docs-src/architecture.md`.

---

## Bootstrap modes

The viewer can start in several different ways. `src/integrations/bootstrapRuntime.js` probes them in priority order.

- **Parent page**
  - same-origin host page passes bootstrap data through `window.parent`
- **Session token**
  - bootstrap data is supplied through a URL token/payload
- **URL parameters**
  - legacy pattern mode using folder + extension + end number
- **JS API**
  - host code calls `window.ODV.start(...)`
- **Demo mode**
  - fallback that builds a sample source list from files in `public/`

This lets the same build work for demo use, embedded use, and host-integrated deployments.

---

## Requirements

- **Node.js 18+**
- Modern browser engines (Chromium, Firefox, Safari)
- Static hosting for the built frontend
- Optional: Node.js runtime for the log servers under `server/`

---

## Quick start

```bash
git clone https://github.com/Optimal2/OpenDocViewer.git
cd OpenDocViewer
npm install
npm run dev
```

Open the local Vite URL, typically `http://localhost:5173`.

---

## Build, preview, and generated docs

```bash
# Production build
npm run build

# Local preview of dist/
npm run preview

# JSDoc site (generated into ./docs/)
npm run doc
```

The generated JSDoc output is not intended to be committed. The hand-written source documentation lives in `README.md`, `CONTRIBUTING.md`, and `docs-src/`.

---

## Hosting and deployment

The frontend is static. Deploy `dist/` to IIS, Nginx, Apache, S3/CloudFront, or another static host.

Important deployment rules:

- Serve `index.html` as the SPA fallback for unknown routes.
- Do not long-cache `index.html` or `odv.config.js`.
- Fingerprinted assets under Vite output can be long-cached.
- If using the log servers, proxy them separately rather than mixing them into the static host process.

IIS-specific helper files and scripts are included in:

- `public/web.config`
- `IIS-ODVProxyApp/`
- `scripts/`

---

## Runtime configuration

Runtime config is loaded before the React application starts.

Loading order:

1. optional `odv.site.config.js`
2. required `odv.config.js`
3. React bootstrap from `src/index.jsx`

The config covers areas such as:

- diagnostics
- i18n defaults and translation loading
- print-header overlay
- user print logging
- system logging
- application base path/base href

For deployment and precedence details, see `docs-src/runtime-configuration.md`.

---

## Printing

The print pipeline lives mainly under:

- `src/utils/printCore.js`
- `src/utils/printDom.js`
- `src/utils/printTemplate.js`
- `src/utils/printParse.js`
- `src/components/DocumentToolbar/PrintRangeDialog.jsx`

Key design points:

- printing uses a hidden iframe instead of popups
- current page printing prefers the renderer’s active canvas/image
- multi-page printing can use ordered full-size URLs and page metadata
- optional header overlays are injected into the print iframe DOM

---

## Logging

### User print log

Client code lives in `src/logging/userLogger.js` and records user print metadata such as reason / recipient, depending on runtime policy.

### System log

Client code lives in `src/logging/systemLogger.js`.
Optional ingestion servers live in:

- `server/system-log-server.js`
- `server/user-log-server.js`

These are intentionally separate from the static frontend so deployments can choose whether to enable them.

---

## Project structure

```text
OpenDocViewer/
├─ public/
│  ├─ odv.config.js
│  ├─ odv.site.config.sample.js
│  └─ demo assets and static files
├─ server/
│  ├─ system-log-server.js
│  └─ user-log-server.js
├─ src/
│  ├─ app/
│  │  ├─ AppBootstrap.jsx
│  │  ├─ OpenDocViewer.jsx
│  │  └─ bootConfig.js
│  ├─ components/
│  │  ├─ DocumentLoader/
│  │  ├─ DocumentToolbar/
│  │  ├─ DocumentViewer/
│  │  └─ shared render/support components
│  ├─ contexts/
│  ├─ integrations/
│  ├─ logging/
│  ├─ styles/
│  ├─ types/
│  ├─ utils/
│  └─ workers/
├─ docs-src/
├─ CONTRIBUTING.md
└─ README.md
```

---

## Development conventions

The repository conventions are documented in `CONTRIBUTING.md`. The most relevant rules are:

- `*.jsx` for files that contain JSX
- `*.js` for hooks, utilities, integrations, workers, loggers, and other non-JSX modules
- `PascalCase` for React components
- `camelCase` for non-component modules
- update comments and JSDoc when changing module responsibilities

---

## Troubleshooting notes

- **If `npm ci` stalls or times out in CI**
  - check `package-lock.json` for environment-specific `resolved` URLs
  - verify `.npmrc` and GitHub Actions use `https://registry.npmjs.org`
- **If the app starts without runtime config**
  - inspect `src/app/bootConfig.js`
  - check that `odv.config.js` is reachable with a JavaScript content type
- **If embedded bootstrap fails**
  - inspect `src/integrations/bootstrapRuntime.js`
  - confirm same-origin access for parent-window mode
- **If print output differs from the viewer**
  - check whether the current page is rendered via canvas or plain image
  - inspect `src/utils/printCore.js` and `src/utils/printDom.js`

---

## License

MIT — see `LICENSE`.
