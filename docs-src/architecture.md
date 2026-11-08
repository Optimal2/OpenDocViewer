# Architecture notes

This document is a maintainer-oriented overview of the main runtime flow. It names the modules
that own each responsibility so a change can be placed correctly; it does not repeat the
configuration reference (`runtime-configuration.md`), the host contract (`integrations.md`) or
the print pipeline details (`printing.md`).

## Startup flow

1. `index.html`
   - carries the fallback CSP as a `<meta>` tag (kept in lockstep with `public/web.config`)
   - runs one inline script that sets `<html lang>` and the title from `localStorage.i18nextLng`
     or the browser language before React mounts; the CSP hash covers exactly that script
   - loads `src/app/bootConfig.js` as a module with the `data-odv-bootstrap` attribute
2. `src/app/bootConfig.js`
   - resolves the application base path from the document URL
   - probes `odv.site.config.js` (optional) and `odv.config.js` (required) with a HEAD/GET request
     and only injects them as classic scripts when the response has a JavaScript content type,
     so an SPA fallback page is never executed as configuration
   - honours optional Subresource Integrity values from `data-odv-*-integrity` attributes
   - records a site-config status in `window.__ODV_SITE_CONFIG_STATUS__` when the site file was
     found but not applied
   - imports `src/index.jsx` only after configuration is available
3. `public/odv.config.js`
   - builds the default configuration, deep-merges `window.__ODV_SITE_CONFIG__` on top
     (site values win), freezes the result and exposes it as `window.__ODV_CONFIG__` plus the
     read-only getter `window.__ODV_GET_CONFIG__`
4. `src/index.jsx`
   - sets the logger level (`debug` in development, `warn` in production) and mounts the React
     root inside `ThemeProvider`
5. `src/app/AppBootstrap.jsx`
   - detects the active bootstrap mode and prepares props for the main viewer shell
   - renders the demo launcher when no host payload exists
6. `src/app/OpenDocViewer.jsx`
   - wires `ViewerProvider`, the optional performance overlay (`showPerfOverlay` or `?perf=1`)
     and the mobile breakpoint (`window.innerWidth < 600`)
7. `src/components/DocumentConsumerWrapper.jsx`
   - lazy-loads `DocumentLoader`, `DocumentViewer` and `DocumentThumbnailList`
   - bridges loader state into viewer state; below the mobile breakpoint it renders the
     thumbnail-only view instead of the full viewer

All runtime configuration is read through `src/utils/runtimeConfig.js` (`getRuntimeConfig()`);
document-loading, rendering and memory policies are normalized once by
`src/utils/documentLoadingConfig.js`.

## Bootstrap responsibilities

`src/integrations/` holds the startup adapters. `bootstrapRuntime.js` probes them in a fixed
priority order and takes the first source that yields a bundle with at least one document:

1. `sessionUrl.js` - `?sessionurl=` / `?bundleUrl=`: a same-origin JSON fetch (http, https or a
   same-origin `blob:` URL created by the host page; 180 s timeout, 256 MB response limit). An explicit session URL that fails leaves the viewer in
   demo mode with the diagnosis `session-url-unavailable` instead of falling through.
2. `parentBridge.js` - `window.parent.ODV_BOOTSTRAP` / `window.opener.ODV_BOOTSTRAP`, read only
   when the parent is same-origin, cloned before use, and filtered by `sessiondata.caseIds` when
   the URL carries them.
3. `sessionToken.js` - `?sessiondata=`: Base64 JSON with hard size limits (200 000 encoded /
   150 000 decoded characters), parsed with `JSON.parse` only.
4. `urlParams.js` - legacy pattern mode (`folder`, `extension`, `endNumber` and their aliases).
5. `window.ODV.start(payload)` - the JS host API, consumed once from `window.ODV.__pending`.
6. Demo mode - sample files from `public/`.

