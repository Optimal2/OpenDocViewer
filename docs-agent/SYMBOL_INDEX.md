# Symbol Index

| Symbol | Kind | File | Summary |
| --- | --- | --- | --- |
| `ALLOWED_ORIGINS` | constant | `server/system-log-server.js:141` | Optional CORS for /log |
| `LOG_TOKEN` | constant | `server/system-log-server.js:135` | Token gate for /log |
| `logLimiter` | constant | `server/system-log-server.js:165` | Rate limit for ingestion |
| `requireLogToken` | function | `server/system-log-server.js:175` | Token auth middleware |
| `TRUST_PROXY_RAW` | constant | `server/system-log-server.js:128` | Trust proxy for accurate req.ip |
| `resolveUser` | function | `server/user-log-server.js:117` | Resolve user identity without cookies. |
| `sameOriginGuard` | function | `server/user-log-server.js:135` | Blocks cross-site requests using Origin/Referer/Sec-Fetch-Site signals. |
| `BootstrapDebugInfo` | typedef | `src/app/AppBootstrap.jsx:62` | Diagnostics-only bootstrap metadata. |
| `buildDemoSourceList` | function | `src/app/AppBootstrap.jsx:227` | Build a demo source list from the /public sample files. |
| `DemoBuildOptions` | typedef | `src/app/AppBootstrap.jsx:71` | Options for building a demo source list. |
| `DemoSourceItem` | typedef | `src/app/AppBootstrap.jsx:79` | One entry in the demo source list. |
| `ExplicitItem` | typedef | `src/app/AppBootstrap.jsx:39` | Explicit item \(URL list\). |
| `module.exports` | function | `src/app/AppBootstrap.jsx:249` | Top-level bootstrapper component. |
| `makeReloadCacheSeedFromBundle` | function | `src/app/AppBootstrap.jsx:209` | Build a stable reload-cache scope from host/user identity without including short-lived source URLs/tickets, session ids, or the current document selection. |
| `PortableDocumentBundle` | typedef | `src/app/AppBootstrap.jsx:47` | Portable document bundle shape. |
| `SessionShape` | typedef | `src/app/AppBootstrap.jsx:31` | Session metadata for a bundle. |
| `UrlConfig` | typedef | `src/app/AppBootstrap.jsx:54` | URL parameter config \(pattern mode\). |
| `getAppBase` | function | `src/app/bootConfig.js:16` | Return the application base path \(always with a trailing slash\) derived from the current page URL. |
| `isJsContentType` | function | `src/app/bootConfig.js:29` | Heuristic: does a content-type look like JavaScript? |
| `loadClassicScript` | function | `src/app/bootConfig.js:58` | Load a classic script and resolve when it executes \(or errors\). |
| `loadFromCandidates` | function | `src/app/bootConfig.js:100` | Try multiple candidate URLs \(in order\) until one probes as JS, then load it. |
| `probeScriptUrl` | function | `src/app/bootConfig.js:42` | Probe a candidate script URL and only accept it when the response looks like JavaScript. |
| `BootstrapDebugInfo` | typedef | `src/app/OpenDocViewer.jsx:33` | Diagnostics-only startup details surfaced through the performance overlay. |
| `OpenDocViewer` | function | `src/app/OpenDocViewer.jsx:67` | OpenDocViewer — Top-level component. |
| `OpenDocViewer~resizeRaf` | constant | `src/app/OpenDocViewer.jsx:93` | rAF-throttled resize handler: Avoids re-render spam during window drags. |
| `OpenDocViewer~showPerf` | constant | `src/app/OpenDocViewer.jsx:134` | Decide if the Performance HUD should render: Runtime flag \(config/env/meta\) OR explicit URL opt-in: ?perf=1 \(handy during support sessions\) |
| `SourceItem` | typedef | `src/app/OpenDocViewer.jsx:25` | Item in the explicit source list mode. |
| `CanvasRenderer` | constant | `src/components/CanvasRenderer.jsx:40` | CanvasRenderer component. |
| `module.exports` | function | `src/components/common/StatusLed.jsx:17` |  |
| `DocumentConsumerWrapper` | function | `src/components/DocumentConsumerWrapper.jsx:66` | DocumentConsumerWrapper Wraps DocumentLoader + DocumentViewer and switches between full viewer and a thumbnail-only presentation on small/mobile layouts. |
| `SourceItem` | typedef | `src/components/DocumentConsumerWrapper.jsx:37` | An item for explicit-list mode. |
| `Batch` | typedef | `src/components/DocumentLoader/batchHandler.js:44` | A batch groups one or more jobs of the same file type. |
| `batchHandler` | constant | `src/components/DocumentLoader/batchHandler.js:201` | Batch scheduler entry point. |
| `InsertPageAtIndex` | typedef | `src/components/DocumentLoader/batchHandler.js:51` | Signature for the function that inserts a page record at a specific index. |
| `pump` | function | `src/components/DocumentLoader/batchHandler.js:85` | Schedule a short, fair distribution pass: Assigns at most one batch per idle worker. |
| `PUMP_DELAY_MS` | constant | `src/components/DocumentLoader/batchHandler.js:70` | Small delay so the event loop can breathe between pumps \(ms\). |
| `WorkerJob` | typedef | `src/components/DocumentLoader/batchHandler.js:31` | A single decoding/rendering unit handed to a worker. |
| `WorkerMessageHandler` | typedef | `src/components/DocumentLoader/batchHandler.js:59` | Handle a worker&#39;s message and insert results. |
| `module.exports` | function | `src/components/DocumentLoader/DemoControls.jsx:35` | DemoControls — wraps DocumentLoader with demo-mode props and a small control UI. |
| `asciiHead` | function | `src/components/DocumentLoader/DocumentLoader.js:254` |  |
| `buildInlineSourceBlob` | function | `src/components/DocumentLoader/DocumentLoader.js:847` | Decode host-provided Base64 source bytes without routing through fetch\(data:...\) . |
| `createFailedPlaceholder` | function | `src/components/DocumentLoader/DocumentLoader.js:1059` |  |
| `createInvalidSourcePayloadError` | function | `src/components/DocumentLoader/DocumentLoader.js:742` | Build a source-validation error. |
| `createLimiter` | function | `src/components/DocumentLoader/DocumentLoader.js:161` |  |
| `createPagePlaceholders` | function | `src/components/DocumentLoader/DocumentLoader.js:1017` |  |
| `createPrefetchHttpError` | function | `src/components/DocumentLoader/DocumentLoader.js:682` | Build a consistent HTTP error so the retry classifier can inspect the status code. |
| `createPrefetchTimeoutError` | function | `src/components/DocumentLoader/DocumentLoader.js:726` | Build a timeout-flavoured prefetch error so the loader can fail fast without waiting for the browser/network stack to decide when a stuck request should finally die. |
| `createSourceUnavailableSessionError` | function | `src/components/DocumentLoader/DocumentLoader.js:710` |  |
| `DocumentLoader` | function | `src/components/DocumentLoader/DocumentLoader.js:1169` |  |
| `DocumentLoaderProps` | typedef | `src/components/DocumentLoader/DocumentLoader.js:58` |  |
| `DocumentSourceItem` | typedef | `src/components/DocumentLoader/DocumentLoader.js:35` |  |
| `estimateTotalPagesConservatively` | function | `src/components/DocumentLoader/DocumentLoader.js:645` | Estimate the final page count conservatively. |
| `FailedPlaceholderInput` | typedef | `src/components/DocumentLoader/DocumentLoader.js:91` |  |
| `finalizeDocumentPages` | function | `src/components/DocumentLoader/DocumentLoader.js:993` | Patch the final page-count and boundary flags onto every page in a document once the loader knows where that document ends. |
| `getDocumentProgressKey` | function | `src/components/DocumentLoader/DocumentLoader.js:977` |  |
| `getEstimatedEntryExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:604` | Resolve the best-effort extension we can use for page-count estimation before every source has been fetched. |
| `getInitialTempStoreMode` | function | `src/components/DocumentLoader/DocumentLoader.js:591` |  |
| `inferUrlExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:206` |  |
| `isReloadCacheEnabled` | function | `src/components/DocumentLoader/DocumentLoader.js:582` |  |
| `isSourceUnavailableError` | function | `src/components/DocumentLoader/DocumentLoader.js:697` | Host integrations often expose short-lived file tickets. |
| `isSupportedSourceExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:238` |  |
| `isTextLikeSourceMime` | function | `src/components/DocumentLoader/DocumentLoader.js:246` |  |
| `isTransientPrefetchError` | function | `src/components/DocumentLoader/DocumentLoader.js:819` | Retry only errors that are likely to be transient in real deployments: browser/network fetch failures and gateway-style HTTP responses. |
| `LoadPressureSummary` | typedef | `src/components/DocumentLoader/DocumentLoader.js:121` |  |
| `looksLikeTextPayload` | function | `src/components/DocumentLoader/DocumentLoader.js:269` |  |
| `matchesKnownSourceSignature` | function | `src/components/DocumentLoader/DocumentLoader.js:298` |  |
| `<anonymous>~maybePrompt` | function | `src/components/DocumentLoader/DocumentLoader.js:1283` |  |
| `mimeForExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:923` |  |
| `mimeToExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:566` |  |
| `needsPageCountAnalysis` | function | `src/components/DocumentLoader/DocumentLoader.js:452` |  |
| `normalizeExtension` | function | `src/components/DocumentLoader/DocumentLoader.js:215` |  |
| `PageEstimateStats` | typedef | `src/components/DocumentLoader/DocumentLoader.js:134` |  |
| `PagePlaceholderInput` | typedef | `src/components/DocumentLoader/DocumentLoader.js:73` |  |
| `PrefetchResult` | typedef | `src/components/DocumentLoader/DocumentLoader.js:140` |  |
| `<anonymous>~prefetchSource` | function | `src/components/DocumentLoader/DocumentLoader.js:1304` | Fetch and persist one source blob with conservative retry behavior. |
| `DocumentLoader~promptForPressure` | constant | `src/components/DocumentLoader/DocumentLoader.js:1213` |  |
| `readBlobHeadBytes` | function | `src/components/DocumentLoader/DocumentLoader.js:335` |  |
| `readUint32LittleEndian` | function | `src/components/DocumentLoader/DocumentLoader.js:888` |  |
| `redactUrlForLog` | function | `src/components/DocumentLoader/DocumentLoader.js:548` |  |
| `<anonymous>~resolve` | function | `src/components/DocumentLoader/DocumentLoader.js:1582` |  |
| `ResolvedEntry` | typedef | `src/components/DocumentLoader/DocumentLoader.js:102` |  |
| `resolveDocumentSourceContext` | function | `src/components/DocumentLoader/DocumentLoader.js:951` | Extract multi-document source context from an entry or placeholder input. |
| `resolveEntries` | function | `src/components/DocumentLoader/DocumentLoader.js:1101` |  |
| `resolveExactPlannedPageCount` | function | `src/components/DocumentLoader/DocumentLoader.js:477` |  |
| `resolveFetchedSourcePayload` | function | `src/components/DocumentLoader/DocumentLoader.js:353` | Resolve source type information with a cheap signature-first path. |
| `resolvePrefetchedPageCountHint` | function | `src/components/DocumentLoader/DocumentLoader.js:517` | Resolve multi-page source page counts inside the prefetch worker queue so many small PDF/TIFF files do not create a second sequential analysis phase after all sources have been fe... |
| `DocumentLoader~resolvePressurePrompt` | constant | `src/components/DocumentLoader/DocumentLoader.js:1222` |  |
| `resolveTrustedEntryPageCountHint` | function | `src/components/DocumentLoader/DocumentLoader.js:462` |  |
| `resolveTrustedSourcePackPayload` | function | `src/components/DocumentLoader/DocumentLoader.js:418` | Gateway source packs already carry trusted file metadata from the prepared server-side session. |
| `safeMessage` | function | `src/components/DocumentLoader/DocumentLoader.js:1161` |  |
| `shouldDeferSourceWarmup` | function | `src/components/DocumentLoader/DocumentLoader.js:499` | Large multi-page PDFs should not start their background render warm-up while the loader is still discovering more sources. |
| `<anonymous>~shouldStopRun` | function | `src/components/DocumentLoader/DocumentLoader.js:1277` | Whether this load run is no longer allowed to mutate React state. |
| `sleep` | function | `src/components/DocumentLoader/DocumentLoader.js:667` |  |
| `startsWithAscii` | function | `src/components/DocumentLoader/DocumentLoader.js:284` |  |
| `toPositiveIntOrUndefined` | function | `src/components/DocumentLoader/DocumentLoader.js:940` |  |
| `updatePageEstimateStats` | function | `src/components/DocumentLoader/DocumentLoader.js:619` | Update per-extension page-count statistics used by the conservative warning estimator. |
| `validateFetchedSourceBlob` | function | `src/components/DocumentLoader/DocumentLoader.js:764` | Validate that a fetched source looks like a renderable document before it is saved to ODV&#39;s session temp store. |
| `fetchAndArrayBuffer` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:119` | Fetch a resource and return its ArrayBuffer. |
| `FetchOptions` | typedef | `src/components/DocumentLoader/documentLoaderUtils.js:105` | Options for fetchAndArrayBuffer. |
| `generateDemoList` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:80` | Generate a list of demo document URLs by repeating or mixing sample files. |
| `generateDocumentList` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:52` | Generate a list of document URLs using a simple pattern: 001..NNN + extension. |
| `generateThumbnail` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:202` | Create a small thumbnail data URL for a given image URL. |
| `getTiffMetadata` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:172` | Extract light-weight metadata from a TIFF buffer \(best-effort\). |
| `getTotalPages` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:140` | Determine total pages for a given document by inspecting its buffer and type. |
| `TRANSPARENT_1x1` | constant | `src/components/DocumentLoader/documentLoaderUtils.js:37` | Tiny transparent PNG as a safe fallback when thumbnails cannot be produced. |
| `module.exports` | function | `src/components/DocumentLoader/LoadPressureDialog.jsx:35` | Large-load warning dialog shown before / during very heavy loading runs. |
| `LoadPressureDialogProps` | typedef | `src/components/DocumentLoader/LoadPressureDialog.jsx:21` |  |
| `LoadPressureDialogSummary` | typedef | `src/components/DocumentLoader/LoadPressureDialog.jsx:8` |  |
| `LoadPressureDialog~tr` | function | `src/components/DocumentLoader/LoadPressureDialog.jsx:43` |  |
| `__pdfWorkerInitialized` | member | `src/components/DocumentLoader/mainThreadRenderer.js:59` | One-time init of pdf.js classic worker script URL \(dev == build\). |
| `buildOjpegJpeg` | function | `src/components/DocumentLoader/mainThreadRenderer.js:224` | Build a standard JPEG Blob from an OJPEG \(old-style JPEG-in-TIFF\) IFD by concatenating the tables \( JPEGInterchangeFormat / Length : t513/t514\) with the entropy-coded scan strips... |
| `ensurePdfWorker` | function | `src/components/DocumentLoader/mainThreadRenderer.js:66` | Ensure a pdf.js worker is ready for this runtime. |
| `getTagArray` | function | `src/components/DocumentLoader/mainThreadRenderer.js:208` | Safely read a TIFF tag array from a utif2 IFD object. |
| `InsertPageAtIndex` | typedef | `src/components/DocumentLoader/mainThreadRenderer.js:49` | Signature for inserting a page structure into the page list at an index. |
| `MAX_OJPEG_SCAN_SIZE_BYTES` | constant | `src/components/DocumentLoader/mainThreadRenderer.js:33` | Upper bound for reconstructed OJPEG entropy-coded scan data. |
| `RenderJob` | typedef | `src/components/DocumentLoader/mainThreadRenderer.js:35` | Render job passed to the main-thread renderer. |
| `renderPDFInMainThread` | constant | `src/components/DocumentLoader/mainThreadRenderer.js:90` | Render PDF pages on the main thread and INSERT THEM DIRECTLY. |
| `renderTIFFInMainThread` | constant | `src/components/DocumentLoader/mainThreadRenderer.js:294` | Render TIFF pages on the main thread with an ultra-light OJPEG fast path: If Compression=6 \(old-style JPEG-in-TIFF\), reconstruct a standard JPEG stream by concatenating the JFIF/t... |
| `ExplicitSourceList` | typedef | `src/components/DocumentLoader/sources/explicitListSource.js:3` | OpenDocViewer — Explicit Source List Normalizer PURPOSE Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically. |
| `firstDocumentField` | function | `src/components/DocumentLoader/sources/explicitListSource.js:102` |  |
| `inferExtFromUrl` | function | `src/components/DocumentLoader/sources/explicitListSource.js:77` | Infer a lowercase extension from a URL if present. |
| `makeExplicitSource` | function | `src/components/DocumentLoader/sources/explicitListSource.js:182` | Convert a PortableDocumentBundle into a flat, ordered list of file URLs. |
| `metadataAliasValue` | function | `src/components/DocumentLoader/sources/explicitListSource.js:115` |  |
| `metadataFieldValue` | function | `src/components/DocumentLoader/sources/explicitListSource.js:130` |  |
| `optionalText` | function | `src/components/DocumentLoader/sources/explicitListSource.js:91` |  |
| `PortableDoc` | typedef | `src/components/DocumentLoader/sources/explicitListSource.js:53` | Portable document containing a list of files. |
| `PortableDocumentBundle` | typedef | `src/components/DocumentLoader/sources/explicitListSource.js:65` | Bundle containing multiple portable documents. |
| `PortableFile` | typedef | `src/components/DocumentLoader/sources/explicitListSource.js:38` | A single file reference in a portable document. |
| `resolveDocumentVersion` | function | `src/components/DocumentLoader/sources/explicitListSource.js:152` |  |
| `createWorker` | function | `src/components/DocumentLoader/workerHandler.js:95` | Create a new image worker instance. |
| `getNumberOfWorkers` | function | `src/components/DocumentLoader/workerHandler.js:110` | Decide how many workers to spawn, leaving one logical core for the UI when possible. |
| `HandleOpts` | typedef | `src/components/DocumentLoader/workerHandler.js:76` | Options passed to the handler to coordinate main-thread rendering. |
| `handleWorkerMessage` | constant | `src/components/DocumentLoader/workerHandler.js:174` | Handle a message payload from an image worker and insert resulting page\(s\). |
| `InsertPageAtIndex` | typedef | `src/components/DocumentLoader/workerHandler.js:68` | Signature for inserting a page structure into the viewer at a specific index. |
| `scheduleMainThread` | function | `src/components/DocumentLoader/workerHandler.js:138` | Decide how to schedule/execute a main-thread render job based on options: If a queue ref is provided → push the job to the queue \(deferred execution\). |
| `WorkerJob` | typedef | `src/components/DocumentLoader/workerHandler.js:42` | A single job/result entry communicated between worker and main thread. |
| `WorkerMessage` | typedef | `src/components/DocumentLoader/workerHandler.js:58` | Worker → main message envelope. |
| `module.exports` | function | `src/components/DocumentMetadataMatrixOverlayDialog.jsx:17` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentMetadataMatrixOverlayDialog.jsx:30` |  |
| `module.exports` | function | `src/components/DocumentMetadataOverlayDialog.jsx:21` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentMetadataOverlayDialog.jsx:38` |  |
| `<anonymous>~applyFitZoomForKnownSize` | constant | `src/components/DocumentRender.jsx:465` | Apply sticky fit modes before a newly loaded page becomes visible. |
| `<anonymous>~applyInitialZoomMode` | constant | `src/components/DocumentRender.jsx:488` |  |
| `<anonymous>~claimAssetRetry` | constant | `src/components/DocumentRender.jsx:215` |  |
| `<anonymous>~clearLoadingOverlayTimer` | constant | `src/components/DocumentRender.jsx:203` |  |
| `DisplayedAsset` | typedef | `src/components/DocumentRender.jsx:76` |  |
| `DocumentRender` | constant | `src/components/DocumentRender.jsx:100` |  |
| `<anonymous>~drawImageOnCanvas` | constant | `src/components/DocumentRender.jsx:374` |  |
| `<anonymous>~finalizeDisplayedAsset` | constant | `src/components/DocumentRender.jsx:709` |  |
| `<anonymous>~fitToCustomWidth` | constant | `src/components/DocumentRender.jsx:452` |  |
| `<anonymous>~fitToScreen` | constant | `src/components/DocumentRender.jsx:433` |  |
| `<anonymous>~fitToWidth` | constant | `src/components/DocumentRender.jsx:442` |  |
| `<anonymous>~getActiveRenderSurface` | constant | `src/components/DocumentRender.jsx:420` | Returns the surface whose intrinsic size should drive fit calculations. |
| `getCurrentPage` | function | `src/components/DocumentRender.jsx:44` |  |
| `<anonymous>~handlePendingImageError` | constant | `src/components/DocumentRender.jsx:893` |  |
| `<anonymous>~handlePendingImageLoad` | constant | `src/components/DocumentRender.jsx:826` |  |
| `<anonymous>~handleViewportDoubleClick` | constant | `src/components/DocumentRender.jsx:511` |  |
| `<anonymous>~handleVisibleImageError` | constant | `src/components/DocumentRender.jsx:921` |  |
| `<anonymous>~handleVisibleImageLoad` | constant | `src/components/DocumentRender.jsx:769` |  |
| `hasUsableSize` | function | `src/components/DocumentRender.jsx:64` |  |
| `isBlobAssetUrl` | function | `src/components/DocumentRender.jsx:72` |  |
| `normalizeSize` | function | `src/components/DocumentRender.jsx:53` |  |
| `<anonymous>~recoverPageAsset` | constant | `src/components/DocumentRender.jsx:852` |  |
| `<anonymous>~resetAssetRetry` | constant | `src/components/DocumentRender.jsx:196` | Reset the per-page blob-URL retry tracker after a successful load or when the target page changes. |
| `<anonymous>~resolveCustomFitOptions` | constant | `src/components/DocumentRender.jsx:255` |  |
| `module.exports` | function | `src/components/DocumentSelectionPanel.jsx:89` |  |
| `SelectionCheckboxRow` | function | `src/components/DocumentSelectionPanel.jsx:30` |  |
| `buildCenterOutQueue` | function | `src/components/DocumentThumbnailList.jsx:150` | Build a center-out thumbnail warm-up order so the pane feels responsive around the user&#39;s current scroll target instead of always starting from page 1. |
| `clamp` | function | `src/components/DocumentThumbnailList.jsx:63` |  |
| `DocumentThumbnailList` | constant | `src/components/DocumentThumbnailList.jsx:535` |  |
| `formatMetricFraction` | function | `src/components/DocumentThumbnailList.jsx:107` |  |
| `formatMetricValue` | function | `src/components/DocumentThumbnailList.jsx:117` |  |
| `getDocumentBoundaryLabel` | function | `src/components/DocumentThumbnailList.jsx:315` |  |
| `getDocumentBoundaryTitle` | function | `src/components/DocumentThumbnailList.jsx:329` |  |
| `getMetricBadges` | function | `src/components/DocumentThumbnailList.jsx:261` |  |
| `getMetricTitles` | function | `src/components/DocumentThumbnailList.jsx:212` |  |
| `getPageDocumentContext` | function | `src/components/DocumentThumbnailList.jsx:184` |  |
| `getPageDocumentKey` | function | `src/components/DocumentThumbnailList.jsx:171` |  |
| `getSessionPageIndex` | function | `src/components/DocumentThumbnailList.jsx:126` |  |
| `getThumbnailLayout` | function | `src/components/DocumentThumbnailList.jsx:86` |  |
| `<anonymous>~handleActivate` | constant | `src/components/DocumentThumbnailList.jsx:1051` |  |
| `<anonymous>~handleImageLoad` | constant | `src/components/DocumentThumbnailList.jsx:1144` |  |
| `<anonymous>~handleKeyActivate` | constant | `src/components/DocumentThumbnailList.jsx:1077` |  |
| `<anonymous>~handleKeyDown` | function | `src/components/DocumentThumbnailList.jsx:946` |  |
| `<anonymous>~handleOpenContextMenu` | constant | `src/components/DocumentThumbnailList.jsx:1090` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentThumbnailList.jsx:937` |  |
| `<anonymous>~handleScroll` | constant | `src/components/DocumentThumbnailList.jsx:1024` |  |
| `isIndexInRange` | function | `src/components/DocumentThumbnailList.jsx:137` |  |
| `<anonymous>~setContainerRef` | constant | `src/components/DocumentThumbnailList.jsx:708` |  |
| `shouldWarmAllThumbnails` | function | `src/components/DocumentThumbnailList.jsx:72` |  |
| `ThumbnailRow` | constant | `src/components/DocumentThumbnailList.jsx:342` |  |
| `ThumbnailRowProps` | typedef | `src/components/DocumentThumbnailList.jsx:35` |  |
| `module.exports` | function | `src/components/DocumentToolbar/AboutOverlayDialog.jsx:46` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentToolbar/AboutOverlayDialog.jsx:70` |  |
| `resolveAboutInfo` | function | `src/components/DocumentToolbar/AboutOverlayDialog.jsx:17` |  |
| `AnyRef` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:108` | Mutable ref-like object used by the toolbar. |
| `DocumentToolbar~dispatchPrintRequest` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:1119` | Execute the actual print helper after the dialog has resolved the user&#39;s choices. |
| `DocumentToolbar` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:285` | Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| `DocumentToolbarProps` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:136` | Props for {@link DocumentToolbar}. |
| `formatPdfProgressBody` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:64` |  |
| `getPdfProgressPercent` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:81` |  |
| `DocumentToolbar~handleBrightnessSliderChange` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:681` | Handle brightness slider changes with neutral snapping at 100. |
| `DocumentToolbar~handleContrastSliderChange` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:695` | Handle contrast slider changes with neutral snapping at 100. |
| `DocumentToolbar~handleEnhancePdfResolutionClick` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:717` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:407` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:399` |  |
| `DocumentToolbar~handlePrintSubmit` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:1287` | Handle the dialog submit event and dispatch the correct print action. |
| `DocumentToolbar~handleResetAdjustmentsClick` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:730` |  |
| `DocumentToolbar~handleRotationButtonClick` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:709` |  |
| `ImageProperties` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:114` | Editable image state shown by the toolbar. |
| `isPdfAbortError` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:55` |  |
| `isPdfPage` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:272` |  |
| `makePdfResolutionPageKey` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:262` |  |
| `DocumentToolbar~makePrintOptions` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:858` |  |
| `normalizeToolbarPageNumber` | function | `src/components/DocumentToolbar/DocumentToolbar.jsx:250` | Clamp a page number into the valid viewer range while preserving a safe fallback. |
| `ONE_TO_ONE_EPS` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:219` | Epsilon for considering zoom ≈ 100% \(0.5%\). |
| `PageNumberSetter` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:122` | React-like numeric page setter used by the toolbar. |
| `PrintSubmitDetail` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:88` | Detail payload emitted by the print dialog. |
| `DocumentToolbar~resolvePrintPageContexts` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:808` | Resolve page metadata objects aligned with the printed page sequence. |
| `DocumentToolbar~resolvePrintPageCount` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:786` | Estimate the number of pages the user is about to print. |
| `DocumentToolbar~resolvePrintPageNumbers` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:822` |  |
| `SLIDER_CENTER_RANGE` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:217` | Range \(±\) around 100% where sliders snap back to the neutral value. |
| `DocumentToolbar~submitUserPrintLog` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:886` | Fire-and-forget user print log. |
| `DocumentToolbar~toggleAdjustmentMenu` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:739` |  |
| `DocumentToolbar~toPagesString` | constant | `src/components/DocumentToolbar/DocumentToolbar.jsx:766` | Build a compact &amp;quot;pages&amp;quot; descriptor for logging. |
| `ZoomState` | typedef | `src/components/DocumentToolbar/DocumentToolbar.jsx:129` | Zoom display state used by the newer toolbar UX paths. |
| `<anonymous>~handleKeyDown` | function | `src/components/DocumentToolbar/HelpMenuButton.jsx:30` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentToolbar/HelpMenuButton.jsx:22` |  |
| `module.exports` | function | `src/components/DocumentToolbar/HelpOverlayDialog.jsx:19` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentToolbar/HelpOverlayDialog.jsx:29` |  |
| `<anonymous>~handleKeyDown` | function | `src/components/DocumentToolbar/LanguageMenuButton.jsx:61` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentToolbar/LanguageMenuButton.jsx:53` |  |
| `LanguageMenuButton~handleSelectLanguage` | function | `src/components/DocumentToolbar/LanguageMenuButton.jsx:80` |  |
| `resolveLanguageLabel` | function | `src/components/DocumentToolbar/LanguageMenuButton.jsx:18` |  |
| `appendManualRefreshToken` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:111` |  |
| `buildManualCandidates` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:143` |  |
| `module.exports` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:173` |  |
| `<anonymous>~handleEscape` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:193` |  |
| `interpolateTemplate` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:31` |  |
| `isRewritableRelativeUrl` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:41` |  |
| `removeManualRefreshToken` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:127` |  |
| `rewriteManualHtml` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:69` |  |
| `sanitizeManualHtml` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:55` |  |
| `toText` | function | `src/components/DocumentToolbar/ManualOverlayDialog.jsx:21` |  |
| `PrintSubmitDetail` | typedef | `src/components/DocumentToolbar/PrintRangeDialog.jsx:13` | Structured payload returned to the caller on submit. |
| `<anonymous>~handleKeyDown` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:88` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:80` |  |
| `ThemeMenuButton~handleSelect` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:104` |  |
| `resolveSelectedMode` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:46` |  |
| `resolveThemeModeIcon` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:34` |  |
| `resolveThemeModeLabel` | function | `src/components/DocumentToolbar/ThemeMenuButton.jsx:23` |  |
| `createSessionPageNumbers` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:125` |  |
| `createVariantDetail` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:78` |  |
| `module.exports` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:140` |  |
| `isAbortError` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:43` |  |
| `isCacheableAllPagesRequest` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:63` |  |
| `normalizePdfOrientation` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:51` |  |
| `runLimited` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:103` | Run async work with bounded concurrency. |
| `throwIfAborted` | function | `src/components/DocumentToolbar/usePdfPrebuildAllPages.js:32` |  |
| `buildSelectedOptionDetails` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:124` | Build token-friendly details for the selected option without forcing templates to use list indexes. |
| `usePrintRangeController~composePrintFormat` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:526` |  |
| `usePrintRangeController~composeReason` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:545` |  |
| `usePrintRangeController~composeSubmitDetail` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:588` | Compose and validate the print payload for the current dialog state. |
| `ensureODVPrintCSS` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:163` | Ensure base print CSS is injected once per document. |
| `usePrintRangeController~extras` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:568` |  |
| `getCfg` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:37` | Read the runtime configuration \(merged defaults + site overrides\). |
| `hasTextValue` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:57` |  |
| `usePrintRangeController~makeDescendingSequence` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:440` |  |
| `normalizePdfOrientationMode` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:110` |  |
| `usePrintRangeController~onDialogKeyDown` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:428` |  |
| `PrintSubmitDetail` | typedef | `src/components/DocumentToolbar/usePrintRangeDialog.js:15` | Structured payload returned to the caller on submit. |
| `resolveOptionPrintText` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:73` | Resolve the string that should be used on physical print/log output for an option. |
| `resolvePrintAction` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:96` | Resolve a configurable print dialog action. |
| `usePrintRangeController~restoreFromDetail` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:679` | Restore the dialog state from the latest successfully prepared print. |
| `safeRegex` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:48` | Build a safe RegExp from optional pattern/flags. |
| `usePrintRangeController~submitPdfDownload` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:668` |  |
| `usePrintRangeController~submitPrintDirect` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:660` |  |
| `usePrintRangeController~submitPrintPdf` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:663` |  |
| `usePrintRangeController~submitWithBackend` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:647` |  |
| `usePrintRangeController` | function | `src/components/DocumentToolbar/usePrintRangeDialog.js:191` | Hook that encapsulates state, derived values, effects and handlers for PrintRangeDialog. |
| `usePrintRangeController~validateRange` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:449` |  |
| `usePrintRangeController~validateUserFields` | constant | `src/components/DocumentToolbar/usePrintRangeDialog.js:461` |  |
| `parsePercentInput` | function | `src/components/DocumentToolbar/ZoomButtons.jsx:98` | Parse a percent-like string safely. |
| `CompareZoomOverlay` | function | `src/components/DocumentViewer/CompareZoomOverlay.jsx:28` | CompareZoomOverlay Presentational-only \(no state\). |
| `<anonymous>~allowNativeContextMenu` | function | `src/components/DocumentViewer/DocumentViewer.jsx:328` |  |
| `<anonymous>~hasActiveModalDialog` | function | `src/components/DocumentViewer/DocumentViewer.jsx:236` |  |
| `<anonymous>~isEditableTarget` | function | `src/components/DocumentViewer/DocumentViewer.jsx:229` |  |
| `<anonymous>~onKeyDown` | function | `src/components/DocumentViewer/DocumentViewer.jsx:240` |  |
| `DocumentViewerRender` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:200` | DocumentViewerRender Renders the main document pane and, if enabled, a comparison pane. |
| `getPageSelectionContext` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:54` |  |
| `getWheelDeltaYPx` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:124` |  |
| `<anonymous>~handleKeyDown` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:645` |  |
| `DocumentViewerRender~handlePaneContextMenu` | constant | `src/components/DocumentViewer/DocumentViewerRender.jsx:671` |  |
| `DocumentViewerRender~handlePaneWheelCapture` | constant | `src/components/DocumentViewer/DocumentViewerRender.jsx:403` |  |
| `<anonymous>~handlePointerDown` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:639` |  |
| `isAtScrollBottom` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:144` |  |
| `isAtScrollTop` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:136` |  |
| `isPaneInteractiveTarget` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:75` |  |
| `isPannableViewport` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:86` |  |
| `isPointerOnViewportScrollbar` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:97` |  |
| `preventDefaultIfCancelable` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:155` |  |
| `DocumentViewerRender~renderEdgeScrollIndicator` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:746` |  |
| `DocumentViewerRender~renderPaneSelector` | function | `src/components/DocumentViewer/DocumentViewerRender.jsx:769` |  |
| `ViewerContextMenuState` | typedef | `src/components/DocumentViewer/DocumentViewerRender.jsx:38` |  |
| `ViewerPaneKey` | typedef | `src/components/DocumentViewer/DocumentViewerRender.jsx:34` |  |
| `DocumentViewerThumbnails` | function | `src/components/DocumentViewer/DocumentViewerThumbnails.jsx:42` |  |
| `DocumentViewerToolbar` | function | `src/components/DocumentViewer/DocumentViewerToolbar.jsx:127` | Renders the toolbar for the document viewer by delegating to . |
| `DocumentViewerToolbarProps` | typedef | `src/components/DocumentViewer/DocumentViewerToolbar.jsx:36` | Props consumed by DocumentViewerToolbar. |
| `PageNumberSetter` | typedef | `src/components/DocumentViewer/DocumentViewerToolbar.jsx:26` | React-like numeric/original page setter used by the toolbar adapter. |
| `RefLike` | typedef | `src/components/DocumentViewer/DocumentViewerToolbar.jsx:13` | Ref-like shape used for imperative handles. |
| `SetBooleanState` | typedef | `src/components/DocumentViewer/DocumentViewerToolbar.jsx:19` | State setter that accepts a boolean or an updater callback. |
| `<anonymous>~getScope` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:374` |  |
| `<anonymous>~getTarget` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:363` |  |
| `module:useViewerEffects~hasActiveModalDialog` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:98` | Determine whether a modal dialog is currently open. |
| `module:useViewerEffects~isEditableTarget` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:83` | Determine whether the event target is an editable or form control where viewer shortcuts must stay inactive. |
| `<anonymous>~isNextRepeatKey` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:384` |  |
| `<anonymous>~isPreviousRepeatKey` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:391` |  |
| `module:useViewerEffects~KeyboardPrintShortcutBehavior` | typedef | `src/components/DocumentViewer/hooks/useViewerEffects.js:31` |  |
| `<anonymous>~onKeyDown` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:329` |  |
| `<anonymous>~onKeyDown` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:395` |  |
| `<anonymous>~onKeyUp` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:508` |  |
| `<anonymous>~onVisibilityChange` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:519` |  |
| `<anonymous>~onWheelGlobal` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:312` |  |
| `<anonymous>~onWindowBlur` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:514` |  |
| `module:useViewerEffects~shouldIgnoreViewerShortcut` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:109` | Decide whether a keyboard shortcut should be ignored for the viewer. |
| `module:useViewerEffects` | module | `src/components/DocumentViewer/hooks/useViewerEffects.js:2` | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res... |
| `module:useViewerEffects.useViewerEffects` | function | `src/components/DocumentViewer/hooks/useViewerEffects.js:121` |  |
| `module:useViewerEffects~UseViewerEffectsArgs` | typedef | `src/components/DocumentViewer/hooks/useViewerEffects.js:33` | Arguments for useViewerEffects. |
| `module:useViewerEffects~ZoomMode` | typedef | `src/components/DocumentViewer/hooks/useViewerEffects.js:26` | Sticky zoom modes used by the viewer. |
| `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomLeft` | constant | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:59` | Adjust left pane post-zoom by ±0.1 steps. |
| `module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomRight` | constant | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:68` | Adjust right pane post-zoom by ±0.1 steps. |
| `module:useViewerPostZoom~clamp` | function | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:20` | Clamp a numeric value to \[min, max\]. |
| `module:useViewerPostZoom.useViewerPostZoom~resetPostZoom` | constant | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:50` | Reset both per-pane factors to 1.0. |
| `module:useViewerPostZoom~round1` | function | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:29` | Round to one decimal place \(avoids float drift when stepping by 0.1\). |
| `module:useViewerPostZoom` | module | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:2` | File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &amp;quot;post-zoom&amp;quot; state &amp;amp; handlers used only in compare mode. |
| `module:useViewerPostZoom.useViewerPostZoom` | function | `src/components/DocumentViewer/hooks/useViewerPostZoom.js:45` | Hook managing per-pane post-zoom factors for compare mode. |
| `useDocumentViewer~activateComparePane` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1509` | Open compare mode when needed and make the right pane the default target. |
| `useDocumentViewer~activatePrimaryPane` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1501` |  |
| `useDocumentViewer~applyThumbnailWidth` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1618` | Mouse down handler for the thumbnail resizer; listens for mousemove/up on window. |
| `buildDocumentSelectionModel` | function | `src/components/DocumentViewer/useDocumentViewer.js:357` |  |
| `buildImageRotationDependencyKey` | function | `src/components/DocumentViewer/useDocumentViewer.js:140` |  |
| `buildSelectionMaskFromPrintPageSequence` | function | `src/components/DocumentViewer/useDocumentViewer.js:263` | Build an inclusion mask from a print-page sequence. |
| `buildVisibleDocumentNavigationModel` | function | `src/components/DocumentViewer/useDocumentViewer.js:435` | Build the visible-document grouping used by document-level navigation. |
| `clampPage` | function | `src/components/DocumentViewer/useDocumentViewer.js:45` | Clamp a 1-based page number into \[1, total\]. |
| `useDocumentViewer~closeCompare` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1537` | Close compare mode without affecting the left page. |
| `CustomFitSizeLimits` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:66` | Optional maximum percentage limits for the custom fit-to-size zoom mode. |
| `findNearestVisiblePageNumber` | function | `src/components/DocumentViewer/useDocumentViewer.js:300` | Resolve the nearest visible page number for a requested original page index. |
| `useDocumentViewer~getDocumentNavigationState` | constant | `src/components/DocumentViewer/useDocumentViewer.js:733` | Resolve document-navigation state for the requested pane. |
| `getPageDocumentNavigationMeta` | function | `src/components/DocumentViewer/useDocumentViewer.js:409` |  |
| `useDocumentViewer~goToFirstDocument` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1263` | Jump to the first page of the first visible document. |
| `useDocumentViewer~goToFirstPage` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1219` | Jump to the first visible page in the requested target pane. |
| `useDocumentViewer~goToLastDocument` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1275` | Jump to the first page of the last visible document. |
| `useDocumentViewer~goToLastPage` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1228` | Jump to the last visible page in the requested target pane. |
| `useDocumentViewer~goToNextDocument` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1251` | Jump to the first page of the next visible document. |
| `useDocumentViewer~goToNextPage` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1210` | Move one page forward in the requested target pane. |
| `useDocumentViewer~goToPreviousDocument` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1239` | Jump to the first page of the previous visible document \(or to the current document start when the active pane already points inside the first visible document\). |
| `useDocumentViewer~goToPreviousPage` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1201` | Move one page backward in the requested target pane. |
| `useDocumentViewer~handleBrightnessChange` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1573` |  |
| `useDocumentViewer~handleCompare` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1519` | Toggle compare mode. |
| `useDocumentViewer~handleContrastChange` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1585` |  |
| `useDocumentViewer~handlePageNumberChange` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1117` | Change the primary page using an original page number \(or a visible-page updater function when called from navigation helpers\). |
| `useDocumentViewer~handlePrimaryDisplayStateChange` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1165` | Keep requested-page state and the actually displayed page synchronized for diagnostics. |
| `useDocumentViewer~handleVisiblePageNumberChange` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1126` | Change the primary page by a visible page number from the thumbnail strip. |
| `hasExcludedPages` | function | `src/components/DocumentViewer/useDocumentViewer.js:173` | Return true when the normalized mask excludes at least one page from the current session. |
| `useDocumentViewer~hideDocumentFromSelection` | constant | `src/components/DocumentViewer/useDocumentViewer.js:992` | Immediately exclude every page that belongs to the same document as the provided original page index. |
| `useDocumentViewer~hidePageFromSelection` | constant | `src/components/DocumentViewer/useDocumentViewer.js:954` | Immediately exclude a page from the active selection and apply the filtered session. |
| `ImageProperties` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:78` | Image adjustment properties for canvas edit mode. |
| `isNaturalPrintPageSequence` | function | `src/components/DocumentViewer/useDocumentViewer.js:282` |  |
| `masksEqual` | function | `src/components/DocumentViewer/useDocumentViewer.js:190` | Compare two selection masks over the active page count. |
| `normalizeOriginalPageIndex` | function | `src/components/DocumentViewer/useDocumentViewer.js:221` | Normalize a zero-based original page index and reject invalid/out-of-range values. |
| `normalizePrintPageSequence` | function | `src/components/DocumentViewer/useDocumentViewer.js:235` |  |
| `normalizeRotationDegrees` | function | `src/components/DocumentViewer/useDocumentViewer.js:61` | Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer. |
| `normalizeSelectionMask` | function | `src/components/DocumentViewer/useDocumentViewer.js:153` | Normalize a persisted/host-provided page-selection mask to the current page count. |
| `normalizeViewerPaneTarget` | function | `src/components/DocumentViewer/useDocumentViewer.js:499` | Normalize any pane key into the viewer&#39;s two supported navigation targets. |
| `<anonymous>~onMove` | function | `src/components/DocumentViewer/useDocumentViewer.js:1704` |  |
| `PrintPageSequence` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:76` |  |
| `resolveDocumentSelectionPageNumber` | function | `src/components/DocumentViewer/useDocumentViewer.js:340` | Resolve a page&#39;s 1-based page number within the current document-selection group. |
| `resolveEffectiveCustomFitSizeLimits` | function | `src/components/DocumentViewer/useDocumentViewer.js:113` | Resolve effective custom-fit limits from a preferred value set and runtime config. |
| `useDocumentViewer~resolveNearestVisibleOriginalPageNumber` | constant | `src/components/DocumentViewer/useDocumentViewer.js:811` |  |
| `resolveOriginalIndexFromPrintPageNumber` | function | `src/components/DocumentViewer/useDocumentViewer.js:205` | Convert a 1-based print/session page number to a zero-based original page index. |
| `resolveProposedVisiblePageNumber` | function | `src/components/DocumentViewer/useDocumentViewer.js:324` | Resolve either a direct visible-page value or a React setState-style updater function. |
| `useDocumentViewer~resolveTargetOriginalPageNumber` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1069` | Resolve the next original 1-based page number from a visible-page update. |
| `useDocumentViewer~selectForCompare` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1552` | Select a page for the right-hand compare pane. |
| `SelectionMask` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:75` |  |
| `useDocumentViewer~setActivePane` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1494` | Set the default pane for compare-aware navigation and editing actions. |
| `useDocumentViewer~setComparePageNumber` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1153` | Change the compare page using an original page number \(or a visible-page updater function when called from compare navigation helpers\). |
| `useDocumentViewer~setIsExpanded` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1482` | Setter for the editing controls visibility. |
| `useDocumentViewer~setVisibleComparePageNumber` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1139` | Change the compare page by a visible page number from the toolbar page field. |
| `useDocumentViewer~setZoomMode` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1389` | Set zoom mode directly \(&#39;FIT_PAGE&#39;\|&#39;FIT_WIDTH&#39;\|&#39;FIT_CUSTOM&#39;\|&#39;ACTUAL_SIZE&#39;\|&#39;CUSTOM&#39;\). |
| `useDocumentViewer~thumbnailSelectionPageNumber` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1193` | The thumbnail pane should react immediately when the user changes page. |
| `useDocumentViewer~toggleFitZoomMode` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1466` | Toggle between the two fit modes from the page surface. |
| `useDocumentViewer~updatePageTarget` | constant | `src/components/DocumentViewer/useDocumentViewer.js:1092` | Generic primary/compare page setter that accepts either a visible-page updater function or a concrete original page number. |
| `useDocumentViewer` | function | `src/components/DocumentViewer/useDocumentViewer.js:520` | Hook that centralizes viewer UI state and event handlers. |
| `ViewerPageTarget` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:77` |  |
| `ZoomMode` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:481` | Sticky zoom modes used by the viewer \(subset is used here\). |
| `ZoomState` | typedef | `src/components/DocumentViewer/useDocumentViewer.js:486` | Zoom state \(mode + current numeric scale\). |
| `ImageRenderer` | constant | `src/components/ImageRenderer.jsx:51` | ImageRenderer component. |
| `ImgEventHandler` | typedef | `src/components/ImageRenderer.jsx:28` | Image load/error handler. |
| `LoadingMessage` | function | `src/components/LoadingMessage.jsx:43` | LoadingMessage component. |
| `LoadingSpinner.propTypes.className` | member | `src/components/LoadingSpinner.jsx:87` | Extra classes to append to the root element. |
| `LoadingSpinner.propTypes.label` | member | `src/components/LoadingSpinner.jsx:85` | Accessible label announced by assistive technologies. |
| `LoadingSpinner` | function | `src/components/LoadingSpinner.jsx:55` | LoadingSpinner component. |
| `LoadingSpinner.propTypes.size` | member | `src/components/LoadingSpinner.jsx:83` | Optional width/height; if omitted, CSS controls dimensions. |
| `srOnlyStyle` | constant | `src/components/LoadingSpinner.jsx:33` | Inline “visually hidden” style for screen-reader-only text \(no CSS dependency\). |
| `<anonymous>~handleDone` | function | `src/components/PrintSelectionWorkspace.jsx:1804` |  |
| `<anonymous>~handleKeyDown` | function | `src/components/PrintSelectionWorkspace.jsx:1744` |  |
| `<anonymous>~handleKeyDown` | function | `src/components/PrintSelectionWorkspace.jsx:1777` |  |
| `<anonymous>~handleMove` | function | `src/components/PrintSelectionWorkspace.jsx:1797` |  |
| `Resizer.propTypes.ariaLabel` | member | `src/components/Resizer.jsx:103` | Accessible name for assistive technologies. |
| `Resizer.propTypes.className` | member | `src/components/Resizer.jsx:105` | Extra class names to append to the root element. |
| `<anonymous>~handleKeyDown` | constant | `src/components/Resizer.jsx:70` | Keyboard handler \(Enter/Space\) to initiate the same flow as mouse down. |
| `Resizer.propTypes.onMouseDown` | member | `src/components/Resizer.jsx:99` | Initiates resize in the parent \(mouse or keyboard-initiated\). |
| `Resizer.propTypes.orientation` | member | `src/components/Resizer.jsx:101` | Visual/semantic orientation of the separator. |
| `Resizer` | constant | `src/components/Resizer.jsx:61` | Resizer component. |
| `ResizerProps` | typedef | `src/components/Resizer.jsx:43` | Props for . |
| `ResizeStartHandler` | typedef | `src/components/Resizer.jsx:36` | Handler invoked when a resize interaction is initiated. |
| `module.exports` | function | `src/components/ViewerProblemNotice.jsx:197` |  |
| `ProblemNoticeTrigger` | typedef | `src/components/ViewerProblemNotice.jsx:26` |  |
| `resolveProblemTrigger` | function | `src/components/ViewerProblemNotice.jsx:44` |  |
| `toCount` | function | `src/components/ViewerProblemNotice.jsx:21` |  |
| `ThemeContext` | constant | `src/contexts/themeContext.js:26` | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| `ThemeContextValue` | typedef | `src/contexts/themeContext.js:10` | Context value shape for the theme. |
| `ThemeMode` | typedef | `src/contexts/themeContext.js:4` | Theme identifier. |
| `applyThemeToDocument` | function | `src/contexts/ThemeProvider.jsx:69` | Apply the resolved theme to the DOM \(SSR-safe\). |
| `detectSystemTheme` | function | `src/contexts/ThemeProvider.jsx:38` | Detect system preferred color scheme \(SSR-safe; defaults to light\). |
| `<anonymous>~onChange` | function | `src/contexts/ThemeProvider.jsx:162` |  |
| `resolveInitialThemeMode` | function | `src/contexts/ThemeProvider.jsx:87` | Resolve the initial theme mode once during provider initialization. |
| `resolveThemeForMode` | function | `src/contexts/ThemeProvider.jsx:55` | Resolve the concrete theme for a theme mode. |
| `ThemeProvider~setThemeExplicit` | constant | `src/contexts/ThemeProvider.jsx:139` | Apply an explicit concrete theme. |
| `ThemeProvider~setThemeMode` | constant | `src/contexts/ThemeProvider.jsx:119` | Persist and apply a theme mode. |
| `ThemeMode` | typedef | `src/contexts/ThemeProvider.jsx:27` | Theme mode identifier. |
| `ThemeName` | typedef | `src/contexts/ThemeProvider.jsx:22` | Theme identifier. |
| `ThemeProvider` | constant | `src/contexts/ThemeProvider.jsx:103` | ThemeProvider component to manage and provide theme-related state and functions. |
| `ThemeProvider~toggleTheme` | constant | `src/contexts/ThemeProvider.jsx:149` | Toggle between the two highest-contrast explicit themes. |
| `DisposeDocumentSessionOptions` | typedef | `src/contexts/viewerContext.js:40` |  |
| `DocumentSessionInitOptions` | typedef | `src/contexts/viewerContext.js:32` |  |
| `EnsurePageAssetOptions` | typedef | `src/contexts/viewerContext.js:55` |  |
| `StoreSourceBlobInput` | typedef | `src/contexts/viewerContext.js:45` |  |
| `ViewerContextValue` | typedef | `src/contexts/viewerContext.js:165` |  |
| `ViewerPageEntry` | typedef | `src/contexts/viewerContext.js:4` |  |
| `ViewerPageLoadState` | typedef | `src/contexts/viewerContext.js:155` |  |
| `ViewerRuntimeDiagnostics` | typedef | `src/contexts/viewerContext.js:78` |  |
| `ViewerSourceDescriptor` | typedef | `src/contexts/viewerContext.js:65` |  |
| `ViewerProvider~addMessage` | constant | `src/contexts/ViewerProvider.jsx:897` |  |
| `ViewerProvider~announceIndexedDbAssetMode` | constant | `src/contexts/ViewerProvider.jsx:1222` |  |
| `ViewerProvider~applySessionConfig` | constant | `src/contexts/ViewerProvider.jsx:912` |  |
| `ViewerProvider~clearPageAssetReference` | constant | `src/contexts/ViewerProvider.jsx:1371` | Drop a page&#39;s current object URL reference from React state and the in-memory cache. |
| `ViewerProvider~clearWarmupQueue` | constant | `src/contexts/ViewerProvider.jsx:939` |  |
| `ViewerProvider~collectRuntimeDiagnostics` | constant | `src/contexts/ViewerProvider.jsx:519` | Collect a stable snapshot of runtime counters for the optional diagnostics overlay. |
| `createLimiter` | function | `src/contexts/ViewerProvider.jsx:203` |  |
| `ViewerProvider~disposeDocumentSession` | constant | `src/contexts/ViewerProvider.jsx:1011` |  |
| `DisposeDocumentSessionOptions` | typedef | `src/contexts/ViewerProvider.jsx:47` |  |
| `DocumentSessionInitOptions` | typedef | `src/contexts/ViewerProvider.jsx:41` |  |
| `ViewerProvider~enforceCacheLimit` | constant | `src/contexts/ViewerProvider.jsx:1469` |  |
| `ViewerProvider~enhancePdfPageResolution` | constant | `src/contexts/ViewerProvider.jsx:1841` | Render one PDF page again at twice the configured full-page PDF scale. |
| `ViewerProvider~ensurePageAsset` | constant | `src/contexts/ViewerProvider.jsx:1680` |  |
| `EnsurePageAssetOptions` | typedef | `src/contexts/ViewerProvider.jsx:62` |  |
| `getPageAt` | function | `src/contexts/ViewerProvider.jsx:135` |  |
| `ViewerProvider~getPrintablePageUrls` | constant | `src/contexts/ViewerProvider.jsx:2218` |  |
| `ViewerProvider~getVariantCache` | constant | `src/contexts/ViewerProvider.jsx:1349` |  |
| `ViewerProvider~getVariantCacheLimit` | constant | `src/contexts/ViewerProvider.jsx:1445` |  |
| `ViewerProvider~initializeDocumentSession` | constant | `src/contexts/ViewerProvider.jsx:948` |  |
| `ViewerProvider~insertPageAtIndex` | constant | `src/contexts/ViewerProvider.jsx:832` |  |
| `ViewerProvider~insertPagesAtIndex` | constant | `src/contexts/ViewerProvider.jsx:849` |  |
| `isBlobObjectUrl` | function | `src/contexts/ViewerProvider.jsx:169` |  |
| `isPageFailedForSession` | function | `src/contexts/ViewerProvider.jsx:195` |  |
| `isPageReadyForSession` | function | `src/contexts/ViewerProvider.jsx:187` |  |
| `isPdfPageEntry` | function | `src/contexts/ViewerProvider.jsx:108` |  |
| `isReusableAssetUrl` | function | `src/contexts/ViewerProvider.jsx:177` |  |
| `makeAssetKey` | function | `src/contexts/ViewerProvider.jsx:77` |  |
| `makePdfResolutionPageKey` | function | `src/contexts/ViewerProvider.jsx:98` |  |
| `makePendingAssetKey` | function | `src/contexts/ViewerProvider.jsx:87` |  |
| `makePersistedAssetKey` | function | `src/contexts/ViewerProvider.jsx:118` |  |
| `ViewerProvider~maybeReleaseSinglePageRasterSource` | constant | `src/contexts/ViewerProvider.jsx:1234` |  |
| `createLimiter~normalizePriority` | function | `src/contexts/ViewerProvider.jsx:214` |  |
| `ViewerProvider~noteFullAssetReady` | constant | `src/contexts/ViewerProvider.jsx:496` | Record that a page now has a reusable full-size asset available. |
| `ViewerProvider~noteThumbnailAssetReady` | constant | `src/contexts/ViewerProvider.jsx:506` | Record that a page now has a reusable thumbnail asset available. |
| `ViewerProvider~patchPageAtIndex` | constant | `src/contexts/ViewerProvider.jsx:870` |  |
| `ViewerProvider~persistRenderedAsset` | constant | `src/contexts/ViewerProvider.jsx:1281` |  |
| `ViewerProvider~pinPageAsset` | constant | `src/contexts/ViewerProvider.jsx:1423` |  |
| `ViewerProvider~pumpWarmupQueue` | constant | `src/contexts/ViewerProvider.jsx:2084` | Drain background eager-render work without blocking the UI thread. |
| `ViewerProvider~readSourceArrayBuffer` | constant | `src/contexts/ViewerProvider.jsx:1205` |  |
| `ViewerProvider~readSourceBlob` | constant | `src/contexts/ViewerProvider.jsx:1214` |  |
| `ViewerProvider~recordLoaderPhaseTiming` | constant | `src/contexts/ViewerProvider.jsx:1904` |  |
| `ViewerProvider~registerSourceDescriptor` | constant | `src/contexts/ViewerProvider.jsx:1162` |  |
| `ViewerProvider~renderPageBlob` | constant | `src/contexts/ViewerProvider.jsx:1594` |  |
| `ViewerProvider~resetViewerState` | constant | `src/contexts/ViewerProvider.jsx:672` |  |
| `resolvePatch` | function | `src/contexts/ViewerProvider.jsx:145` |  |
| `ViewerProvider~restorePersistedAsset` | constant | `src/contexts/ViewerProvider.jsx:1527` |  |
| `ViewerProvider~revokeSessionUrls` | constant | `src/contexts/ViewerProvider.jsx:650` |  |
| `ViewerProvider~scheduleSourceWarmup` | constant | `src/contexts/ViewerProvider.jsx:2175` | Enqueue eager page rendering for a newly discovered source range. |
| `ViewerProvider~shouldReuseFullAssetForThumbnail` | constant | `src/contexts/ViewerProvider.jsx:1514` |  |
| `ViewerProvider~storeSourceBlob` | constant | `src/contexts/ViewerProvider.jsx:1181` |  |
| `StoreSourceBlobInput` | typedef | `src/contexts/ViewerProvider.jsx:52` |  |
| `touchCacheEntry` | function | `src/contexts/ViewerProvider.jsx:158` |  |
| `ViewerProvider~touchPageAsset` | constant | `src/contexts/ViewerProvider.jsx:1358` |  |
| `ViewerProvider~tryRenderPdfWarmupBatch` | constant | `src/contexts/ViewerProvider.jsx:1926` | Try to render a full-page PDF warm-up batch through the partitioned worker path. |
| `ViewerProvider~unpinPageAsset` | constant | `src/contexts/ViewerProvider.jsx:1434` |  |
| `ViewerProvider~updateAllPages` | constant | `src/contexts/ViewerProvider.jsx:472` |  |
| `ViewerProvider` | constant | `src/contexts/ViewerProvider.jsx:324` |  |
| `ViewerProviderProps` | typedef | `src/contexts/ViewerProvider.jsx:313` |  |
| `componentDidCatch` | function | `src/ErrorBoundary.jsx:152` | Log error details for diagnostics. |
| `module.exports#copyDetails` | member | `src/ErrorBoundary.jsx:189` | Copy a concise diagnostic bundle to the clipboard \(best effort\). |
| `ErrorBoundaryProps` | typedef | `src/ErrorBoundary.jsx:103` | Props for the ErrorBoundary component. |
| `ErrorBoundaryState` | typedef | `src/ErrorBoundary.jsx:115` | Internal state for the ErrorBoundary. |
| `module.exports` | class | `src/ErrorBoundary.jsx:130` | React Error Boundary implementation with: runtime-controlled stack visibility copy-to-clipboard helper for diagnostics reset handler to re-render child tree |
| `getDerivedStateFromError` | function | `src/ErrorBoundary.jsx:139` |  |
| `IS_DEV` | constant | `src/ErrorBoundary.jsx:34` | Determine whether we are in development mode. |
| `readConfigFlag` | function | `src/ErrorBoundary.jsx:80` | Read a runtime configuration flag \(SSR-safe\). |
| `render` | function | `src/ErrorBoundary.jsx:208` |  |
| `module.exports#reset` | member | `src/ErrorBoundary.jsx:166` | Reset the boundary and optionally call the external onReset handler. |
| `toBool` | function | `src/ErrorBoundary.jsx:59` | Coerce unknown values to boolean using common string/number forms. |
| `tr` | function | `src/ErrorBoundary.jsx:45` | Tiny helper to translate with safe fallback \(NS: &#39;common&#39;\). |
| `module.exports` | function | `src/hooks/useAcceleratingHoldRepeat.js:57` |  |
| `<anonymous>~applyState` | function | `src/hooks/useNavigationModifierState.js:59` |  |
| `<anonymous>~clearState` | function | `src/hooks/useNavigationModifierState.js:71` |  |
| `<anonymous>~handleVisibilityChange` | function | `src/hooks/useNavigationModifierState.js:88` |  |
| `hasActiveModalDialog` | function | `src/hooks/useNavigationModifierState.js:25` |  |
| `NavigationModifierState` | typedef | `src/hooks/useNavigationModifierState.js:16` |  |
| `resolveModifierState` | function | `src/hooks/useNavigationModifierState.js:34` |  |
| `<anonymous>~syncModifierState` | function | `src/hooks/useNavigationModifierState.js:79` |  |
| `useNavigationModifierState` | function | `src/hooks/useNavigationModifierState.js:44` |  |
| `usePageNavigation~fastNext` | constant | `src/hooks/usePageNavigation.js:140` | Fast step: next \(used by timers\). |
| `usePageNavigation~fastPrev` | constant | `src/hooks/usePageNavigation.js:131` | Fast step: previous \(used by timers\). |
| `usePageNavigation~handleFirstPageWrapper` | constant | `src/hooks/usePageNavigation.js:104` | Wrapper: go to first page. |
| `usePageNavigation~handleLastPageWrapper` | constant | `src/hooks/usePageNavigation.js:117` | Wrapper: go to last page. |
| `usePageNavigation~handleNextPageWrapper` | constant | `src/hooks/usePageNavigation.js:91` | Wrapper: go to next page \(logs once per user action\). |
| `usePageNavigation~handlePrevPageWrapper` | constant | `src/hooks/usePageNavigation.js:78` | Wrapper: go to previous page \(logs once per user action\). |
| `PageNavigationAPI` | typedef | `src/hooks/usePageNavigation.js:49` | API returned by usePageNavigation. |
| `usePageNavigation` | function | `src/hooks/usePageNavigation.js:69` | Custom hook to handle document page navigation with keyboard/mouse. |
| `DEFAULT_REPEAT_INTERVAL_MS` | constant | `src/hooks/usePageTimer.js:41` | Default repeat cadence \(ms\). |
| `PageDirection` | typedef | `src/hooks/usePageTimer.js:38` |  |
| `PageTimerAPI` | typedef | `src/hooks/usePageTimer.js:43` | API returned by usePageTimer. |
| `usePageTimer~startPageTimer` | constant | `src/hooks/usePageTimer.js:75` | Start the timer for continuous page navigation. |
| `usePageTimer~stopPageTimer` | constant | `src/hooks/usePageTimer.js:123` | Stop any active delay or interval timer \(idempotent\). |
| `usePageTimer` | function | `src/hooks/usePageTimer.js:60` | Custom hook to handle page change with a timer for continuous navigation. |
| `appendQuery` | function | `src/i18n.js:140` | Helper: append query params safely to a URL. |
| `BUNDLED_I18N_RESOURCE_REVISION` | constant | `src/i18n.js:90` | Fallback cache-busting token for bundled locale resources. |
| `computeBaseHref` | function | `src/i18n.js:372` | Compute a normalized base href. |
| `DIAGNOSTIC_RELOAD_DELAY_MS` | constant | `src/i18n.js:99` | Dev-only reload delay after diagnostic localStorage writes. |
| `getBaseLanguageCode` | function | `src/i18n.js:243` | Extract the lowercase base language code from a locale candidate. |
| `getI18nVersion` | function | `src/i18n.js:111` | Return cache-busting version token \(see header\). |
| `getImportMetaEnv` | function | `src/i18n.js:57` | Return Vite import.meta.env safely. |
| `getNormalizedSupportedLanguages` | function | `src/i18n.js:257` | Normalize configured supported languages to non-empty base language codes. |
| `getSafeWindow` | function | `src/i18n.js:40` | Return browser window safely in browser, SSR, test, and documentation contexts. |
| `getStaticI18nDefaults` | function | `src/i18n.js:217` | Compute app config &amp;amp; defaults safely. |
| `getUnsupportedVersionPlaceholders` | function | `src/i18n.js:173` | Find malformed version-like placeholders in loadPath without extra array passes. |
| `IS_DEV` | constant | `src/i18n.js:68` | Dev-mode detector \(Vite + Node envs\). |
| `normalizeSupportedLanguage` | function | `src/i18n.js:272` | Normalize an arbitrary language candidate to a supported base language. |
| `normalizeVersionToken` | function | `src/i18n.js:102` | Normalize optional version tokens from runtime config or globals. |
| `readQuery` | function | `src/i18n.js:73` | Read a query parameter by name \(no deps\). |
| `reloadAfterDiagnosticStorageWrite` | function | `src/i18n.js:196` | Refresh i18n resources after a diagnostic localStorage write. |
| `resolveInitialLanguage` | function | `src/i18n.js:302` | Resolve the initial UI language without relying on persisted i18next cache state. |
| `resolveLoadPath` | function | `src/i18n.js:390` | Resolve the final translation URL at request time \(with cache buster\). |
| `sanitizeI18nPathSegment` | function | `src/i18n.js:161` | Keep i18n URL template substitutions constrained to plain path segments. |
| `syncDocumentLanguage` | function | `src/i18n.js:353` | Keep the document language synchronized with the active UI language. |
| `WANT_DIAG` | constant | `src/i18n.js:82` | Diagnostics ON only in dev builds. |
| `container` | constant | `src/index.jsx:44` | Mount the app into #root. |
| `isDev` | constant | `src/index.jsx:34` | Determine environment and set a sensible client-side log level. |
| `BootstrapAny` | typedef | `src/integrations/bootstrapRuntime.js:44` |  |
| `BootstrapDebugInfo` | typedef | `src/integrations/bootstrapRuntime.js:33` | Opaque information about how startup data reached the viewer. |
| `bootstrapDetect` | function | `src/integrations/bootstrapRuntime.js:243` | Detect the best available bootstrap mode. |
| `BootstrapDetectOptions` | typedef | `src/integrations/bootstrapRuntime.js:58` | Options controlling bootstrap diagnostics collection. |
| `makeDebugInfo` | function | `src/integrations/bootstrapRuntime.js:117` | Build the debug envelope returned to the app shell. |
| `ODV_BOOTSTRAP_MODES` | constant | `src/integrations/bootstrapRuntime.js:24` | Canonical bootstrap modes. |
| `ODVHostApi` | typedef | `src/integrations/bootstrapRuntime.js:51` | Host API shape exposed on window.ODV. |
| `bootstrapDetect~probeParent` | function | `src/integrations/bootstrapRuntime.js:256` |  |
| `bootstrapDetect~probeSessionToken` | function | `src/integrations/bootstrapRuntime.js:284` |  |
| `bootstrapDetect~probeSessionUrl` | function | `src/integrations/bootstrapRuntime.js:270` |  |
| `<anonymous>~api.start` | function | `src/integrations/bootstrapRuntime.js:81` | Queue a start payload to be consumed by bootstrapDetect\(\). |
| `tryNormalizeBundle` | function | `src/integrations/bootstrapRuntime.js:94` | Try to normalize a candidate payload into a bundle with documents. |
| `normalizeToPortableBundle` | function | `src/integrations/normalizePortableBundle.js:116` | Normalize many incoming shapes to a neutral PortableDocumentBundle v1. |
| `PortableBundleMetadataAliasMap` | typedef | `src/integrations/normalizePortableBundle.js:94` | Runtime-configurable mapping between semantic metadata aliases and metadata record identifiers used by a host-specific object-document payload. |
| `PortableDocumentBundle` | typedef | `src/integrations/normalizePortableBundle.js:85` | A portable bundle groups a session and an array of document entries. |
| `PortableDocumentEntry` | typedef | `src/integrations/normalizePortableBundle.js:73` | A single document entry containing one or more files. |
| `PortableDocumentFile` | typedef | `src/integrations/normalizePortableBundle.js:27` | A single file reference inside a document. |
| `PortableMetadataAliasDetail` | typedef | `src/integrations/normalizePortableBundle.js:54` | One resolved semantic alias derived from raw metadata records. |
| `PortableMetadataRecord` | typedef | `src/integrations/normalizePortableBundle.js:38` | A normalized raw metadata record attached to a document. |
| `PortableSession` | typedef | `src/integrations/normalizePortableBundle.js:20` | Session info stored on a bundle. |
| `spreadUnknown` | function | `src/integrations/normalizePortableBundle.js:240` | Preserve unknown own enumerable properties from host input while excluding keys that were already normalized explicitly. |
| `b64DecodeUnicode` | function | `src/integrations/parentBridge.js:88` | Decode a base64-encoded Unicode string into text \(handles UTF-8\). |
| `getSameOriginOpener` | function | `src/integrations/parentBridge.js:52` | Try to obtain a same-origin opener window reference. |
| `getSameOriginParent` | function | `src/integrations/parentBridge.js:30` | Try to obtain a same-origin parent window reference. |
| `ParentBootstrapResult` | typedef | `src/integrations/parentBridge.js:15` | Result object when data is obtained from a same-origin parent. |
| `readFromOpener` | function | `src/integrations/parentBridge.js:168` | Attempt to read a bootstrap object from a same-origin opener. |
| `readFromParent` | function | `src/integrations/parentBridge.js:159` | Attempt to read a bootstrap object from a same-origin parent. |
| `readFromRelatedWindow` | function | `src/integrations/parentBridge.js:177` | Attempt to read a bootstrap object from a same-origin parent or opener. |
| `readFromWindow` | function | `src/integrations/parentBridge.js:107` | Attempt to read a bootstrap object from a same-origin related window. |
| `safeClone` | function | `src/integrations/parentBridge.js:73` | Perform a safe, structured clone of serializable data. |
| `b64DecodeUnicode` | function | `src/integrations/sessionToken.js:75` | Decode a Base64 string into a UTF-8 JavaScript string. |
| `MAX_B64_LEN` | constant | `src/integrations/sessionToken.js:34` | Upper bound for the Base64 token length \(~200 KB base64 ≈ 150 KB raw\). |
| `MAX_RAW_LEN` | constant | `src/integrations/sessionToken.js:36` | Upper bound for the decoded raw string length. |
| `normalizeBase64` | function | `src/integrations/sessionToken.js:54` | Normalize a Base64 string to a decodable form: Trim whitespace Convert URL-safe chars &#39;-&#39; → &#39;+&#39;, &#39;_&#39; → &#39;/&#39; Add &#39;=&#39; padding to reach a length divisible by 4 |
| `readFromSessionToken` | function | `src/integrations/sessionToken.js:104` | Read and decode a session payload from the URL query string. |
| `SessionTokenResult` | typedef | `src/integrations/sessionToken.js:38` | Session token read result. |
| `MAX_RESPONSE_TEXT_LEN` | constant | `src/integrations/sessionUrl.js:9` | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| `readFromSessionUrl` | function | `src/integrations/sessionUrl.js:85` | Read and fetch a session payload URL from the viewer query string. |
| `SessionUrlResult` | typedef | `src/integrations/sessionUrl.js:12` |  |
| `parsePositiveInt` | function | `src/integrations/urlParams.js:64` | Parse a positive integer from a string. |
| `pick` | function | `src/integrations/urlParams.js:51` | Pick the first non-empty value among a list of candidate query keys. |
| `readFromUrlParams` | function | `src/integrations/urlParams.js:83` | Reads common query params used by the demo and other hosts. |
| `UrlParamsData` | typedef | `src/integrations/urlParams.js:32` |  |
| `UrlParamsResult` | typedef | `src/integrations/urlParams.js:39` |  |
| `clearTimeoutSafe` | function | `src/integrations/viewerEvents.js:187` | Clear a timer if it exists \(tiny helper\). |
| `createCustomEvent` | function | `src/integrations/viewerEvents.js:56` | Create a CustomEvent with best-effort fallback for older browsers. |
| `emitODVEvent` | function | `src/integrations/viewerEvents.js:79` | Emit a namespaced OpenDocViewer event with an optional detail payload. |
| `ODVEventHandler` | typedef | `src/integrations/viewerEvents.js:29` | Listener signature for ODV events. |
| `OnceEventResult` | typedef | `src/integrations/viewerEvents.js:43` | Result returned by onceODVEvent when the event fires. |
| `onceODVEvent` | function | `src/integrations/viewerEvents.js:152` | Wait for a single occurrence of an event and resolve with { event, detail } . |
| `OnceOptions` | typedef | `src/integrations/viewerEvents.js:37` | Options for onceODVEvent. |
| `onODVEvent` | function | `src/integrations/viewerEvents.js:110` | Attach a listener for a given OpenDocViewer event. |
| `circularReplacer` | function | `src/logging/systemLogger.js:196` | Create a JSON replacer that: prevents circular references leaves values otherwise intact |
| `LogController#debug` | member | `src/logging/systemLogger.js:417` |  |
| `LogController#disableBackendLogging` | member | `src/logging/systemLogger.js:365` | Disable backend forwarding after a non-recoverable configuration/runtime failure. |
| `LogController#error` | member | `src/logging/systemLogger.js:426` |  |
| `LogController#info` | member | `src/logging/systemLogger.js:420` |  |
| `levelGte` | function | `src/logging/systemLogger.js:186` | Compare two log levels \(is a &amp;gt;= b ?\). |
| `LogController#log` | member | `src/logging/systemLogger.js:338` | Log a message with a given level and optional context. |
| `LOG_LEVELS` | constant | `src/logging/systemLogger.js:44` | Valid log levels in ascending verbosity. |
| `LogController` | class | `src/logging/systemLogger.js:210` | LogController — small facade around console + optional HTTP forwarding. |
| `logger` | constant | `src/logging/systemLogger.js:430` | Export a singleton instance \(sufficient for app usage\). |
| `LogLevel` | typedef | `src/logging/systemLogger.js:41` |  |
| `NOOP` | function | `src/logging/systemLogger.js:47` | No-op function used when we want to swallow calls cleanly. |
| `normalizeLevel` | function | `src/logging/systemLogger.js:175` | Normalize and validate a log level. |
| `readMeta` | function | `src/logging/systemLogger.js:54` | Resolve a string from a meta tag \(SSR-safe\). |
| `readMetaBool` | function | `src/logging/systemLogger.js:69` | Resolve a boolean from a meta tag content. |
| `readRuntimeConfig` | function | `src/logging/systemLogger.js:81` | Resolve a runtime config snapshot from runtime globals \(SSR-safe\). |
| `resolveAuthToken` | function | `src/logging/systemLogger.js:146` | Resolve the shared auth token used for posting to /log. |
| `resolveBackendUrl` | function | `src/logging/systemLogger.js:115` | Resolve a candidate backend URL using precedence rules and make it absolute relative to document.baseURI \(SSR-safe\). |
| `resolveEnabledOverride` | function | `src/logging/systemLogger.js:163` | Resolve an explicit &amp;quot;enabled&amp;quot; boolean if one exists. |
| `LogController#sendLogToBackend` | member | `src/logging/systemLogger.js:383` | Attempt to POST the log to the backend, with simple linear retries. |
| `LogController#setAuthToken` | member | `src/logging/systemLogger.js:311` | Update/replace the auth token used in &#39;x-log-token&#39;. |
| `LogController#setBackendUrl` | member | `src/logging/systemLogger.js:260` | Set the backend ingestion URL \(absolute or relative\). |
| `LogController#setHttpTimeout` | member | `src/logging/systemLogger.js:302` | Set axios timeout \(ms\) for backend posts. |
| `LogController#setLogLevel` | member | `src/logging/systemLogger.js:274` | Set the current log level. |
| `LogController#setLogToBackend` | member | `src/logging/systemLogger.js:247` | Enable/disable HTTP forwarding at runtime. |
| `LogController#setRetryInterval` | member | `src/logging/systemLogger.js:293` | Set retry interval \(ms\) for backend forwarding. |
| `LogController#setRetryLimit` | member | `src/logging/systemLogger.js:284` | Set retry limit for backend forwarding. |
| `LogController#shouldLog` | member | `src/logging/systemLogger.js:324` | Internal: should this level be logged at all \(console or backend\)? |
| `LogController#warn` | member | `src/logging/systemLogger.js:423` |  |
| `__DEV__` | constant | `src/logging/userLogger.js:59` | True when running in dev \(for debug logging only\). |
| `UserLogController#_captureCookieFingerprint` | function | `src/logging/userLogger.js:168` | Internal: hash document.cookie once \(non-blocking\). |
| `abToBase64` | function | `src/logging/userLogger.js:110` | Base64 from ArrayBuffer \(for cookie fingerprint\). |
| `BootContext` | typedef | `src/logging/userLogger.js:37` |  |
| `debug` | function | `src/logging/userLogger.js:62` | Dev-only logger. |
| `getRuntimeConfig` | function | `src/logging/userLogger.js:71` | Safely read runtime config from window. |
| `UserLogController#initContext` | function | `src/logging/userLogger.js:160` | Initialize context near iframe/viewer creation. |
| `isSameOrigin` | function | `src/logging/userLogger.js:91` | Determine if the target URL is same-origin with current document. |
| `PrintLogPayload` | typedef | `src/logging/userLogger.js:43` |  |
| `UserLogController#setUserResolver` | function | `src/logging/userLogger.js:142` | Optional identity resolver supplied by host app. |
| `UserLogController#setViewerVersion` | function | `src/logging/userLogger.js:150` | Optional viewer version to add in meta.viewerVersion. |
| `sha256Base64` | function | `src/logging/userLogger.js:120` | Async SHA-256 of a string → &amp;quot;sha256- &amp;quot; \(or null\). |
| `UserLogController#submitPrint` | function | `src/logging/userLogger.js:189` | Submit a &amp;quot;print&amp;quot; user-log event. |
| `toAbsoluteUrl` | function | `src/logging/userLogger.js:82` | Make absolute using document.baseURI when available. |
| `tzOffset` | function | `src/logging/userLogger.js:100` | Return timezone offset as &amp;quot;+HH:MM&amp;quot; or &amp;quot;-HH:MM&amp;quot;. |
| `UserIdentity` | typedef | `src/logging/userLogger.js:31` |  |
| `userLog` | constant | `src/logging/userLogger.js:306` | Export singleton instance. |
| `analyzePageIntegrity` | function | `src/PerformanceMonitor.jsx:103` | Check the flat viewer page list for ordering mistakes that would be user-visible. |
| `copyText` | function | `src/PerformanceMonitor.jsx:349` | Copy best-effort text to clipboard without throwing. |
| `countBundleMetaFields` | function | `src/PerformanceMonitor.jsx:305` |  |
| `describeValueType` | function | `src/PerformanceMonitor.jsx:218` |  |
| `downloadText` | function | `src/PerformanceMonitor.jsx:387` | Download best-effort text as a local file without throwing. |
| `formatCacheScope` | function | `src/PerformanceMonitor.jsx:194` |  |
| `formatDuration` | function | `src/PerformanceMonitor.jsx:46` |  |
| `formatTtl` | function | `src/PerformanceMonitor.jsx:182` |  |
| `getCaseIdCount` | function | `src/PerformanceMonitor.jsx:295` |  |
| `getPayloadTopLevelCount` | function | `src/PerformanceMonitor.jsx:285` |  |
| `isPlainObject` | function | `src/PerformanceMonitor.jsx:228` |  |
| `MemorySnapshot` | typedef | `src/PerformanceMonitor.jsx:26` |  |
| `PerformanceMonitor` | function | `src/PerformanceMonitor.jsx:417` | PerformanceMonitor component. |
| `resolveElapsedMs` | function | `src/PerformanceMonitor.jsx:207` |  |
| `safePrettyStringify` | function | `src/PerformanceMonitor.jsx:268` |  |
| `sanitizeForOverlay` | function | `src/PerformanceMonitor.jsx:242` | Redact auth-like values before showing transport payloads in the diagnostics HUD. |
| `summarizeBundleSources` | function | `src/PerformanceMonitor.jsx:318` |  |
| `PerformanceMonitor~tick` | constant | `src/PerformanceMonitor.jsx:475` |  |
| `toMB` | function | `src/PerformanceMonitor.jsx:37` |  |
| `PerformanceMonitor~updateMemory` | constant | `src/PerformanceMonitor.jsx:494` |  |
| `CreateBundleResult` | typedef | `src/schemas/portableBundle.js:82` | Result object for createPortableBundle |
| `createPortableBundle` | function | `src/schemas/portableBundle.js:343` | Convenience constructor: normalize → \(optionally validate\) → freeze. |
| `extFromString` | function | `src/schemas/portableBundle.js:107` | Extract lowercase file extension from a string \(best-effort\). |
| `freezePortableBundle` | function | `src/schemas/portableBundle.js:326` | Create a shallow, immutable copy of a normalized bundle \(Object.freeze tree\). |
| `normalizeDocumentEntry` | function | `src/schemas/portableBundle.js:225` | Normalize a single document entry. |
| `normalizeDocumentFile` | function | `src/schemas/portableBundle.js:197` | Normalize a file entry. |
| `normalizeMetadataAliasDetails` | function | `src/schemas/portableBundle.js:150` | Preserve a richer semantic alias object map without trying to deeply validate every property. |
| `normalizeMetadataAliases` | function | `src/schemas/portableBundle.js:126` | Normalize an alias-based metadata object to a predictable string map. |
| `normalizeMetadataIndex` | function | `src/schemas/portableBundle.js:172` | Preserve a raw metadata lookup map without imposing a rigid record schema here. |
| `normalizePortableBundle` | function | `src/schemas/portableBundle.js:253` | Normalize a bundle to a predictable, minimally validated shape: Ensures session.id and stringifies known fields. |
| `PORTABLE_BUNDLE_SCHEMA_VERSION` | constant | `src/schemas/portableBundle.js:29` | Schema version of this portable bundle definition. |
| `PortableDocumentBundle` | typedef | `src/schemas/portableBundle.js:65` | A portable bundle groups a session and an array of document entries. |
| `PortableDocumentEntry` | typedef | `src/schemas/portableBundle.js:53` | A single document entry containing one or more files. |
| `PortableDocumentFile` | typedef | `src/schemas/portableBundle.js:39` | A single file reference inside a document. |
| `PortableSession` | typedef | `src/schemas/portableBundle.js:31` | Session context for a bundle. |
| `toObject` | function | `src/schemas/portableBundle.js:98` | Coerce unknown input to a plain object \(or return null\). |
| `validatePortableBundle` | function | `src/schemas/portableBundle.js:283` | Validate a normalized \(or raw\) bundle. |
| `ValidateReport` | typedef | `src/schemas/portableBundle.js:74` | Validation report for a bundle. |
| `BumpPostZoom` | typedef | `src/types/jsdoc-types.js:84` | Step the per-pane post-zoom by ±0.1. |
| `DocumentRenderHandle` | typedef | `src/types/jsdoc-types.js:67` | Minimal imperative handle exposed by the page renderer for printing. |
| `FallbackRenderer` | typedef | `src/types/jsdoc-types.js:58` | Render function signature for ErrorBoundary fallbacks. |
| `PageDirection` | typedef | `src/types/jsdoc-types.js:52` | Direction token used by page timers / navigation. |
| `PostZoomApi` | typedef | `src/types/jsdoc-types.js:91` | Per-pane post-zoom API that augments the document viewer hook. |
| `RefLike` | typedef | `src/types/jsdoc-types.js:73` | Generic &amp;quot;ref-like&amp;quot; object \(for places where React.MutableRefObject is too specific\). |
| `SetBooleanState` | typedef | `src/types/jsdoc-types.js:36` | React-like state setter for booleans: accepts a boolean or an updater \(boolean\)-&amp;gt;boolean. |
| `SetNumber` | typedef | `src/types/jsdoc-types.js:22` | Simple number setter \(no updater function\). |
| `SetNumberState` | typedef | `src/types/jsdoc-types.js:7` | Generic React-like state setter for numbers: accepts either a number or an updater function \(number\)-&amp;gt;number. |
| `SetPageNumber` | typedef | `src/types/jsdoc-types.js:44` | React-like state setter for page number: accepts a number or an updater \(number\)-&amp;gt;number. |
| `SetString` | typedef | `src/types/jsdoc-types.js:29` | Simple string setter. |
| `SetStringNullable` | typedef | `src/types/jsdoc-types.js:15` | Setter for string-or-null values. |
| `ZoomMode` | typedef | `src/types/jsdoc-types.js:79` | Sticky zoom modes used by the viewer. |
| `countPdfPages` | function | `src/utils/documentLoadingConfig.js:504` | Count PDF pages in a page descriptor list. |
| `detectBrowserFamily` | function | `src/utils/documentLoadingConfig.js:166` |  |
| `DocumentLoadingAdaptiveMemoryConfig` | typedef | `src/utils/documentLoadingConfig.js:29` |  |
| `DocumentLoadingAssetStoreConfig` | typedef | `src/utils/documentLoadingConfig.js:70` |  |
| `DocumentLoadingConfig` | typedef | `src/utils/documentLoadingConfig.js:151` |  |
| `DocumentLoadingFetchConfig` | typedef | `src/utils/documentLoadingConfig.js:49` |  |
| `DocumentLoadingFetchStrategy` | typedef | `src/utils/documentLoadingConfig.js:21` |  |
| `DocumentLoadingMemoryPressureConfig` | typedef | `src/utils/documentLoadingConfig.js:132` |  |
| `DocumentLoadingMemoryPressureStage` | typedef | `src/utils/documentLoadingConfig.js:25` |  |
| `DocumentLoadingMode` | typedef | `src/utils/documentLoadingConfig.js:20` |  |
| `DocumentLoadingPdfWorkerPagePolicy` | typedef | `src/utils/documentLoadingConfig.js:119` |  |
| `DocumentLoadingRenderBackend` | typedef | `src/utils/documentLoadingConfig.js:23` |  |
| `DocumentLoadingRenderConfig` | typedef | `src/utils/documentLoadingConfig.js:86` |  |
| `DocumentLoadingRenderStrategy` | typedef | `src/utils/documentLoadingConfig.js:22` |  |
| `DocumentLoadingSourceStoreConfig` | typedef | `src/utils/documentLoadingConfig.js:59` |  |
| `DocumentLoadingWarningConfig` | typedef | `src/utils/documentLoadingConfig.js:40` |  |
| `formatBytes` | function | `src/utils/documentLoadingConfig.js:1006` |  |
| `formatCount` | function | `src/utils/documentLoadingConfig.js:1024` |  |
| `getPerformanceWindowPageCount` | function | `src/utils/documentLoadingConfig.js:833` | Return the page-count window where auto mode should still behave like the fast, eager path. |
| `getReportedCoreCount` | function | `src/utils/documentLoadingConfig.js:180` |  |
| `PdfToImageMode` | typedef | `src/utils/documentLoadingConfig.js:24` |  |
| `resolvePdfRenderConfigForPageCount` | function | `src/utils/documentLoadingConfig.js:588` | Return a render config with pdfToImageMode and pdfWorkerCount resolved for a known PDF page count. |
| `resolvePdfWorkerPlanForPageCount` | function | `src/utils/documentLoadingConfig.js:524` | Resolve the PDF page-worker policy for the current document size. |
| `resolveRecommendedRasterWorkerCount` | function | `src/utils/documentLoadingConfig.js:214` |  |
| `resolveRecommendedWorkerCount` | function | `src/utils/documentLoadingConfig.js:193` |  |
| `RuntimeMemoryTier` | typedef | `src/utils/documentLoadingConfig.js:19` |  |
| `shouldRecommendStopping` | function | `src/utils/documentLoadingConfig.js:1032` |  |
| `SourceStoreMode` | typedef | `src/utils/documentLoadingConfig.js:15` |  |
| `SourceStoreProtection` | typedef | `src/utils/documentLoadingConfig.js:16` |  |
| `StopRecommendationInput` | typedef | `src/utils/documentLoadingConfig.js:144` |  |
| `ThumbnailLoadingStrategy` | typedef | `src/utils/documentLoadingConfig.js:17` |  |
| `ThumbnailSourceStrategy` | typedef | `src/utils/documentLoadingConfig.js:18` |  |
| `buildAliasDetailRow` | function | `src/utils/documentMetadata.js:183` |  |
| `buildAliasLabelsByFieldId` | function | `src/utils/documentMetadata.js:209` |  |
| `buildDocumentMetadataMatrixView` | function | `src/utils/documentMetadata.js:341` | Build a session-wide metadata matrix with one row per document and one column per metadata field. |
| `buildDocumentMetadataView` | function | `src/utils/documentMetadata.js:311` | Build a UI-friendly projection of one document&#39;s metadata. |
| `buildDocumentRows` | function | `src/utils/documentMetadata.js:293` |  |
| `buildFieldPresentationHints` | function | `src/utils/documentMetadata.js:77` |  |
| `buildRowsFromMetadataAliases` | function | `src/utils/documentMetadata.js:274` |  |
| `buildRowsFromMetadataDetails` | function | `src/utils/documentMetadata.js:264` |  |
| `buildRowsFromRawMetadata` | function | `src/utils/documentMetadata.js:232` |  |
| `bundleDocumentHasMetadata` | function | `src/utils/documentMetadata.js:69` |  |
| `documentHasMetadata` | function | `src/utils/documentMetadata.js:55` |  |
| `getBundleDocumentById` | function | `src/utils/documentMetadata.js:44` |  |
| `isObject` | function | `src/utils/documentMetadata.js:14` |  |
| `normalizeStringArray` | function | `src/utils/documentMetadata.js:32` |  |
| `buildFieldPresentationHints~pushEntry` | function | `src/utils/documentMetadata.js:83` |  |
| `resolveMetadataLabel` | function | `src/utils/documentMetadata.js:129` | Resolve the label shown for one metadata row. |
| `resolveMetadataValue` | function | `src/utils/documentMetadata.js:161` |  |
| `toOptionalText` | function | `src/utils/documentMetadata.js:22` |  |
| `bytesToHex` | function | `src/utils/idUtils.js:17` |  |
| `createOpaqueId` | function | `src/utils/idUtils.js:56` | Create a prefixed opaque identifier. |
| `createOpaqueIdFragment` | function | `src/utils/idUtils.js:27` | Create an opaque identifier fragment suitable for synthetic keys and document ids. |
| `fallbackCounter` | member | `src/utils/idUtils.js:11` | OpenDocViewer — small opaque identifier helpers. |
| `I18nLike` | typedef | `src/utils/localizedValue.js:17` | Minimal shape of an i18n instance used by this module. |
| `I18nOptionsLike` | typedef | `src/utils/localizedValue.js:11` | A subset of the i18next options object we care about. |
| `LocalizedString` | typedef | `src/utils/localizedValue.js:2` | Localized string resolver for admin-supplied config values. |
| `OptionLike` | typedef | `src/utils/localizedValue.js:24` | Option-like shape used by the print reason selector. |
| `resolveLocalizedValue` | function | `src/utils/localizedValue.js:41` | Return the best string for the active language. |
| `resolveOptionLabel` | function | `src/utils/localizedValue.js:109` | Resolve a label for a reason option. |
| `getRuntimeMemoryProfile` | function | `src/utils/memoryProfile.js:63` |  |
| `readDeviceMemoryGb` | function | `src/utils/memoryProfile.js:24` |  |
| `readJsHeapLimitMiB` | function | `src/utils/memoryProfile.js:37` |  |
| `resolveTier` | function | `src/utils/memoryProfile.js:52` |  |
| `RuntimeMemoryProfile` | typedef | `src/utils/memoryProfile.js:12` |  |
| `RuntimeMemoryTier` | typedef | `src/utils/memoryProfile.js:10` |  |
| `clampPage` | function | `src/utils/navigationUtils.js:54` | Clamp a page number into \[1, totalPages\]. |
| `handleFirstPage` | constant | `src/utils/navigationUtils.js:124` | Navigate to the first page \(always sets page to 1\). |
| `handleLastPage` | constant | `src/utils/navigationUtils.js:149` | Navigate to the last page \(no-op if totalPages invalid\). |
| `handleNextPage` | constant | `src/utils/navigationUtils.js:94` | Navigate to the next page \(no-op if already at the last page\). |
| `handlePrevPage` | constant | `src/utils/navigationUtils.js:69` | Navigate to the previous page \(no-op if already at page 1\). |
| `isValidTotalPages` | function | `src/utils/navigationUtils.js:43` | Check whether totalPages looks valid \(&amp;gt;= 1\). |
| `toPositiveInt` | function | `src/utils/navigationUtils.js:31` | Coerce a value to a positive integer \(minimum 1\). |
| `createTrackedObjectUrl` | function | `src/utils/objectUrlRegistry.js:30` |  |
| `getTrackedObjectUrlCount` | function | `src/utils/objectUrlRegistry.js:75` |  |
| `isTrackedObjectUrl` | function | `src/utils/objectUrlRegistry.js:65` | Check whether a blob/object URL is still tracked as live by the viewer. |
| `revokeAllTrackedObjectUrls` | function | `src/utils/objectUrlRegistry.js:83` | Revoke every tracked object URL. |
| `revokeTrackedObjectUrl` | function | `src/utils/objectUrlRegistry.js:41` |  |
| `revokeTrackedObjectUrls` | function | `src/utils/objectUrlRegistry.js:54` |  |
| `PageAssetDescriptor` | typedef | `src/utils/pageAssetRenderer.js:34` |  |
| `PageAssetRendererOptions` | typedef | `src/utils/pageAssetRenderer.js:28` |  |
| `PageAssetRenderer#renderPageAsset` | function | `src/utils/pageAssetRenderer.js:635` | Render one requested page asset. |
| `RenderPageAssetOptions` | typedef | `src/utils/pageAssetRenderer.js:42` |  |
| `PageAssetRenderer#renderPdfPageAssetBatch` | function | `src/utils/pageAssetRenderer.js:509` | Render a PDF page set through the PDF worker pool as one partitioned batch. |
| `BlobLruCache` | class | `src/utils/pageAssetStore.js:170` |  |
| `PageAssetStore#cleanup` | function | `src/utils/pageAssetStore.js:455` |  |
| `PageAssetStore#cleanupStaleSessions` | function | `src/utils/pageAssetStore.js:499` |  |
| `createPageAssetStore` | function | `src/utils/pageAssetStore.js:211` |  |
| `createSessionId` | function | `src/utils/pageAssetStore.js:57` |  |
| `PageAssetStore#enqueueWrite` | function | `src/utils/pageAssetStore.js:333` |  |
| `PageAssetStore#ensureDb` | function | `src/utils/pageAssetStore.js:540` |  |
| `PageAssetStore#ensureKey` | function | `src/utils/pageAssetStore.js:549` |  |
| `BlobLruCache#get` | function | `src/utils/pageAssetStore.js:180` |  |
| `PageAssetStore#getAsset` | function | `src/utils/pageAssetStore.js:398` |  |
| `PageAssetStore#getIndexedDbRecord` | function | `src/utils/pageAssetStore.js:696` |  |
| `PageAssetStore#getStats` | function | `src/utils/pageAssetStore.js:281` |  |
| `hasIndexedDb` | function | `src/utils/pageAssetStore.js:33` |  |
| `hasWebCrypto` | function | `src/utils/pageAssetStore.js:44` |  |
| `PageAssetStore#makeIndexedDbRecord` | function | `src/utils/pageAssetStore.js:632` |  |
| `makeStorageKey` | function | `src/utils/pageAssetStore.js:26` |  |
| `PageAssetStore#maybePromote` | function | `src/utils/pageAssetStore.js:573` |  |
| `openAssetStoreDb` | function | `src/utils/pageAssetStore.js:101` |  |
| `PageAssetStore#PageAssetStore` | class | `src/utils/pageAssetStore.js:219` |  |
| `PageAssetStoreStats` | typedef | `src/utils/pageAssetStore.js:121` |  |
| `PageAssetStore#promoteToIndexedDb` | function | `src/utils/pageAssetStore.js:322` | Force promotion to IndexedDB for the current session when supported. |
| `PageAssetStore#putAsset` | function | `src/utils/pageAssetStore.js:343` |  |
| `PageAssetStore#putIndexedDbEntry` | function | `src/utils/pageAssetStore.js:617` |  |
| `PutPageAssetOptions` | typedef | `src/utils/pageAssetStore.js:154` |  |
| `PageAssetStore#ready` | function | `src/utils/pageAssetStore.js:272` |  |
| `PageAssetStore#recordToBlob` | function | `src/utils/pageAssetStore.js:728` |  |
| `PageAssetStore#recordToMeta` | function | `src/utils/pageAssetStore.js:675` |  |
| `requestToPromise` | function | `src/utils/pageAssetStore.js:79` |  |
| `BlobLruCache#set` | function | `src/utils/pageAssetStore.js:193` |  |
| `StoredPageAssetMeta` | typedef | `src/utils/pageAssetStore.js:138` |  |
| `PageAssetStore#touchIndexedDbRecord` | function | `src/utils/pageAssetStore.js:710` |  |
| `transactionDone` | function | `src/utils/pageAssetStore.js:90` |  |
| `PageAssetStore#updateConfig` | function | `src/utils/pageAssetStore.js:308` | Update runtime thresholds for the active session. |
| `PageAssetWorkerPool#allocateTaskId` | function | `src/utils/pageAssetWorkerPool.js:156` |  |
| `PageAssetWorkerPool#canRender` | function | `src/utils/pageAssetWorkerPool.js:128` |  |
| `createPageAssetWorkerPool` | function | `src/utils/pageAssetWorkerPool.js:51` |  |
| `PageAssetWorkerPool#dispose` | function | `src/utils/pageAssetWorkerPool.js:298` |  |
| `PageAssetWorkerPool#getWorkerCount` | function | `src/utils/pageAssetWorkerPool.js:119` |  |
| `PageAssetWorkerPool#handleError` | function | `src/utils/pageAssetWorkerPool.js:267` |  |
| `PageAssetWorkerPool#handleMessage` | function | `src/utils/pageAssetWorkerPool.js:226` |  |
| `isRasterExt` | function | `src/utils/pageAssetWorkerPool.js:59` |  |
| `PageAssetWorkerEntry` | typedef | `src/utils/pageAssetWorkerPool.js:19` |  |
| `PageAssetWorkerPool#PageAssetWorkerPool` | class | `src/utils/pageAssetWorkerPool.js:82` |  |
| `PageAssetWorkerPoolOptions` | typedef | `src/utils/pageAssetWorkerPool.js:11` |  |
| `PendingWorkerTask` | typedef | `src/utils/pageAssetWorkerPool.js:27` |  |
| `PageAssetWorkerPool#pump` | function | `src/utils/pageAssetWorkerPool.js:176` |  |
| `PageAssetWorkerPool#renderAsset` | function | `src/utils/pageAssetWorkerPool.js:140` |  |
| `WorkerTaskInput` | typedef | `src/utils/pageAssetWorkerPool.js:36` |  |
| `addBatchSizeCandidate` | function | `src/utils/pdfBenchmark.js:156` | Keep a batch-size list ordered and unique. |
| `addPhaseDuration` | function | `src/utils/pdfBenchmark.js:570` |  |
| `addPhaseDurations` | function | `src/utils/pdfBenchmark.js:661` |  |
| `addScenario` | function | `src/utils/pdfBenchmark.js:237` |  |
| `calculateTransitionPhaseDurations` | function | `src/utils/pdfBenchmark.js:584` | Convert progress markers into phase durations by measuring time between phase transitions. |
| `createBenchmarkScenarios` | function | `src/utils/pdfBenchmark.js:413` |  |
| `createEmptyPhaseDurations` | function | `src/utils/pdfBenchmark.js:546` |  |
| `createFocusedBenchmarkScenarios` | function | `src/utils/pdfBenchmark.js:326` | Create a compact benchmark matrix that answers the important tuning questions without spending most of the run on combinations that are already known to be poor: single worker vs... |
| `createMatrixBenchmarkScenarios` | function | `src/utils/pdfBenchmark.js:259` |  |
| `createScenarioKey` | function | `src/utils/pdfBenchmark.js:221` |  |
| `createScenarioLabel` | function | `src/utils/pdfBenchmark.js:208` |  |
| `createScenarioPdfConfig` | function | `src/utils/pdfBenchmark.js:425` |  |
| `delay` | function | `src/utils/pdfBenchmark.js:771` |  |
| `describeBenchmarkBatchPlan` | function | `src/utils/pdfBenchmark.js:182` | Describe the actual batch plan for one benchmark run. |
| `describeScenarioPlan` | function | `src/utils/pdfBenchmark.js:466` |  |
| `expandBenchmarkBatchSizes` | function | `src/utils/pdfBenchmark.js:502` | Expand configured benchmark sizes with values near the current auto plan. |
| `finalizePhaseSpans` | function | `src/utils/pdfBenchmark.js:644` |  |
| `finiteNumberOrNull` | function | `src/utils/pdfBenchmark.js:529` |  |
| `groupEventsByNumericKey` | function | `src/utils/pdfBenchmark.js:612` |  |
| `isPdfBenchmarkEnabled` | function | `src/utils/pdfBenchmark.js:762` |  |
| `normalizeBatchCounts` | function | `src/utils/pdfBenchmark.js:74` |  |
| `normalizeBatchSizes` | function | `src/utils/pdfBenchmark.js:57` |  |
| `normalizeBenchmarkConfig` | function | `src/utils/pdfBenchmark.js:736` |  |
| `normalizeInteger` | function | `src/utils/pdfBenchmark.js:47` |  |
| `normalizeIntegerList` | function | `src/utils/pdfBenchmark.js:93` |  |
| `normalizeMergeModes` | function | `src/utils/pdfBenchmark.js:127` |  |
| `normalizeProfile` | function | `src/utils/pdfBenchmark.js:144` |  |
| `normalizeStrategies` | function | `src/utils/pdfBenchmark.js:110` |  |
| `normalizeTimingPhase` | function | `src/utils/pdfBenchmark.js:538` |  |
| `recordPhaseSpan` | function | `src/utils/pdfBenchmark.js:556` |  |
| `resolveBenchmarkWorkerPolicy` | function | `src/utils/pdfBenchmark.js:168` | Resolve the PDF worker count with the same policy as generated-PDF output. |
| `roundMilliseconds` | function | `src/utils/pdfBenchmark.js:521` |  |
| `runPdfGenerationBenchmark` | function | `src/utils/pdfBenchmark.js:816` |  |
| `selectBenchmarkPages` | function | `src/utils/pdfBenchmark.js:796` |  |
| `summarizeBenchmarkTiming` | function | `src/utils/pdfBenchmark.js:672` |  |
| `summarizeTaskDurations` | function | `src/utils/pdfBenchmark.js:628` |  |
| `PDFJS_WASM_BASE_URL` | constant | `src/utils/pdfjsDocumentOptions.js:8` | Shared pdf.js document-loading options. |
| `withPdfJsDocumentOptions` | function | `src/utils/pdfjsDocumentOptions.js:21` |  |
| `PdfPageWorkerEntry` | typedef | `src/utils/pdfPageWorkerPool.js:50` |  |
| `PdfPageWorkerPool#PdfPageWorkerPool` | class | `src/utils/pdfPageWorkerPool.js:66` |  |
| `PdfPageWorkerPoolOptions` | typedef | `src/utils/pdfPageWorkerPool.js:43` |  |
| `buildSelectedOptionDetails` | function | `src/utils/pdfPrebuildPlan.js:138` |  |
| `clampInteger` | function | `src/utils/pdfPrebuildPlan.js:28` |  |
| `createPdfPrebuildAllPagesVariants` | function | `src/utils/pdfPrebuildPlan.js:289` | Create all cacheable all-pages PDF variant descriptors for a runtime config. |
| `createPdfPrebuildVariantKey` | function | `src/utils/pdfPrebuildPlan.js:334` |  |
| `createPrintFormatVariant` | function | `src/utils/pdfPrebuildPlan.js:214` |  |
| `createReasonVariants` | function | `src/utils/pdfPrebuildPlan.js:189` |  |
| `getActiveLanguageKey` | function | `src/utils/pdfPrebuildPlan.js:254` |  |
| `getPdfPrebuildAllPagesLanguageDependency` | function | `src/utils/pdfPrebuildPlan.js:269` | Return the language dependency that should invalidate an all-pages prebuild run. |
| `getReasonOptions` | function | `src/utils/pdfPrebuildPlan.js:178` |  |
| `isNonEmptyObject` | function | `src/utils/pdfPrebuildPlan.js:38` |  |
| `normalizeCopyMarkerStates` | function | `src/utils/pdfPrebuildPlan.js:64` |  |
| `normalizeLanguageList` | function | `src/utils/pdfPrebuildPlan.js:46` |  |
| `normalizePdfOrientationMode` | function | `src/utils/pdfPrebuildPlan.js:88` |  |
| `normalizePdfPrebuildAllPagesConfig` | function | `src/utils/pdfPrebuildPlan.js:156` |  |
| `resolveOptionPrintText` | function | `src/utils/pdfPrebuildPlan.js:116` | Resolve the string that should be used on physical print output for an option. |
| `resolvePrebuildPdfOrientation` | function | `src/utils/pdfPrebuildPlan.js:98` |  |
| `resolveVariantLanguageContext` | function | `src/utils/pdfPrebuildPlan.js:245` |  |
| `canReuseGeneratedPdfPrint` | function | `src/utils/pdfPrintCacheKey.js:101` | Active-page PDF output is based on the current rendered surface, including transient client-side edits such as rotation, brightness and contrast. |
| `getPdfPrintCacheKey` | function | `src/utils/pdfPrintCacheKey.js:75` | Compare the content-affecting print settings that determine whether an existing generated PDF can be reused. |
| `getPdfPrintCacheKeyOptions` | function | `src/utils/pdfPrintCacheKey.js:31` |  |
| `isFullSessionPageSequence` | function | `src/utils/pdfPrintCacheKey.js:110` |  |
| `isPdfPrintCacheLanguageIgnored` | function | `src/utils/pdfPrintCacheKey.js:52` |  |
| `normalizePdfPrintCacheLanguageMode` | function | `src/utils/pdfPrintCacheKey.js:21` |  |
| `normalizePdfPrintCachePageNumbers` | function | `src/utils/pdfPrintCacheKey.js:60` |  |
| `stablePrintText` | function | `src/utils/pdfPrintCacheKey.js:13` |  |
| `batchProgressUnitsFromEvent` | function | `src/utils/pdfWorkerDispatcher.js:156` | Convert worker phases to deterministic job units: 1 unit for loading the PDF engine per batch 1 unit per loaded page image 1 unit per generated page 1 unit for finalizing each par... |
| `clampInteger` | function | `src/utils/pdfWorkerDispatcher.js:41` |  |
| `clampNumber` | function | `src/utils/pdfWorkerDispatcher.js:114` |  |
| `countBatchJobUnits` | function | `src/utils/pdfWorkerDispatcher.js:124` |  |
| `createBatchJob` | function | `src/utils/pdfWorkerDispatcher.js:276` |  |
| `createPdfProgressPlan` | function | `src/utils/pdfWorkerDispatcher.js:135` |  |
| `createPdfWithWorkerDispatcher` | function | `src/utils/pdfWorkerDispatcher.js:382` | Dispatch generated-PDF work to the worker layer. |
| `mergePdfBlobs` | function | `src/utils/pdfWorkerDispatcher.js:361` |  |
| `mergePdfBlobsSinglePass` | function | `src/utils/pdfWorkerDispatcher.js:319` |  |
| `PdfWorkerBatch` | typedef | `src/utils/pdfWorkerDispatcher.js:16` |  |
| `PdfWorkerPlan` | typedef | `src/utils/pdfWorkerDispatcher.js:23` |  |
| `planPdfWorkerBatches` | function | `src/utils/pdfWorkerDispatcher.js:78` | Split pages into worker tasks. |
| `progressValueFromWorkerEvent` | function | `src/utils/pdfWorkerDispatcher.js:297` |  |
| `resolveAutoPdfWorkerBatchSize` | function | `src/utils/pdfWorkerDispatcher.js:56` | Pick a conservative future batch size from a pages-per-worker target. |
| `runLimitedTasks` | function | `src/utils/pdfWorkerDispatcher.js:188` | Run async work with a small in-process dispatcher. |
| `runPdfWorkerTask` | function | `src/utils/pdfWorkerDispatcher.js:217` |  |
| `sumProgress` | function | `src/utils/pdfWorkerDispatcher.js:308` |  |
| `throwIfAborted` | function | `src/utils/pdfWorkerDispatcher.js:101` |  |
| `escapeMetaName` | function | `src/utils/performanceOverlayFlag.js:14` |  |
| `isPerformanceOverlayEnabled` | function | `src/utils/performanceOverlayFlag.js:72` | Determine whether the diagnostics/performance overlay is enabled. |
| `readRuntimeBooleanFlag` | function | `src/utils/performanceOverlayFlag.js:34` | Resolve a boolean flag from \(precedence order\): window. |
| `collectAllPrintableDataUrlsFromDom` | function | `src/utils/printCore.js:390` | Collect printable image sources from the DOM as a fallback when the renderer handle cannot provide an explicit all-pages list. |
| `createHiddenIframe` | function | `src/utils/printCore.js:235` | Create the temporary hidden iframe used as the print document host. |
| `getODVConfig` | function | `src/utils/printCore.js:194` | Read runtime configuration from the globals populated by public/odv.config.js . |
| `getPrintableDataUrl` | function | `src/utils/printCore.js:145` | Safely derive a printable data URL from an element that is either a or an . |
| `handlePrint` | function | `src/utils/printCore.js:270` | Handles the print functionality for the CURRENT page/image. |
| `handlePrintAll` | function | `src/utils/printCore.js:443` | Print all available pages in viewer order. |
| `handlePrintCurrentComparison` | function | `src/utils/printCore.js:339` | Print both currently visible compare panes as a two-page print job. |
| `handlePrintRange` | function | `src/utils/printCore.js:585` | Print an inclusive page range. |
| `handlePrintSequence` | function | `src/utils/printCore.js:516` | Print an explicit page sequence such as 3,1,2 . |
| `HiddenIframe` | typedef | `src/utils/printCore.js:89` | Return type for the hidden-iframe factory. |
| `isVisiblyMeasurable` | function | `src/utils/printCore.js:103` | Check whether a candidate element is both present in layout and not hidden by basic CSS visibility. |
| `PageRange` | typedef | `src/utils/printCore.js:50` | A 1-based inclusive page range. |
| `pickLargestVisibleElement` | function | `src/utils/printCore.js:120` | Best-effort: pick the largest visible or inside a container \(or document\). |
| `PrintAllOptions` | typedef | `src/utils/printCore.js:57` | Options for printing multiple pages \(all/range/sequence\). |
| `PrintCandidate` | typedef | `src/utils/printCore.js:70` | Internal: candidate node for &amp;quot;largest visible&amp;quot; heuristics. |
| `PrintHeaderCfg` | typedef | `src/utils/printCore.js:77` | Print header config \(runtime\) consumed by the print overlay logic. |
| `PrintOptions` | typedef | `src/utils/printCore.js:37` | Options for single-page printing. |
| `resolveActiveNode` | function | `src/utils/printCore.js:217` | Attempt to resolve the currently active visual node to print. |
| `resolveAllPageDataUrls` | function | `src/utils/printCore.js:409` | Resolve all printable page URLs, preferring the renderer&#39;s imperative API and falling back to DOM inspection. |
| `resolveOrientation` | function | `src/utils/printCore.js:180` | Compute page orientation from dimensions when options.orientation === &#39;auto&#39;. |
| `buildOverlayElement` | function | `src/utils/printDom.js:227` | Build a header/footer DIV element for a page using config + tokens. |
| `buildPrintCss` | function | `src/utils/printDom.js:134` | Build the print-only CSS string \(inlined within the print iframe\). |
| `buildPrintFormatElements` | function | `src/utils/printDom.js:275` | Build configured print-format header/watermark elements for a page. |
| `enabled` | function | `src/utils/printDom.js:123` |  |
| `ensureBody` | function | `src/utils/printDom.js:202` |  |
| `ensureHead` | function | `src/utils/printDom.js:176` |  |
| `mergeOverlayCss` | function | `src/utils/printDom.js:404` |  |
| `normalizeApplyTo` | function | `src/utils/printDom.js:85` | Normalize runtime overlay application mode. |
| `normalizeNonNegativeNumber` | function | `src/utils/printDom.js:75` | Normalize an unknown configuration value to a non-negative number. |
| `normalizePageOrientation` | function | `src/utils/printDom.js:106` |  |
| `normalizeTrustedExtraCss` | function | `src/utils/printDom.js:115` |  |
| `populateBodyAndPrint` | function | `src/utils/printDom.js:349` | Attach pages and images into the \(cleared\) body, wait for image terminal states, then print. |
| `PrintOverlayCfg` | typedef | `src/utils/printDom.js:24` | Print overlay config \(runtime\) consumed by the print overlay logic. |
| `renderMultiDocument` | function | `src/utils/printDom.js:453` | Render a multi-page print document in the given print iframe document. |
| `renderSingleDocument` | function | `src/utils/printDom.js:424` | Render a single-page print document in the given print iframe document. |
| `shouldApplyOverlay` | function | `src/utils/printDom.js:96` |  |
| `TokenContext` | typedef | `src/utils/printDom.js:36` | Token context used by templates. |
| `tr` | function | `src/utils/printDom.js:62` | Tiny helper to translate with safe fallback. |
| `waitForImagesToLoad` | function | `src/utils/printDom.js:311` |  |
| `parsePrintSequence` | function | `src/utils/printParse.js:48` | Parse &amp;quot;Custom pages&amp;quot; into a sequence. |
| `ParseResult` | typedef | `src/utils/printParse.js:15` | Result of parsing a custom pages string. |
| `tr` | function | `src/utils/printParse.js:30` | Tiny helper to translate with safe fallback. |
| `addImageWithFallback` | function | `src/utils/printPdf.js:967` |  |
| `appendRichColumnLine` | function | `src/utils/printPdf.js:591` |  |
| `appendRichLineBreak` | function | `src/utils/printPdf.js:552` |  |
| `appendRichText` | function | `src/utils/printPdf.js:562` |  |
| `asNumber` | function | `src/utils/printPdf.js:216` | Convert a value to a finite number for PDF layout calculations. |
| `blobToDataUrl` | function | `src/utils/printPdf.js:2224` |  |
| `buildPdfPagePlans` | function | `src/utils/printPdf.js:1559` |  |
| `calculateOverlayReserve` | function | `src/utils/printPdf.js:1604` |  |
| `canvasToBlob` | function | `src/utils/printPdf.js:2209` |  |
| `canvasToPngDataUrl` | function | `src/utils/printPdf.js:2195` | Convert a canvas to a PNG data URL without using synchronous toDataURL when browser support for async toBlob is available. |
| `clamp01` | function | `src/utils/printPdf.js:241` | Clamp a numeric value to the inclusive 0..1 range. |
| `collectPrintablePdfSources` | function | `src/utils/printPdf.js:2117` | Collect printable page image URLs without creating or opening a PDF. |
| `createAbortError` | function | `src/utils/printPdf.js:248` |  |
| `createDefaultSegment` | function | `src/utils/printPdf.js:1143` |  |
| `createJsPdfOptions` | function | `src/utils/printPdf.js:1040` |  |
| `createPdfFromDocumentHandle` | function | `src/utils/printPdf.js:2141` |  |
| `createPrintPdfBlob` | function | `src/utils/printPdf.js:1662` | Build a PDF blob from page image URLs and print metadata. |
| `createPrintPdfBlobInWorker` | function | `src/utils/printPdf.js:1580` |  |
| `describeImageSource` | function | `src/utils/printPdf.js:796` |  |
| `describeModuleExports` | function | `src/utils/printPdf.js:1629` |  |
| `describeValueType` | function | `src/utils/printPdf.js:822` |  |
| `downloadPdfBlob` | function | `src/utils/printPdf.js:1814` |  |
| `drawRichSegments` | function | `src/utils/printPdf.js:1359` |  |
| `drawRichTextBlock` | function | `src/utils/printPdf.js:1382` |  |
| `drawWatermark` | function | `src/utils/printPdf.js:1414` |  |
| `drawWatermarkImage` | function | `src/utils/printPdf.js:1461` | Draw a prepared transparent PNG watermark, scaled to page width and centered. |
| `elementMatchesClassSelectorPart` | function | `src/utils/printPdf.js:358` |  |
| `ensureWritableRichLine` | function | `src/utils/printPdf.js:544` |  |
| `escapeRegExp` | function | `src/utils/printPdf.js:28` | Escape regular-expression metacharacters in literal text. |
| `executeOutputAction` | function | `src/utils/printPdf.js:2024` |  |
| `fitRichSegmentsToWidth` | function | `src/utils/printPdf.js:1184` |  |
| `fitRichSegmentTextToWidth` | function | `src/utils/printPdf.js:1154` |  |
| `flattenRichLines` | function | `src/utils/printPdf.js:611` |  |
| `getElementStyleHints` | function | `src/utils/printPdf.js:419` |  |
| `getImageDimension` | function | `src/utils/printPdf.js:940` |  |
| `getRichLineColumns` | function | `src/utils/printPdf.js:1073` |  |
| `getSelectedPrintableDataUrls` | function | `src/utils/printPdf.js:2059` | Read printable page image URLs from the document renderer. |
| `handlePdfCurrent` | function | `src/utils/printPdf.js:2245` | Generate/print/download a PDF from the currently rendered active page surface. |
| `handlePdfCurrentComparison` | function | `src/utils/printPdf.js:2268` | Generate/print/download a two-page PDF from the currently rendered comparison surfaces. |
| `handlePdfOutput` | function | `src/utils/printPdf.js:2152` |  |
| `htmlToRichLines` | function | `src/utils/printPdf.js:635` | Parse a small, print-template-oriented HTML subset into styled text lines for jsPDF. |
| `imageExtensionFromUrl` | function | `src/utils/printPdf.js:893` |  |
| `imageFormatAttempts` | function | `src/utils/printPdf.js:951` |  |
| `imageToJpegDataUrl` | function | `src/utils/printPdf.js:914` | Convert image to a JPEG data URL only as a last-resort fallback when jsPDF cannot consume the original image element/format directly. |
| `inferImageFormat` | function | `src/utils/printPdf.js:878` |  |
| `isBlockNode` | function | `src/utils/printPdf.js:435` | Check whether an HTML node name should be treated as block-level in PDF text flow. |
| `isBoldFontWeight` | function | `src/utils/printPdf.js:292` | Check whether a CSS font-weight value should be treated as bold text. |
| `layoutRichColumns` | function | `src/utils/printPdf.js:1228` |  |
| `loadImage` | function | `src/utils/printPdf.js:746` |  |
| `loadImagesConcurrently` | function | `src/utils/printPdf.js:837` |  |
| `loadJsPdf` | function | `src/utils/printPdf.js:1642` | Dynamically load the jsPDF constructor used by generated PDF output. |
| `makeTokenContext` | function | `src/utils/printPdf.js:1495` |  |
| `measureRichSegment` | function | `src/utils/printPdf.js:1122` |  |
| `measureRichSegments` | function | `src/utils/printPdf.js:1134` |  |
| `normalizePdfOrientationMode` | function | `src/utils/printPdf.js:999` |  |
| `normalizeQuality` | function | `src/utils/printPdf.js:228` | Normalize canvas/PDF image quality to the browser-supported 0..1 range. |
| `normalizeRichLine` | function | `src/utils/printPdf.js:1097` |  |
| `normalizeRichSegments` | function | `src/utils/printPdf.js:1056` |  |
| `pageFormatForImage` | function | `src/utils/printPdf.js:1028` |  |
| `pageNumberToIndex` | function | `src/utils/printPdf.js:2128` | Convert a 1-based printable page number into the matching 0-based data URL index. |
| `parseTemplateCssClassSelector` | function | `src/utils/printPdf.js:334` | Parse a supported class-only selector into descendant selector parts. |
| `parseTemplateCssStyleRules` | function | `src/utils/printPdf.js:397` | Parse only the small CSS subset used by trusted print header/footer templates. |
| `parseTextStyleDeclarations` | function | `src/utils/printPdf.js:304` |  |
| `PdfPrintOptions` | typedef | `src/utils/printPdf.js:156` |  |
| `PdfRichColumn` | typedef | `src/utils/printPdf.js:199` |  |
| `PdfRichLine` | typedef | `src/utils/printPdf.js:207` |  |
| `PdfRichSegment` | typedef | `src/utils/printPdf.js:191` |  |
| `PdfTemplateCssStyleRule` | typedef | `src/utils/printPdf.js:185` |  |
| `PdfTextStyleHints` | typedef | `src/utils/printPdf.js:175` |  |
| `printableSourceFromElement` | function | `src/utils/printPdf.js:2168` | Extract a safe printable image source from an already-rendered canvas or image element. |
| `printPdfBlob` | function | `src/utils/printPdf.js:1834` | Print a generated PDF through a hidden iframe. |
| `renderOverlayRichLines` | function | `src/utils/printPdf.js:730` |  |
| `reportProgress` | function | `src/utils/printPdf.js:1510` |  |
| `resolveJsPdfConstructor` | function | `src/utils/printPdf.js:1616` | Resolve jsPDF from common ESM/CJS export shapes used by bundlers. |
| `resolvePdfImageLoadConcurrency` | function | `src/utils/printPdf.js:1523` |  |
| `resolvePdfOrientationMode` | function | `src/utils/printPdf.js:1009` |  |
| `resolvePdfWorkerPlan` | function | `src/utils/printPdf.js:1536` | Resolve the generated-PDF worker plan. |
| `richLineHasText` | function | `src/utils/printPdf.js:513` |  |
| `richLineIsEmpty` | function | `src/utils/printPdf.js:521` |  |
| `sanitizeDiagnosticText` | function | `src/utils/printPdf.js:809` |  |
| `sanitizeParsedTemplateDocument` | function | `src/utils/printPdf.js:498` | Keep only the attributes used by the generated-PDF rich text subset. |
| `sanitizeTemplateHtmlForPdf` | function | `src/utils/printPdf.js:484` | Keep generated-PDF print templates inside the small rich-text subset consumed below. |
| `segmentFontStyle` | function | `src/utils/printPdf.js:1109` |  |
| `selectPageContexts` | function | `src/utils/printPdf.js:2014` |  |
| `stripDisallowedTemplateElements` | function | `src/utils/printPdf.js:447` | Remove elements that are never meaningful in generated PDF header/footer text. |
| `swapRichLineBufferContents` | function | `src/utils/printPdf.js:533` | Replace one line buffer with another while preserving the original array object. |
| `templateCssRuleMatchesElement` | function | `src/utils/printPdf.js:367` |  |
| `throwIfAborted` | function | `src/utils/printPdf.js:265` | Stop PDF generation as soon as the caller cancels the operation. |
| `htmlToRichLines~walk` | function | `src/utils/printPdf.js:650` |  |
| `warnDeprecatedPrintableUrlExportAlias` | function | `src/utils/printPdf.js:2040` |  |
| `wrapRichLines` | function | `src/utils/printPdf.js:1309` |  |
| `yieldToBrowser` | function | `src/utils/printPdf.js:275` | Yield one browser paint opportunity so progress updates become visible before expensive synchronous jsPDF operations run on the main thread. |
| `isSafeImageSrc` | function | `src/utils/printSanitize.js:16` | Allow-list image sources used for printing. |
| `applyBraceTokensEscaped` | function | `src/utils/printTemplate.js:649` |  |
| `applyConditionalBlocks` | function | `src/utils/printTemplate.js:720` | Resolve conditional blocks of the form \[\[{{path}}, &amp;quot;content&amp;quot;\]\]. |
| `applyLegacyTokensEscaped` | function | `src/utils/printTemplate.js:749` | Expand legacy ${...} tokens. |
| `applyTemplateTokensEscaped` | function | `src/utils/printTemplate.js:798` | Perform safe token substitution for print templates. |
| `buildMetadataTokenMap` | function | `src/utils/printTemplate.js:326` | Build a generic metadata lookup map from raw metadata, aliases and details. |
| `buildSessionTokenAliases` | function | `src/utils/printTemplate.js:407` |  |
| `convertNewlinesToBreaks` | function | `src/utils/printTemplate.js:737` | Convert template newlines to HTML line breaks after token expansion. |
| `decodeTemplateLiteral` | function | `src/utils/printTemplate.js:660` | Decode the small string literal grammar used inside conditional blocks. |
| `escapeHtmlSegment` | function | `src/utils/printTemplate.js:30` | Escape raw text characters for HTML text context. |
| `findCaseInsensitiveKey` | function | `src/utils/printTemplate.js:222` |  |
| `findFirstPresentText` | function | `src/utils/printTemplate.js:208` | Return the first present text value from an iterable collection. |
| `formatDateTokens` | function | `src/utils/printTemplate.js:105` | Format the built-in print date tokens. |
| `getByPath` | function | `src/utils/printTemplate.js:252` | Resolve a dotted-path property from an object \(e.g., &amp;quot;doc.title&amp;quot;\). |
| `hasPrintableValue` | function | `src/utils/printTemplate.js:143` | Treat null-like host values as absent so conditional blocks suppress their whole label/value pair. |
| `isPlainObject` | function | `src/utils/printTemplate.js:123` |  |
| `isPresentText` | function | `src/utils/printTemplate.js:199` | Test whether optionalText returned a usable string. |
| `makeBaseTokenContext` | function | `src/utils/printTemplate.js:474` | Build the base token context used by print templates. |
| `makePageTokenContext` | function | `src/utils/printTemplate.js:526` | Derive a page-specific token context by adding the document metadata tied to one printed page. |
| `normalizeDocumentOrdinal` | function | `src/utils/printTemplate.js:372` | Normalize host document numbers to the print-template convention. |
| `normalizePositiveInteger` | function | `src/utils/printTemplate.js:133` | Normalize page/document counters to a non-negative integer. |
| `ODVPrintWindow` | typedef | `src/utils/printTemplate.js:451` | Window-level values optionally supplied by embedding hosts. |
| `optionalText` | function | `src/utils/printTemplate.js:188` |  |
| `parseTokenExpression` | function | `src/utils/printTemplate.js:579` | Parse a token expression: path or path\|\|fallbackLiteral. |
| `putMetadataValue` | function | `src/utils/printTemplate.js:313` | Store a metadata value under a safe, useful key if that key is not already populated. |
| `resolveBundleDocumentForPage` | function | `src/utils/printTemplate.js:382` |  |
| `resolveCopyMarkerText` | function | `src/utils/printTemplate.js:235` | Resolve the configured copy/print-format marker text consistently across print backends. |
| `resolveMetadataRecordKey` | function | `src/utils/printTemplate.js:286` |  |
| `resolveMetadataRecordLabel` | function | `src/utils/printTemplate.js:295` |  |
| `resolveMetadataRecordValue` | function | `src/utils/printTemplate.js:277` |  |
| `resolvePriorityObjectValueText` | function | `src/utils/printTemplate.js:159` | Resolve the first printable display value from a host-supplied metadata object. |
| `resolveTokenExpressionEscaped` | function | `src/utils/printTemplate.js:637` |  |
| `tryGetDocumentMetadata` | function | `src/utils/printTemplate.js:435` | Read document metadata from a viewer handle without leaking handle-specific checks into the token-context builder. |
| `valueToText` | function | `src/utils/printTemplate.js:174` |  |
| `zeroPad2` | function | `src/utils/printTemplate.js:94` | Format a non-negative date/time component as at least two digits. |
| `currentLanguage` | function | `src/utils/printWatermark.js:13` |  |
| `normalizeWatermarkMode` | function | `src/utils/printWatermark.js:38` |  |
| `resolveWatermarkAssetSrc` | function | `src/utils/printWatermark.js:64` | Resolve the image asset for COPY/KOPIA watermark modes. |
| `resolveWatermarkMode` | function | `src/utils/printWatermark.js:51` |  |
| `toAbsoluteUrl` | function | `src/utils/printWatermark.js:21` |  |
| `getPublicAssetUrl` | function | `src/utils/publicAssetUrl.js:13` |  |
| `getReloadCacheAesKey` | function | `src/utils/reloadCacheCrypto.js:120` |  |
| `getReloadCacheAesKeyStorageState` | function | `src/utils/reloadCacheCrypto.js:105` |  |
| `STORAGE_PREFIX` | constant | `src/utils/reloadCacheCrypto.js:12` | Short-lived reload-cache key helpers. |
| `createDocumentSourceKey` | function | `src/utils/reloadCacheIdentity.js:115` |  |
| `createPersistedPageAssetKey` | function | `src/utils/reloadCacheIdentity.js:141` |  |
| `createReloadCacheSessionId` | function | `src/utils/reloadCacheIdentity.js:41` |  |
| `createRenderAssetSignature` | function | `src/utils/reloadCacheIdentity.js:123` |  |
| `describeDocumentSourceKey` | function | `src/utils/reloadCacheIdentity.js:53` |  |
| `part` | function | `src/utils/reloadCacheIdentity.js:33` |  |
| `stableHash` | function | `src/utils/reloadCacheIdentity.js:14` |  |
| `addScenario` | function | `src/utils/renderDecodeBenchmark.js:434` |  |
| `createAbortError` | function | `src/utils/renderDecodeBenchmark.js:293` |  |
| `createScenarios` | function | `src/utils/renderDecodeBenchmark.js:480` |  |
| `createTimeoutError` | function | `src/utils/renderDecodeBenchmark.js:338` |  |
| `delay` | function | `src/utils/renderDecodeBenchmark.js:304` |  |
| `deriveCountsFromMultipliers` | function | `src/utils/renderDecodeBenchmark.js:221` |  |
| `deriveWorkerCountsFromPageTargets` | function | `src/utils/renderDecodeBenchmark.js:234` |  |
| `getHardwareConcurrency` | function | `src/utils/renderDecodeBenchmark.js:189` |  |
| `isRenderDecodeBenchmarkEnabled` | function | `src/utils/renderDecodeBenchmark.js:285` |  |
| `mergePositiveCounts` | function | `src/utils/renderDecodeBenchmark.js:203` |  |
| `normalizeInteger` | function | `src/utils/renderDecodeBenchmark.js:50` |  |
| `normalizeMainThreadConcurrencies` | function | `src/utils/renderDecodeBenchmark.js:117` |  |
| `normalizeMultiplierList` | function | `src/utils/renderDecodeBenchmark.js:98` |  |
| `normalizePdfToImageModes` | function | `src/utils/renderDecodeBenchmark.js:146` |  |
| `normalizePdfWorkerBatchMode` | function | `src/utils/renderDecodeBenchmark.js:172` |  |
| `normalizePositiveNumberList` | function | `src/utils/renderDecodeBenchmark.js:80` |  |
| `normalizeRenderBenchmarkConfig` | function | `src/utils/renderDecodeBenchmark.js:245` |  |
| `normalizeSampleMode` | function | `src/utils/renderDecodeBenchmark.js:181` |  |
| `normalizeVariants` | function | `src/utils/renderDecodeBenchmark.js:129` |  |
| `normalizeWorkerCounts` | function | `src/utils/renderDecodeBenchmark.js:61` |  |
| `resolveScenarioConcurrency` | function | `src/utils/renderDecodeBenchmark.js:685` |  |
| `runLimited` | function | `src/utils/renderDecodeBenchmark.js:566` |  |
| `runRenderDecodeBenchmark` | function | `src/utils/renderDecodeBenchmark.js:1086` |  |
| `runScenario` | function | `src/utils/renderDecodeBenchmark.js:915` |  |
| `selectBenchmarkPages` | function | `src/utils/renderDecodeBenchmark.js:391` |  |
| `summarizeByExtension` | function | `src/utils/renderDecodeBenchmark.js:590` |  |
| `throwIfAborted` | function | `src/utils/renderDecodeBenchmark.js:329` |  |
| `withTimeout` | function | `src/utils/renderDecodeBenchmark.js:352` |  |
| `clampRenderSurfaceSize` | function | `src/utils/renderSurfaceBounds.js:25` | Clamp a requested raster surface into a conservative browser-safe envelope while preserving its aspect ratio. |
| `MAX_RENDER_SURFACE_DIMENSION` | constant | `src/utils/renderSurfaceBounds.js:9` | OpenDocViewer — conservative raster surface bounds. |
| `getKeyboardPrintShortcutBehavior` | function | `src/utils/runtimeConfig.js:83` | Resolve the configured Ctrl/Cmd+P behavior. |
| `getPrintDefaultMode` | function | `src/utils/runtimeConfig.js:275` | Resolve the default print page mode used when the user has not stored an override. |
| `getPrintSelectionWorkspaceConfig` | function | `src/utils/runtimeConfig.js:300` | Resolve the print-selection workspace configuration. |
| `getRuntimeConfig` | function | `src/utils/runtimeConfig.js:60` | Read the merged runtime configuration from the browser environment. |
| `getViewerCustomFitSizeLimits` | function | `src/utils/runtimeConfig.js:252` | Resolve the configured custom-size limits. |
| `getViewerCustomFitWidthFactorPercent` | function | `src/utils/runtimeConfig.js:238` | Resolve the custom-size width factor percentage. |
| `getViewerDefaultZoomMode` | function | `src/utils/runtimeConfig.js:225` | Resolve the initial page zoom mode. |
| `getViewerEdgeScrollPageTurnConfig` | function | `src/utils/runtimeConfig.js:324` | Resolve the optional scroll-at-edge page turn gesture. |
| `getViewerProblemNoticeConfig` | function | `src/utils/runtimeConfig.js:342` | Resolve the configurable viewer-level problem notice. |
| `isDocumentMetadataUiEnabled` | function | `src/utils/runtimeConfig.js:97` | Resolve whether document metadata UI affordances should be available. |
| `KeyboardPrintShortcutBehavior` | typedef | `src/utils/runtimeConfig.js:9` |  |
| `normalizeCustomFitSizeLimitPreference` | function | `src/utils/runtimeConfig.js:200` | Normalize the optional user custom-size limits. |
| `normalizeCustomFitWidthFactorPercent` | function | `src/utils/runtimeConfig.js:174` | Normalize a custom fit-width factor. |
| `normalizeOptionalCustomFitFactorPercent` | function | `src/utils/runtimeConfig.js:185` | Normalize an optional custom-size limit percentage. |
| `normalizePrintDefaultMode` | function | `src/utils/runtimeConfig.js:159` | Normalize a user-facing print default mode. |
| `PrintDefaultMode` | typedef | `src/utils/runtimeConfig.js:11` |  |
| `PrintSelectionWorkspaceConfig` | typedef | `src/utils/runtimeConfig.js:19` |  |
| `ViewerCustomFitSizeLimits` | typedef | `src/utils/runtimeConfig.js:12` |  |
| `ViewerDefaultZoomMode` | typedef | `src/utils/runtimeConfig.js:10` |  |
| `ViewerEdgeScrollPageTurnConfig` | typedef | `src/utils/runtimeConfig.js:26` |  |
| `ViewerProblemNoticeConfig` | typedef | `src/utils/runtimeConfig.js:34` |  |
| `BlobLruCache` | class | `src/utils/sourceTempStore.js:210` |  |
| `SourceTempStore#cleanup` | function | `src/utils/sourceTempStore.js:586` |  |
| `SourceTempStore#cleanupStaleSessions` | function | `src/utils/sourceTempStore.js:636` |  |
| `createSessionId` | function | `src/utils/sourceTempStore.js:74` |  |
| `createSourceTempStore` | function | `src/utils/sourceTempStore.js:260` |  |
| `BlobLruCache#delete` | function | `src/utils/sourceTempStore.js:247` |  |
| `SourceTempStore#deleteSource` | function | `src/utils/sourceTempStore.js:548` |  |
| `SourceTempStore#enqueueWrite` | function | `src/utils/sourceTempStore.js:410` |  |
| `SourceTempStore#ensureDb` | function | `src/utils/sourceTempStore.js:698` |  |
| `SourceTempStore#ensureKey` | function | `src/utils/sourceTempStore.js:707` |  |
| `BlobLruCache#get` | function | `src/utils/sourceTempStore.js:220` |  |
| `SourceTempStore#getArrayBuffer` | function | `src/utils/sourceTempStore.js:539` |  |
| `SourceTempStore#getBlob` | function | `src/utils/sourceTempStore.js:483` |  |
| `SourceTempStore#getIndexedDbRecord` | function | `src/utils/sourceTempStore.js:844` |  |
| `SourceTempStore#getMeta` | function | `src/utils/sourceTempStore.js:475` |  |
| `SourceTempStore#getSessionId` | function | `src/utils/sourceTempStore.js:340` |  |
| `SourceTempStore#getStats` | function | `src/utils/sourceTempStore.js:347` |  |
| `hasIndexedDb` | function | `src/utils/sourceTempStore.js:50` |  |
| `hasWebCrypto` | function | `src/utils/sourceTempStore.js:61` |  |
| `SourceTempStore#makeIndexedDbRecord` | function | `src/utils/sourceTempStore.js:793` |  |
| `makeStorageKey` | function | `src/utils/sourceTempStore.js:43` |  |
| `SourceTempStore#maybePromote` | function | `src/utils/sourceTempStore.js:731` |  |
| `normalizePositiveInteger` | function | `src/utils/sourceTempStore.js:113` |  |
| `normalizeTtlMs` | function | `src/utils/sourceTempStore.js:99` |  |
| `openTempStoreDb` | function | `src/utils/sourceTempStore.js:145` |  |
| `SourceTempStore#promoteToIndexedDb` | function | `src/utils/sourceTempStore.js:399` | Force promotion to IndexedDB for the current session when supported. |
| `SourceTempStore#putIndexedDbEntry` | function | `src/utils/sourceTempStore.js:777` |  |
| `SourceTempStore#putSource` | function | `src/utils/sourceTempStore.js:422` |  |
| `PutSourceOptions` | typedef | `src/utils/sourceTempStore.js:196` |  |
| `SourceTempStore#ready` | function | `src/utils/sourceTempStore.js:331` |  |
| `SourceTempStore#recordToBlob` | function | `src/utils/sourceTempStore.js:895` |  |
| `SourceTempStore#recordToMeta` | function | `src/utils/sourceTempStore.js:876` |  |
| `requestToPromise` | function | `src/utils/sourceTempStore.js:123` |  |
| `BlobLruCache#set` | function | `src/utils/sourceTempStore.js:234` |  |
| `SourceMeta` | typedef | `src/utils/sourceTempStore.js:182` |  |
| `SourceStoreStats` | typedef | `src/utils/sourceTempStore.js:165` |  |
| `SourceTempStore#SourceTempStore` | class | `src/utils/sourceTempStore.js:268` |  |
| `SourceTempStore#touchIndexedDbRecord` | function | `src/utils/sourceTempStore.js:858` |  |
| `transactionDone` | function | `src/utils/sourceTempStore.js:134` |  |
| `SourceTempStore#updateConfig` | function | `src/utils/sourceTempStore.js:374` | Update runtime thresholds for the active session. |
| `collectConfigDiagnostics` | function | `src/utils/supportDiagnostics.js:135` |  |
| `collectLocationDiagnostics` | function | `src/utils/supportDiagnostics.js:122` |  |
| `collectNavigatorDiagnostics` | function | `src/utils/supportDiagnostics.js:105` |  |
| `collectSupportDiagnostics` | function | `src/utils/supportDiagnostics.js:303` |  |
| `createDefaultDiagnosticsFilename` | function | `src/utils/supportDiagnostics.js:61` |  |
| `downloadJsonFile` | function | `src/utils/supportDiagnostics.js:337` | Download a JSON diagnostics payload in browser environments. |
| `getAppVersionFromWindowGlobals` | function | `src/utils/supportDiagnostics.js:26` |  |
| `hasOwn` | function | `src/utils/supportDiagnostics.js:52` |  |
| `loadLatestBenchmarkResult` | function | `src/utils/supportDiagnostics.js:246` |  |
| `loadLatestPdfBenchmarkResult` | function | `src/utils/supportDiagnostics.js:262` |  |
| `loadLatestRenderDecodeBenchmarkResult` | function | `src/utils/supportDiagnostics.js:282` |  |
| `logDiagnosticsDownloadFailure` | function | `src/utils/supportDiagnostics.js:81` |  |
| `normalizeDownloadFilename` | function | `src/utils/supportDiagnostics.js:72` |  |
| `resolveAppVersion` | function | `src/utils/supportDiagnostics.js:89` |  |
| `resolveBuildId` | function | `src/utils/supportDiagnostics.js:98` |  |
| `resolveImportMetaEnvValue` | function | `src/utils/supportDiagnostics.js:37` |  |
| `saveLatestPdfBenchmarkResult` | function | `src/utils/supportDiagnostics.js:270` |  |
| `saveLatestRenderDecodeBenchmarkResult` | function | `src/utils/supportDiagnostics.js:290` |  |
| `clearCustomFitSizeLimitPreference` | function | `src/utils/viewerPreferences.js:467` |  |
| `clearCustomFitWidthFactorPreference` | function | `src/utils/viewerPreferences.js:412` |  |
| `clearDefaultZoomModePreference` | function | `src/utils/viewerPreferences.js:377` |  |
| `clearPrintDefaultModePreference` | function | `src/utils/viewerPreferences.js:352` |  |
| `CustomFitSizeLimitPreference` | typedef | `src/utils/viewerPreferences.js:17` |  |
| `getCustomFitSizeLimitPreference` | function | `src/utils/viewerPreferences.js:427` |  |
| `getCustomFitWidthFactorPreference` | function | `src/utils/viewerPreferences.js:386` |  |
| `getDefaultZoomModePreference` | function | `src/utils/viewerPreferences.js:361` |  |
| `getLanguagePreference` | function | `src/utils/viewerPreferences.js:318` |  |
| `getPrintDefaultModePreference` | function | `src/utils/viewerPreferences.js:334` |  |
| `getThemeModePreference` | function | `src/utils/viewerPreferences.js:280` |  |
| `getThemePreference` | function | `src/utils/viewerPreferences.js:251` |  |
| `getViewerPreferences` | function | `src/utils/viewerPreferences.js:209` |  |
| `isExplicitTheme` | function | `src/utils/viewerPreferences.js:46` |  |
| `isThemeMode` | function | `src/utils/viewerPreferences.js:54` |  |
| `normalizeDefaultZoomModePreference` | function | `src/utils/viewerPreferences.js:74` |  |
| `normalizePreferences` | function | `src/utils/viewerPreferences.js:101` |  |
| `normalizeThemeModeValue` | function | `src/utils/viewerPreferences.js:64` | Normalize legacy theme-mode values. |
| `parsePreferences` | function | `src/utils/viewerPreferences.js:144` |  |
| `readPreferencesFromCookie` | function | `src/utils/viewerPreferences.js:156` |  |
| `readPreferencesFromStorage` | function | `src/utils/viewerPreferences.js:173` |  |
| `replaceViewerPreferences` | function | `src/utils/viewerPreferences.js:241` | Persist an already-normalized full preference object. |
| `setCustomFitSizeLimitPreference` | function | `src/utils/viewerPreferences.js:440` |  |
| `setCustomFitWidthFactorPreference` | function | `src/utils/viewerPreferences.js:399` |  |
| `setDefaultZoomModePreference` | function | `src/utils/viewerPreferences.js:369` |  |
| `setLanguagePreference` | function | `src/utils/viewerPreferences.js:327` |  |
| `setPrintDefaultModePreference` | function | `src/utils/viewerPreferences.js:345` |  |
| `setThemeModePreference` | function | `src/utils/viewerPreferences.js:297` | Persist the user&#39;s theme mode preference. |
| `setThemePreference` | function | `src/utils/viewerPreferences.js:270` |  |
| `setViewerPreferences` | function | `src/utils/viewerPreferences.js:219` |  |
| `ViewerPreferences` | typedef | `src/utils/viewerPreferences.js:24` |  |
| `writePreferencesToCookie` | function | `src/utils/viewerPreferences.js:186` |  |
| `writePreferencesToStorage` | function | `src/utils/viewerPreferences.js:199` |  |
| `applyZoom` | function | `src/utils/zoomUtils.js:140` | Set a new zoom value using the provided setter, clamped to \[MIN_ZOOM, MAX_ZOOM\]. |
| `calculateFitToScreenZoom` | function | `src/utils/zoomUtils.js:160` | Calculate and set a zoom that fits the render surface within both viewport axes. |
| `calculateFitToWidthZoom` | function | `src/utils/zoomUtils.js:200` | Calculate and set a zoom that fits the render surface width within the pane viewport. |
| `clamp` | function | `src/utils/zoomUtils.js:43` | Clamp a numeric value into the inclusive range \[min, max\]. |
| `getRenderableSize` | function | `src/utils/zoomUtils.js:95` | Read the intrinsic size of the active render surface. |
| `getViewport` | function | `src/utils/zoomUtils.js:80` | Resolve an exact viewport element from either a DOM node or a React-like ref. |
| `getViewportSize` | function | `src/utils/zoomUtils.js:126` | Read the exact client viewport available to the rendered pane. |
| `handleZoomIn` | function | `src/utils/zoomUtils.js:245` | Increase the zoom level by 10% \(multiplicative\), clamped to the safe range. |
| `handleZoomOut` | function | `src/utils/zoomUtils.js:260` | Decrease the zoom level by ~9.09% \(inverse of +10%\), clamped to the safe range. |
| `hasValidDimensions` | function | `src/utils/zoomUtils.js:60` |  |
| `isPositiveFiniteNumber` | function | `src/utils/zoomUtils.js:51` |  |
| `MAX_ZOOM` | constant | `src/utils/zoomUtils.js:15` | Maximum allowed zoom factor \(800%\). |
| `MIN_ZOOM` | constant | `src/utils/zoomUtils.js:13` | Minimum allowed zoom factor \(5%\). |
| `normalizeOptionalFactor` | function | `src/utils/zoomUtils.js:69` |  |
| `ZOOM_CHANGE_THRESHOLD` | constant | `src/utils/zoomUtils.js:21` | Treat zoom deltas smaller than this as unchanged to avoid redundant React updates. |
| `ZOOM_IN_MULTIPLIER` | constant | `src/utils/zoomUtils.js:17` | Zoom-in multiplier: each click increases zoom by 10% of the current zoom level \(1.1x\). |
| `ZOOM_OUT_MULTIPLIER` | constant | `src/utils/zoomUtils.js:19` | Zoom-out multiplier: inverse of +10%, approximately a 9.09% decrease. |
| `ZoomCalcOptions` | typedef | `src/utils/zoomUtils.js:23` | Optional calculation overrides. |
| `createFallbackMainThreadError` | function | `src/workers/imageWorker.js:44` | Creates an error that tells the caller this worker path is unsupported and should be retried on the main thread. |
| `PdfCacheEntry` | typedef | `src/workers/pdfPageWorker.js:20` |  |
| `workerScope` | constant | `src/workers/pdfWorker.js:9` | OpenDocViewer - generated PDF worker. |
