# File Map

Files are sorted by path. Incoming imports and doclet counts are useful signals for where to start.

| File | Lines | In | JSDoc | Confidence | Summary |
| --- | ---: | ---: | ---: | --- | --- |
| <code>server/system-log-server.js</code> | 237 | 0 | 5 | high | System Log Server — standalone Express endpoint for structured system logs. |
| <code>server/user-log-server.js</code> | 271 | 0 | 2 | high | User Action Log Server — standalone Express endpoint for print/user-action audit events. |
| <code>src/app/AppBootstrap.jsx</code> | 432 | 1 | 10 | high | Application bootstrap React component. |
| <code>src/app/bootConfig.js</code> | 157 | 0 | 5 | high | Runtime boot loader that resolves configuration scripts before React starts. |
| <code>src/app/OpenDocViewer.jsx</code> | 193 | 1 | 5 | high | src/app/OpenDocViewer.jsx Main application shell for the viewer. |
| <code>src/components/CanvasRenderer.jsx</code> | 84 | 1 | 1 | high | OpenDocViewer — Absolute-positioned Canvas Renderer Render a &lt;canvas&gt; element for a single page at a specified zoom factor. |
| <code>src/components/common/StatusLed.jsx</code> | 36 | 2 | 1 | high | Small reusable LED-style status indicator. |
| <code>src/components/DocumentConsumerWrapper.jsx</code> | 172 | 1 | 2 | high | OpenDocViewer — Consumer Wrapper for Loader + Viewer Orchestrates the document loading pipeline and the main viewer UI: • Pattern mode: { folder, extension, endNumber } • Explicit-list: { sourceList: \[{ url, ext?, fileIn |
| <code>src/components/DocumentLoader/batchHandler.js</code> | 226 | 0 | 7 | high | OpenDocViewer — Minimal, fair worker-batch scheduler Distribute image-decoding jobs across a pool of Web Workers without monopolizing the main thread. |
| <code>src/components/DocumentLoader/DemoControls.jsx</code> | 101 | 0 | 1 | high | OpenDocViewer — Demo Controls for “one-file-per-format” demo mode - Provide a simple control bar: &quot;Total pages/files&quot; + JPG/PNG/TIF/PDF buttons + a new &quot;Mix&quot; button. |
| <code>src/components/DocumentLoader/DocumentLoader.js</code> | 2172 | 2 | 58 | high | OpenDocViewer — Document loader orchestrator. |
| <code>src/components/DocumentLoader/documentLoaderUtils.js</code> | 389 | 3 | 8 | high | OpenDocViewer — Loader Utilities Helper utilities used by the DocumentLoader pipeline: • Build document URL lists \(pattern mode and demo mode\) • Fetch as ArrayBuffer \(with optional AbortSignal\) • Page counting \(PDF / TIF |
| <code>src/components/DocumentLoader/LoadPressureDialog.jsx</code> | 172 | 1 | 4 | medium | Large-load warning dialog shown before / during very heavy loading runs. |
| <code>src/components/DocumentLoader/mainThreadRenderer.js</code> | 517 | 1 | 9 | high | OpenDocViewer — Main-thread renderers for PDF &amp; TIFF Render multi-page formats \(PDF/TIFF\) on the main thread when necessary \(e.g., worker fallback, low-core devices, or when explicitly configured\). |
| <code>src/components/DocumentLoader/sources/explicitListSource.js</code> | 231 | 1 | 11 | high | OpenDocViewer — Explicit Source List Normalizer Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically. |
| <code>src/components/DocumentLoader/workerHandler.js</code> | 301 | 0 | 8 | high | OpenDocViewer — Worker orchestration &amp; message handling - Create image workers for off-main-thread rasterization/conversion. |
| <code>src/components/DocumentMetadataMatrixOverlayDialog.jsx</code> | 177 | 1 | 2 | high | Session-wide document metadata matrix overlay. |
| <code>src/components/DocumentMetadataOverlayDialog.jsx</code> | 191 | 1 | 2 | high | Document metadata overlay shown from viewer-owned context menus. |
| <code>src/components/DocumentRender.jsx</code> | 1236 | 3 | 27 | high | OpenDocViewer — Active page renderer. |
| <code>src/components/DocumentSelectionPanel.jsx</code> | 335 | 0 | 2 | high | Hierarchical page-selection editor shown inside the thumbnail pane. |
| <code>src/components/DocumentThumbnailList.jsx</code> | 1604 | 2 | 28 | high | OpenDocViewer — Deterministic thumbnail strip. |
| <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx</code> | 463 | 1 | 3 | high | Small About dialog for version/build/support information. |
| <code>src/components/DocumentToolbar/DocumentToolbar.jsx</code> | 1551 | 1 | 18 | high | Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| <code>src/components/DocumentToolbar/HelpMenuButton.jsx</code> | 110 | 1 | 2 | high | Toolbar help menu with entries for the manual and About dialog. |
| <code>src/components/DocumentToolbar/HelpOverlayDialog.jsx</code> | 233 | 0 | 2 | high | Full-screen help overlay for OpenDocViewer. |
| <code>src/components/DocumentToolbar/hooks/usePrintRangeConfig.js</code> | 163 | 1 | 2 | high | Runtime-configuration derivation for PrintRangeDialog. |
| <code>src/components/DocumentToolbar/LanguageMenuButton.jsx</code> | 154 | 1 | 4 | high | Compact language selector for the toolbar. |
| <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx</code> | 1301 | 1 | 38 | high | Manual overlay that loads simple external HTML fragments from the public help folder. |
| <code>src/components/DocumentToolbar/PageNavigationButtons.jsx</code> | 333 | 1 | 1 | high | Page navigation controls with support for single-step clicks and continuous stepping on press-and-hold. |
| <code>src/components/DocumentToolbar/printFieldLabels.js</code> | 22 | 1 | 1 | high | Visible label for an optional/required print-dialog field. |
| <code>src/components/DocumentToolbar/PrintPipelineDialogs.jsx</code> | 220 | 2 | 3 | high | The dialogs of the ONE print pipeline \(usePrintPipeline.js\): the print dialog and the generated-PDF progress \(modal, or a dock while working in the background\). |
| <code>src/components/DocumentToolbar/PrintRangeDialog.jsx</code> | 566 | 1 | 1 | high | Unified print dialog with a single print-method selector and shared print-details section. |
| <code>src/components/DocumentToolbar/printRangeDialogHelpers.js</code> | 149 | 2 | 9 | high | Pure helpers and shared constants for the print-range dialog. |
| <code>src/components/DocumentToolbar/SplitToolbarButton.jsx</code> | 128 | 2 | 1 | high | Reusable toolbar split-button. |
| <code>src/components/DocumentToolbar/ThemeMenuButton.jsx</code> | 202 | 1 | 6 | high | Compact theme selector for the toolbar. |
| <code>src/components/DocumentToolbar/ThemeToggleButton.jsx</code> | 61 | 0 | 1 | high | Small button that toggles between light/dark themes using the ThemeContext. |
| <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js</code> | 367 | 1 | 8 | high | Background prebuild/cache for configured &quot;all pages&quot; generated-PDF variants. |
| <code>src/components/DocumentToolbar/usePrintPipeline.js</code> | 800 | 2 | 20 | high | File: src/components/DocumentToolbar/usePrintPipeline.js The ONE print pipeline of the viewer: print dialog target, print options, user print log, the direct-versus-generated-PDF... |
| <code>src/components/DocumentToolbar/usePrintRangeDialog.js</code> | 671 | 1 | 15 | high | Hook + helpers for PrintRangeDialog. |
| <code>src/components/DocumentToolbar/ZoomButtons.jsx</code> | 566 | 1 | 3 | high | Zoom control cluster: \[ - \] \[ % editable \] \[ + \] \| \[ 1:1 \] \[ Fit Page \] \[ Fit Width \] \[ Custom Fit \] - When the field is NOT focused, it renders like “100%”. |
| <code>src/components/DocumentViewer/CompareCurtainButton.jsx</code> | 55 | 2 | 1 | high | Entry to the curtain view \(CompareCurtainView.jsx\), shown in the compare toolbar and in the overlay view&#39;s toolbar. |
| <code>src/components/DocumentViewer/CompareCurtainView.jsx</code> | 445 | 1 | 5 | high | Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above, page B clipped to one side of a draggable border. |
| <code>src/components/DocumentViewer/CompareOverlayView.jsx</code> | 560 | 1 | 5 | high | Overlay view of the compare mode: the two compared pages stacked in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above, so differences show through. |
| <code>src/components/DocumentViewer/CompareTransformControls.jsx</code> | 531 | 3 | 4 | high | Compare toolbar for one compared page: a disclosure button with a short summary, which expands into one panel for everything the page can be adjusted with - its free transform \(utils/compareTransform.js\) and its image ad |
| <code>src/components/DocumentViewer/compareViewKeys.js</code> | 41 | 2 | 4 | high | File: src/components/DocumentViewer/compareViewKeys.js Keyboard targets shared by the full-surface compare views \(CompareOverlayView.jsx, CompareCurtainView.jsx\): which focused el... |
| <code>src/components/DocumentViewer/CompareZoomOverlay.jsx</code> | 240 | 1 | 3 | high | Per-pane “post-zoom” controls shown in comparison mode, tucked behind the pane marker ring at the top-left of each pane. |
| <code>src/components/DocumentViewer/DocumentViewer.jsx</code> | 848 | 1 | 6 | high | OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation + selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the |
| <code>src/components/DocumentViewer/DocumentViewerRender.jsx</code> | 1292 | 1 | 18 | high | OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;. |
| <code>src/components/DocumentViewer/DocumentViewerThumbnails.jsx</code> | 230 | 1 | 1 | high | OpenDocViewer — Document Viewer Thumbnails \(Wrapper\) Provides the deterministic thumbnail list and local width controls for the viewer shell. |
| <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx</code> | 432 | 1 | 5 | high | Toolbar adapter for the document viewer. |
| <code>src/components/DocumentViewer/hooks/useCompareOverlay.js</code> | 186 | 2 | 3 | high | File: src/components/DocumentViewer/hooks/useCompareOverlay.js Open/close state of the compare overlay view \(CompareOverlayView.jsx\). |
| <code>src/components/DocumentViewer/hooks/useCompareTransforms.js</code> | 101 | 1 | 5 | high | File: src/components/DocumentViewer/hooks/useCompareTransforms.js Viewer-side access to the free per-page compare transform kept in the viewer context \(utils/compareTransform.js,... |
| <code>src/components/DocumentViewer/hooks/usePaneImageAdjustments.js</code> | 181 | 1 | 14 | high | File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js Per-pane image adjustments \(brightness, contrast, grayscale, invert\) and the resets that combine them with the... |
| <code>src/components/DocumentViewer/hooks/useViewerEffects.js</code> | 123 | 1 | 8 | high | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects. |
| <code>src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js</code> | 311 | 1 | 10 | high | Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer. |
| <code>src/components/DocumentViewer/hooks/useViewerZoomEffects.js</code> | 162 | 1 | 4 | high | Zoom, resize, wheel, print-shortcut, and initial-fit effects for DocumentViewer. |
| <code>src/components/DocumentViewer/useDocumentViewer.js</code> | 1918 | 1 | 58 | high | Primary viewer-state hook. |
| <code>src/components/ImageRenderer.jsx</code> | 121 | 1 | 2 | high | OpenDocViewer — Absolute-positioned Image Renderer Render a single page image at a specified zoom factor. |
| <code>src/components/LoadingMessage.jsx</code> | 90 | 1 | 1 | high | OpenDocViewer — Loading / Error Message Simple, accessible message block that reflects the current page load status. |
| <code>src/components/LoadingSpinner.jsx</code> | 91 | 1 | 5 | high | OpenDocViewer — Loading Spinner Minimal, accessible loading indicator. |
| <code>src/components/OcrTextLayer.jsx</code> | 125 | 1 | 1 | high | Selectable, invisible text over a recognised page image. |
| <code>src/components/PrintSelectionWorkspace.jsx</code> | 2504 | 1 | 5 | high | Full-window print-selection workspace. |
| <code>src/components/Resizer.jsx</code> | 111 | 1 | 8 | high | OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels \(e.g., sidebar/content\) via mouse drag or keyboard interaction. |
| <code>src/components/SignatureDetailsDialog.jsx</code> | 573 | 1 | 12 | high | Signature details dialog \(browser integrity\). |
| <code>src/components/SignatureOverviewButton.jsx</code> | 68 | 1 | 2 | high | Toolbar signature overview button. |
| <code>src/components/SignatureOverviewDialog.jsx</code> | 302 | 1 | 3 | high | Signature overview dialog, opened from the toolbar overview button. |
| <code>src/components/SignatureStatusBadge.jsx</code> | 110 | 1 | 2 | high | Small signature symbol shown next to a document&#39;s &quot;DOK n&quot; label \(variant \`document\`, aggregated over all files of the document\) and on every page thumbnail of a signed file \(variant \`thumbnail\`\). |
| <code>src/components/SignatureTime.jsx</code> | 33 | 2 | 1 | high | Local-time rendering of a signature-related ISO time \(signing, validation, certificate validity\) for the signature dialogs: &quot;2022-04-27 19:55&quot; as text, the exact UTC ISO value in the title attribute and \`dateTime\`. |
| <code>src/components/ViewerProblemNotice.jsx</code> | 285 | 1 | 4 | high | OpenDocViewer — configurable viewer-level problem notice. |
| <code>src/contexts/themeContext.js</code> | 41 | 3 | 3 | high | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| <code>src/contexts/ThemeProvider.jsx</code> | 343 | 1 | 14 | high | src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: - explicit themes: normal / light / dark - an implicit system-following startup mode when the user has not chosen |
| <code>src/contexts/viewerContext.js</code> | 257 | 12 | 12 | medium | Per-page compare transform \(utils/compareTransform.js\): scale multiplies the base zoom \(1 = 100 %\), dx / dy are CSS px at transform scale 1, rotation is degrees in \[0, 360\). |
| <code>src/contexts/ViewerProvider.jsx</code> | 2880 | 1 | 68 | high | OpenDocViewer — Viewer state provider. |
| <code>src/ErrorBoundary.jsx</code> | 297 | 1 | 12 | high | OpenDocViewer — React Error Boundary - Catch unexpected render/runtime errors in descendant components. |
| <code>src/hooks/useAcceleratingHoldRepeat.js</code> | 210 | 2 | 1 | high | Reusable press-and-hold behavior for toolbar buttons. |
| <code>src/hooks/useNavigationModifierState.js</code> | 109 | 1 | 8 | high | Shared modifier-key state for navigation and compare-aware viewer actions. |
| <code>src/hooks/useOcrModule.js</code> | 44 | 1 | 1 | high | Loads the OCR module once the runtime switch \(\`ocr.enabled\`\) is the literal true. |
| <code>src/hooks/useOcrTextLayers.js</code> | 158 | 1 | 2 | high | Runs OCR for the pages near the viewer&#39;s focus and exposes the outcomes per page. |
| <code>src/hooks/usePageNavigation.js</code> | 182 | 0 | 8 | high | OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press-and-hold UI \(e.g., mousedown\). |
| <code>src/hooks/usePageTimer.js</code> | 149 | 2 | 6 | high | OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press-and-hold page navigation: - Invokes a caller-supplied callback immediately \(leading edge\) and then repeatedly after an initia |
| <code>src/hooks/usePdfSignatureReports.js</code> | 119 | 1 | 3 | high | Browser PDF signature inspection. |
| <code>src/i18n.js</code> | 562 | 2 | 21 | high | i18n bootstrap for OpenDocViewer. |
| <code>src/index.jsx</code> | 67 | 0 | 2 | high | OpenDocViewer — Application Entry - Load global styles \(CSS variables + layout\). |
| <code>src/integrations/bootstrapRuntime.js</code> | 457 | 1 | 12 | high | Startup mode detection and host-integration entry point. |
| <code>src/integrations/normalizePortableBundle.js</code> | 833 | 1 | 9 | high | Normalizes multiple host payload shapes into the project&#39;s neutral portable bundle shape. |
| <code>src/integrations/ompThemeBridge.js</code> | 203 | 1 | 7 | high | Opt-in cross-origin theme bridge for the shared OMP theme preference. |
| <code>src/integrations/parentBridge.js</code> | 182 | 1 | 9 | high | Same-origin parent-window bootstrap adapter. |
| <code>src/integrations/sessionToken.js</code> | 142 | 1 | 6 | high | OpenDocViewer — Session Token Reader \(Browser-only\) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=&lt;base64&gt; This enables hosts to pass a compact, self-contained “portab |
| <code>src/integrations/sessionUrl.js</code> | 166 | 1 | 4 | high | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| <code>src/integrations/urlParams.js</code> | 110 | 1 | 5 | high | OpenDocViewer — URL Parameter Reader \(Browser-only\) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e. |
| <code>src/integrations/viewerEvents.js</code> | 192 | 0 | 8 | high | OpenDocViewer — Tiny Event Emitter/Listener Utilities \(Browser-only\) Lightweight helpers for broadcasting and listening to app-level DOM events. |
| <code>src/logging/systemLogger.js</code> | 471 | 41 | 31 | high | src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) - Provide a small, dependency-light logging facade for the browser app. |
| <code>src/logging/userLogger.js</code> | 308 | 2 | 17 | high | UserLogController — client-side controller for **user** print logs \(backend-agnostic\). |
| <code>src/ocr/assetUrls.js</code> | 82 | 1 | 4 | high | Resolves where the OCR worker, engine core and language models are loaded from. |
| <code>src/ocr/classify.js</code> | 100 | 2 | 15 | high | Decides, per page, whether OCR is worth running. |
| <code>src/ocr/engine.js</code> | 282 | 1 | 13 | high | Thin wrapper around a tesseract.js worker. |
| <code>src/ocr/index.js</code> | 20 | 1 | 0 | high | Entry point of the OCR module: the one file the viewer imports, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true. |
| <code>src/ocr/languages.js</code> | 29 | 1 | 2 | high | Membership check for OCR language codes against the models tesseract.js knows. |
| <code>src/ocr/lineRemoval.js</code> | 292 | 1 | 16 | high | Ruling-line removal before recognition: the pre-processing step for ruled tables and forms. |
| <code>src/ocr/pdfTextProbe.js</code> | 139 | 0 | 4 | high | Reads a PDF page&#39;s own text layer through pdf.js so classify.js can decide whether OCR is needed at all. |
| <code>src/ocr/prepareImage.js</code> | 161 | 0 | 8 | high | Turns the viewer&#39;s rendered page image into the image the OCR engine receives: measures it and, when \`ocr.removeRulingLines\` is on \(the default\), removes the ruling lines of tables and forms on a private copy \(lineRemova |
| <code>src/ocr/queue.js</code> | 285 | 0 | 8 | high | The OCR page queue: one page at a time, bounded by the window \(window.js\), results in the in-memory cache \(resultCache.js\). |
| <code>src/ocr/resultCache.js</code> | 79 | 0 | 3 | high | In-memory cache of OCR outcomes, one entry per document page. |
| <code>src/ocr/setup.js</code> | 100 | 0 | 3 | high | Builds an OCR engine from the runtime configuration and reports configuration problems once. |
| <code>src/ocr/window.js</code> | 62 | 0 | 4 | high | Which pages are queued for OCR: the visible page\(s\) and a fixed number of neighbours. |
| <code>src/PerformanceMonitor.jsx</code> | 1346 | 1 | 20 | high | src/PerformanceMonitor.jsx OpenDocViewer — Lightweight Performance HUD - Provide optional, low-impact visibility into runtime performance and viewer state. |
| <code>src/schemas/portableBundle.js</code> | 363 | 0 | 18 | high | OpenDocViewer — Portable Document Bundle Schema &amp; Helpers \(ESM\) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency-free helpers to validate and normalize input. |
| <code>src/types/jsdoc-types.js</code> | 102 | 0 | 13 | high | Centralized JSDoc-only type and callback definitions. |
| <code>src/utils/compareCurtain.js</code> | 187 | 2 | 13 | high | File: src/utils/compareCurtain.js Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above,... |
| <code>src/utils/compareOverlay.js</code> | 181 | 4 | 11 | high | File: src/utils/compareOverlay.js Overlay view of the compare mode: the two compared pages stacked in one coordinate space, the top page drawn semi-transparent. |
| <code>src/utils/compareTransform.js</code> | 353 | 13 | 24 | high | File: src/utils/compareTransform.js Free per-page transform for the compare view: stepless scale, free pan and 0.1 degree rotation, one transform per compared page \( primary = lef... |
| <code>src/utils/documentLoadingConfig.js</code> | 1099 | 14 | 34 | high | OpenDocViewer — runtime helpers for fetch/render/memory policies. |
| <code>src/utils/documentMetadata.js</code> | 404 | 3 | 18 | high | Helpers for resolving document-level metadata from the normalized portable bundle. |
| <code>src/utils/i18nVersion.js</code> | 69 | 1 | 4 | high | Cache-busting version token for the locale files \( locales/&amp;lt;lng&amp;gt;/common.json?v=&amp;lt;token&amp;gt; \). |
| <code>src/utils/idUtils.js</code> | 64 | 1 | 4 | high | OpenDocViewer — small opaque identifier helpers. |
| <code>src/utils/imageAdjustments.js</code> | 109 | 9 | 9 | high | File: src/utils/imageAdjustments.js Per-pane pixel adjustments \(brightness, contrast, grayscale, invert\) and the quarter turn the canvas draws. |
| <code>src/utils/localizedValue.js</code> | 113 | 8 | 6 | high | Localized string resolver for admin-supplied config values. |
| <code>src/utils/manualContentsTree.js</code> | 194 | 1 | 10 | high | Runtime contents tree for the manual overlay. |
| <code>src/utils/manualSources.js</code> | 108 | 1 | 7 | high | Resolves which manual HTML file the help dialog shows. |
| <code>src/utils/memoryProfile.js</code> | 75 | 2 | 6 | high | OpenDocViewer — Runtime memory profile helpers. |
| <code>src/utils/navigationUtils.js</code> | 172 | 1 | 7 | high | OpenDocViewer — Navigation Utilities Centralized helpers for page navigation in the document viewer. |
| <code>src/utils/objectUrlRegistry.js</code> | 92 | 3 | 6 | high | Centralized helpers for object/blob URL lifecycle management. |
| <code>src/utils/ocrLoader.js</code> | 41 | 1 | 3 | high | The only door into the OCR module. |
| <code>src/utils/ocrPageKey.js</code> | 32 | 2 | 3 | high | Key of one document page in the OCR result map \(\`ocrPages\` on the viewer context\). |
| <code>src/utils/ocrTextLayout.js</code> | 105 | 1 | 5 | high | Geometry of the OCR text layer \(components/OcrTextLayer.jsx\): where each recognised word goes inside the page frame and how wide its invisible text must be scaled to cover its box. |
| <code>src/utils/ompThemePreference.js</code> | 390 | 3 | 22 | high | Shared OMP theme preference adapter \(OMP_THEME_PREFERENCE\). |
| <code>src/utils/pageAssetRenderer.js</code> | 918 | 2 | 6 | high | OpenDocViewer — hybrid page-asset renderer. |
| <code>src/utils/pageAssetStore.js</code> | 746 | 1 | 33 | high | OpenDocViewer — Browser-side rendered page-asset storage. |
| <code>src/utils/pageAssetWorkerPool.js</code> | 320 | 1 | 15 | high | OpenDocViewer — Page-asset worker pool. |
| <code>src/utils/pdfBenchmark.js</code> | 970 | 1 | 36 | high | Opt-in generated-PDF benchmark tooling. |
| <code>src/utils/pdfjsDocumentOptions.js</code> | 30 | 5 | 2 | high | Shared pdf.js document-loading options. |
| <code>src/utils/pdfPageWorkerPool.js</code> | 479 | 2 | 3 | high | OpenDocViewer - PDF page-image worker pool. |
| <code>src/utils/pdfPrebuildPlan.js</code> | 343 | 2 | 17 | high | OpenDocViewer - generated-PDF prebuild planning. |
| <code>src/utils/pdfPrintCacheKey.js</code> | 117 | 4 | 8 | high | Generated-PDF cache key helpers. |
| <code>src/utils/pdfResolution.js</code> | 133 | 6 | 7 | high | Pure, per-page PDF display resolution policy shared by browser and worker renderers. |
| <code>src/utils/pdfResolutionRuntime.js</code> | 51 | 6 | 4 | high | Browser measurements and diagnostic state kept outside the pure PDF resolution policy. |
| <code>src/utils/pdfSignatureDocuments.js</code> | 257 | 5 | 11 | high | Per-document aggregation of PDF signature reports. |
| <code>src/utils/pdfSignatureInspector.js</code> | 195 | 2 | 5 | high | PDF signature inspection - the single entry point for application code. |
| <code>src/utils/pdfSignatureRevisions.js</code> | 769 | 1 | 16 | high | Appended-revision classifier for PDF signatures. |
| <code>src/utils/pdfSignatures.js</code> | 1537 | 3 | 26 | high | PDF signature collection - level 1 integrity inspection. |
| <code>src/utils/pdfSignatureStatus.js</code> | 300 | 6 | 21 | high | Signature UI status helpers for browser integrity. |
| <code>src/utils/pdfWorkerDispatcher.js</code> | 451 | 2 | 18 | high | OpenDocViewer - generated PDF worker dispatcher. |
| <code>src/utils/performanceOverlayFlag.js</code> | 86 | 2 | 3 | high | Shared runtime toggle helpers for optional diagnostics UI. |
| <code>src/utils/printCore.js</code> | 1058 | 3 | 39 | high | Core print coordinator for the frontend. |
| <code>src/utils/printDom.js</code> | 473 | 1 | 19 | high | OpenDocViewer — Print DOM Builder Safely construct the print iframe’s DOM using DOM APIs \(no doc.write\), wait until images reach a terminal state, then trigger window.print\(\). |
| <code>src/utils/printParse.js</code> | 103 | 1 | 3 | high | OpenDocViewer — Print Sequence Parser Parse a user-entered &quot;Custom pages&quot; string into a sequence of page indices. |
| <code>src/utils/printPdf.js</code> | 2489 | 3 | 101 | high | OpenDocViewer — Generated PDF print backend. |
| <code>src/utils/printSanitize.js</code> | 23 | 4 | 1 | high | OpenDocViewer — Print Sanitization Helpers Small helpers for URL and HTML value safety used by printing modules. |
| <code>src/utils/printTemplate.js</code> | 809 | 3 | 34 | high | OpenDocViewer — Print Templating &amp; Tokens Provide token context generation and safe token substitution where values are HTML-escaped before insertion into admin-authored print header/footer templates. |
| <code>src/utils/printUtils.js</code> | 138 | 2 | 18 | high | OpenDocViewer — Print Utilities Facade Re-export the stable print API and parser from the internal modules. |
| <code>src/utils/printWatermark.js</code> | 80 | 2 | 5 | high | OpenDocViewer — Print watermark mode helpers. |
| <code>src/utils/publicAssetUrl.js</code> | 29 | 6 | 1 | high | Resolve a public asset path against the viewer base URL. |
| <code>src/utils/reloadCacheCrypto.js</code> | 165 | 2 | 3 | high | Short-lived reload-cache key helpers. |
| <code>src/utils/reloadCacheIdentity.js</code> | 158 | 2 | 7 | high | Stable identities for the opt-in reload/document cache. |
| <code>src/utils/renderDecodeBenchmark.js</code> | 1212 | 1 | 28 | high | Opt-in render/decode benchmark tooling for the already loaded document session. |
| <code>src/utils/renderSurfaceBounds.js</code> | 52 | 2 | 2 | high | OpenDocViewer — conservative raster surface bounds. |
| <code>src/utils/runtimeConfig.js</code> | 895 | 27 | 65 | high | Runtime configuration helpers. |
| <code>src/utils/sourceTempStore.js</code> | 913 | 1 | 40 | high | OpenDocViewer — Browser-side temporary source storage. |
| <code>src/utils/supportDiagnostics.js</code> | 375 | 3 | 18 | high | Support diagnostics helpers for opt-in troubleshooting tools. |
| <code>src/utils/toolbarDensity.js</code> | 30 | 2 | 2 | high | Toolbar density on the document root. |
| <code>src/utils/viewerPreferences.js</code> | 530 | 7 | 37 | high | Lightweight persisted viewer preferences. |
| <code>src/utils/zoomUtils.js</code> | 268 | 1 | 18 | high | OpenDocViewer — Zoom utilities. |
| <code>src/workers/imageWorker.js</code> | 500 | 0 | 1 | high | OpenDocViewer — image / TIFF worker. |
| <code>src/workers/pdfPageWorker.js</code> | 441 | 0 | 1 | high | OpenDocViewer - PDF page image worker. |
| <code>src/workers/pdfSignatureWorker.js</code> | 40 | 0 | 1 | high | Web worker entry for PDF signature inspection. |
| <code>src/workers/pdfWorker.js</code> | 628 | 0 | 1 | high | OpenDocViewer - generated PDF worker. |

## Parse Errors

No parse errors.
