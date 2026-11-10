# File Map

Files are sorted by path. Incoming imports and doclet counts are useful signals for where to start.

| File | Lines | In | JSDoc | Confidence | Summary |
| --- | ---: | ---: | ---: | --- | --- |
| <code>server/system-log-server.js</code> | 237 | 0 | 5 | high | System Log Server — standalone Express endpoint for structured system logs. |
| <code>server/user-log-server.js</code> | 271 | 0 | 2 | high | User Action Log Server — standalone Express endpoint for print/user-action audit events. |
| <code>src/app/AppBootstrap.jsx</code> | 432 | 1 | 10 | high | Application bootstrap React component. |
| <code>src/app/bootConfig.js</code> | 193 | 0 | 6 | high | Runtime boot loader that resolves configuration scripts before React starts. |
| <code>src/app/OpenDocViewer.jsx</code> | 193 | 1 | 5 | high | src/app/OpenDocViewer.jsx Main application shell for the viewer. |
| <code>src/components/CanvasRenderer.jsx</code> | 98 | 1 | 1 | high | OpenDocViewer — Absolute-positioned Canvas Renderer Render a &lt;canvas&gt; element for a single page at a specified zoom factor. |
| <code>src/components/common/StatusLed.jsx</code> | 36 | 3 | 1 | high | Small reusable LED-style status indicator. |
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
| <code>src/components/DocumentRender.jsx</code> | 1211 | 3 | 26 | high | OpenDocViewer — Active page renderer. |
| <code>src/components/DocumentSelectionPanel.jsx</code> | 335 | 0 | 2 | high | Hierarchical page-selection editor shown inside the thumbnail pane. |
| <code>src/components/DocumentThumbnailList.jsx</code> | 1604 | 2 | 28 | high | OpenDocViewer — Deterministic thumbnail strip. |
| <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx</code> | 717 | 1 | 3 | high | Small About dialog for version/build/support information. |
| <code>src/components/DocumentToolbar/DocumentToolbar.jsx</code> | 1641 | 1 | 19 | high | Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| <code>src/components/DocumentToolbar/HelpMenuButton.jsx</code> | 118 | 1 | 2 | high | Toolbar help menu with entries for the manual and About dialog. |
| <code>src/components/DocumentToolbar/HelpOverlayDialog.jsx</code> | 233 | 0 | 2 | high | Full-screen help overlay for OpenDocViewer. |
| <code>src/components/DocumentToolbar/hooks/usePrintRangeConfig.js</code> | 163 | 1 | 2 | high | Runtime-configuration derivation for PrintRangeDialog. |
| <code>src/components/DocumentToolbar/LanguageMenuButton.jsx</code> | 219 | 2 | 5 | high | Compact language selector for the toolbar. |
| <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx</code> | 262 | 1 | 4 | high | Manual overlay: modal dialog chrome \(title bar, reload, open-in-new-tab and close buttons, focus trap, Escape and backdrop handling\) around the shared {@link ManualView}, which loads, filters, searches and navigates the |
| <code>src/components/DocumentToolbar/OcrSearchBar.jsx</code> | 464 | 1 | 6 | high | Search in the recognised text, from the toolbar: a search button right after the image-adjustment group that doubles as the page&#39;s OCR status \(an LED on the button, the status as its tooltip and in a visually hidden live |
| <code>src/components/DocumentToolbar/OcrToolbarActions.jsx</code> | 52 | 1 | 1 | high | The toolbar&#39;s OCR group, right after the image-adjustment group: a separator and the search in the text layers \(OcrSearchBar.jsx\), behind its runtime switches: - \`ocr.search.enabled\` \(default true; only the literal false |
| <code>src/components/DocumentToolbar/PageNavigationButtons.jsx</code> | 333 | 1 | 1 | high | Page navigation controls with support for single-step clicks and continuous stepping on press-and-hold. |
| <code>src/components/DocumentToolbar/printFieldLabels.js</code> | 22 | 1 | 1 | high | Visible label for an optional/required print-dialog field. |
| <code>src/components/DocumentToolbar/PrintPipelineDialogs.jsx</code> | 220 | 2 | 3 | high | The dialogs of the ONE print pipeline \(usePrintPipeline.js\): the print dialog and the generated-PDF progress \(modal, or a dock while working in the background\). |
| <code>src/components/DocumentToolbar/PrintRangeDialog.jsx</code> | 566 | 1 | 1 | high | Unified print dialog with a single print-method selector and shared print-details section. |
| <code>src/components/DocumentToolbar/printRangeDialogHelpers.js</code> | 149 | 2 | 9 | high | Pure helpers and shared constants for the print-range dialog. |
| <code>src/components/DocumentToolbar/SplitToolbarButton.jsx</code> | 128 | 2 | 1 | high | Reusable toolbar split-button. |
| <code>src/components/DocumentToolbar/ThemeMenuButton.jsx</code> | 202 | 2 | 6 | high | Compact theme selector for the toolbar. |
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
| <code>src/components/DocumentViewer/DocumentViewer.jsx</code> | 858 | 1 | 6 | high | OpenDocViewer — Document Viewer \(Container\) Tie together: • Toolbar \(actions, zoom, adjustments\) • Thumbnails \(navigation + selection reset\) • Main renderer \(canvas/img\) This component wires ViewerContext state into the |
| <code>src/components/DocumentViewer/DocumentViewerRender.jsx</code> | 1413 | 1 | 21 | high | OpenDocViewer — Main Viewer Rendering Wrapper Render the primary document pane \(and optional comparison pane\) by delegating all heavy lifting to &lt;DocumentRender /&gt;. |
| <code>src/components/DocumentViewer/DocumentViewerThumbnails.jsx</code> | 230 | 1 | 1 | high | OpenDocViewer — Document Viewer Thumbnails \(Wrapper\) Provides the deterministic thumbnail list and local width controls for the viewer shell. |
| <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx</code> | 432 | 1 | 5 | high | Toolbar adapter for the document viewer. |
| <code>src/components/DocumentViewer/hooks/useCompareOverlay.js</code> | 186 | 2 | 3 | high | File: src/components/DocumentViewer/hooks/useCompareOverlay.js Open/close state of the compare overlay view \(CompareOverlayView.jsx\). |
| <code>src/components/DocumentViewer/hooks/useCompareTransforms.js</code> | 101 | 1 | 5 | high | File: src/components/DocumentViewer/hooks/useCompareTransforms.js Viewer-side access to the free per-page compare transform kept in the viewer context \(utils/compareTransform.js,... |
| <code>src/components/DocumentViewer/hooks/usePaneImageAdjustments.js</code> | 181 | 1 | 14 | high | File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js Per-pane image adjustments \(brightness, contrast, grayscale, invert\) and the resets that combine them with the... |
| <code>src/components/DocumentViewer/hooks/useViewerEffects.js</code> | 123 | 4 | 8 | high | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects. |
| <code>src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js</code> | 311 | 1 | 10 | high | Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer. |
| <code>src/components/DocumentViewer/hooks/useViewerZoomEffects.js</code> | 162 | 1 | 4 | high | Zoom, resize, wheel, print-shortcut, and initial-fit effects for DocumentViewer. |
| <code>src/components/DocumentViewer/useDocumentViewer.js</code> | 1918 | 1 | 58 | high | Primary viewer-state hook. |
| <code>src/components/ImageRenderer.jsx</code> | 121 | 1 | 2 | high | OpenDocViewer — Absolute-positioned Image Renderer Render a single page image at a specified zoom factor. |
| <code>src/components/KeyTips.jsx</code> | 103 | 1 | 5 | high | Key tips: hold \`?\` and every toolbar button shows its name in a small label under it, so the icons can be learnt without hovering them one by one; release the key and the labels go. |
| <code>src/components/LoadingMessage.jsx</code> | 90 | 1 | 1 | high | OpenDocViewer — Loading / Error Message Simple, accessible message block that reflects the current page load status. |
| <code>src/components/LoadingSpinner.jsx</code> | 91 | 1 | 5 | high | OpenDocViewer — Loading Spinner Minimal, accessible loading indicator. |
| <code>src/components/Manual/manualDocument.js</code> | 410 | 2 | 14 | high | Manual source loading and HTML preparation shared by every manual host \(the overlay dialog and a full-page view\). |
| <code>src/components/Manual/manualNavigation.js</code> | 128 | 1 | 8 | high | Scrolling, focus and URL-fragment helpers for navigating inside a rendered manual. |
| <code>src/components/Manual/manualSearch.js</code> | 337 | 1 | 14 | high | In-manual text search: locale-aware case folding, match collection over the rendered manual and highlighting through the CSS Custom Highlight API with a \`&lt;mark&gt;\` fallback. |
| <code>src/components/Manual/ManualView.jsx</code> | 871 | 2 | 13 | high | Shared manual body: loads the configured manual source for the current UI language, filters the standard manual by enabled features, renders a contents tree built from the h2/h3 headings, an in-manual search with highlig |
| <code>src/components/OcrTextLayer.jsx</code> | 264 | 1 | 4 | high | Selectable, invisible text over a recognised page image. |
| <code>src/components/PrintSelectionWorkspace.jsx</code> | 2504 | 1 | 5 | high | Full-window print-selection workspace. |
| <code>src/components/ReadAloudMenuItem.jsx</code> | 57 | 1 | 1 | high | The page context menu&#39;s read-aloud entry \(DocumentViewer/DocumentViewerRender.jsx\): &quot;Read the selection aloud&quot; while nothing is being read, greyed with the reason in its tooltip when nothing can be read \(no selection in |
| <code>src/components/ReadAloudProvider.jsx</code> | 26 | 1 | 1 | high | Provides the read-aloud state \(hooks/useReadAloud.js\) to the page&#39;s context menu and the toolbar&#39;s language menu \(contexts/readAloudContext.js\). |
| <code>src/components/Resizer.jsx</code> | 111 | 1 | 8 | high | OpenDocViewer — Resizer Small, focusable separator used to let users resize adjacent panels \(e.g., sidebar/content\) via mouse drag or keyboard interaction. |
| <code>src/components/SignatureDetailsDialog.jsx</code> | 573 | 1 | 12 | high | Signature details dialog \(browser integrity\). |
| <code>src/components/SignatureOverviewButton.jsx</code> | 68 | 1 | 2 | high | Toolbar signature overview button. |
| <code>src/components/SignatureOverviewDialog.jsx</code> | 302 | 1 | 3 | high | Signature overview dialog, opened from the toolbar overview button. |
| <code>src/components/SignatureStatusBadge.jsx</code> | 110 | 1 | 2 | high | Small signature symbol shown next to a document&#39;s &quot;DOK n&quot; label \(variant \`document\`, aggregated over all files of the document\) and on every page thumbnail of a signed file \(variant \`thumbnail\`\). |
| <code>src/components/SignatureTime.jsx</code> | 33 | 2 | 1 | high | Local-time rendering of a signature-related ISO time \(signing, validation, certificate validity\) for the signature dialogs: &quot;2022-04-27 19:55&quot; as text, the exact UTC ISO value in the title attribute and \`dateTime\`. |
| <code>src/components/ViewerProblemNotice.jsx</code> | 285 | 1 | 4 | high | OpenDocViewer — configurable viewer-level problem notice. |
| <code>src/contexts/readAloudContext.js</code> | 41 | 4 | 1 | high | The read-aloud state shared by the page&#39;s context menu \(&quot;Read the selection aloud&quot; / &quot;Stop reading aloud&quot;, components/ReadAloudMenuItem.jsx\) and the toolbar&#39;s language menu \(the &quot;Reading language&quot; section, DocumentToolba |
| <code>src/contexts/themeContext.js</code> | 41 | 3 | 3 | high | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| <code>src/contexts/ThemeProvider.jsx</code> | 343 | 2 | 14 | high | src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: - explicit themes: normal / light / dark - an implicit system-following startup mode when the user has not chosen |
| <code>src/contexts/viewerContext.js</code> | 260 | 13 | 12 | medium | Per-page compare transform \(utils/compareTransform.js\): scale multiplies the base zoom \(1 = 100 %\), dx / dy are CSS px at transform scale 1, rotation is degrees in \[0, 360\). |
| <code>src/contexts/ViewerProvider.jsx</code> | 2927 | 1 | 71 | high | OpenDocViewer — Viewer state provider. |
| <code>src/ErrorBoundary.jsx</code> | 297 | 1 | 12 | high | OpenDocViewer — React Error Boundary - Catch unexpected render/runtime errors in descendant components. |
| <code>src/generated/standard-manual/manual.en.js</code> | 2 | 1 | 0 | low | Default export for manual.en. |
| <code>src/generated/standard-manual/manual.sv.js</code> | 2 | 1 | 0 | low | Default export for manual.sv. |
| <code>src/hooks/useAcceleratingHoldRepeat.js</code> | 210 | 2 | 1 | high | Reusable press-and-hold behavior for toolbar buttons. |
| <code>src/hooks/useKeyTipsHeld.js</code> | 67 | 1 | 3 | high | Whether the key tips key \(\`?\`\) is held: the one piece of the key tips \(components/KeyTips.jsx\) that lives while the viewer runs. |
| <code>src/hooks/useNavigationModifierState.js</code> | 109 | 1 | 8 | high | Shared modifier-key state for navigation and compare-aware viewer actions. |
| <code>src/hooks/useOcrModule.js</code> | 44 | 1 | 1 | high | Loads the OCR module once the runtime switch \(\`ocr.enabled\`\) is the literal true. |
| <code>src/hooks/useOcrTextLayers.js</code> | 226 | 1 | 3 | high | Runs OCR for the pages near the viewer&#39;s focus and exposes the outcomes per page. |
| <code>src/hooks/usePageNavigation.js</code> | 182 | 0 | 8 | high | OpenDocViewer — Page Navigation Hook \(React\) Provide memoized handlers for page navigation \(first/prev/next/last\) and continuous navigation timers suitable for press-and-hold UI \(e.g., mousedown\). |
| <code>src/hooks/usePageTimer.js</code> | 149 | 2 | 6 | high | OpenDocViewer — Continuous Page Navigation Timer \(React hook\) Provide a tiny utility for press-and-hold page navigation: - Invokes a caller-supplied callback immediately \(leading edge\) and then repeatedly after an initia |
| <code>src/hooks/usePdfSignatureReports.js</code> | 119 | 1 | 3 | high | Browser PDF signature inspection. |
| <code>src/hooks/useReadAloud.js</code> | 242 | 1 | 5 | high | Read the selected recognised text aloud: the state behind the page&#39;s context menu entry and the toolbar&#39;s &quot;Reading language&quot; section \(contexts/readAloudContext.js\). |
| <code>src/i18n.js</code> | 567 | 3 | 21 | high | i18n bootstrap for OpenDocViewer. |
| <code>src/index.jsx</code> | 67 | 0 | 2 | high | OpenDocViewer — Application Entry - Load global styles \(CSS variables + layout\). |
| <code>src/integrations/bootstrapRuntime.js</code> | 457 | 1 | 12 | high | Startup mode detection and host-integration entry point. |
| <code>src/integrations/normalizePortableBundle.js</code> | 833 | 1 | 9 | high | Normalizes multiple host payload shapes into the project&#39;s neutral portable bundle shape. |
| <code>src/integrations/ompThemeBridge.js</code> | 203 | 1 | 7 | high | Opt-in cross-origin theme bridge for the shared OMP theme preference. |
| <code>src/integrations/parentBridge.js</code> | 182 | 1 | 9 | high | Same-origin parent-window bootstrap adapter. |
| <code>src/integrations/sessionToken.js</code> | 142 | 1 | 6 | high | OpenDocViewer — Session Token Reader \(Browser-only\) Decode an optional Base64/URL-safe Base64 JSON payload provided via the query string: ?sessiondata=&lt;base64&gt; This enables hosts to pass a compact, self-contained “portab |
| <code>src/integrations/sessionUrl.js</code> | 166 | 1 | 4 | high | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| <code>src/integrations/urlParams.js</code> | 110 | 1 | 5 | high | OpenDocViewer — URL Parameter Reader \(Browser-only\) Read a minimal set of query parameters to bootstrap the viewer in “pattern mode”, i.e. |
| <code>src/integrations/viewerEvents.js</code> | 192 | 0 | 8 | high | OpenDocViewer — Tiny Event Emitter/Listener Utilities \(Browser-only\) Lightweight helpers for broadcasting and listening to app-level DOM events. |
| <code>src/logging/systemLogger.js</code> | 471 | 44 | 31 | high | src/logging/systemLogger.js OpenDocViewer — Frontend Logging Controller \(ESM\) - Provide a small, dependency-light logging facade for the browser app. |
| <code>src/logging/userLogger.js</code> | 308 | 2 | 17 | high | UserLogController — client-side controller for **user** print logs \(backend-agnostic\). |
| <code>src/manual-page/main.jsx</code> | 27 | 0 | 0 | high | Entry of the stand-alone manual page \(manual/index.html\). |
| <code>src/manual-page/ManualPage.jsx</code> | 111 | 1 | 3 | high | The stand-alone manual page \(served as \`&lt;ODV base&gt;/manual/\`\): a header with the page title and the viewer&#39;s own theme and language menus, and the shared manual view filling the rest. |
| <code>src/manual-page/mountManualPage.jsx</code> | 40 | 1 | 1 | high | Mount the stand-alone manual page into a container, the way src/index.jsx mounts the viewer: apply the shared theme and toolbar density to the document before the first render, then render the page inside the viewer&#39;s Th |
| <code>src/ocr/assetUrls.js</code> | 82 | 1 | 4 | high | Resolves where the OCR worker, engine core and language models are loaded from. |
| <code>src/ocr/benchmark.js</code> | 661 | 0 | 20 | high | Opt-in OCR benchmark \(\`ocr.benchmark.enabled\`\): recognises a sample of the loaded document&#39;s pages once per scenario and reports what each scenario cost, so a site can measure how many workers \(\`ocr.workerCount\`\), which |
| <code>src/ocr/boostBenchmark.js</code> | 810 | 1 | 26 | high | Opt-in OCR *boost* benchmark \(\`ocr.boostBenchmark.enabled\`\): the same measurement as benchmark.js, but above the worker counts the viewer itself will ever run. |
| <code>src/ocr/classify.js</code> | 106 | 3 | 15 | high | Decides, per page, whether OCR is worth running. |
| <code>src/ocr/detectLanguage.js</code> | 132 | 0 | 8 | high | Guess the language of a page&#39;s text among a few candidate languages, from its words alone. |
| <code>src/ocr/engine.js</code> | 302 | 1 | 14 | high | Thin wrapper around a tesseract.js worker. |
| <code>src/ocr/enginePool.js</code> | 165 | 1 | 5 | high | A pool of OCR engines \(engine.js\) behind the one-engine interface the queue \(queue.js\) uses, so that several pages \(the worker count, see setup.js\) can be recognised at the same time. |
| <code>src/ocr/index.js</code> | 31 | 2 | 0 | high | Entry point of the OCR module: the one file the viewer imports, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true. |
| <code>src/ocr/languages.js</code> | 29 | 2 | 2 | high | Membership check for OCR language codes against the models tesseract.js knows. |
| <code>src/ocr/lineRemoval.js</code> | 292 | 1 | 16 | high | Ruling-line removal before recognition: the pre-processing step for ruled tables and forms. |
| <code>src/ocr/pdfTextProbe.js</code> | 156 | 0 | 4 | high | Reads a PDF page&#39;s own text layer through pdf.js so classify.js can decide whether OCR is needed at all, and, when the layer is usable, hands it over as words with boxes \(pdfTextWords.js\) so the page gets the same text l |
| <code>src/ocr/pdfTextWords.js</code> | 229 | 1 | 9 | high | Word boxes from a PDF page&#39;s own text layer, in the shape the recognised words have, so that a page with real text gets the same text layer, search and read-aloud as a recognised page \(components/OcrTextLayer.jsx, utils/ |
| <code>src/ocr/prepareImage.js</code> | 161 | 1 | 8 | high | Turns the viewer&#39;s rendered page image into the image the OCR engine receives: measures it and, when \`ocr.removeRulingLines\` is on \(the default\), removes the ruling lines of tables and forms on a private copy \(lineRemova |
| <code>src/ocr/queue.js</code> | 391 | 0 | 13 | high | The OCR page queue: \`concurrency\` pages at a time \(one by default\), bounded by the window \(window.js\), results in the in-memory cache \(resultCache.js\). |
| <code>src/ocr/resultCache.js</code> | 96 | 0 | 3 | high | In-memory cache of OCR outcomes, one entry per document page. |
| <code>src/ocr/setup.js</code> | 170 | 1 | 6 | high | Builds an OCR engine from the runtime configuration and reports configuration problems once. |
| <code>src/ocr/window.js</code> | 73 | 0 | 4 | high | Which pages are queued for OCR: the visible page\(s\) and a fixed number of neighbours, and, when the site asks for the whole document, the rest after them. |
| <code>src/PerformanceMonitor.jsx</code> | 1346 | 1 | 20 | high | src/PerformanceMonitor.jsx OpenDocViewer — Lightweight Performance HUD - Provide optional, low-impact visibility into runtime performance and viewer state. |
| <code>src/schemas/portableBundle.js</code> | 363 | 0 | 18 | high | OpenDocViewer — Portable Document Bundle Schema &amp; Helpers \(ESM\) Define the canonical shape for a portable, serializable set of documents and provide minimal, dependency-free helpers to validate and normalize input. |
| <code>src/types/jsdoc-types.js</code> | 102 | 0 | 13 | high | Centralized JSDoc-only type and callback definitions. |
| <code>src/utils/canvasBitmapSize.js</code> | 31 | 1 | 1 | high | Resize the bitmap of a canvas only when the requested size differs from its current size. |
| <code>src/utils/compareCurtain.js</code> | 187 | 2 | 13 | high | File: src/utils/compareCurtain.js Curtain view of the compare mode: the two calibrated pages in one coordinate space, page A \(left/primary\) below and page B \(right/compare\) above,... |
| <code>src/utils/compareOverlay.js</code> | 181 | 4 | 11 | high | File: src/utils/compareOverlay.js Overlay view of the compare mode: the two compared pages stacked in one coordinate space, the top page drawn semi-transparent. |
| <code>src/utils/compareTransform.js</code> | 353 | 13 | 24 | high | File: src/utils/compareTransform.js Free per-page transform for the compare view: stepless scale, free pan and 0.1 degree rotation, one transform per compared page \( primary = lef... |
| <code>src/utils/documentLoadingConfig.js</code> | 1099 | 14 | 34 | high | OpenDocViewer — runtime helpers for fetch/render/memory policies. |
| <code>src/utils/documentMetadata.js</code> | 404 | 3 | 18 | high | Helpers for resolving document-level metadata from the normalized portable bundle. |
| <code>src/utils/i18nVersion.js</code> | 69 | 1 | 4 | high | Cache-busting version token for the locale files \( locales/&amp;lt;lng&amp;gt;/common.json?v=&amp;lt;token&amp;gt; \). |
| <code>src/utils/idUtils.js</code> | 64 | 1 | 4 | high | OpenDocViewer — small opaque identifier helpers. |
| <code>src/utils/imageAdjustments.js</code> | 109 | 9 | 9 | high | File: src/utils/imageAdjustments.js Per-pane pixel adjustments \(brightness, contrast, grayscale, invert\) and the quarter turn the canvas draws. |
| <code>src/utils/keyTipLayout.js</code> | 65 | 1 | 6 | high | Where the key tips go \(components/KeyTips.jsx\): one label under each toolbar button, centred on the button, packed into rows so that the labels of neighbouring buttons do not cover each other. |
| <code>src/utils/localizedValue.js</code> | 113 | 8 | 6 | high | Localized string resolver for admin-supplied config values. |
| <code>src/utils/manualContentsTree.js</code> | 194 | 1 | 10 | high | Runtime contents tree for the manual overlay. |
| <code>src/utils/manualEnabled.js</code> | 24 | 2 | 1 | high | The single switch that turns the user manual off for an installation. |
| <code>src/utils/manualSources.js</code> | 172 | 1 | 10 | high | Resolves which manual HTML file the help dialog shows. |
| <code>src/utils/memoryProfile.js</code> | 75 | 2 | 6 | high | OpenDocViewer — Runtime memory profile helpers. |
| <code>src/utils/navigationUtils.js</code> | 172 | 1 | 7 | high | OpenDocViewer — Navigation Utilities Centralized helpers for page navigation in the document viewer. |
| <code>src/utils/objectUrlRegistry.js</code> | 92 | 3 | 6 | high | Centralized helpers for object/blob URL lifecycle management. |
| <code>src/utils/ocrLanguageCodes.js</code> | 31 | 2 | 1 | high | Tesseract language codes \(\`ocr.languages\`\) and the ISO 639-1 language each one reads: what the read-aloud menu offers and the language guess chooses among. |
| <code>src/utils/ocrLoader.js</code> | 41 | 2 | 3 | high | The only door into the OCR module. |
| <code>src/utils/ocrPageKey.js</code> | 32 | 3 | 3 | high | Key of one document page in the OCR result map \(\`ocrPages\` on the viewer context\). |
| <code>src/utils/ocrSearch.js</code> | 143 | 2 | 9 | high | Search in recognised text: the toolbar&#39;s OCR search \(components/DocumentToolbar/OcrSearchBar.jsx\) and the text layer&#39;s match marks \(components/OcrTextLayer.jsx\) both go through these functions, on the same outcomes, so t |
| <code>src/utils/ocrSearchPlacement.js</code> | 182 | 1 | 12 | high | Where the toolbar&#39;s OCR search field goes and how wide it is \(components/DocumentToolbar/OcrSearchBar.jsx\): inline in the toolbar, grown out of the button to the right into the room the toolbar&#39;s spacer leaves, or, when |
| <code>src/utils/ocrStatus.js</code> | 73 | 1 | 4 | high | The per-page OCR status the toolbar&#39;s search button shows \(components/DocumentToolbar/OcrSearchBar.jsx\): one key per outcome state, its English fallback text \(public/locales/&lt;lng&gt;/common.json, \`ocr.status\`\) and the LED s |
| <code>src/utils/ocrTextLayout.js</code> | 283 | 3 | 13 | high | Geometry of the OCR text layer \(components/OcrTextLayer.jsx\): the recognised words grouped into lines, where each line and word goes inside the page frame, and how the invisible text is fitted to the recognised boxes. |
| <code>src/utils/ompThemePreference.js</code> | 390 | 4 | 22 | high | Shared OMP theme preference adapter \(OMP_THEME_PREFERENCE\). |
| <code>src/utils/pageAssetRenderer.js</code> | 918 | 2 | 6 | high | OpenDocViewer — hybrid page-asset renderer. |
| <code>src/utils/pageAssetStore.js</code> | 746 | 1 | 33 | high | OpenDocViewer — Browser-side rendered page-asset storage. |
| <code>src/utils/pageAssetWorkerPool.js</code> | 320 | 1 | 15 | high | OpenDocViewer — Page-asset worker pool. |
| <code>src/utils/pdfBenchmark.js</code> | 970 | 1 | 36 | high | Opt-in generated-PDF benchmark tooling. |
| <code>src/utils/pdfjsDocumentOptions.js</code> | 30 | 6 | 2 | high | Shared pdf.js document-loading options. |
| <code>src/utils/pdfPageWorkerPool.js</code> | 479 | 2 | 3 | high | OpenDocViewer - PDF page-image worker pool. |
| <code>src/utils/pdfPrebuildPlan.js</code> | 343 | 2 | 17 | high | OpenDocViewer - generated-PDF prebuild planning. |
| <code>src/utils/pdfPrintCacheKey.js</code> | 117 | 4 | 8 | high | Generated-PDF cache key helpers. |
| <code>src/utils/pdfResolution.js</code> | 133 | 6 | 7 | high | Pure, per-page PDF display resolution policy shared by browser and worker renderers. |
| <code>src/utils/pdfResolutionRuntime.js</code> | 51 | 6 | 4 | high | Browser measurements and diagnostic state kept outside the pure PDF resolution policy. |
| <code>src/utils/pdfSignatureDocuments.js</code> | 257 | 5 | 11 | high | Per-document aggregation of PDF signature reports. |
| <code>src/utils/pdfSignatureInspector.js</code> | 211 | 2 | 5 | high | PDF signature inspection - the single entry point for application code. |
| <code>src/utils/pdfSignatureRenderCheck.js</code> | 562 | 2 | 22 | high | pdf.js differential confirmation for appended revisions. |
| <code>src/utils/pdfSignatureRevisions.js</code> | 1015 | 1 | 23 | high | Appended-revision classifier for PDF signatures. |
| <code>src/utils/pdfSignatures.js</code> | 1560 | 3 | 26 | high | PDF signature collection - level 1 integrity inspection. |
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
| <code>src/utils/runtimeConfig.js</code> | 1200 | 36 | 84 | high | Runtime configuration helpers. |
| <code>src/utils/sourceTempStore.js</code> | 913 | 1 | 40 | high | OpenDocViewer — Browser-side temporary source storage. |
| <code>src/utils/speech.js</code> | 225 | 1 | 10 | high | Reading text aloud with the browser&#39;s speech synthesis \(Web Speech API, \`window.speechSynthesis\`\). |
| <code>src/utils/standardManual.js</code> | 569 | 1 | 25 | high | Filter and sanitize the bundled standard manual for a supplied runtime config. |
| <code>src/utils/standardManualRules.js</code> | 217 | 1 | 9 | high | Resolve every site switch that can hide standard-manual content. |
| <code>src/utils/supportDiagnostics.js</code> | 430 | 5 | 22 | high | Support diagnostics helpers for opt-in troubleshooting tools. |
| <code>src/utils/toolbarDensity.js</code> | 30 | 3 | 2 | high | Toolbar density on the document root. |
| <code>src/utils/viewerPreferences.js</code> | 562 | 9 | 39 | high | Lightweight persisted viewer preferences. |
| <code>src/utils/zoomUtils.js</code> | 268 | 1 | 18 | high | OpenDocViewer — Zoom utilities. |
| <code>src/workers/imageWorker.js</code> | 500 | 0 | 1 | high | OpenDocViewer — image / TIFF worker. |
| <code>src/workers/pdfPageWorker.js</code> | 441 | 0 | 1 | high | OpenDocViewer - PDF page image worker. |
| <code>src/workers/pdfSignatureWorker.js</code> | 80 | 0 | 2 | high | Web worker entry for PDF signature inspection. |
| <code>src/workers/pdfWorker.js</code> | 628 | 0 | 1 | high | OpenDocViewer - generated PDF worker. |

## Parse Errors

No parse errors.