URL payloads deliberately win over the parent bridge: a gateway integration can run inside a host
page that still exposes its original bootstrap data, and choosing the parent first would silently
bypass the prepared gateway bundle.

`normalizePortableBundle.js` turns every accepted payload shape (a neutral bundle, the object
document model with `PortableDocuments` and `id|ext|path` tickets, a URL array or a single URL)
into one neutral `PortableDocumentBundle` defined in `src/schemas/portableBundle.js`. Unknown host
properties are preserved, except `__proto__`, `prototype` and `constructor`. The rest of the
application does not need to know which bootstrap source was used.

## Loading and rendering pipeline

`src/components/DocumentLoader/DocumentLoader.js` orchestrates a two-phase loading flow tuned for
very large batches. `documentLoading.mode` selects `performance`, `memory` or `auto` (default:
start fast, then degrade one-way toward memory mode under pressure).

High-level flow:

1. `sources/explicitListSource.js` turns the bundle into a stable ordered list of source entries
2. `LoadPressureDialog.jsx` may warn when the run looks too large
3. original source files are prefetched into `src/utils/sourceTempStore.js` (memory, IndexedDB,
   or adaptive promotion; IndexedDB payloads are AES-GCM wrapped with a per-session key), using a
   deliberately conservative concurrency level and limited retry/backoff. Entries with a
   `sourcePackUrl` are fetched as one `ODVSP1` stream instead of one request per file
4. every fetched blob is type-detected from its bytes (`file-type`) and text-like responses such as
   login pages or JSON errors are rejected before they can be cached as a corrupt document
5. page counts are analyzed from the temp store (pdf.js / utif2) while prefetch continues
6. lightweight page placeholders are inserted into `ViewerContext`; failed sources keep their
   position as error placeholders
7. thumbnails and full pages are rendered lazily when the UI requests them and evicted through
   provider-managed LRU caches

Key pieces:

- `src/utils/pageAssetRenderer.js`
  - hybrid renderer: raster images and TIFF go through `pageAssetWorkerPool.js`
    (`src/workers/imageWorker.js`), PDF stays on the main-thread pdf.js path by default with an
    opt-in `pdfPageWorkerPool.js` (`src/workers/pdfPageWorker.js`); every pool falls back to the
    main thread
- `src/utils/pdfResolution.js`
  - pure per-page PDF resolution policy shared by browser and worker renderers: auto mode targets a
    physical resolution (300 dpi by default) bounded by scale and pixel caps; the one-shot boost
    doubles the factor within those caps
- `src/utils/memoryProfile.js` and `src/utils/renderSurfaceBounds.js`
  - runtime memory tier (`low` to `very-high`) from `navigator.deviceMemory` and the JS heap limit,
    and conservative canvas bounds so oversized pages scale down instead of failing allocation
- `src/utils/pageAssetStore.js`
  - browser-side storage for rendered page assets, same adaptive/encrypted model as the temp store,
    so a page is rasterized once per session
- `src/contexts/ViewerProvider.jsx`
  - cache ownership, object-URL lifecycle (`objectUrlRegistry.js`), page-asset pinning, memory
    pressure stages (`normal` / `soft` / `hard`), the PDF resolution boost state and printable page
    URL generation
- `src/utils/reloadCacheIdentity.js` and `reloadCacheCrypto.js`
  - stable cache identities based on document version rather than short-lived file URLs, and the
    key handling for the opt-in reload cache

Rendering responsibilities are split further:

- `DocumentRender.jsx` chooses image vs. canvas presentation for the active page and prefetches
  neighbouring pages
- `ImageRenderer.jsx` handles plain image rendering
- `CanvasRenderer.jsx` handles canvas drawing and visual adjustments (rotation, brightness,
  contrast are drawn into the canvas). It sizes the canvas bitmap imperatively and only when the
  size really changes (`utils/canvasBitmapSize.js`): setting a canvas's width or height clears the
  bitmap even to the same value, and the parent reports the size it drew only after drawing
