# File Map

Files are sorted by path. Incoming imports and doclet counts are useful signals for where to start.

| File | Lines | In | JSDoc | Confidence | Summary |
| --- | ---: | ---: | ---: | --- | --- |
| `server/system-log-server.js` | 237 | 0 | 5 | high | System Log Server — Single-file, standalone \(ESM\) Responsibilities: - Expose POST /log for structured system logs \(tiny JSON bodies\) - Write NDJSON to daily-rotated files under ./logs/ - Keep access, ingestion, and error |
| `server/user-log-server.js` | 271 | 0 | 2 | high | User Action Log Server — Single-file, standalone \(ESM\) Endpoint: POST /userlog/record - Body: application/x-www-form-urlencoded or JSON - reason: string\|null - forWhom: string\|null - Response: 200 OK with body: true \(JSO |
| `src/app/AppBootstrap.jsx` | 432 | 1 | 10 | high | Application bootstrap React component. |
| `src/app/bootConfig.js` | 138 | 0 | 5 | high | Runtime boot loader that resolves configuration scripts before React starts. |
| `src/app/OpenDocViewer.jsx` | 193 | 1 | 5 | high | src/app/OpenDocViewer.jsx Main application shell for the viewer. |
| `src/components/CanvasRenderer.jsx` | 84 | 1 | 1 | high | OpenDocViewer — Absolute-positioned Canvas Renderer Render a &lt;canvas&gt; element for a single page at a specified zoom factor. |
| `src/components/common/StatusLed.jsx` | 36 | 2 | 1 | high | Small reusable LED-style status indicator. |
| `src/components/DocumentConsumerWrapper.jsx` | 172 | 1 | 2 | high | OpenDocViewer — Consumer Wrapper for Loader + Viewer Orchestrates the document loading pipeline and the main viewer UI: • Pattern mode: { folder, extension, endNumber } • Explicit-list: { sourceList: \[{ url, ext?, fileIn |
| `src/components/DocumentLoader/batchHandler.js` | 226 | 0 | 7 | high | OpenDocViewer — Minimal, fair worker-batch scheduler Distribute image-decoding jobs across a pool of Web Workers without monopolizing the main thread. |
| `src/components/DocumentLoader/DemoControls.jsx` | 101 | 0 | 1 | high | OpenDocViewer — Demo Controls for “one-file-per-format” demo mode - Provide a simple control bar: &quot;Total pages/files&quot; + JPG/PNG/TIF/PDF buttons + a new &quot;Mix&quot; button. |
| `src/components/DocumentLoader/DocumentLoader.js` | 2170 | 1 | 58 | high | OpenDocViewer — Document loader orchestrator. |
| `src/components/DocumentLoader/documentLoaderUtils.js` | 254 | 3 | 8 | high | OpenDocViewer — Loader Utilities Helper utilities used by the DocumentLoader pipeline: • Build document URL lists \(pattern mode and demo mode\) • Fetch as ArrayBuffer \(with optional AbortSignal\) • Page counting \(PDF / TIF |
| `src/components/DocumentLoader/LoadPressureDialog.jsx` | 172 | 1 | 4 | medium | Large-load warning dialog shown before / during very heavy loading runs. |
| `src/components/DocumentLoader/mainThreadRenderer.js` | 481 | 1 | 9 | high | OpenDocViewer — Main-thread renderers for PDF &amp; TIFF Render multi-page formats \(PDF/TIFF\) on the main thread when necessary \(e.g., worker fallback, low-core devices, or when explicitly configured\). |
| `src/components/DocumentLoader/sources/explicitListSource.js` | 231 | 1 | 11 | high | OpenDocViewer — Explicit Source List Normalizer Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically. |
| `src/components/DocumentLoader/workerHandler.js` | 301 | 0 | 8 | high | OpenDocViewer — Worker orchestration &amp; message handling - Create image workers for off-main-thread rasterization/conversion. |
| `src/components/DocumentMetadataMatrixOverlayDialog.jsx` | 177 | 1 | 2 | high | Session-wide document metadata matrix overlay. |
| `src/components/DocumentMetadataOverlayDialog.jsx` | 191 | 1 | 2 | high | Document metadata overlay shown from viewer-owned context menus. |
| `src/components/DocumentRender.jsx` | 1112 | 1 | 24 | high | OpenDocViewer — Active page renderer. |
| `src/components/DocumentSelectionPanel.jsx` | 335 | 0 | 2 | high | Hierarchical page-selection editor shown inside the thumbnail pane. |
| `src/components/DocumentThumbnailList.jsx` | 1370 | 1 | 25 | high | OpenDocViewer — Deterministic thumbnail strip. |
| `src/components/DocumentToolbar/AboutOverlayDialog.jsx` | 463 | 1 | 3 | high | Small About dialog for version/build/support information. |
| `src/components/DocumentToolbar/DocumentToolbar.jsx` | 2150 | 1 | 31 | high | Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| `src/components/DocumentToolbar/HelpMenuButton.jsx` | 109 | 1 | 2 | high | Toolbar help menu with entries for the manual and About dialog. |
| `src/components/DocumentToolbar/HelpOverlayDialog.jsx` | 216 | 0 | 2 | high | Full-screen help overlay for OpenDocViewer. |
| `src/components/DocumentToolbar/LanguageMenuButton.jsx` | 154 | 1 | 4 | high | Compact language selector for the toolbar. |
| `src/components/DocumentToolbar/ManualOverlayDialog.jsx` | 357 | 1 | 10 | high | Manual overlay that loads simple external HTML fragments from the public help folder. |
| `src/components/DocumentToolbar/PageNavigationButtons.jsx` | 329 | 1 | 0 | high | Page navigation controls with support for single-step clicks and continuous stepping on press-and-hold. |
| `src/components/DocumentToolbar/PrintRangeDialog.jsx` | 544 | 1 | 1 | high | Unified print dialog with a single print-method selector and shared print-details section. |
| `src/components/DocumentToolbar/SplitToolbarButton.jsx` | 108 | 2 | 0 | high | Reusable toolbar split-button. |
| `src/components/DocumentToolbar/ThemeMenuButton.jsx` | 179 | 1 | 6 | high | Compact theme selector for the toolbar. |
| `src/components/DocumentToolbar/ThemeToggleButton.jsx` | 59 | 0 | 0 | high | Small button that toggles between light/dark themes using the ThemeContext. |
| `src/components/DocumentToolbar/usePdfPrebuildAllPages.js` | 362 | 1 | 8 | high | Background prebuild/cache for configured &quot;all pages&quot; generated-PDF variants. |
| `src/components/DocumentToolbar/usePrintRangeDialog.js` | 828 | 1 | 23 | high | Hook + helpers for PrintRangeDialog. |
| `src/components/DocumentToolbar/ZoomButtons.jsx` | 508 | 1 | 1 | high | Zoom control cluster: \[ - \] \[ % editable \] \[ + \] \| \[ 1:1 \] \[ Fit Page \] \[ Fit Width \] \[ Custom Fit \] - When the field is NOT focused, it renders like “100%”. |
| `src/components/DocumentViewer/CompareZoomOverlay.jsx` | 100 | 1 | 1 | high | Per-pane “post-zoom” controls shown in comparison mode. |
| `src/components/DocumentViewer/DocumentViewer.jsx` | 593 | 0 | 4 | high | OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation + selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the |
| `src/components/DocumentViewer/DocumentViewerRender.jsx` | 1051 | 1 | 17 | high | OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;. |
| `src/components/DocumentViewer/DocumentViewerThumbnails.jsx` | 222 | 1 | 1 | high | OpenDocViewer — Document Viewer Thumbnails \(Wrapper\) Provides the deterministic thumbnail list and local width controls for the viewer shell. |
| `src/components/DocumentViewer/DocumentViewerToolbar.jsx` | 418 | 1 | 5 | high | Toolbar adapter for the document viewer. |
| `src/components/DocumentViewer/hooks/useViewerEffects.js` | 557 | 1 | 18 | high | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res... |
| `src/components/DocumentViewer/hooks/useViewerPostZoom.js` | 86 | 1 | 7 | high | File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &amp;quot;post-zoom&amp;quot; state &amp;amp; handlers used only in compare mode. |
| `src/components/DocumentViewer/useDocumentViewer.js` | 1899 | 1 | 60 | high | Primary viewer-state hook. |
| `src/components/ImageRenderer.jsx` | 121 | 1 | 2 | high | OpenDocViewer — Absolute-positioned Image Renderer Render a single page image at a specified zoom factor. |
| `src/components/LoadingMessage.jsx` | 90 | 1 | 1 | high | OpenDocViewer — Loading / Error Message Simple, accessible message block that reflects the current page load status. |
| `src/components/LoadingSpinner.jsx` | 91 | 1 | 5 | high | OpenDocViewer — Loading Spinner Minimal, accessible loading indicator. |
| `src/components/PrintSelectionWorkspace.jsx` | 2473 | 1 | 4 | high | Full-window print-selection workspace. |
| `src/components/Resizer.jsx` | 111 | 1 | 8 | high | OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels \(e.g., sidebar/content\) via mouse drag or keyboard interaction. |
| `src/components/ViewerProblemNotice.jsx` | 285 | 1 | 4 | high | OpenDocViewer — configurable viewer-level problem notice. |
| `src/contexts/themeContext.js` | 37 | 3 | 3 | high | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| `src/contexts/ThemeProvider.jsx` | 202 | 1 | 11 | high | src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: - explicit themes: normal / light / dark - an implicit system-following startup mode when the user has not chosen |
| `src/contexts/viewerContext.js` | 207 | 10 | 9 | medium | Exports ViewerContext. |
| `src/contexts/ViewerProvider.jsx` | 2551 | 1 | 58 | high | OpenDocViewer — Viewer state provider. |
| `src/ErrorBoundary.jsx` | 297 | 1 | 12 | high | OpenDocViewer — React Error Boundary - Catch unexpected render/runtime errors in descendant components. |
| `src/hooks/useAcceleratingHoldRepeat.js` | 210 | 2 | 1 | high | Reusable press-and-hold behavior for toolbar buttons. |
| `src/hooks/useNavigationModifierState.js` | 109 | 1 | 8 | high | Shared modifier-key state for navigation and compare-aware viewer actions. |
| `src/hooks/usePageNavigation.js` | 182 | 0 | 8 | high | OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press-and-hold UI \(e.g., mousedown\). |
| `src/hooks/usePageTimer.js` | 149 | 2 | 6 | high | OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press-and-hold page navigation: - Invokes a caller-supplied callback immediately \(leading edge\) and then repeatedly after an initia |
| `src/i18n.js` | 566 | 2 | 21 | high | i18n bootstrap for OpenDocViewer. |
| `src/index.jsx` | 59 | 0 | 2 | high | OpenDocViewer — Application Entry - Load global styles \(CSS variables + layout\). |
| `src/integrations/bootstrapRuntime.js` | 457 | 1 | 12 | high | Startup mode detection and host-integration entry point. |
| `src/integrations/normalizePortableBundle.js` | 833 | 1 | 9 | high | Normalizes multiple host payload shapes into the project&#39;s neutral portable bundle shape. |
| `src/integrations/parentBridge.js` | 182 | 1 | 9 | high | Same-origin parent-window bootstrap adapter. |
| `src/integrations/sessionToken.js` | 142 | 1 | 6 | high | OpenDocViewer — Session Token Reader \(Browser-only\) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=&lt;base64&gt; This enables hosts to pass a compact, self-contained “portab |
| `src/integrations/sessionUrl.js` | 157 | 1 | 3 | high | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| `src/integrations/urlParams.js` | 110 | 1 | 5 | high | OpenDocViewer — URL Parameter Reader \(Browser-only\) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e. |
| `src/integrations/viewerEvents.js` | 192 | 0 | 8 | high | OpenDocViewer — Tiny Event Emitter/Listener Utilities \(Browser-only\) Lightweight helpers for broadcasting and listening to app-level DOM events. |
| `src/logging/systemLogger.js` | 432 | 35 | 29 | high | src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) - Provide a small, dependency-light logging facade for the browser app. |
| `src/logging/userLogger.js` | 308 | 1 | 17 | high | UserLogController — client-side controller for **user** print logs \(backend-agnostic\). |
| `src/PerformanceMonitor.jsx` | 1346 | 1 | 20 | high | src/PerformanceMonitor.jsx OpenDocViewer — Lightweight Performance HUD - Provide optional, low-impact visibility into runtime performance and viewer state. |
| `src/schemas/portableBundle.js` | 363 | 0 | 18 | high | OpenDocViewer — Portable Document Bundle Schema &amp; Helpers \(ESM\) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency-free helpers to validate and normalize input. |
| `src/types/jsdoc-types.js` | 101 | 0 | 13 | high | Centralized JSDoc-only type and callback definitions. |
| `src/utils/documentLoadingConfig.js` | 1045 | 12 | 32 | high | OpenDocViewer — runtime helpers for fetch/render/memory policies. |
| `src/utils/documentMetadata.js` | 404 | 3 | 18 | high | Helpers for resolving document-level metadata from the normalized portable bundle. |
| `src/utils/idUtils.js` | 64 | 1 | 4 | high | OpenDocViewer — small opaque identifier helpers. |
| `src/utils/localizedValue.js` | 113 | 6 | 6 | high | Localized string resolver for admin-supplied config values. |
| `src/utils/memoryProfile.js` | 75 | 1 | 6 | high | OpenDocViewer — Runtime memory profile helpers. |
| `src/utils/navigationUtils.js` | 172 | 1 | 7 | high | OpenDocViewer — Navigation Utilities Centralized helpers for page navigation in the document viewer. |
| `src/utils/objectUrlRegistry.js` | 86 | 3 | 6 | high | Centralized helpers for object/blob URL lifecycle management. |
| `src/utils/pageAssetRenderer.js` | 860 | 2 | 5 | high | OpenDocViewer — hybrid page-asset renderer. |
| `src/utils/pageAssetStore.js` | 746 | 1 | 33 | high | OpenDocViewer — Browser-side rendered page-asset storage. |
| `src/utils/pageAssetWorkerPool.js` | 320 | 1 | 15 | high | OpenDocViewer — Page-asset worker pool. |
| `src/utils/pdfBenchmark.js` | 965 | 1 | 36 | high | Opt-in generated-PDF benchmark tooling. |
| `src/utils/pdfjsDocumentOptions.js` | 30 | 4 | 2 | high | Shared pdf.js document-loading options. |
| `src/utils/pdfPageWorkerPool.js` | 477 | 2 | 3 | high | OpenDocViewer - PDF page-image worker pool. |
| `src/utils/pdfPrebuildPlan.js` | 343 | 2 | 17 | high | OpenDocViewer - generated-PDF prebuild planning. |
| `src/utils/pdfPrintCacheKey.js` | 117 | 4 | 8 | high | Generated-PDF cache key helpers. |
| `src/utils/pdfWorkerDispatcher.js` | 451 | 2 | 18 | high | OpenDocViewer - generated PDF worker dispatcher. |
| `src/utils/performanceOverlayFlag.js` | 86 | 2 | 3 | high | Shared runtime toggle helpers for optional diagnostics UI. |
| `src/utils/printCore.js` | 588 | 1 | 20 | high | Core print coordinator for the frontend. |
| `src/utils/printDom.js` | 473 | 1 | 19 | high | OpenDocViewer — Print DOM Builder Safely construct the print iframe’s DOM using DOM APIs \(no doc.write\), wait until images reach a terminal state, then trigger window.print\(\). |
| `src/utils/printParse.js` | 100 | 1 | 3 | high | OpenDocViewer — Print Sequence Parser Parse a user-entered &quot;Custom pages&quot; string into a sequence of page indices. |
| `src/utils/printPdf.js` | 2286 | 3 | 92 | high | OpenDocViewer — Generated PDF print backend. |
| `src/utils/printSanitize.js` | 23 | 4 | 1 | high | OpenDocViewer — Print Sanitization Helpers Small helpers for URL and HTML value safety used by printing modules. |
| `src/utils/printTemplate.js` | 809 | 3 | 34 | high | OpenDocViewer — Print Templating &amp; Tokens Provide token context generation and safe token substitution where values are HTML-escaped before insertion into admin-authored print header/footer templates. |
| `src/utils/printUtils.js` | 37 | 2 | 0 | high | OpenDocViewer — Print Utilities Facade Re-export the stable print API and parser from the internal modules. |
| `src/utils/printWatermark.js` | 80 | 2 | 5 | high | OpenDocViewer — Print watermark mode helpers. |
| `src/utils/publicAssetUrl.js` | 29 | 6 | 1 | high | Resolve a public asset path against the viewer base URL. |
| `src/utils/reloadCacheCrypto.js` | 165 | 2 | 3 | high | Short-lived reload-cache key helpers. |
| `src/utils/reloadCacheIdentity.js` | 154 | 2 | 7 | high | Stable identities for the opt-in reload/document cache. |
| `src/utils/renderDecodeBenchmark.js` | 1211 | 1 | 28 | high | Opt-in render/decode benchmark tooling for the already loaded document session. |
| `src/utils/renderSurfaceBounds.js` | 52 | 1 | 2 | high | OpenDocViewer — conservative raster surface bounds. |
| `src/utils/runtimeConfig.js` | 367 | 13 | 21 | high | Runtime configuration helpers. |
| `src/utils/sourceTempStore.js` | 913 | 1 | 40 | high | OpenDocViewer — Browser-side temporary source storage. |
| `src/utils/supportDiagnostics.js` | 370 | 3 | 18 | high | Support diagnostics helpers for opt-in troubleshooting tools. |
| `src/utils/viewerPreferences.js` | 473 | 5 | 33 | high | Lightweight persisted viewer preferences. |
| `src/utils/zoomUtils.js` | 268 | 1 | 18 | high | OpenDocViewer — Zoom utilities. |
| `src/workers/imageWorker.js` | 500 | 0 | 1 | high | OpenDocViewer — image / TIFF worker. |
| `src/workers/pdfPageWorker.js` | 433 | 0 | 1 | high | OpenDocViewer - PDF page image worker. |
| `src/workers/pdfWorker.js` | 628 | 0 | 1 | high | OpenDocViewer - generated PDF worker. |

## Parse Errors

No parse errors.
