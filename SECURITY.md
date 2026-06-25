# Security Policy

## Supported Versions

**OpenDocViewer v2.6.4** is the only currently supported release and the recommended production target.

OpenDocViewer v2.6.3 and earlier are superseded by v2.6.4 and are no longer supported for production deployments. v2.6.4 keeps the v2.6 dependency baseline current and adds additional document-loading, source-stream, TIFF/OJPEG, print, and cleanup hardening. Operators should upgrade to v2.6.4 before opening new support or security issues.

Earlier releases are retained for historical reference only and are **not supported** for current production deployments, even if they were previously marked as safe.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 2.6.4   | :white_check_mark: | Current recommended patch release and only supported baseline |
| <= 2.6.3 | :x: | Superseded by v2.6.4 document-loading, print, and cleanup hardening; upgrade required |

## Recent release context

The most recent releases are listed below for operational context. Historical entries are kept to explain upgrade impact, but only v2.6.4 is supported.

### OpenDocViewer v2.6.4
Changes since v2.6.3:

- Added configurable source-fetch size limits and streamed download caps so unusually large document sources can be rejected before they exhaust browser memory.
- Added source-pack frame payload bounds to reject unexpectedly large frames from gateway-style source streams.
- Hardened TIFF/OJPEG parsing with offset, length, and scan-size checks for both worker and main-thread rendering paths.
- Improved canvas, PDF, TIFF, and object URL cleanup to reduce memory retention during long sessions, repeated document reloads, and selection workspace use.
- Hardened generated-PDF printing and download flows, including safer iframe cleanup timing, fallback preview handling, and clearer error reporting when the browser blocks preview creation.
- Sanitized print header/footer overlay markup with DOMPurify while preserving the supported rich-text subset for configured print templates.
- Updated DOMPurify from 3.4.10 to 3.4.11.
- Fixed selection-workspace sequence handling so saved custom page order and included-page masks remain aligned after edits.
- Hardened selection-workspace image rendering so preview and thumbnail images fall back safely when source URLs are invalid or unsafe.
- Improved custom zoom limit fallback handling and viewer page/selection validation helpers.
- Split viewer keyboard and zoom effects into narrower modules without changing the public viewer behavior.
- Added generated AI-agent documentation and CI validation so source-map documentation stays current for future maintenance.
- Updated CI and release workflows to build and package the generated agent documentation alongside the standard distribution and JSDoc output.

### OpenDocViewer v2.6.3
Changes since v2.6.2:

- Updated the dependency baseline and lockfile to resolve GitHub Dependabot security alerts, including the Vite Windows alternate-path `server.fs.deny` bypass advisory fixed by Vite 8.0.16.
- Raised the development, CI, and release baseline to Node.js 22.18.0 and updated CI/release workflows accordingly.
- Updated key runtime dependencies, including React 19.2.7, pdf.js 6.0.227, DOMPurify 3.4.10, axios 1.18.0, i18next 26.3.1, react-i18next 17.0.8, Express 5.2.1, Helmet 8.2.0, express-rate-limit 8.5.2, and Morgan 1.11.0.
- Updated development tooling to current stable lines, including Vite 8.0.16, `@vitejs/plugin-react` 6.0.2, ESLint 10.5.0, Babel 8, Rolldown 1.1.1, concurrently 10.0.3, and Prettier 3.8.4.
- Removed unused direct dependencies and development tools so the dependency graph is smaller and easier to audit.
- Removed the unused SVGR build plugin and the legacy React ESLint plugin after confirming the project no longer needs them.
- Replaced Google Fonts runtime icon loading with the self-hosted `material-icons` npm package so toolbar icons are packaged with the viewer and no longer require network access to Google font endpoints.
- Removed the unused Vite starter SVG from public assets.
- Hardened lint compatibility for ESLint 10 by attaching error causes where failures are wrapped and by removing stale initialization patterns.
- Addressed selection-workspace review feedback around default order sorting, modifier-key handling, lightbox keyboard handling, and small badge text readability.