- `DocumentViewer/*` manages stateful viewer composition, keyboard navigation, zoom effects and
  compare-mode post-zoom
- `DocumentToolbar/*` manages toolbar UI, the print dialog, help/manual/about dialogs, language and
  theme menus

## State ownership

The broad state split is:

- `ViewerContext` (`src/contexts/viewerContext.js`, provided by `ViewerProvider.jsx`)
  - shared page collection, loading status, caches, diagnostics and viewer-wide data
- `useDocumentViewer()` (`src/components/DocumentViewer/useDocumentViewer.js`)
  - local viewer interaction state such as current page, zoom, compare mode, image adjustments,
    selection and print dialog visibility
- `ThemeContext` (`src/contexts/ThemeProvider.jsx`)
  - theme selection (`system`, `normal`, `light`, `dark`) and theme toggle actions
  - the viewer-local "Larger toolbar buttons" choice, applied as `data-toolbar-density`
    (`large`/`compact`) on the document root and mapped to size variables in `src/styles/toolbar.css`
- `src/utils/viewerPreferences.js`
  - persisted user choices (theme, language, toolbar button size, default print scope, default
    zoom mode, custom fit factors) stored in both `localStorage` and a same-origin cookie; image adjustments are never
    persisted

## Print flow

The print pipeline is deliberately separated from the viewer UI. `src/utils/printUtils.js` is the
facade the toolbar imports.

- `PrintRangeDialog.jsx`, `usePrintRangeDialog.js`, `printRangeDialogHelpers.js` and
  `hooks/usePrintRangeConfig.js`
  - collect and validate user print options (method, scope, reason/for-whom, watermark,
    orientation)
- `printCore.js` and `printDom.js`
  - browser HTML printing through a hidden iframe (`print.pdf.defaultMode: 'direct'`)
- `printPdf.js`, `pdfWorkerDispatcher.js` and `src/workers/pdfWorker.js`
  - generated-PDF printing and download with jsPDF, split across workers above
    `print.pdf.workerPageThreshold` pages and merged with pdf-lib
    (`print.pdf.defaultMode: 'safe'`)
- `usePdfPrebuildAllPages.js`, `pdfPrebuildPlan.js` and `pdfPrintCacheKey.js`
  - optional background prebuild of "all pages" PDF variants (off by default)
- `printTemplate.js`
  - resolves print header/footer tokens with HTML escaping of every value
- `printSanitize.js` and `printWatermark.js`
  - image source allow-list and the shared COPY/KOPIA watermark decision
- `printParse.js`
  - parses ranges and custom page sequences

The active page prints the rendered canvas (adjustments included); every other print scope uses
the archived page image without adjustments.

## Help, manual and diagnostics

- `HelpOverlayDialog.jsx` is the built-in text-only quick help
- `ManualOverlayDialog.jsx` loads the site-local or bundled manual HTML fragment with
  `cache: 'no-store'` and sanitizes it with DOMPurify before insertion; the candidate order
  (`help/site/` before `help/default/`, skipping an SPA-fallback app shell) lives in
  `src/utils/manualSources.js`
