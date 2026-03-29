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
- [Release workflow](#release-workflow)
- [Hosting and deployment](#hosting-and-deployment)
- [Runtime configuration](#runtime-configuration)
- [Printing](#printing)
- [Logging](#logging)
- [Operations and deployment](#operations-and-deployment)
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
  - Deterministic thumbnail pane with keyboard-friendly selection, compare badges, and width controls
  - Lazy full-page / thumbnail rendering with bounded cache sizes
  - Basic visual image adjustments for raster pages (rotation, brightness, contrast)
- **Printing**
  - Current page, all pages, range, and explicit sequence printing
  - Optional print-header overlay with template tokens
- **Runtime flexibility**
  - Runtime config through `public/odv.config.js`
  - Configurable large-document loading thresholds, adaptive memory heuristics, prefetch concurrency, and cache limits
  - Adaptive browser temp storage (memory -> IndexedDB) for original source bytes
  - Optional persisted page-asset storage so rendered full pages / thumbnails can be reused without re-rendering
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
- `docs-src/log-servers.md`
  - logging endpoint contracts, retention, proxy patterns, and security assumptions
- `docs-src/deploy-ops.md`
  - IIS hosting, proxy deployment, cache rules, and operational checklists
- `docs-src/printing.md`
  - print pipeline design and the responsibilities of the print helper modules
- `docs-src/integrations.md`
  - bootstrap modes, host payload shapes, and where integration logic belongs
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
- Primary target browsers: Microsoft Edge and Google Chrome (Chromium)
- Firefox may work for basic viewing, but it is not the primary support target and may differ in diagnostics and some HTML input-validation behavior
- Safari is not the primary operational target
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

## Release workflow

For a normal release candidate, validate locally first:

```bash
npm ci
npm run lint
npm run build
npm run doc
```

Then run the PowerShell helper from the repo root on Windows:

```powershell
.\release.ps1
```

The release helper now runs the same local validation steps (`lint`, `build`, `doc`) before it creates a release commit. After validation passes, it will:

1. stage and commit the current working changes
2. run `npm version <patch|minor|major>` to create the version-bump commit and Git tag
3. push the branch and tag to `origin`

The pushed tag triggers `.github/workflows/release.yml`, which builds the production bundle and generated docs, packages them as zip files, and publishes the GitHub release assets.

Use GitHub Desktop for review if you want, but you do not need to create or push the release commits manually unless you explicitly prefer that workflow.

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
- i18n defaults and translation loading (now cache-busted automatically per build)
- print-header overlay
- user print logging
- system logging
- application base path/base href
- large-document loading (`documentLoading`) for warnings, temp storage, lazy rendering, and cache limits

For deployment and precedence details, see `docs-src/runtime-configuration.md`.

---


### Adaptive large-document loading

The viewer now supports a two-phase loading pipeline for large batches:

1. prefetch original source files early, which helps when bootstrap URLs are short-lived or tokenized
2. store original bytes in memory or IndexedDB depending on configured thresholds
3. analyze page counts in stable order from the freshly fetched blob when possible
4. render thumbnails and full pages on demand
5. persist rendered page blobs in a second cache layer so later navigation and printing can usually reuse the same blob without re-rendering
6. keep the thumbnail scrollbar deterministic while object URLs are only evicted from RAM when configured limits are actually reached

This reduces heap pressure substantially compared with eager rendering and also enables a warning dialog
before continuing clearly large runs. The shipped defaults now favor stability/performance and only
move into more conservative memory behavior when the browser signals lower headroom or when a site
explicitly overrides the thresholds in `odv.site.config.js`. The relevant knobs live under
`documentLoading` in `public/odv.config.js`.

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

For the logging server contract and reverse-proxy examples, see `docs-src/log-servers.md`.


### User print log

Client code lives in `src/logging/userLogger.js` and records user print metadata such as reason / recipient, depending on runtime policy. Runtime default: disabled until explicitly enabled in `odv.site.config.js`.

### System log

Client code lives in `src/logging/systemLogger.js`. Runtime default: disabled until explicitly enabled in `odv.site.config.js`.
Optional ingestion servers live in:

- `server/system-log-server.js`
- `server/user-log-server.js`

These are intentionally separate from the static frontend so deployments can choose whether to enable them.

---

## Operations and deployment

For IIS-specific hosting, proxy setup, cache guidance, and ops checklists, see `docs-src/deploy-ops.md`.

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
- **If Firefox shows console warnings such as `Unable to check <input pattern=...>`**
  - treat them as browser-specific validation noise first
  - OpenDocViewer is primarily validated for Chromium browsers (Edge/Chrome)
- **If the performance overlay shows no heap numbers**
  - heap metrics rely on Chromium's `performance.memory` API
  - non-Chromium browsers such as Firefox will show `N/A` instead of heap usage values

---

## License

MIT — see `LICENSE`.
