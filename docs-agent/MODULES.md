# Modules

## server

File count: 2. Line count: 508. JSDoc symbol count: 7.

- `server/system-log-server.js` - System Log Server — Single-file, standalone (ESM) Responsibilities: - Expose POST /log for structured system logs (tiny JSON bodies) - Write NDJSON to daily-rotated files under ./logs/ - Keep access, ingestion, and error
- `server/user-log-server.js` - User Action Log Server — Single-file, standalone (ESM) Endpoint: POST /userlog/record - Body: application/x-www-form-urlencoded or JSON - reason: string|null - forWhom: string|null - Response: 200 OK with body: true (JSO

## src/app

File count: 3. Line count: 731. JSDoc symbol count: 20.

- `src/app/AppBootstrap.jsx` - Application bootstrap React component.
- `src/app/OpenDocViewer.jsx` - src/app/OpenDocViewer.jsx Main application shell for the viewer.
- `src/app/bootConfig.js` - Runtime boot loader that resolves configuration scripts before React starts.

## src/components

File count: 13. Line count: 6533. JSDoc symbol count: 82.

- `src/components/DocumentThumbnailList.jsx` - OpenDocViewer — Deterministic thumbnail strip.
- `src/components/DocumentRender.jsx` - OpenDocViewer — Active page renderer.
- `src/components/PrintSelectionWorkspace.jsx` - Full-window print-selection workspace.
- `src/components/Resizer.jsx` - OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels (e.g., sidebar/content) via mouse drag or keyboard interaction.
- `src/components/LoadingSpinner.jsx` - OpenDocViewer — Loading Spinner Minimal, accessible loading indicator.
- `src/components/ViewerProblemNotice.jsx` - OpenDocViewer — configurable viewer-level problem notice.
- `src/components/DocumentConsumerWrapper.jsx` - OpenDocViewer — Consumer Wrapper for Loader + Viewer Orchestrates the document loading pipeline and the main viewer UI: • Pattern mode: { folder, extension, endNumber } • Explicit-list: { sourceList: [{ url, ext?, fileIn
- `src/components/DocumentMetadataMatrixOverlayDialog.jsx` - Session-wide document metadata matrix overlay.

## src/components/common

File count: 1. Line count: 36. JSDoc symbol count: 1.

- `src/components/common/StatusLed.jsx` - Small reusable LED-style status indicator.

## src/components/DocumentLoader

File count: 8. Line count: 3984. JSDoc symbol count: 107.

- `src/components/DocumentLoader/documentLoaderUtils.js` - OpenDocViewer — Loader Utilities Helper utilities used by the DocumentLoader pipeline: • Build document URL lists (pattern mode and demo mode) • Fetch as ArrayBuffer (with optional AbortSignal) • Page counting (PDF / TIF
- `src/components/DocumentLoader/DocumentLoader.js` - OpenDocViewer — Document loader orchestrator.
- `src/components/DocumentLoader/mainThreadRenderer.js` - OpenDocViewer — Main-thread renderers for PDF & TIFF Render multi-page formats (PDF/TIFF) on the main thread when necessary (e.g., worker fallback, low-core devices, or when explicitly configured).
- `src/components/DocumentLoader/workerHandler.js` - OpenDocViewer — Worker orchestration & message handling - Create image workers for off-main-thread rasterization/conversion.
- `src/components/DocumentLoader/sources/explicitListSource.js` - OpenDocViewer — Explicit Source List Normalizer Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically.
- `src/components/DocumentLoader/batchHandler.js` - OpenDocViewer — Minimal, fair worker-batch scheduler Distribute image-decoding jobs across a pool of Web Workers without monopolizing the main thread.
- `src/components/DocumentLoader/LoadPressureDialog.jsx` - Large-load warning dialog shown before / during very heavy loading runs.
- `src/components/DocumentLoader/DemoControls.jsx` - OpenDocViewer — Demo Controls for “one-file-per-format” demo mode - Provide a simple control bar: "Total pages/files" + JPG/PNG/TIF/PDF buttons + a new "Mix" button.

## src/components/DocumentToolbar

File count: 14. Line count: 6329. JSDoc symbol count: 90.

- `src/components/DocumentToolbar/usePrintRangeDialog.js` - Hook + helpers for PrintRangeDialog.
- `src/components/DocumentToolbar/DocumentToolbar.jsx` - Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry.
- `src/components/DocumentToolbar/usePdfPrebuildAllPages.js` - Background prebuild/cache for configured "all pages" generated-PDF variants.
- `src/components/DocumentToolbar/ManualOverlayDialog.jsx` - Manual overlay that loads simple external HTML fragments from the public help folder.
- `src/components/DocumentToolbar/ThemeMenuButton.jsx` - Compact theme selector for the toolbar.
- `src/components/DocumentToolbar/LanguageMenuButton.jsx` - Compact language selector for the toolbar.
- `src/components/DocumentToolbar/AboutOverlayDialog.jsx` - Small About dialog for version/build/support information.
- `src/components/DocumentToolbar/SplitToolbarButton.jsx` - Reusable toolbar split-button.

## src/components/DocumentViewer

File count: 8. Line count: 4717. JSDoc symbol count: 106.

- `src/components/DocumentViewer/useDocumentViewer.js` - Primary viewer-state hook.
- `src/components/DocumentViewer/DocumentViewerRender.jsx` - OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane (and optional comparison pane) by delegating all heavy lifting to <DocumentRender />.
- `src/components/DocumentViewer/hooks/useViewerEffects.js` - File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res...
- `src/components/DocumentViewer/hooks/useViewerPostZoom.js` - File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &quot;post-zoom&quot; state &amp; handlers used only in compare mode.
- `src/components/DocumentViewer/DocumentViewerToolbar.jsx` - Toolbar adapter for the document viewer.
- `src/components/DocumentViewer/DocumentViewer.jsx` - OpenDocViewer — Document Viewer (Container) Tie together: • Toolbar (actions, zoom, adjustments) • Thumbnails (navigation + selection reset) • Main renderer (canvas/img) This component wires ViewerContext state into the
- `src/components/DocumentViewer/DocumentViewerThumbnails.jsx` - OpenDocViewer — Document Viewer Thumbnails (Wrapper) Provides the deterministic thumbnail list and local width controls for the viewer shell.
- `src/components/DocumentViewer/CompareZoomOverlay.jsx` - Per-pane “post-zoom” controls shown in comparison mode.

## src/contexts

File count: 4. Line count: 2997. JSDoc symbol count: 81.

- `src/contexts/viewerContext.js` - Exports ViewerContext.
- `src/contexts/ViewerProvider.jsx` - OpenDocViewer — Viewer state provider.
- `src/contexts/themeContext.js` - Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake.
- `src/contexts/ThemeProvider.jsx` - src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context (React) Centralize theme handling with: - explicit themes: normal / light / dark - an implicit system-following startup mode when the user has not chosen

## src/ErrorBoundary.jsx

File count: 1. Line count: 297. JSDoc symbol count: 12.

- `src/ErrorBoundary.jsx` - OpenDocViewer — React Error Boundary - Catch unexpected render/runtime errors in descendant components.

## src/hooks

File count: 4. Line count: 650. JSDoc symbol count: 23.

- `src/hooks/useNavigationModifierState.js` - Shared modifier-key state for navigation and compare-aware viewer actions.
- `src/hooks/usePageTimer.js` - OpenDocViewer — Continuous Page Navigation Timer (React hook) Provide a tiny utility for press-and-hold page navigation: - Invokes a caller-supplied callback immediately (leading edge) and then repeatedly after an initia
- `src/hooks/usePageNavigation.js` - OpenDocViewer — Page Navigation Hook (React) Provide memoized handlers for page navigation (first/prev/next/last) and continuous navigation timers suitable for press-and-hold UI (e.g., mousedown).
- `src/hooks/useAcceleratingHoldRepeat.js` - Reusable press-and-hold behavior for toolbar buttons.

## src/i18n.js

File count: 1. Line count: 566. JSDoc symbol count: 21.

- `src/i18n.js` - i18n bootstrap for OpenDocViewer.

## src/index.jsx

File count: 1. Line count: 59. JSDoc symbol count: 2.

- `src/index.jsx` - OpenDocViewer — Application Entry - Load global styles (CSS variables + layout).

## src/integrations

File count: 7. Line count: 2073. JSDoc symbol count: 52.

- `src/integrations/parentBridge.js` - Same-origin parent-window bootstrap adapter.
- `src/integrations/normalizePortableBundle.js` - Normalizes multiple host payload shapes into the project's neutral portable bundle shape.
- `src/integrations/bootstrapRuntime.js` - Startup mode detection and host-integration entry point.
- `src/integrations/viewerEvents.js` - OpenDocViewer — Tiny Event Emitter/Listener Utilities (Browser-only) Lightweight helpers for broadcasting and listening to app-level DOM events.
- `src/integrations/sessionToken.js` - OpenDocViewer — Session Token Reader (Browser-only) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=<base64> This enables hosts to pass a compact, self-contained “portab
- `src/integrations/sessionUrl.js` - Fetch a host-prepared Portable Document Bundle from a short URL query value.
- `src/integrations/urlParams.js` - OpenDocViewer — URL Parameter Reader (Browser-only) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e.

## src/logging

File count: 2. Line count: 740. JSDoc symbol count: 46.

- `src/logging/systemLogger.js` - src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller (ESM) - Provide a small, dependency-light logging facade for the browser app.
- `src/logging/userLogger.js` - UserLogController — client-side controller for **user** print logs (backend-agnostic).

## src/PerformanceMonitor.jsx

File count: 1. Line count: 1346. JSDoc symbol count: 20.

- `src/PerformanceMonitor.jsx` - src/PerformanceMonitor.jsx OpenDocViewer — Lightweight Performance HUD - Provide optional, low-impact visibility into runtime performance and viewer state.

## src/schemas

File count: 1. Line count: 363. JSDoc symbol count: 18.

- `src/schemas/portableBundle.js` - OpenDocViewer — Portable Document Bundle Schema & Helpers (ESM) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency-free helpers to validate and normalize input.

## src/types

File count: 1. Line count: 101. JSDoc symbol count: 13.

- `src/types/jsdoc-types.js` - Centralized JSDoc-only type and callback definitions.

## src/utils

File count: 34. Line count: 14530. JSDoc symbol count: 562.

- `src/utils/documentLoadingConfig.js` - OpenDocViewer — runtime helpers for fetch/render/memory policies.
- `src/utils/runtimeConfig.js` - Runtime configuration helpers.
- `src/utils/viewerPreferences.js` - Lightweight persisted viewer preferences.
- `src/utils/printPdf.js` - OpenDocViewer — Generated PDF print backend.
- `src/utils/pdfPrintCacheKey.js` - Generated-PDF cache key helpers.
- `src/utils/printTemplate.js` - OpenDocViewer — Print Templating & Tokens Provide token context generation and safe token substitution where values are HTML-escaped before insertion into admin-authored print header/footer templates.
- `src/utils/supportDiagnostics.js` - Support diagnostics helpers for opt-in troubleshooting tools.
- `src/utils/documentMetadata.js` - Helpers for resolving document-level metadata from the normalized portable bundle.

## src/workers

File count: 3. Line count: 1549. JSDoc symbol count: 3.

- `src/workers/pdfWorker.js` - OpenDocViewer - generated PDF worker.
- `src/workers/imageWorker.js` - OpenDocViewer — image / TIFF worker.
- `src/workers/pdfPageWorker.js` - OpenDocViewer - PDF page image worker.