- the manual dialog traps Tab and Shift+Tab while it is open. In the tested Chromium sequences,
  focus stayed inside the dialog even though `aria-modal` declares the page behind the backdrop
  unavailable; this is a measured result, not an unconditional containment guarantee. The eligible
  sequence is the browser's own: ordinary controls in sequential order, positive `tabindex` first
  in ascending order, and inherited-disabled and hidden targets excluded. Controlled
  `audio[controls]` and `video[controls]` hosts are part of that sequence, but the trap does not
  cancel the Tab inside them: their UA controls (play, scrubber, volume, mute, full screen, "show
  more media controls") stay native and reachable. A media host is entered through a temporary
  `tabindex="-1"` starting point and left through a temporary same-index guard, so the browser
  keeps ownership of the media focus scope in both directions. Both helpers are removed on the
  next keydown, on pointer navigation, and when the dialog opens or closes. Known boundaries are
  focus already on `body` (a body-targeted Tab does not bubble through the dialog's `onKeyDown`
  and is not recaptured), a positive-`tabindex` target between consecutive media hosts (native
  focus ownership is retained and containment is not guaranteed), and an authored media host with
  `tabindex="-1"` (excluded from the eligible sequence and skipped, which is pre-existing
  behavior). The media behavior is proven in Chromium, not inferred from jsdom — see "Native
  verification" below
- the manual overlay fills almost the whole viewport and shows a contents tree built at runtime
  from the sanitised manual's h2/h3 headings (`src/utils/manualContentsTree.js`); headings without
  an id get one derived from their text, so the manual files themselves never carry the tree.
  The tree and the manual text scroll independently; below about 900 px dialog width a
  "Contents" toggle in the search row opens the tree as an overlay list instead. Authored ids are
  never renamed; generated ids avoid every authored id and the dialog's own ids. In-text "#id"
  links to a rendered element scroll the content pane; links to a target hidden until it is the
  URL fragment target (the bundled manuals' `.lb:target` image lightbox), or to no element at
  all, replace the URL fragment in place so `:target` applies. The viewer keeps no state in the
  fragment, and the dialog puts the original URL back on close. Closing returns focus to the help
  button
- `AboutOverlayDialog.jsx` shows version and build id and offers the support diagnostics download
  (`src/utils/supportDiagnostics.js`); the benchmark tools are separate opt-in flags
- `ViewerProblemNotice.jsx` shows configurable problem notices and can request a session reset
  through a `CustomEvent` (same-origin parent) or `postMessage` (cross-origin parent, allowed
  origin only)
- `PerformanceMonitor.jsx` is the opt-in performance HUD

## Native verification

Some of the viewer's behaviour has no jsdom equivalent: UA media controls, real layout, real
focus order and CSS visibility. A Vitest run proves the JavaScript contract; it cannot prove what
the browser does. The rule is therefore that a behaviour of this kind is only claimed when a
Chromium run measured it, and the claim names the browser engine it was measured in.

The manual dialog's media focus behaviour is the current case. jsdom has no UA media controls and
no native Tab default, so the unit test
(`src/components/DocumentToolbar/__tests__/ManualOverlayDialog.contents.test.js`) can only prove
that the trap does not cancel the Tab inside a media host. The reachable stops themselves are
proven by `tests/ui/manual-contents-tree.spec.mjs`, which drives real Chromium keyboard input and
compares the observed focused accessibility state against an oracle built from the same
product-sanitized fixture, forward and reverse, and asserts that focus stays inside the dialog.

The measured status, the RED/GREEN pair and the limits of the claim are recorded in
`docs/quality/github-fynd-ai-forslag-alla-repon-opendocviewer.md`. The cross-engine case is
explicitly unmeasured: only Chromium was run, and no other engine is claimed.

## Logging boundaries

The frontend can operate without the log servers; both channels are disabled by default.

- `src/logging/systemLogger.js`
  - structured operational logging from the client; token-gated, fails closed on placeholder
    tokens and disables forwarding for the session after 401/403/404
- `src/logging/userLogger.js`
  - print-related user logging via `sendBeacon` or `fetch` with `keepalive`
- `server/*.js`
  - optional ingestion services behind the IIS proxy application (`IIS-ODVProxyApp/`)

## Maintenance notes

The largest files each own several responsibilities and are the natural split points when a
change touches them: `src/contexts/ViewerProvider.jsx`, `src/components/PrintSelectionWorkspace.jsx`,
`src/utils/printPdf.js`, `src/components/DocumentLoader/DocumentLoader.js` and
`src/components/DocumentToolbar/DocumentToolbar.jsx`. `CONTRIBUTING.md` describes how to identify
a split boundary before extracting code. Regenerate `docs-agent/` with `npm run doc:agent` after
structural changes; the pre-push gate and CI both verify it.
