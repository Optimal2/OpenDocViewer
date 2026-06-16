# File Map

Files are sorted by path. Incoming imports and doclet counts are useful signals for where to start.

| File | Lines | In | JSDoc | Summary |
| --- | ---: | ---: | ---: | --- |
| `server/system-log-server.js` | 237 | 0 | 5 | Token auth middleware |
| `server/user-log-server.js` | 271 | 0 | 2 | Resolve user identity without cookies. |
| `src/app/AppBootstrap.jsx` | 432 | 1 | 10 | Session metadata for a bundle. |
| `src/app/bootConfig.js` | 106 | 0 | 5 | Return the application base path (always with a trailing slash) derived from the current page URL. |
| `src/app/OpenDocViewer.jsx` | 193 | 1 | 5 | OpenDocViewer — Top-level component. |
| `src/components/CanvasRenderer.jsx` | 84 | 1 | 1 | CanvasRenderer component. |
| `src/components/common/StatusLed.jsx` | 36 | 2 | 1 | Exports StatusLed. |
| `src/components/DocumentConsumerWrapper.jsx` | 172 | 1 | 2 | DocumentConsumerWrapper Wraps DocumentLoader + DocumentViewer and switches between full viewer and a thumbnail-only presentation on small/mobile layouts. |
| `src/components/DocumentLoader/batchHandler.js` | 226 | 0 | 7 | Batch scheduler entry point. |
| `src/components/DocumentLoader/DemoControls.jsx` | 101 | 0 | 1 | DemoControls — wraps DocumentLoader with demo-mode props and a small control UI. |
| `src/components/DocumentLoader/DocumentLoader.js` | 2163 | 1 | 58 | Resolve source type information with a cheap signature-first path. |
| `src/components/DocumentLoader/documentLoaderUtils.js` | 254 | 3 | 8 | Generate a list of document URLs using a simple pattern: 001..NNN + extension. |
| `src/components/DocumentLoader/LoadPressureDialog.jsx` | 172 | 1 | 4 | Large-load warning dialog shown before / during very heavy loading runs. |
| `src/components/DocumentLoader/mainThreadRenderer.js` | 507 | 1 | 9 | Render PDF pages on the main thread and INSERT THEM DIRECTLY. |
| `src/components/DocumentLoader/sources/explicitListSource.js` | 231 | 1 | 11 | Convert a PortableDocumentBundle into a flat, ordered list of file URLs. |
| `src/components/DocumentLoader/workerHandler.js` | 330 | 0 | 9 | Create a new image worker instance. |
| `src/components/DocumentMetadataMatrixOverlayDialog.jsx` | 177 | 1 | 2 | Exports DocumentMetadataMatrixOverlayDialog. |
| `src/components/DocumentMetadataOverlayDialog.jsx` | 191 | 1 | 2 | Exports DocumentMetadataOverlayDialog. |
| `src/components/DocumentRender.jsx` | 1074 | 1 | 24 | Reset the per-page blob-URL retry tracker after a successful load or when the target page changes. |
| `src/components/DocumentSelectionPanel.jsx` | 335 | 0 | 2 | Exports DocumentSelectionPanel. |
| `src/components/DocumentThumbnailList.jsx` | 1364 | 1 | 25 | Build a center-out thumbnail warm-up order so the pane feels responsive around the user's current scroll target instead of always starting from page 1. |
| `src/components/DocumentToolbar/AboutOverlayDialog.jsx` | 463 | 1 | 3 | Exports AboutOverlayDialog. |
| `src/components/DocumentToolbar/DocumentToolbar.jsx` | 2126 | 1 | 31 | Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| `src/components/DocumentToolbar/HelpMenuButton.jsx` | 109 | 1 | 2 | Exports HelpMenuButton. |
| `src/components/DocumentToolbar/HelpOverlayDialog.jsx` | 216 | 0 | 2 | Exports HelpOverlayDialog. |
| `src/components/DocumentToolbar/LanguageMenuButton.jsx` | 154 | 1 | 4 | Exports LanguageMenuButton. |
| `src/components/DocumentToolbar/ManualOverlayDialog.jsx` | 357 | 1 | 10 | Exports ManualOverlayDialog. |
| `src/components/DocumentToolbar/PageNavigationButtons.jsx` | 329 | 1 | 0 | Exports PageNavigationButtons. |
| `src/components/DocumentToolbar/PrintRangeDialog.jsx` | 545 | 1 | 1 | Structured payload returned to the caller on submit. |
| `src/components/DocumentToolbar/SplitToolbarButton.jsx` | 108 | 2 | 0 | Exports SplitToolbarButton. |
| `src/components/DocumentToolbar/ThemeMenuButton.jsx` | 166 | 1 | 5 | Exports ThemeMenuButton. |
| `src/components/DocumentToolbar/ThemeToggleButton.jsx` | 55 | 0 | 0 | Exports ThemeToggleButton. |
| `src/components/DocumentToolbar/usePdfPrebuildAllPages.js` | 362 | 1 | 8 | Run async work with bounded concurrency. |
| `src/components/DocumentToolbar/usePrintRangeDialog.js` | 828 | 1 | 23 | Read the runtime configuration (merged defaults + site overrides). |
| `src/components/DocumentToolbar/ZoomButtons.jsx` | 508 | 1 | 1 | Parse a percent-like string safely. |
| `src/components/DocumentViewer/CompareZoomOverlay.jsx` | 100 | 1 | 1 | CompareZoomOverlay Presentational-only (no state). |
| `src/components/DocumentViewer/DocumentViewer.jsx` | 593 | 0 | 4 | Exports DocumentViewer. |
| `src/components/DocumentViewer/DocumentViewerRender.jsx` | 1051 | 1 | 17 | DocumentViewerRender Renders the main document pane and, if enabled, a comparison pane. |
| `src/components/DocumentViewer/DocumentViewerThumbnails.jsx` | 222 | 1 | 1 | Exports DocumentViewerThumbnails. |
| `src/components/DocumentViewer/DocumentViewerToolbar.jsx` | 418 | 1 | 5 | Renders the toolbar for the document viewer by delegating to . |
| `src/components/DocumentViewer/hooks/useViewerEffects.js` | 557 | 1 | 18 | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res... |
| `src/components/DocumentViewer/hooks/useViewerPostZoom.js` | 86 | 1 | 7 | File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &quot;post-zoom&quot; state &amp; handlers used only in compare mode. |
| `src/components/DocumentViewer/useDocumentViewer.js` | 1690 | 1 | 53 | Hook that centralizes viewer UI state and event handlers. |
| `src/components/ImageRenderer.jsx` | 121 | 1 | 2 | ImageRenderer component. |
| `src/components/LoadingMessage.jsx` | 90 | 1 | 1 | LoadingMessage component. |
| `src/components/LoadingSpinner.jsx` | 91 | 1 | 5 | LoadingSpinner component. |
| `src/components/PrintSelectionWorkspace.jsx` | 2450 | 1 | 4 | Exports PrintSelectionWorkspace. |
| `src/components/Resizer.jsx` | 111 | 1 | 8 | Resizer component. |
| `src/components/ViewerProblemNotice.jsx` | 267 | 1 | 4 | Exports ViewerProblemNotice. |
| `src/contexts/themeContext.js` | 37 | 3 | 3 | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| `src/contexts/ThemeProvider.jsx` | 202 | 1 | 11 | ThemeProvider component to manage and provide theme-related state and functions. |
| `src/contexts/viewerContext.js` | 207 | 10 | 9 | Exports ViewerContext. |
| `src/contexts/ViewerProvider.jsx` | 2551 | 1 | 58 | Record that a page now has a reusable full-size asset available. |
| `src/ErrorBoundary.jsx` | 297 | 1 | 12 | Tiny helper to translate with safe fallback (NS: 'common'). |
| `src/hooks/useAcceleratingHoldRepeat.js` | 210 | 2 | 1 | Exports useAcceleratingHoldRepeat. |
| `src/hooks/useNavigationModifierState.js` | 109 | 1 | 8 | Exports useNavigationModifierState. |
| `src/hooks/usePageNavigation.js` | 182 | 0 | 8 | Custom hook to handle document page navigation with keyboard/mouse. |
| `src/hooks/usePageTimer.js` | 149 | 2 | 6 | Custom hook to handle page change with a timer for continuous navigation. |
| `src/i18n.js` | 566 | 2 | 21 | Return browser window safely in browser, SSR, test, and documentation contexts. |
| `src/index.jsx` | 59 | 0 | 2 | Determine environment and set a sensible client-side log level. |
| `src/integrations/bootstrapRuntime.js` | 457 | 1 | 12 | Canonical bootstrap modes. |
| `src/integrations/normalizePortableBundle.js` | 833 | 1 | 9 | Normalize many incoming shapes to a neutral PortableDocumentBundle v1. |
| `src/integrations/parentBridge.js` | 182 | 1 | 9 | Attempt to read a bootstrap object from a same-origin parent. |
| `src/integrations/sessionToken.js` | 142 | 1 | 6 | Decode a Base64 string into a UTF-8 JavaScript string. |
| `src/integrations/sessionUrl.js` | 157 | 1 | 3 | Read and fetch a session payload URL from the viewer query string. |
| `src/integrations/urlParams.js` | 110 | 1 | 5 | Reads common query params used by the demo and other hosts. |
| `src/integrations/viewerEvents.js` | 192 | 0 | 8 | Emit a namespaced OpenDocViewer event with an optional detail payload. |
| `src/logging/systemLogger.js` | 432 | 35 | 29 | Export a singleton instance (sufficient for app usage). |
| `src/logging/userLogger.js` | 308 | 1 | 17 | Export singleton instance. |
| `src/PerformanceMonitor.jsx` | 1346 | 1 | 20 | PerformanceMonitor component. |
| `src/schemas/portableBundle.js` | 363 | 0 | 18 | Schema version of this portable bundle definition. |
| `src/types/jsdoc-types.js` | 101 | 0 | 13 | Generic React-like state setter for numbers: accepts either a number or an updater function (number)-&gt;number. |
| `src/utils/documentLoadingConfig.js` | 1045 | 12 | 32 | Count PDF pages in a page descriptor list. |
| `src/utils/documentMetadata.js` | 404 | 3 | 18 | Build a UI-friendly projection of one document's metadata. |
| `src/utils/idUtils.js` | 64 | 1 | 4 | Create an opaque identifier fragment suitable for synthetic keys and document ids. |
| `src/utils/localizedValue.js` | 113 | 6 | 6 | Return the best string for the active language. |
| `src/utils/memoryProfile.js` | 75 | 1 | 6 | Exports getRuntimeMemoryProfile. |
| `src/utils/navigationUtils.js` | 172 | 1 | 7 | Navigate to the previous page (no-op if already at page 1). |
| `src/utils/objectUrlRegistry.js` | 72 | 1 | 6 | Check whether a blob/object URL is still tracked as live by the viewer. |
| `src/utils/pageAssetRenderer.js` | 850 | 2 | 5 | Render a PDF page set through the PDF worker pool as one partitioned batch. |
| `src/utils/pageAssetStore.js` | 746 | 1 | 33 | Update runtime thresholds for the active session. |
| `src/utils/pageAssetWorkerPool.js` | 320 | 1 | 15 | Exports createPageAssetWorkerPool, PageAssetWorkerPool. |
| `src/utils/pdfBenchmark.js` | 965 | 1 | 36 | Keep a batch-size list ordered and unique. |
| `src/utils/pdfjsDocumentOptions.js` | 30 | 4 | 2 | Shared pdf.js document-loading options. |
| `src/utils/pdfPageWorkerPool.js` | 477 | 2 | 3 | Exports createPdfPageWorkerPool, PdfPageWorkerPool. |
| `src/utils/pdfPrebuildPlan.js` | 343 | 2 | 17 | Return the language dependency that should invalidate an all-pages prebuild run. |
| `src/utils/pdfPrintCacheKey.js` | 117 | 4 | 8 | Compare the content-affecting print settings that determine whether an existing generated PDF can be reused. |
| `src/utils/pdfWorkerDispatcher.js` | 451 | 2 | 18 | Pick a conservative future batch size from a pages-per-worker target. |
| `src/utils/performanceOverlayFlag.js` | 86 | 2 | 3 | Resolve a boolean flag from (precedence order): window. |
| `src/utils/printCore.js` | 569 | 1 | 20 | Handles the print functionality for the CURRENT page/image. |
| `src/utils/printDom.js` | 462 | 1 | 19 | Render a single-page print document in the given print iframe document. |
| `src/utils/printParse.js` | 100 | 1 | 3 | Parse &quot;Custom pages&quot; into a sequence. |
| `src/utils/printPdf.js` | 2174 | 3 | 92 | Build a PDF blob from page image URLs and print metadata. |
| `src/utils/printSanitize.js` | 23 | 3 | 1 | Allow-list image sources used for printing. |
| `src/utils/printTemplate.js` | 809 | 3 | 34 | Resolve the configured copy/print-format marker text consistently across print backends. |
| `src/utils/printUtils.js` | 37 | 2 | 0 | Exports handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence. |
| `src/utils/printWatermark.js` | 80 | 2 | 5 | Resolve the image asset for COPY/KOPIA watermark modes. |
| `src/utils/publicAssetUrl.js` | 29 | 6 | 1 | Exports getPublicAssetUrl, default. |
| `src/utils/reloadCacheCrypto.js` | 165 | 2 | 3 | Short-lived reload-cache key helpers. |
| `src/utils/reloadCacheIdentity.js` | 154 | 2 | 7 | Exports stableHash, createReloadCacheSessionId, describeDocumentSourceKey, createDocumentSourceKey, createRenderAssetSignature. |
| `src/utils/renderDecodeBenchmark.js` | 1211 | 1 | 28 | Exports isRenderDecodeBenchmarkEnabled, runRenderDecodeBenchmark. |
| `src/utils/runtimeConfig.js` | 363 | 13 | 21 | Read the merged runtime configuration from the browser environment. |
| `src/utils/sourceTempStore.js` | 913 | 1 | 40 | Update runtime thresholds for the active session. |
| `src/utils/supportDiagnostics.js` | 370 | 3 | 18 | Download a JSON diagnostics payload in browser environments. |
| `src/utils/viewerPreferences.js` | 473 | 5 | 33 | Persist the user's theme mode preference. |
| `src/utils/zoomUtils.js` | 268 | 1 | 18 | Calculate and set a zoom that fits the render surface within both viewport axes. |
| `src/workers/imageWorker.js` | 488 | 0 | 1 | Creates an error that tells the caller this worker path is unsupported and should be retried on the main thread. |
| `src/workers/pdfPageWorker.js` | 433 | 0 | 1 | Defines createFallbackMainThreadError, getWorkerEnvironmentDiagnostics, serializeError, fitScale, normalizeThumbnailBound. |
| `src/workers/pdfWorker.js` | 628 | 0 | 1 | OpenDocViewer - generated PDF worker. |

## Parse Errors

No parse errors.