### OpenDocViewer v2.6.2
Changes since v2.6.1:

- Improved selection-workspace multi-select behavior so Ctrl toggles individual pages and Shift selects page ranges in a more familiar desktop-style pattern.
- Added Ctrl-additive rectangle selection so marquee selection can extend an existing page selection instead of replacing it.
- Tightened document-mode drag rules so selected pages can be moved within their document while page mode remains available for free page placement.
- Added left-panel double-click toggling for pages that are already included in the active selection when all source pages are visible.
- Added document-header double-click removal when all pages in that source document are already included in the active selection.
- Fixed the thumbnail preview eye button so it no longer remains visible on the last clicked thumbnail after the pointer leaves the tile.
- Made the selection-workspace print-order badge visually distinct from the source document/page badge.
- Added same-origin opener bootstrap support so host pages can open OpenDocViewer in a new tab while preserving prepared session payloads such as local-file demo bundles.
- Updated the OMP component manifest during artifact-only delivery testing. OMP artifact versions remain independent from this public OpenDocViewer release version.

### OpenDocViewer v2.6.1
Changes since v2.6.0:

- Added template value filters for selection-workspace metadata so date-like values can be rendered in compact display formats.
- Fixed metadata alias fallback handling for datetime fields so later configured fields can be used when earlier fallback fields are empty or not date-like.
- Fixed document mode availability for single-document sessions that still include reliable document metadata.
- Fixed Escape handling in the selection workspace so the workspace can be left even when toolbar controls currently have focus.
- Hardened document-loader diagnostics and source-pack extension normalization.
- Normalized default zoom mode fallbacks more consistently when runtime configuration values use different casing or whitespace.
- Updated the public site configuration sample to use neutral metadata examples.

### OpenDocViewer v2.6.0
Changes since v2.5.1:

- Added a dedicated selection workspace for managing which pages are included in the active viewer session and print output.
- Added document-aware and page-based workspace modes, including document boundary handling when reliable document metadata is available.
- Added drag-and-drop page and document ordering, rectangle selection, undo/redo, reset-to-saved behavior, save/leave controls, and full-screen page previews.
- Made saved selections drive the normal thumbnail pane, page navigation, and print behavior.
- Added reusable split toolbar buttons for print and custom zoom defaults.
- Added print default selection between active page and all pages, persisted per user.
- Added a custom size zoom mode with user-configurable caps for window width, window height, and actual size.
- Added a persisted default zoom/size preference for new sessions.
- Improved custom zoom labels, Swedish and English localization, preview keyboard actions, selection status feedback, and zoom-control visual consistency.
- Fixed unintended add-all actions from modifier keys, fixed preview list routing, and hardened zoom utility validation and JSDoc generation.

### OpenDocViewer v2.5.1
Changes since v2.5.0:

- Pinned `concurrently` to the Node 20 compatible `9.2.0` line so the transitive `shell-quote` development dependency resolves to `1.8.4`, addressing GHSA-w7jw-789q-3m8p / CVE-2026-9277 in local, CI, and release tooling.
- Fixed PDF resolution boost state handling so pages are only marked as boosted after the rendered asset URL has actually changed.
- Improved fitted-page transitions after PDF resolution boosts by treating a changed page URL as a real asset transition.
- Improved print/progress dialog button contrast and focus styling.
- Made Vite build identifiers deterministic by default, with explicit environment-variable overrides for release and diagnostics workflows.
- Added and hardened OMP universal-package helper scripts and command-wrapper validation tooling.

### OpenDocViewer v2.5.0
Changes since v2.4.0:

- Added source-pack stream loading for host-prepared sessions so many small source files can be transferred through one ordered stream instead of many browser-managed source fetches.
- Added explicit bundle URL bootstrap diagnostics, bootstrap timing, source-pack counters, route summaries, trusted page-count hints, and richer copied performance snapshots for large-session support.
- Improved large raster-session behavior by keeping performance-mode memory caching viable for higher page counts and avoiding unnecessary thumbnail-only fallback during first load.
- Tuned browser-aware worker allocation so Chromium-family browsers can use the available CPU more aggressively for raster sources while Firefox keeps a lower worker cap.
- Added worker queue/run timing, source-pack frame processing decoupling, and progress feedback while host-prepared bundles are loading.
- Hardened document-loading utilities, JSDoc, timer portability, focus visibility, memory-pressure threshold validation, worker task ids, and gateway-style bootstrap precedence.

