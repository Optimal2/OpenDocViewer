# File Map

Files are sorted by path. Incoming imports and doclet counts are useful signals for where to start.

| File | Lines | In | JSDoc | Confidence | Summary |
| --- | ---: | ---: | ---: | --- | --- |
| <code>server/system-log-server.js</code> | 237 | 0 | 5 | high | System Log Server — Single-file, standalone \(ESM\) Responsibilities: - Expose POST /log for structured system logs \(tiny JSON bodies\) - Write NDJSON to daily-rotated files under ./logs/ - Keep access, ingestion, and error |
| <code>server/user-log-server.js</code> | 271 | 0 | 2 | high | User Action Log Server — Single-file, standalone \(ESM\) Endpoint: POST /userlog/record - Body: application/x-www-form-urlencoded or JSON - reason: string\|null - forWhom: string\|null - Response: 200 OK with body: true \(JSO |
| <code>src/app/AppBootstrap.jsx</code> | 432 | 1 | 10 | high | Application bootstrap React component. |
| <code>src/app/bootConfig.js</code> | 138 | 0 | 5 | high | Runtime boot loader that resolves configuration scripts before React starts. |
| <code>src/app/OpenDocViewer.jsx</code> | 193 | 1 | 5 | high | src/app/OpenDocViewer.jsx Main application shell for the viewer. |
| <code>src/components/CanvasRenderer.jsx</code> | 84 | 1 | 1 | high | OpenDocViewer — Absolute-positioned Canvas Renderer Render a &lt;canvas&gt; element for a single page at a specified zoom factor. |
| <code>src/components/common/StatusLed.jsx</code> | 36 | 2 | 1 | high | Small reusable LED-style status indicator. |
| <code>src/components/DocumentConsumerWrapper.jsx</code> | 172 | 1 | 2 | high | OpenDocViewer — Consumer Wrapper for Loader + Viewer Orchestrates the document loading pipeline and the main viewer UI: • Pattern mode: { folder, extension, endNumber } • Explicit-list: { sourceList: \[{ url, ext?, fileIn |
| <code>src/components/DocumentLoader/batchHandler.js</code> | 226 | 0 | 7 | high | OpenDocViewer — Minimal, fair worker-batch scheduler Distribute image-decoding jobs across a pool of Web Workers without monopolizing the main thread. |
| <code>src/components/DocumentLoader/DemoControls.jsx</code> | 101 | 0 | 1 | high | OpenDocViewer — Demo Controls for “one-file-per-format” demo mode - Provide a simple control bar: &quot;Total pages/files&quot; + JPG/PNG/TIF/PDF buttons + a new &quot;Mix&quot; button. |
| <code>src/components/DocumentLoader/DocumentLoader.js</code> | 2172 | 1 | 58 | high | OpenDocViewer — Document loader orchestrator. |
| <code>src/components/DocumentLoader/documentLoaderUtils.js</code> | 389 | 3 | 8 | high | OpenDocViewer — Loader Utilities Helper utilities used by the DocumentLoader pipeline: • Build document URL lists \(pattern mode and demo mode\) • Fetch as ArrayBuffer \(with optional AbortSignal\) • Page counting \(PDF / TIF |
| <code>src/components/DocumentLoader/LoadPressureDialog.jsx</code> | 172 | 1 | 4 | medium | Large-load warning dialog shown before / during very heavy loading runs. |
| <code>src/components/DocumentLoader/mainThreadRenderer.js</code> | 509 | 1 | 9 | high | OpenDocViewer — Main-thread renderers for PDF &amp; TIFF Render multi-page formats \(PDF/TIFF\) on the main thread when necessary \(e.g., worker fallback, low-core devices, or when explicitly configured\). |
| <code>src/components/DocumentLoader/sources/explicitListSource.js</code> | 231 | 1 | 11 | high | OpenDocViewer — Explicit Source List Normalizer Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically. |
| <code>src/components/DocumentLoader/workerHandler.js</code> | 301 | 0 | 8 | high | OpenDocViewer — Worker orchestration &amp; message handling - Create image workers for off-main-thread rasterization/conversion. |
| <code>src/components/DocumentMetadataMatrixOverlayDialog.jsx</code> | 177 | 1 | 2 | high | Session-wide document metadata matrix overlay. |
| <code>src/components/DocumentMetadataOverlayDialog.jsx</code> | 191 | 1 | 2 | high | Document metadata overlay shown from viewer-owned context menus. |
| <code>src/components/DocumentRender.jsx</code> | 1112 | 1 | 24 | high | OpenDocViewer — Active page renderer. |
| <code>src/components/DocumentSelectionPanel.jsx</code> | 335 | 0 | 2 | high | Hierarchical page-selection editor shown inside the thumbnail pane. |
| <code>src/components/DocumentThumbnailList.jsx</code> | 1370 | 1 | 25 | high | OpenDocViewer — Deterministic thumbnail strip. |
| <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx</code> | 463 | 1 | 3 | high | Small About dialog for version/build/support information. |
| <code>src/components/DocumentToolbar/DocumentToolbar.jsx</code> | 2150 | 1 | 31 | high | Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| <code>src/components/DocumentToolbar/HelpMenuButton.jsx</code> | 109 | 1 | 2 | high | Toolbar help menu with entries for the manual and About dialog. |
| <code>src/components/DocumentToolbar/HelpOverlayDialog.jsx</code> | 216 | 0 | 2 | high | Full-screen help overlay for OpenDocViewer. |
| <code>src/components/DocumentToolbar/LanguageMenuButton.jsx</code> | 154 | 1 | 4 | high | Compact language selector for the toolbar. |
| <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx</code> | 357 | 1 | 10 | high | Manual overlay that loads simple external HTML fragments from the public help folder. |
| <code>src/components/DocumentToolbar/PageNavigationButtons.jsx</code> | 329 | 1 | 0 | high | Page navigation controls with support for single-step clicks and continuous stepping on press-and-hold. |
| <code>src/components/DocumentToolbar/PrintRangeDialog.jsx</code> | 544 | 1 | 1 | high | Unified print dialog with a single print-method selector and shared print-details section. |
| <code>src/components/DocumentToolbar/SplitToolbarButton.jsx</code> | 108 | 2 | 0 | high | Reusable toolbar split-button. |
| <code>src/components/DocumentToolbar/ThemeMenuButton.jsx</code> | 179 | 1 | 6 | high | Compact theme selector for the toolbar. |
| <code>src/components/DocumentToolbar/ThemeToggleButton.jsx</code> | 59 | 0 | 0 | high | Small button that toggles between light/dark themes using the ThemeContext. |
| <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js</code> | 362 | 1 | 8 | high | Background prebuild/cache for configured &quot;all pages&quot; generated-PDF variants. |
| <code>src/components/DocumentToolbar/usePrintRangeDialog.js</code> | 828 | 1 | 23 | high | Hook + helpers for PrintRangeDialog. |
| <code>src/components/DocumentToolbar/ZoomButtons.jsx</code> | 508 | 1 | 1 | high | Zoom control cluster: \[ - \] \[ % editable \] \[ + \] \| \[ 1:1 \] \[ Fit Page \] \[ Fit Width \] \[ Custom Fit \] - When the field is NOT focused, it renders like “100%”. |
| <code>src/components/DocumentViewer/CompareZoomOverlay.jsx</code> | 100 | 1 | 1 | high | Per-pane “post-zoom” controls shown in comparison mode. |
| <code>src/components/DocumentViewer/DocumentViewer.jsx</code> | 593 | 0 | 4 | high | OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation + selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the |
| <code>src/components/DocumentViewer/DocumentViewerRender.jsx</code> | 1051 | 1 | 17 | high | OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;. |
| <code>src/components/DocumentViewer/DocumentViewerThumbnails.jsx</code> | 222 | 1 | 1 | high | OpenDocViewer — Document Viewer Thumbnails \(Wrapper\) Provides the deterministic thumbnail list and local width controls for the viewer shell. |
| <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx</code> | 418 | 1 | 5 | high | Toolbar adapter for the document viewer. |
| <code>src/components/DocumentViewer/hooks/useViewerEffects.js</code> | 557 | 1 | 18 | high | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res... |
| <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js</code> | 86 | 1 | 7 | high | File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &amp;quot;post-zoom&amp;quot; state &amp;amp; handlers used only in compare mode. |
| <code>src/components/DocumentViewer/useDocumentViewer.js</code> | 1899 | 1 | 60 | high | Primary viewer-state hook. |
| <code>src/components/ImageRenderer.jsx</code> | 121 | 1 | 2 | high | OpenDocViewer — Absolute-positioned Image Renderer Render a single page image at a specified zoom factor. |
| <code>src/components/LoadingMessage.jsx</code> | 90 | 1 | 1 | high | OpenDocViewer — Loading / Error Message Simple, accessible message block that reflects the current page load status. |
| <code>src/components/LoadingSpinner.jsx</code> | 91 | 1 | 5 | high | OpenDocViewer — Loading Spinner Minimal, accessible loading indicator. |
| <code>src/components/PrintSelectionWorkspace.jsx</code> | 2485 | 1 | 4 | high | Full-window print-selection workspace. |
| <code>src/components/Resizer.jsx</code> | 111 | 1 | 8 | high | OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels \(e.g., sidebar/content\) via mouse drag or keyboard interaction. |
| <code>src/components/ViewerProblemNotice.jsx</code> | 285 | 1 | 4 | high | OpenDocViewer — configurable viewer-level problem notice. |
| <code>src/contexts/themeContext.js</code> | 37 | 3 | 3 | high | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| <code>src/contexts/ThemeProvider.jsx</code> | 202 | 1 | 11 | high | src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: - explicit themes: normal / light / dark - an implicit system-following startup mode when the user has not chosen |
| <code>src/contexts/viewerContext.js</code> | 207 | 10 | 9 | medium | Exports ViewerContext. |
| <code>src/contexts/ViewerProvider.jsx</code> | 2572 | 1 | 58 | high | OpenDocViewer — Viewer state provider. |
| <code>src/ErrorBoundary.jsx</code> | 297 | 1 | 12 | high | OpenDocViewer — React Error Boundary - Catch unexpected render/runtime errors in descendant components. |
| <code>src/hooks/useAcceleratingHoldRepeat.js</code> | 210 | 2 | 1 | high | Reusable press-and-hold behavior for toolbar buttons. |
| <code>src/hooks/useNavigationModifierState.js</code> | 109 | 1 | 8 | high | Shared modifier-key state for navigation and compare-aware viewer actions. |
| <code>src/hooks/usePageNavigation.js</code> | 182 | 0 | 8 | high | OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press-and-hold UI \(e.g., mousedown\). |
| <code>src/hooks/usePageTimer.js</code> | 149 | 2 | 6 | high | OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press-and-hold page navigation: - Invokes a caller-supplied callback immediately \(leading edge\) and then repeatedly after an initia |
| <code>src/i18n.js</code> | 566 | 2 | 21 | high | i18n bootstrap for OpenDocViewer. |
| <code>src/index.jsx</code> | 59 | 0 | 2 | high | OpenDocViewer — Application Entry - Load global styles \(CSS variables + layout\). |
| <code>src/integrations/bootstrapRuntime.js</code> | 457 | 1 | 12 | high | Startup mode detection and host-integration entry point. |
| <code>src/integrations/normalizePortableBundle.js</code> | 833 | 1 | 9 | high | Normalizes multiple host payload shapes into the project&#39;s neutral portable bundle shape. |
| <code>src/integrations/parentBridge.js</code> | 182 | 1 | 9 | high | Same-origin parent-window bootstrap adapter. |
| <code>src/integrations/sessionToken.js</code> | 142 | 1 | 6 | high | OpenDocViewer — Session Token Reader \(Browser-only\) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=&lt;base64&gt; This enables hosts to pass a compact, self-contained “portab |
| <code>src/integrations/sessionUrl.js</code> | 157 | 1 | 3 | high | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| <code>src/integrations/urlParams.js</code> | 110 | 1 | 5 | high | OpenDocViewer — URL Parameter Reader \(Browser-only\) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e. |
| <code>src/integrations/viewerEvents.js</code> | 192 | 0 | 8 | high | OpenDocViewer — Tiny Event Emitter/Listener Utilities \(Browser-only\) Lightweight helpers for broadcasting and listening to app-level DOM events. |
| <code>src/logging/systemLogger.js</code> | 432 | 35 | 29 | high | src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) - Provide a small, dependency-light logging facade for the browser app. |
| <code>src/logging/userLogger.js</code> | 308 | 1 | 17 | high | UserLogController — client-side controller for **user** print logs \(backend-agnostic\). |
| <code>src/PerformanceMonitor.jsx</code> | 1346 | 1 | 20 | high | src/PerformanceMonitor.jsx OpenDocViewer — Lightweight Performance HUD - Provide optional, low-impact visibility into runtime performance and viewer state. |
| <code>src/schemas/portableBundle.js</code> | 363 | 0 | 18 | high | OpenDocViewer — Portable Document Bundle Schema &amp; Helpers \(ESM\) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency-free helpers to validate and normalize input. |
| <code>src/types/jsdoc-types.js</code> | 101 | 0 | 13 | high | Centralized JSDoc-only type and callback definitions. |
| <code>src/utils/documentLoadingConfig.js</code> | 1048 | 12 | 32 | high | OpenDocViewer — runtime helpers for fetch/render/memory policies. |
| <code>src/utils/documentMetadata.js</code> | 404 | 3 | 18 | high | Helpers for resolving document-level metadata from the normalized portable bundle. |
| <code>src/utils/idUtils.js</code> | 64 | 1 | 4 | high | OpenDocViewer — small opaque identifier helpers. |
| <code>src/utils/localizedValue.js</code> | 113 | 6 | 6 | high | Localized string resolver for admin-supplied config values. |
| <code>src/utils/memoryProfile.js</code> | 75 | 1 | 6 | high | OpenDocViewer — Runtime memory profile helpers. |
| <code>src/utils/navigationUtils.js</code> | 172 | 1 | 7 | high | OpenDocViewer — Navigation Utilities Centralized helpers for page navigation in the document viewer. |
| <code>src/utils/objectUrlRegistry.js</code> | 92 | 3 | 6 | high | Centralized helpers for object/blob URL lifecycle management. |
| <code>src/utils/pageAssetRenderer.js</code> | 895 | 2 | 5 | high | OpenDocViewer — hybrid page-asset renderer. |
| <code>src/utils/pageAssetStore.js</code> | 746 | 1 | 33 | high | OpenDocViewer — Browser-side rendered page-asset storage. |
| <code>src/utils/pageAssetWorkerPool.js</code> | 320 | 1 | 15 | high | OpenDocViewer — Page-asset worker pool. |
| <code>src/utils/pdfBenchmark.js</code> | 965 | 1 | 36 | high | Opt-in generated-PDF benchmark tooling. |
| <code>src/utils/pdfjsDocumentOptions.js</code> | 30 | 4 | 2 | high | Shared pdf.js document-loading options. |
| <code>src/utils/pdfPageWorkerPool.js</code> | 477 | 2 | 3 | high | OpenDocViewer - PDF page-image worker pool. |
| <code>src/utils/pdfPrebuildPlan.js</code> | 343 | 2 | 17 | high | OpenDocViewer - generated-PDF prebuild planning. |
| <code>src/utils/pdfPrintCacheKey.js</code> | 117 | 4 | 8 | high | Generated-PDF cache key helpers. |
| <code>src/utils/pdfWorkerDispatcher.js</code> | 451 | 2 | 18 | high | OpenDocViewer - generated PDF worker dispatcher. |
| <code>src/utils/performanceOverlayFlag.js</code> | 86 | 2 | 3 | high | Shared runtime toggle helpers for optional diagnostics UI. |
| <code>src/utils/printCore.js</code> | 588 | 1 | 20 | high | Core print coordinator for the frontend. |
| <code>src/utils/printDom.js</code> | 473 | 1 | 19 | high | OpenDocViewer — Print DOM Builder Safely construct the print iframe’s DOM using DOM APIs \(no doc.write\), wait until images reach a terminal state, then trigger window.print\(\). |
| <code>src/utils/printParse.js</code> | 100 | 1 | 3 | high | OpenDocViewer — Print Sequence Parser Parse a user-entered &quot;Custom pages&quot; string into a sequence of page indices. |
| <code>src/utils/printPdf.js</code> | 2286 | 3 | 92 | high | OpenDocViewer — Generated PDF print backend. |
| <code>src/utils/printSanitize.js</code> | 23 | 4 | 1 | high | OpenDocViewer — Print Sanitization Helpers Small helpers for URL and HTML value safety used by printing modules. |
| <code>src/utils/printTemplate.js</code> | 809 | 3 | 34 | high | OpenDocViewer — Print Templating &amp; Tokens Provide token context generation and safe token substitution where values are HTML-escaped before insertion into admin-authored print header/footer templates. |
| <code>src/utils/printUtils.js</code> | 37 | 2 | 0 | high | OpenDocViewer — Print Utilities Facade Re-export the stable print API and parser from the internal modules. |
| <code>src/utils/printWatermark.js</code> | 80 | 2 | 5 | high | OpenDocViewer — Print watermark mode helpers. |
| <code>src/utils/publicAssetUrl.js</code> | 29 | 6 | 1 | high | Resolve a public asset path against the viewer base URL. |
| <code>src/utils/reloadCacheCrypto.js</code> | 165 | 2 | 3 | high | Short-lived reload-cache key helpers. |
| <code>src/utils/reloadCacheIdentity.js</code> | 154 | 2 | 7 | high | Stable identities for the opt-in reload/document cache. |
| <code>src/utils/renderDecodeBenchmark.js</code> | 1211 | 1 | 28 | high | Opt-in render/decode benchmark tooling for the already loaded document session. |
| <code>src/utils/renderSurfaceBounds.js</code> | 52 | 1 | 2 | high | OpenDocViewer — conservative raster surface bounds. |
| <code>src/utils/runtimeConfig.js</code> | 367 | 13 | 21 | high | Runtime configuration helpers. |
| <code>src/utils/sourceTempStore.js</code> | 913 | 1 | 40 | high | OpenDocViewer — Browser-side temporary source storage. |
| <code>src/utils/supportDiagnostics.js</code> | 370 | 3 | 18 | high | Support diagnostics helpers for opt-in troubleshooting tools. |
| <code>src/utils/viewerPreferences.js</code> | 473 | 5 | 33 | high | Lightweight persisted viewer preferences. |
| <code>src/utils/zoomUtils.js</code> | 268 | 1 | 18 | high | OpenDocViewer — Zoom utilities. |
| <code>src/workers/imageWorker.js</code> | 500 | 0 | 1 | high | OpenDocViewer — image / TIFF worker. |
| <code>src/workers/pdfPageWorker.js</code> | 433 | 0 | 1 | high | OpenDocViewer - PDF page image worker. |
| <code>src/workers/pdfWorker.js</code> | 628 | 0 | 1 | high | OpenDocViewer - generated PDF worker. |

## Parse Errors

No parse errors.