### OpenDocViewer v2.4.0
Changes since v2.3.3:

- Added automatic PDF page-image worker routing with a page-count policy that starts small, scales for larger PDF sessions, and remains capped by the runtime hardware recommendation.
- Added focused render/decode benchmark scenarios for main-thread PDF rendering, PDF worker counts, page-count-derived worker counts, and partitioned PDF worker batches.
- Added an opt-in partitioned PDF warm-up path for very large PDF sessions, with pending-asset coordination, stale-result checks, duplicate-commit protection, and fallback to normal per-page rendering for failed or missing batch items.
- Parallelized source page-count analysis during prefetch so large mixed sessions can discover PDF/TIFF page counts while source fetching is still in progress.
- Added loader phase timings, PDF routing counters, throughput metrics, copyable performance-overlay snapshots, and page-list integrity diagnostics for support work.
- Improved first-load isolation diagnostics by exposing source-store and asset-store cache behavior, including cache-restore and background-persist timings.
- Fixed one-shot PDF resolution boosting so forced high-resolution re-renders can use the main-thread path correctly.
- Updated runtime configuration documentation, site configuration samples, support diagnostics, and the OMP component manifest for the new loading and benchmark controls.

### OpenDocViewer v2.3.3
Changes since v2.3.2:

- Bundled the optional PDF.js codec resources under `pdfjs/wasm/` and supplied a shared `wasmUrl` for PDF document loading, fixing blank pages for PDFs that use JBIG2/OpenJPEG images and avoiding `JBig2 failed to initialize` or missing `wasmUrl` console warnings.
- Documented deployment of the PDF.js codec resources so IIS/static hosting copies `dist/pdfjs/wasm/` together with the viewer bundle.
- Improved large PDF and multi-page TIFF loading progress by yielding render queues between page jobs so the main thread can update page readiness during long runs instead of only after the queue drains.
- Added a compact page-loading progress badge in the toolbar navigation area while page selection or printing still waits for all rendered page assets.
- Updated the OMP component manifest to advertise the latest artifact-only component version used during OMP delivery testing.

### OpenDocViewer v2.3.2
Changes since v2.3.1:

- Fixed edge-scroll page turning on fitted pages that do not have a vertical scrollbar while keeping the deliberate progress-threshold behavior before changing pages.
- Fixed a stale loading-overlay race during scroll-wheel page turns where a cache-fast hidden image load could be missed and leave the pane showing the loading message.
- Fixed refreshed page-asset reuse so one-shot PDF resolution boosts prefer the newly rendered object URL over an older cached URL.
- Improved keyboard focus visibility for toolbar, mode, thumbnail-selection, context-menu, empty-state, and problem-notice controls.
- Kept the loading message surface aligned with the active theme instead of using a hardcoded light background.
- Hardened render/decode benchmark timing, abort handling, result summarization, worker-safe delay handling, and PDF worker-count resolution.
- Hardened PDF page-worker document caching, LRU eviction, in-flight loading-task cleanup, and lease-aware disposal so concurrent worker renders can reuse cached documents without leaking or destroying active documents.
- Updated the OMP component manifest to advertise the current artifact-only component version used for OMP delivery testing.

### OpenDocViewer v2.3.1
Changes since v2.3.0:

- Fixed edge-scroll page turning so the wheel handler uses a non-passive native listener and can cancel wheel scrolling at a page edge without browser console warnings.
- Suppressed expected pdf.js in-worker loopback warnings from the PDF page-image worker while keeping worker-side render errors available through the existing fallback diagnostics.

### OpenDocViewer v2.3.0
Changes since v2.2.0:

- Added drag-to-pan support on large rendered pages when the pane is scrollable.
- Added Page Up and Page Down keyboard navigation for page stepping while leaving browser-reserved Ctrl+Page Up and Ctrl+Page Down shortcuts untouched.
- Added optional PDF page-image worker rendering through `documentLoading.render.pdfToImageMode`, with configurable worker-count limits and diagnostics.
- Improved PDF worker rendering so pdf.js worker setup and font handling work reliably inside the page-image worker.
- Added PDF page-worker fallback diagnostics and exposed worker/fallback counters in diagnostics and the performance overlay.
- Hardened render/decode benchmarking with per-page timeouts, clearer stalled-page handling, and better PDF worker measurement.
- Improved source and rendered-asset cache stability by hardening queued writes, reload-cache cleanup, and buffer-cache behavior.
- Added a per-page PDF resolution boost action that re-renders a selected PDF page at higher resolution for the current session.
- Added accelerated press-and-hold behavior for toolbar page navigation and zoom buttons.
- Fixed toolbar page navigation so button actions use the same compare-aware navigation path as keyboard shortcuts.
- Fixed thumbnail activation in compare mode so Shift targets the opposite pane without moving the persistent primary/compare pane selector.
- Fixed Shift-click on a thumbnail when compare mode is closed so it opens compare mode with the clicked page on the right while keeping the primary pane selected.
- Fixed double-click fit-mode toggling so it continues to work when drag-to-pan is available.
- Smoothed page swaps across different raster resolutions by preloading the next rendered page before showing it, applying sticky fit zoom before the swap, and removing animated page-surface transforms.
- Added safer support for importing OpenDocViewer artifact packages whose public application version and OMP artifact version differ.
- Updated runtime configuration documentation, bundled help text, and the OMP component manifest for the new viewer navigation, PDF worker, diagnostics, and artifact-package behavior.

### OpenDocViewer v2.2.0
Changes since v2.1.1:

- Added a configurable `viewer.defaultZoomMode` setting for deployments that need a different initial page zoom.
- Changed the default initial zoom mode to `fit-width` in both the built-in runtime config and the site-config sample.
- Added double-click zoom toggling on the main page surface between `fit-width` and `fit-page`.
- Added an optional edge-scroll page-turn gesture at the top and bottom page edges, now enabled by default in the built-in runtime config and the site-config sample.
- Added explicit compare-view pane targeting so keyboard navigation can choose the primary or compare pane directly.
- Changed Left/Right keyboard handling to target compare panes by default, while keeping rotation available through Ctrl+Left/Ctrl+Right.
- Increased the default PDF full-page render scale to `2.0` for sharper rendered PDF pages.
- Updated the OMP component manifest to advertise the current OpenDocViewer artifact package version for artifact-only delivery workflows.

### OpenDocViewer v2.1.1
Changes since v2.1.0:

- Clarified runtime-configuration documentation: `odv.site.config.js` is fetched before the default config, but its values are applied as overrides on top of the defaults defined in `odv.config.js`.
- Updated the OMP component manifest to advertise the current OpenDocViewer artifact package version for artifact-only delivery workflows.
- Updated the OMP component-version helper to write JSON as UTF-8 without BOM, serialize deeper manifest structures, and make dry-run output explicit.
- Simplified reset-session event dispatch to use the standard browser `CustomEvent` constructor directly.

### OpenDocViewer v2.1.0
Changes since v2.0.3:

- Added OMP-compatible repository object wrappers for building module definitions and artifact packages from `omp-components.json`.
- Added a universal-package exporter so OpenDocViewer can be transported through the same package format as other OMP-compatible modules.
- Made the OpenDocViewer module definition portable by embedding its SQL initialization and repair scripts.
- Added a host-profile segment convention for repository-owned package generation.
- Added defense-in-depth sanitization for site-local manual HTML before displaying it in the manual overlay.
- Added a viewer-level reset-session recovery action for expired host document tickets.
- The reset action emits `odv:session-reset-requested`, can notify an embedding host, reloads a same-origin parent page by default, and falls back to a cache-busted viewer reload.
- Documented `showResetSessionButton` and `resetSessionTarget` for deployments where reloading only the viewer iframe can reuse stale host payloads.

### OpenDocViewer v2.0.3
Changes since v2.0.2:

- Improved diagnostics JSON downloads with timestamped default filenames.
- Added console diagnostics when a diagnostics download cannot be created.
- Hardened temporary download URL cleanup after successful and failed diagnostics downloads.
- Added build-id fallback support for diagnostics.
- Made diagnostics fields clearer by naming render-worker counts separately and documenting device-memory units.
- Kept diagnostics own-property checks compatible with older browser shells.
- Replaced several diagnostics list-size literals with named limits.
- Reduced duplicate benchmark-result loading logic.
- Replaced packed compare-rotation dependency math with an explicit primary/compare rotation key.
- Added an OMP component manifest and version-bump helper for artifact-based deployment tooling.

### OpenDocViewer v2.0.2
Changes since v2.0.1:

- Added `print.pdf.cacheLanguageMode`.
- Kept the default `strict` mode, where localized print text remains part of the generated-PDF cache key.
- Added opt-in `ignore` mode for installations where generated print output is intentionally identical across UI languages.
- Fixed reuse of fixed-language all-pages PDF prebuild variants when the active UI language differs from the configured prebuild language.
- Stopped UI language changes from invalidating fixed-language prebuild runs.
- Applied the same language-mode cache policy to user-generated session PDFs and background-prebuilt PDFs.
- Documented the cache language mode and exposed it in diagnostics.

### OpenDocViewer v2.0.1
Changes since v2.0.0:

- Added an optional short-lived reload cache for original source blobs and rendered page assets.
- Keyed reload-cache entries from stable document identity and version metadata instead of temporary source URLs.
- Kept the reload cache disabled by default, with bounded TTL validation and performance-overlay hit/miss diagnostics.
- Rejected invalid document payloads before caching.
- Improved handling and diagnostics for expired source links and serious source/session failures.
- Added a configurable viewer-level problem notice for serious loading failures.
- Preserved zero brightness and contrast values correctly.
- Changed the Selection tab cancel action so it is always available, discards unsaved selection edits, and returns to the thumbnail view.
- Aligned Swedish and English help text with the Selection tab behavior.
- Cleaned up source temporary storage, reload-cache TTL normalization, queued writes, cache constants, and benchmark helper signatures.

### OpenDocViewer v2.0.0
Changes since v1.9.1:

- Added a dedicated generated-PDF worker pipeline.
- Added worker-batch dispatch planning, partial PDF generation, and final PDF merge support.
- Changed generated-PDF progress reporting to deterministic work units.
- Added optional background preparation for common all-pages print variants.
- Paused background PDF preparation while a user-initiated print or download job is active.
- Kept completed prebuilt variants in the session cache.
- Added session-scoped generated-PDF cache reuse for compatible print settings.
- Excluded active-page PDF output from cache-key reuse because transient page edits can change the output.
- Added a configurable automatic-orientation checkbox for generated-PDF output.
- Added configurable print/export action labels and tooltips.
- Moved the runtime status indicator to the help-menu status LED.
- Kept diagnostics JSON download available independently of benchmark execution.
- Added opt-in PDF and render/decode benchmark tooling.
- Removed the old HTML print prewarm path.
- Documented generated-PDF prebuild and benchmark configuration.
- Added configuration for hiding user-facing metadata dialogs while preserving metadata internally.
- Added a manual reload control for site-local manual HTML updates.

### OpenDocViewer v1.9.1
Changes since v1.9.0:

- Promoted `dompurify` to a direct dependency.
- Added defense-in-depth sanitization for trusted header/footer template HTML before generated-PDF rendering.
- Tightened generated-PDF template parsing.
- Improved image-source diagnostics, printable surface extraction, cancellation handling, and jsPDF initialization errors.
- Improved generated-PDF rich text handling for header/footer templates.
- Added support for bold/italic detection, block/inline flow handling, simple alignment, two-column flex rows, text fitting, ellipsis behavior, and image format fallbacks.
- Kept generated-PDF cleanup delays conservative so browser print previews do not lose their backing PDF blob too early.
- Extracted constants and helper functions around PDF timing, quality, image handling, text fitting, and jsPDF compatibility.

### OpenDocViewer v1.9.0
Changes since v1.8.0:

- Refreshed runtime and development dependencies, including `axios` 1.16.0, `express-rate-limit` 8.5.1, resolved `ip-address` 10.2.0, React 19.2.6, pdf.js 5.7.284, and Vite 8.0.11.
- Updated lint/build tooling and release validation guidance.
- Added prepared transparent COPY and KOPIA watermark image assets.
- Added watermark modes: `auto`, `copy`, `kopia`, and `custom`.
- Kept custom text watermarking available.
- Made generated-PDF watermarks more subtle.
- Added configurable and localizable print action labels and tooltips.
- Improved generated-PDF header and footer rendering for the supported print-template subset.
- Preserved common inline styling such as bold and italic in generated-PDF output.
- Added simple left/right/center alignment and two-column flex-row handling for generated-PDF headers and footers.
- Documented the limited CSS parsing model for generated-PDF templates.
- Added cancellation for generated-PDF output while pages are being prepared.
- Added Escape as a cancel shortcut with confirmation.
- Replaced "secure print" terminology in progress UI with neutral wording.
- Kept print pre-warming configurable and disabled by default.
- Added a session-URL integration helper and related error handling.
- Updated runtime configuration documentation for expanded print options.
- Documented non-interactive release-script usage.

### OpenDocViewer v1.8.0
Changes since v1.7.0:

- Added a PDF-based print path alongside the existing browser HTML print path.
- Added optional PDF download from the print dialog.
- Added progress feedback while PDF output is generated.
- Simplified the print dialog to explicit actions for HTML print, PDF print, and PDF download.
- Added a reusable `StatusLed` component and initial print-readiness integration.
- Improved visual alignment between HTML print and generated-PDF output.
- Improved copy-marker handling in headers and watermark rendering.
- Expanded the bundled Swedish and English manuals.
- Hardened generated-PDF fallback handling, sanitization, quality normalization, and resource cleanup.
- Updated release documentation and release-script handling.

### OpenDocViewer v1.7.0
Changes since v1.6.0:

- Added a configurable copy-marker workflow for physical print output.
- Added configuration for exposing, defaulting, hiding, or forcing the copy watermark control.
- Added separate display labels and physical print values for print dialog options.
- Added metadata-aware header and footer templates with `{{...}}` tokens.
- Added conditional print-template blocks, page-specific document metadata, session-level tokens, structured reason/format tokens, metadata alias tokens, newline support, and a dedicated print footer.
- Escaped token values before insertion while preserving trusted administrator-authored template markup.
- Changed the default header/footer layout to reserve page space instead of drawing over the original page image.
- Adjusted copy watermark size, opacity, and visibility.
- Fixed JSDoc parser issues in print modules.
- Documented the print token and layout model.
- Tightened i18n path/default handling.
- Improved robustness around `import.meta` and `window` access.
- Added safer i18n path segment handling.
- Updated print-related logging payloads.
- Refreshed selected dependencies, including `i18next-http-backend` and `postcss`.

v1.7.0 is superseded by later releases and is not recommended for current deployments.

## Reporting a Vulnerability

Please report security vulnerabilities by email to **dev@optimal2.se**.

Use a subject such as:

`Security vulnerability report: <short description>`

Include at least:

- a clear description of the issue and its potential impact
- steps to reproduce, including sample input, configuration, or test data where relevant
- the exact OpenDocViewer version you tested
- relevant logs, stack traces, screenshots, or proof-of-concept material

Do **not** open a public issue for suspected security vulnerabilities.

## Response expectations

We aim to:

- acknowledge valid reports within **3 business days**
- provide status updates at least every **7 days** while investigation or remediation is ongoing
- coordinate fixes and release notes before public disclosure when appropriate
