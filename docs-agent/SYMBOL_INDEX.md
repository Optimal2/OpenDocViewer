# Symbol Index

| Symbol | Kind | File | Summary |
| --- | --- | --- | --- |
| <code>ALLOWED_ORIGINS</code> | constant | <code>server/system-log-server.js:141</code> | Optional CORS for /log |
| <code>LOG_TOKEN</code> | constant | <code>server/system-log-server.js:135</code> | Token gate for /log |
| <code>logLimiter</code> | constant | <code>server/system-log-server.js:165</code> | Rate limit for ingestion |
| <code>requireLogToken</code> | function | <code>server/system-log-server.js:175</code> | Token auth middleware |
| <code>TRUST_PROXY_RAW</code> | constant | <code>server/system-log-server.js:128</code> | Trust proxy for accurate req.ip |
| <code>resolveUser</code> | function | <code>server/user-log-server.js:117</code> | Resolve user identity without cookies. |
| <code>sameOriginGuard</code> | function | <code>server/user-log-server.js:135</code> | Blocks cross-site requests using Origin/Referer/Sec-Fetch-Site signals. |
| <code>BootstrapDebugInfo</code> | typedef | <code>src/app/AppBootstrap.jsx:62</code> | Diagnostics-only bootstrap metadata. |
| <code>buildDemoSourceList</code> | function | <code>src/app/AppBootstrap.jsx:227</code> | Build a demo source list from the /public sample files. |
| <code>DemoBuildOptions</code> | typedef | <code>src/app/AppBootstrap.jsx:71</code> | Options for building a demo source list. |
| <code>DemoSourceItem</code> | typedef | <code>src/app/AppBootstrap.jsx:79</code> | One entry in the demo source list. |
| <code>ExplicitItem</code> | typedef | <code>src/app/AppBootstrap.jsx:39</code> | Explicit item \(URL list\). |
| <code>module.exports</code> | function | <code>src/app/AppBootstrap.jsx:249</code> | Top-level bootstrapper component. |
| <code>makeReloadCacheSeedFromBundle</code> | function | <code>src/app/AppBootstrap.jsx:209</code> | Build a stable reload-cache scope from host/user identity without including short-lived source URLs/tickets, session ids, or the current document selection. |
| <code>PortableDocumentBundle</code> | typedef | <code>src/app/AppBootstrap.jsx:47</code> | Portable document bundle shape. |
| <code>SessionShape</code> | typedef | <code>src/app/AppBootstrap.jsx:31</code> | Session metadata for a bundle. |
| <code>UrlConfig</code> | typedef | <code>src/app/AppBootstrap.jsx:54</code> | URL parameter config \(pattern mode\). |
| <code>getAppBase</code> | function | <code>src/app/bootConfig.js:16</code> | Return the application base path \(always with a trailing slash\) derived from the current page URL. |
| <code>isJsContentType</code> | function | <code>src/app/bootConfig.js:29</code> | Heuristic: does a content-type look like JavaScript? |
| <code>loadClassicScript</code> | function | <code>src/app/bootConfig.js:58</code> | Load a classic script and resolve when it executes \(or errors\). |
| <code>loadFromCandidates</code> | function | <code>src/app/bootConfig.js:100</code> | Try multiple candidate URLs \(in order\) until one probes as JS, then load it. |
| <code>probeScriptUrl</code> | function | <code>src/app/bootConfig.js:42</code> | Probe a candidate script URL and only accept it when the response looks like JavaScript. |
| <code>BootstrapDebugInfo</code> | typedef | <code>src/app/OpenDocViewer.jsx:33</code> | Diagnostics-only startup details surfaced through the performance overlay. |
| <code>OpenDocViewer</code> | function | <code>src/app/OpenDocViewer.jsx:67</code> | OpenDocViewer — Top-level component. |
| <code>OpenDocViewer~resizeRaf</code> | constant | <code>src/app/OpenDocViewer.jsx:93</code> | rAF-throttled resize handler: Avoids re-render spam during window drags. |
| <code>OpenDocViewer~showPerf</code> | constant | <code>src/app/OpenDocViewer.jsx:134</code> | Decide if the Performance HUD should render: Runtime flag \(config/env/meta\) OR explicit URL opt-in: ?perf=1 \(handy during support sessions\) |
| <code>SourceItem</code> | typedef | <code>src/app/OpenDocViewer.jsx:25</code> | Item in the explicit source list mode. |
| <code>CanvasRenderer</code> | constant | <code>src/components/CanvasRenderer.jsx:40</code> | CanvasRenderer component. |
| <code>module.exports</code> | function | <code>src/components/common/StatusLed.jsx:17</code> |  |
| <code>DocumentConsumerWrapper</code> | function | <code>src/components/DocumentConsumerWrapper.jsx:66</code> | DocumentConsumerWrapper Wraps DocumentLoader + DocumentViewer and switches between full viewer and a thumbnail-only presentation on small/mobile layouts. |
| <code>SourceItem</code> | typedef | <code>src/components/DocumentConsumerWrapper.jsx:37</code> | An item for explicit-list mode. |
| <code>Batch</code> | typedef | <code>src/components/DocumentLoader/batchHandler.js:44</code> | A batch groups one or more jobs of the same file type. |
| <code>batchHandler</code> | constant | <code>src/components/DocumentLoader/batchHandler.js:201</code> | Batch scheduler entry point. |
| <code>InsertPageAtIndex</code> | typedef | <code>src/components/DocumentLoader/batchHandler.js:51</code> | Signature for the function that inserts a page record at a specific index. |
| <code>pump</code> | function | <code>src/components/DocumentLoader/batchHandler.js:85</code> | Schedule a short, fair distribution pass: Assigns at most one batch per idle worker. |
| <code>PUMP_DELAY_MS</code> | constant | <code>src/components/DocumentLoader/batchHandler.js:70</code> | Small delay so the event loop can breathe between pumps \(ms\). |
| <code>WorkerJob</code> | typedef | <code>src/components/DocumentLoader/batchHandler.js:31</code> | A single decoding/rendering unit handed to a worker. |
| <code>WorkerMessageHandler</code> | typedef | <code>src/components/DocumentLoader/batchHandler.js:59</code> | Handle a worker&#39;s message and insert results. |
| <code>module.exports</code> | function | <code>src/components/DocumentLoader/DemoControls.jsx:35</code> | DemoControls — wraps DocumentLoader with demo-mode props and a small control UI. |
| <code>asciiHead</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:254</code> |  |
| <code>buildInlineSourceBlob</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:847</code> | Decode host-provided Base64 source bytes without routing through fetch\(data:...\) . |
| <code>createFailedPlaceholder</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1059</code> |  |
| <code>createInvalidSourcePayloadError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:742</code> | Build a source-validation error. |
| <code>createLimiter</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:161</code> |  |
| <code>createPagePlaceholders</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1017</code> |  |
| <code>createPrefetchHttpError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:682</code> | Build a consistent HTTP error so the retry classifier can inspect the status code. |
| <code>createPrefetchTimeoutError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:726</code> | Build a timeout-flavoured prefetch error so the loader can fail fast without waiting for the browser/network stack to decide when a stuck request should finally die. |
| <code>createSourceUnavailableSessionError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:710</code> |  |
| <code>DocumentLoader</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1169</code> |  |
| <code>DocumentLoaderProps</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:58</code> |  |
| <code>DocumentSourceItem</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:35</code> |  |
| <code>estimateTotalPagesConservatively</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:645</code> | Estimate the final page count conservatively. |
| <code>FailedPlaceholderInput</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:91</code> |  |
| <code>finalizeDocumentPages</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:993</code> | Patch the final page-count and boundary flags onto every page in a document once the loader knows where that document ends. |
| <code>getDocumentProgressKey</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:977</code> |  |
| <code>getEstimatedEntryExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:604</code> | Resolve the best-effort extension we can use for page-count estimation before every source has been fetched. |
| <code>getInitialTempStoreMode</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:591</code> |  |
| <code>inferUrlExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:206</code> |  |
| <code>isReloadCacheEnabled</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:582</code> |  |
| <code>isSourceUnavailableError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:697</code> | Host integrations often expose short-lived file tickets. |
| <code>isSupportedSourceExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:238</code> |  |
| <code>isTextLikeSourceMime</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:246</code> |  |
| <code>isTransientPrefetchError</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:819</code> | Retry only errors that are likely to be transient in real deployments: browser/network fetch failures and gateway-style HTTP responses. |
| <code>LoadPressureSummary</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:121</code> |  |
| <code>looksLikeTextPayload</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:269</code> |  |
| <code>matchesKnownSourceSignature</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:298</code> |  |
| <code>&lt;anonymous&gt;~maybePrompt</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1283</code> |  |
| <code>mimeForExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:923</code> |  |
| <code>mimeToExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:566</code> |  |
| <code>needsPageCountAnalysis</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:452</code> |  |
| <code>normalizeExtension</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:215</code> |  |
| <code>PageEstimateStats</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:134</code> |  |
| <code>PagePlaceholderInput</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:73</code> |  |
| <code>PrefetchResult</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:140</code> |  |
| <code>&lt;anonymous&gt;~prefetchSource</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1304</code> | Fetch and persist one source blob with conservative retry behavior. |
| <code>DocumentLoader~promptForPressure</code> | constant | <code>src/components/DocumentLoader/DocumentLoader.js:1213</code> |  |
| <code>readBlobHeadBytes</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:335</code> |  |
| <code>readUint32LittleEndian</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:888</code> |  |
| <code>redactUrlForLog</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:548</code> |  |
| <code>&lt;anonymous&gt;~resolve</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1584</code> |  |
| <code>ResolvedEntry</code> | typedef | <code>src/components/DocumentLoader/DocumentLoader.js:102</code> |  |
| <code>resolveDocumentSourceContext</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:951</code> | Extract multi-document source context from an entry or placeholder input. |
| <code>resolveEntries</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1101</code> |  |
| <code>resolveExactPlannedPageCount</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:477</code> |  |
| <code>resolveFetchedSourcePayload</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:353</code> | Resolve source type information with a cheap signature-first path. |
| <code>resolvePrefetchedPageCountHint</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:517</code> | Resolve multi-page source page counts inside the prefetch worker queue so many small PDF/TIFF files do not create a second sequential analysis phase after all sources have been fe... |
| <code>DocumentLoader~resolvePressurePrompt</code> | constant | <code>src/components/DocumentLoader/DocumentLoader.js:1222</code> |  |
| <code>resolveTrustedEntryPageCountHint</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:462</code> |  |
| <code>resolveTrustedSourcePackPayload</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:418</code> | Gateway source packs already carry trusted file metadata from the prepared server-side session. |
| <code>safeMessage</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1161</code> |  |
| <code>shouldDeferSourceWarmup</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:499</code> | Large multi-page PDFs should not start their background render warm-up while the loader is still discovering more sources. |
| <code>&lt;anonymous&gt;~shouldStopRun</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:1277</code> | Whether this load run is no longer allowed to mutate React state. |
| <code>sleep</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:667</code> |  |
| <code>startsWithAscii</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:284</code> |  |
| <code>toPositiveIntOrUndefined</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:940</code> |  |
| <code>updatePageEstimateStats</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:619</code> | Update per-extension page-count statistics used by the conservative warning estimator. |
| <code>validateFetchedSourceBlob</code> | function | <code>src/components/DocumentLoader/DocumentLoader.js:764</code> | Validate that a fetched source looks like a renderable document before it is saved to ODV&#39;s session temp store. |
| <code>fetchAndArrayBuffer</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:170</code> | Fetch a resource and return its ArrayBuffer. |
| <code>FetchOptions</code> | typedef | <code>src/components/DocumentLoader/documentLoaderUtils.js:105</code> | Options for fetchAndArrayBuffer. |
| <code>generateDemoList</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:80</code> | Generate a list of demo document URLs by repeating or mixing sample files. |
| <code>generateDocumentList</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:52</code> | Generate a list of document URLs using a simple pattern: 001..NNN + extension. |
| <code>generateThumbnail</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:337</code> | Create a small thumbnail data URL for a given image URL. |
| <code>getTiffMetadata</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:307</code> | Extract light-weight metadata from a TIFF buffer \(best-effort\). |
| <code>getTotalPages</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:275</code> | Determine total pages for a given document by inspecting its buffer and type. |
| <code>TRANSPARENT_1x1</code> | constant | <code>src/components/DocumentLoader/documentLoaderUtils.js:37</code> | Tiny transparent PNG as a safe fallback when thumbnails cannot be produced. |
| <code>module.exports</code> | function | <code>src/components/DocumentLoader/LoadPressureDialog.jsx:35</code> | Large-load warning dialog shown before / during very heavy loading runs. |
| <code>LoadPressureDialogProps</code> | typedef | <code>src/components/DocumentLoader/LoadPressureDialog.jsx:21</code> |  |
| <code>LoadPressureDialogSummary</code> | typedef | <code>src/components/DocumentLoader/LoadPressureDialog.jsx:8</code> |  |
| <code>LoadPressureDialog~tr</code> | function | <code>src/components/DocumentLoader/LoadPressureDialog.jsx:43</code> |  |
| <code>__pdfWorkerInitialized</code> | member | <code>src/components/DocumentLoader/mainThreadRenderer.js:71</code> | One-time init of pdf.js classic worker script URL \(dev == build\). |
| <code>buildOjpegJpeg</code> | function | <code>src/components/DocumentLoader/mainThreadRenderer.js:248</code> | Build a standard JPEG Blob from an OJPEG \(old-style JPEG-in-TIFF\) IFD by concatenating the tables \( JPEGInterchangeFormat / Length : t513/t514\) with the entropy-coded scan strips... |
| <code>ensurePdfWorker</code> | function | <code>src/components/DocumentLoader/mainThreadRenderer.js:78</code> | Ensure a pdf.js worker is ready for this runtime. |
| <code>getTagArray</code> | function | <code>src/components/DocumentLoader/mainThreadRenderer.js:232</code> | Safely read a TIFF tag array from a utif2 IFD object. |
| <code>InsertPageAtIndex</code> | typedef | <code>src/components/DocumentLoader/mainThreadRenderer.js:61</code> | Signature for inserting a page structure into the page list at an index. |
| <code>MAX_OJPEG_SCAN_SIZE_BYTES</code> | constant | <code>src/components/DocumentLoader/mainThreadRenderer.js:33</code> | Upper bound for reconstructed OJPEG entropy-coded scan data. |
| <code>RenderJob</code> | typedef | <code>src/components/DocumentLoader/mainThreadRenderer.js:47</code> | Render job passed to the main-thread renderer. |
| <code>renderPDFInMainThread</code> | constant | <code>src/components/DocumentLoader/mainThreadRenderer.js:102</code> | Render PDF pages on the main thread and INSERT THEM DIRECTLY. |
| <code>renderTIFFInMainThread</code> | constant | <code>src/components/DocumentLoader/mainThreadRenderer.js:318</code> | Render TIFF pages on the main thread with an ultra-light OJPEG fast path: If Compression=6 \(old-style JPEG-in-TIFF\), reconstruct a standard JPEG stream by concatenating the JFIF/t... |
| <code>ExplicitSourceList</code> | typedef | <code>src/components/DocumentLoader/sources/explicitListSource.js:3</code> | OpenDocViewer — Explicit Source List Normalizer PURPOSE Convert a PortableDocumentBundle into a flat, ordered list of file entries that the loader can process deterministically. |
| <code>firstDocumentField</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:102</code> |  |
| <code>inferExtFromUrl</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:77</code> | Infer a lowercase extension from a URL if present. |
| <code>makeExplicitSource</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:182</code> | Convert a PortableDocumentBundle into a flat, ordered list of file URLs. |
| <code>metadataAliasValue</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:115</code> |  |
| <code>metadataFieldValue</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:130</code> |  |
| <code>optionalText</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:91</code> |  |
| <code>PortableDoc</code> | typedef | <code>src/components/DocumentLoader/sources/explicitListSource.js:53</code> | Portable document containing a list of files. |
| <code>PortableDocumentBundle</code> | typedef | <code>src/components/DocumentLoader/sources/explicitListSource.js:65</code> | Bundle containing multiple portable documents. |
| <code>PortableFile</code> | typedef | <code>src/components/DocumentLoader/sources/explicitListSource.js:38</code> | A single file reference in a portable document. |
| <code>resolveDocumentVersion</code> | function | <code>src/components/DocumentLoader/sources/explicitListSource.js:152</code> |  |
| <code>createWorker</code> | function | <code>src/components/DocumentLoader/workerHandler.js:95</code> | Create a new image worker instance. |
| <code>getNumberOfWorkers</code> | function | <code>src/components/DocumentLoader/workerHandler.js:110</code> | Decide how many workers to spawn, leaving one logical core for the UI when possible. |
| <code>HandleOpts</code> | typedef | <code>src/components/DocumentLoader/workerHandler.js:76</code> | Options passed to the handler to coordinate main-thread rendering. |
| <code>handleWorkerMessage</code> | constant | <code>src/components/DocumentLoader/workerHandler.js:174</code> | Handle a message payload from an image worker and insert resulting page\(s\). |
| <code>InsertPageAtIndex</code> | typedef | <code>src/components/DocumentLoader/workerHandler.js:68</code> | Signature for inserting a page structure into the viewer at a specific index. |
| <code>scheduleMainThread</code> | function | <code>src/components/DocumentLoader/workerHandler.js:138</code> | Decide how to schedule/execute a main-thread render job based on options: If a queue ref is provided → push the job to the queue \(deferred execution\). |
| <code>WorkerJob</code> | typedef | <code>src/components/DocumentLoader/workerHandler.js:42</code> | A single job/result entry communicated between worker and main thread. |
| <code>WorkerMessage</code> | typedef | <code>src/components/DocumentLoader/workerHandler.js:58</code> | Worker → main message envelope. |
| <code>module.exports</code> | function | <code>src/components/DocumentMetadataMatrixOverlayDialog.jsx:17</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentMetadataMatrixOverlayDialog.jsx:30</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentMetadataOverlayDialog.jsx:21</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentMetadataOverlayDialog.jsx:38</code> |  |
| <code>&lt;anonymous&gt;~applyFitZoomForKnownSize</code> | constant | <code>src/components/DocumentRender.jsx:465</code> | Apply sticky fit modes before a newly loaded page becomes visible. |
| <code>&lt;anonymous&gt;~applyInitialZoomMode</code> | constant | <code>src/components/DocumentRender.jsx:488</code> |  |
| <code>&lt;anonymous&gt;~claimAssetRetry</code> | constant | <code>src/components/DocumentRender.jsx:215</code> |  |
| <code>&lt;anonymous&gt;~clearLoadingOverlayTimer</code> | constant | <code>src/components/DocumentRender.jsx:203</code> |  |
| <code>DisplayedAsset</code> | typedef | <code>src/components/DocumentRender.jsx:76</code> |  |
| <code>DocumentRender</code> | constant | <code>src/components/DocumentRender.jsx:100</code> |  |
| <code>&lt;anonymous&gt;~drawImageOnCanvas</code> | constant | <code>src/components/DocumentRender.jsx:374</code> |  |
| <code>&lt;anonymous&gt;~finalizeDisplayedAsset</code> | constant | <code>src/components/DocumentRender.jsx:709</code> |  |
| <code>&lt;anonymous&gt;~fitToCustomWidth</code> | constant | <code>src/components/DocumentRender.jsx:452</code> |  |
| <code>&lt;anonymous&gt;~fitToScreen</code> | constant | <code>src/components/DocumentRender.jsx:433</code> |  |
| <code>&lt;anonymous&gt;~fitToWidth</code> | constant | <code>src/components/DocumentRender.jsx:442</code> |  |
| <code>&lt;anonymous&gt;~getActiveRenderSurface</code> | constant | <code>src/components/DocumentRender.jsx:420</code> | Returns the surface whose intrinsic size should drive fit calculations. |
| <code>getCurrentPage</code> | function | <code>src/components/DocumentRender.jsx:44</code> |  |
| <code>&lt;anonymous&gt;~handlePendingImageError</code> | constant | <code>src/components/DocumentRender.jsx:893</code> |  |
| <code>&lt;anonymous&gt;~handlePendingImageLoad</code> | constant | <code>src/components/DocumentRender.jsx:826</code> |  |
| <code>&lt;anonymous&gt;~handleViewportDoubleClick</code> | constant | <code>src/components/DocumentRender.jsx:511</code> |  |
| <code>&lt;anonymous&gt;~handleVisibleImageError</code> | constant | <code>src/components/DocumentRender.jsx:921</code> |  |
| <code>&lt;anonymous&gt;~handleVisibleImageLoad</code> | constant | <code>src/components/DocumentRender.jsx:769</code> |  |
| <code>hasUsableSize</code> | function | <code>src/components/DocumentRender.jsx:64</code> |  |
| <code>isBlobAssetUrl</code> | function | <code>src/components/DocumentRender.jsx:72</code> |  |
| <code>normalizeSize</code> | function | <code>src/components/DocumentRender.jsx:53</code> |  |
| <code>&lt;anonymous&gt;~recoverPageAsset</code> | constant | <code>src/components/DocumentRender.jsx:852</code> |  |
| <code>&lt;anonymous&gt;~resetAssetRetry</code> | constant | <code>src/components/DocumentRender.jsx:196</code> | Reset the per-page blob-URL retry tracker after a successful load or when the target page changes. |
| <code>&lt;anonymous&gt;~resolveCustomFitOptions</code> | constant | <code>src/components/DocumentRender.jsx:255</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentSelectionPanel.jsx:89</code> |  |
| <code>SelectionCheckboxRow</code> | function | <code>src/components/DocumentSelectionPanel.jsx:30</code> |  |
| <code>buildCenterOutQueue</code> | function | <code>src/components/DocumentThumbnailList.jsx:150</code> | Build a center-out thumbnail warm-up order so the pane feels responsive around the user&#39;s current scroll target instead of always starting from page 1. |
| <code>clamp</code> | function | <code>src/components/DocumentThumbnailList.jsx:63</code> |  |
| <code>DocumentThumbnailList</code> | constant | <code>src/components/DocumentThumbnailList.jsx:535</code> |  |
| <code>formatMetricFraction</code> | function | <code>src/components/DocumentThumbnailList.jsx:107</code> |  |
| <code>formatMetricValue</code> | function | <code>src/components/DocumentThumbnailList.jsx:117</code> |  |
| <code>getDocumentBoundaryLabel</code> | function | <code>src/components/DocumentThumbnailList.jsx:315</code> |  |
| <code>getDocumentBoundaryTitle</code> | function | <code>src/components/DocumentThumbnailList.jsx:329</code> |  |
| <code>getMetricBadges</code> | function | <code>src/components/DocumentThumbnailList.jsx:261</code> |  |
| <code>getMetricTitles</code> | function | <code>src/components/DocumentThumbnailList.jsx:212</code> |  |
| <code>getPageDocumentContext</code> | function | <code>src/components/DocumentThumbnailList.jsx:184</code> |  |
| <code>getPageDocumentKey</code> | function | <code>src/components/DocumentThumbnailList.jsx:171</code> |  |
| <code>getSessionPageIndex</code> | function | <code>src/components/DocumentThumbnailList.jsx:126</code> |  |
| <code>getThumbnailLayout</code> | function | <code>src/components/DocumentThumbnailList.jsx:86</code> |  |
| <code>&lt;anonymous&gt;~handleActivate</code> | constant | <code>src/components/DocumentThumbnailList.jsx:1051</code> |  |
| <code>&lt;anonymous&gt;~handleImageLoad</code> | constant | <code>src/components/DocumentThumbnailList.jsx:1144</code> |  |
| <code>&lt;anonymous&gt;~handleKeyActivate</code> | constant | <code>src/components/DocumentThumbnailList.jsx:1077</code> |  |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/DocumentThumbnailList.jsx:946</code> |  |
| <code>&lt;anonymous&gt;~handleOpenContextMenu</code> | constant | <code>src/components/DocumentThumbnailList.jsx:1090</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentThumbnailList.jsx:937</code> |  |
| <code>&lt;anonymous&gt;~handleScroll</code> | constant | <code>src/components/DocumentThumbnailList.jsx:1024</code> |  |
| <code>isIndexInRange</code> | function | <code>src/components/DocumentThumbnailList.jsx:137</code> |  |
| <code>&lt;anonymous&gt;~setContainerRef</code> | constant | <code>src/components/DocumentThumbnailList.jsx:708</code> |  |
| <code>shouldWarmAllThumbnails</code> | function | <code>src/components/DocumentThumbnailList.jsx:72</code> |  |
| <code>ThumbnailRow</code> | constant | <code>src/components/DocumentThumbnailList.jsx:342</code> |  |
| <code>ThumbnailRowProps</code> | typedef | <code>src/components/DocumentThumbnailList.jsx:35</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx:46</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx:70</code> |  |
| <code>resolveAboutInfo</code> | function | <code>src/components/DocumentToolbar/AboutOverlayDialog.jsx:17</code> |  |
| <code>AnyRef</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:108</code> | Mutable ref-like object used by the toolbar. |
| <code>DocumentToolbar~dispatchPrintRequest</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:1119</code> | Execute the actual print helper after the dialog has resolved the user&#39;s choices. |
| <code>DocumentToolbar</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:285</code> | Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry. |
| <code>DocumentToolbarProps</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:136</code> | Props for {@link DocumentToolbar}. |
| <code>formatPdfProgressBody</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:64</code> |  |
| <code>getPdfProgressPercent</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:81</code> |  |
| <code>DocumentToolbar~handleBrightnessSliderChange</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:681</code> | Handle brightness slider changes with neutral snapping at 100. |
| <code>DocumentToolbar~handleContrastSliderChange</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:695</code> | Handle contrast slider changes with neutral snapping at 100. |
| <code>DocumentToolbar~handleEnhancePdfResolutionClick</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:717</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:407</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:399</code> |  |
| <code>DocumentToolbar~handlePrintSubmit</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:1287</code> | Handle the dialog submit event and dispatch the correct print action. |
| <code>DocumentToolbar~handleResetAdjustmentsClick</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:730</code> |  |
| <code>DocumentToolbar~handleRotationButtonClick</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:709</code> |  |
| <code>ImageProperties</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:114</code> | Editable image state shown by the toolbar. |
| <code>isPdfAbortError</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:55</code> |  |
| <code>isPdfPage</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:272</code> |  |
| <code>makePdfResolutionPageKey</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:262</code> |  |
| <code>DocumentToolbar~makePrintOptions</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:858</code> |  |
| <code>normalizeToolbarPageNumber</code> | function | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:250</code> | Clamp a page number into the valid viewer range while preserving a safe fallback. |
| <code>ONE_TO_ONE_EPS</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:219</code> | Epsilon for considering zoom ≈ 100% \(0.5%\). |
| <code>PageNumberSetter</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:122</code> | React-like numeric page setter used by the toolbar. |
| <code>PrintSubmitDetail</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:88</code> | Detail payload emitted by the print dialog. |
| <code>DocumentToolbar~resolvePrintPageContexts</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:808</code> | Resolve page metadata objects aligned with the printed page sequence. |
| <code>DocumentToolbar~resolvePrintPageCount</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:786</code> | Estimate the number of pages the user is about to print. |
| <code>DocumentToolbar~resolvePrintPageNumbers</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:822</code> |  |
| <code>SLIDER_CENTER_RANGE</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:217</code> | Range \(±\) around 100% where sliders snap back to the neutral value. |
| <code>DocumentToolbar~submitUserPrintLog</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:886</code> | Fire-and-forget user print log. |
| <code>DocumentToolbar~toggleAdjustmentMenu</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:739</code> |  |
| <code>DocumentToolbar~toPagesString</code> | constant | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:766</code> | Build a compact &amp;quot;pages&amp;quot; descriptor for logging. |
| <code>ZoomState</code> | typedef | <code>src/components/DocumentToolbar/DocumentToolbar.jsx:129</code> | Zoom display state used by the newer toolbar UX paths. |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/DocumentToolbar/HelpMenuButton.jsx:30</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentToolbar/HelpMenuButton.jsx:22</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentToolbar/HelpOverlayDialog.jsx:19</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentToolbar/HelpOverlayDialog.jsx:29</code> |  |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/DocumentToolbar/LanguageMenuButton.jsx:61</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentToolbar/LanguageMenuButton.jsx:53</code> |  |
| <code>LanguageMenuButton~handleSelectLanguage</code> | function | <code>src/components/DocumentToolbar/LanguageMenuButton.jsx:80</code> |  |
| <code>resolveLanguageLabel</code> | function | <code>src/components/DocumentToolbar/LanguageMenuButton.jsx:18</code> |  |
| <code>appendManualRefreshToken</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:111</code> |  |
| <code>buildManualCandidates</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:143</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:173</code> |  |
| <code>&lt;anonymous&gt;~handleEscape</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:193</code> |  |
| <code>interpolateTemplate</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:31</code> |  |
| <code>isRewritableRelativeUrl</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:41</code> |  |
| <code>removeManualRefreshToken</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:127</code> |  |
| <code>rewriteManualHtml</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:69</code> |  |
| <code>sanitizeManualHtml</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:55</code> |  |
| <code>toText</code> | function | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx:21</code> |  |
| <code>PrintSubmitDetail</code> | typedef | <code>src/components/DocumentToolbar/PrintRangeDialog.jsx:13</code> | Structured payload returned to the caller on submit. |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:88</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:80</code> |  |
| <code>ThemeMenuButton~handleSelect</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:104</code> |  |
| <code>resolveSelectedMode</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:46</code> |  |
| <code>resolveThemeModeIcon</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:34</code> |  |
| <code>resolveThemeModeLabel</code> | function | <code>src/components/DocumentToolbar/ThemeMenuButton.jsx:23</code> |  |
| <code>createSessionPageNumbers</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:125</code> |  |
| <code>createVariantDetail</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:78</code> |  |
| <code>module.exports</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:140</code> |  |
| <code>isAbortError</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:43</code> |  |
| <code>isCacheableAllPagesRequest</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:63</code> |  |
| <code>normalizePdfOrientation</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:51</code> |  |
| <code>runLimited</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:103</code> | Run async work with bounded concurrency. |
| <code>throwIfAborted</code> | function | <code>src/components/DocumentToolbar/usePdfPrebuildAllPages.js:32</code> |  |
| <code>buildSelectedOptionDetails</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:124</code> | Build token-friendly details for the selected option without forcing templates to use list indexes. |
| <code>usePrintRangeController~composePrintFormat</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:526</code> |  |
| <code>usePrintRangeController~composeReason</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:545</code> |  |
| <code>usePrintRangeController~composeSubmitDetail</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:588</code> | Compose and validate the print payload for the current dialog state. |
| <code>ensureODVPrintCSS</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:163</code> | Ensure base print CSS is injected once per document. |
| <code>usePrintRangeController~extras</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:568</code> |  |
| <code>getCfg</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:37</code> | Read the runtime configuration \(merged defaults + site overrides\). |
| <code>hasTextValue</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:57</code> |  |
| <code>usePrintRangeController~makeDescendingSequence</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:440</code> |  |
| <code>normalizePdfOrientationMode</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:110</code> |  |
| <code>usePrintRangeController~onDialogKeyDown</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:428</code> |  |
| <code>PrintSubmitDetail</code> | typedef | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:15</code> | Structured payload returned to the caller on submit. |
| <code>resolveOptionPrintText</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:73</code> | Resolve the string that should be used on physical print/log output for an option. |
| <code>resolvePrintAction</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:96</code> | Resolve a configurable print dialog action. |
| <code>usePrintRangeController~restoreFromDetail</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:679</code> | Restore the dialog state from the latest successfully prepared print. |
| <code>safeRegex</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:48</code> | Build a safe RegExp from optional pattern/flags. |
| <code>usePrintRangeController~submitPdfDownload</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:668</code> |  |
| <code>usePrintRangeController~submitPrintDirect</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:660</code> |  |
| <code>usePrintRangeController~submitPrintPdf</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:663</code> |  |
| <code>usePrintRangeController~submitWithBackend</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:647</code> |  |
| <code>usePrintRangeController</code> | function | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:191</code> | Hook that encapsulates state, derived values, effects and handlers for PrintRangeDialog. |
| <code>usePrintRangeController~validateRange</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:449</code> |  |
| <code>usePrintRangeController~validateUserFields</code> | constant | <code>src/components/DocumentToolbar/usePrintRangeDialog.js:461</code> |  |
| <code>parsePercentInput</code> | function | <code>src/components/DocumentToolbar/ZoomButtons.jsx:98</code> | Parse a percent-like string safely. |
| <code>CompareZoomOverlay</code> | function | <code>src/components/DocumentViewer/CompareZoomOverlay.jsx:28</code> | CompareZoomOverlay Presentational-only \(no state\). |
| <code>&lt;anonymous&gt;~allowNativeContextMenu</code> | function | <code>src/components/DocumentViewer/DocumentViewer.jsx:328</code> |  |
| <code>&lt;anonymous&gt;~hasActiveModalDialog</code> | function | <code>src/components/DocumentViewer/DocumentViewer.jsx:236</code> |  |
| <code>&lt;anonymous&gt;~isEditableTarget</code> | function | <code>src/components/DocumentViewer/DocumentViewer.jsx:229</code> |  |
| <code>&lt;anonymous&gt;~onKeyDown</code> | function | <code>src/components/DocumentViewer/DocumentViewer.jsx:240</code> |  |
| <code>DocumentViewerRender</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:200</code> | DocumentViewerRender Renders the main document pane and, if enabled, a comparison pane. |
| <code>getPageSelectionContext</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:54</code> |  |
| <code>getWheelDeltaYPx</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:124</code> |  |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:645</code> |  |
| <code>DocumentViewerRender~handlePaneContextMenu</code> | constant | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:671</code> |  |
| <code>DocumentViewerRender~handlePaneWheelCapture</code> | constant | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:403</code> |  |
| <code>&lt;anonymous&gt;~handlePointerDown</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:639</code> |  |
| <code>isAtScrollBottom</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:144</code> |  |
| <code>isAtScrollTop</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:136</code> |  |
| <code>isPaneInteractiveTarget</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:75</code> |  |
| <code>isPannableViewport</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:86</code> |  |
| <code>isPointerOnViewportScrollbar</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:97</code> |  |
| <code>preventDefaultIfCancelable</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:155</code> |  |
| <code>DocumentViewerRender~renderEdgeScrollIndicator</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:746</code> |  |
| <code>DocumentViewerRender~renderPaneSelector</code> | function | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:769</code> |  |
| <code>ViewerContextMenuState</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:38</code> |  |
| <code>ViewerPaneKey</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerRender.jsx:34</code> |  |
| <code>DocumentViewerThumbnails</code> | function | <code>src/components/DocumentViewer/DocumentViewerThumbnails.jsx:42</code> |  |
| <code>DocumentViewerToolbar</code> | function | <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx:127</code> | Renders the toolbar for the document viewer by delegating to . |
| <code>DocumentViewerToolbarProps</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx:36</code> | Props consumed by DocumentViewerToolbar. |
| <code>PageNumberSetter</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx:26</code> | React-like numeric/original page setter used by the toolbar adapter. |
| <code>RefLike</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx:13</code> | Ref-like shape used for imperative handles. |
| <code>SetBooleanState</code> | typedef | <code>src/components/DocumentViewer/DocumentViewerToolbar.jsx:19</code> | State setter that accepts a boolean or an updater callback. |
| <code>&lt;anonymous&gt;~getScope</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:374</code> |  |
| <code>&lt;anonymous&gt;~getTarget</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:363</code> |  |
| <code>module:useViewerEffects~hasActiveModalDialog</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:98</code> | Determine whether a modal dialog is currently open. |
| <code>module:useViewerEffects~isEditableTarget</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:83</code> | Determine whether the event target is an editable or form control where viewer shortcuts must stay inactive. |
| <code>&lt;anonymous&gt;~isNextRepeatKey</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:384</code> |  |
| <code>&lt;anonymous&gt;~isPreviousRepeatKey</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:391</code> |  |
| <code>module:useViewerEffects~KeyboardPrintShortcutBehavior</code> | typedef | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:31</code> |  |
| <code>&lt;anonymous&gt;~onKeyDown</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:329</code> |  |
| <code>&lt;anonymous&gt;~onKeyDown</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:395</code> |  |
| <code>&lt;anonymous&gt;~onKeyUp</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:508</code> |  |
| <code>&lt;anonymous&gt;~onVisibilityChange</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:519</code> |  |
| <code>&lt;anonymous&gt;~onWheelGlobal</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:312</code> |  |
| <code>&lt;anonymous&gt;~onWindowBlur</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:514</code> |  |
| <code>module:useViewerEffects~shouldIgnoreViewerShortcut</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:109</code> | Decide whether a keyboard shortcut should be ignored for the viewer. |
| <code>module:useViewerEffects</code> | module | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:2</code> | File: src/components/DocumentViewer/hooks/useViewerEffects.js Cross-cutting viewer effects: Sync zoomState.scale from numeric zoom Sticky Fit recomputation on relevant changes Res... |
| <code>module:useViewerEffects.useViewerEffects</code> | function | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:121</code> |  |
| <code>module:useViewerEffects~UseViewerEffectsArgs</code> | typedef | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:33</code> | Arguments for useViewerEffects. |
| <code>module:useViewerEffects~ZoomMode</code> | typedef | <code>src/components/DocumentViewer/hooks/useViewerEffects.js:26</code> | Sticky zoom modes used by the viewer. |
| <code>module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomLeft</code> | constant | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:59</code> | Adjust left pane post-zoom by ±0.1 steps. |
| <code>module:useViewerPostZoom.useViewerPostZoom~bumpPostZoomRight</code> | constant | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:68</code> | Adjust right pane post-zoom by ±0.1 steps. |
| <code>module:useViewerPostZoom~clamp</code> | function | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:20</code> | Clamp a numeric value to \[min, max\]. |
| <code>module:useViewerPostZoom.useViewerPostZoom~resetPostZoom</code> | constant | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:50</code> | Reset both per-pane factors to 1.0. |
| <code>module:useViewerPostZoom~round1</code> | function | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:29</code> | Round to one decimal place \(avoids float drift when stepping by 0.1\). |
| <code>module:useViewerPostZoom</code> | module | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:2</code> | File: src/components/DocumentViewer/hooks/useViewerPostZoom.js Encapsulates per-pane &amp;quot;post-zoom&amp;quot; state &amp;amp; handlers used only in compare mode. |
| <code>module:useViewerPostZoom.useViewerPostZoom</code> | function | <code>src/components/DocumentViewer/hooks/useViewerPostZoom.js:45</code> | Hook managing per-pane post-zoom factors for compare mode. |
| <code>useDocumentViewer~activateComparePane</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1509</code> | Open compare mode when needed and make the right pane the default target. |
| <code>useDocumentViewer~activatePrimaryPane</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1501</code> |  |
| <code>useDocumentViewer~applyThumbnailWidth</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1618</code> | Mouse down handler for the thumbnail resizer; listens for mousemove/up on window. |
| <code>buildDocumentSelectionModel</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:357</code> |  |
| <code>buildImageRotationDependencyKey</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:140</code> |  |
| <code>buildSelectionMaskFromPrintPageSequence</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:263</code> | Build an inclusion mask from a print-page sequence. |
| <code>buildVisibleDocumentNavigationModel</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:435</code> | Build the visible-document grouping used by document-level navigation. |
| <code>clampPage</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:45</code> | Clamp a 1-based page number into \[1, total\]. |
| <code>useDocumentViewer~closeCompare</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1537</code> | Close compare mode without affecting the left page. |
| <code>CustomFitSizeLimits</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:66</code> | Optional maximum percentage limits for the custom fit-to-size zoom mode. |
| <code>findNearestVisiblePageNumber</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:300</code> | Resolve the nearest visible page number for a requested original page index. |
| <code>useDocumentViewer~getDocumentNavigationState</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:733</code> | Resolve document-navigation state for the requested pane. |
| <code>getPageDocumentNavigationMeta</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:409</code> |  |
| <code>useDocumentViewer~goToFirstDocument</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1263</code> | Jump to the first page of the first visible document. |
| <code>useDocumentViewer~goToFirstPage</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1219</code> | Jump to the first visible page in the requested target pane. |
| <code>useDocumentViewer~goToLastDocument</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1275</code> | Jump to the first page of the last visible document. |
| <code>useDocumentViewer~goToLastPage</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1228</code> | Jump to the last visible page in the requested target pane. |
| <code>useDocumentViewer~goToNextDocument</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1251</code> | Jump to the first page of the next visible document. |
| <code>useDocumentViewer~goToNextPage</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1210</code> | Move one page forward in the requested target pane. |
| <code>useDocumentViewer~goToPreviousDocument</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1239</code> | Jump to the first page of the previous visible document \(or to the current document start when the active pane already points inside the first visible document\). |
| <code>useDocumentViewer~goToPreviousPage</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1201</code> | Move one page backward in the requested target pane. |
| <code>useDocumentViewer~handleBrightnessChange</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1573</code> |  |
| <code>useDocumentViewer~handleCompare</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1519</code> | Toggle compare mode. |
| <code>useDocumentViewer~handleContrastChange</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1585</code> |  |
| <code>useDocumentViewer~handlePageNumberChange</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1117</code> | Change the primary page using an original page number \(or a visible-page updater function when called from navigation helpers\). |
| <code>useDocumentViewer~handlePrimaryDisplayStateChange</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1165</code> | Keep requested-page state and the actually displayed page synchronized for diagnostics. |
| <code>useDocumentViewer~handleVisiblePageNumberChange</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1126</code> | Change the primary page by a visible page number from the thumbnail strip. |
| <code>hasExcludedPages</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:173</code> | Return true when the normalized mask excludes at least one page from the current session. |
| <code>useDocumentViewer~hideDocumentFromSelection</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:992</code> | Immediately exclude every page that belongs to the same document as the provided original page index. |
| <code>useDocumentViewer~hidePageFromSelection</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:954</code> | Immediately exclude a page from the active selection and apply the filtered session. |
| <code>ImageProperties</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:78</code> | Image adjustment properties for canvas edit mode. |
| <code>isNaturalPrintPageSequence</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:282</code> |  |
| <code>masksEqual</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:190</code> | Compare two selection masks over the active page count. |
| <code>normalizeOriginalPageIndex</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:221</code> | Normalize a zero-based original page index and reject invalid/out-of-range values. |
| <code>normalizePrintPageSequence</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:235</code> |  |
| <code>normalizeRotationDegrees</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:61</code> | Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer. |
| <code>normalizeSelectionMask</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:153</code> | Normalize a persisted/host-provided page-selection mask to the current page count. |
| <code>normalizeViewerPaneTarget</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:499</code> | Normalize any pane key into the viewer&#39;s two supported navigation targets. |
| <code>&lt;anonymous&gt;~onMove</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:1704</code> |  |
| <code>PrintPageSequence</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:76</code> |  |
| <code>resolveDocumentSelectionPageNumber</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:340</code> | Resolve a page&#39;s 1-based page number within the current document-selection group. |
| <code>resolveEffectiveCustomFitSizeLimits</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:113</code> | Resolve effective custom-fit limits from a preferred value set and runtime config. |
| <code>useDocumentViewer~resolveNearestVisibleOriginalPageNumber</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:811</code> |  |
| <code>resolveOriginalIndexFromPrintPageNumber</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:205</code> | Convert a 1-based print/session page number to a zero-based original page index. |
| <code>resolveProposedVisiblePageNumber</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:324</code> | Resolve either a direct visible-page value or a React setState-style updater function. |
| <code>useDocumentViewer~resolveTargetOriginalPageNumber</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1069</code> | Resolve the next original 1-based page number from a visible-page update. |
| <code>useDocumentViewer~selectForCompare</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1552</code> | Select a page for the right-hand compare pane. |
| <code>SelectionMask</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:75</code> |  |
| <code>useDocumentViewer~setActivePane</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1494</code> | Set the default pane for compare-aware navigation and editing actions. |
| <code>useDocumentViewer~setComparePageNumber</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1153</code> | Change the compare page using an original page number \(or a visible-page updater function when called from compare navigation helpers\). |
| <code>useDocumentViewer~setIsExpanded</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1482</code> | Setter for the editing controls visibility. |
| <code>useDocumentViewer~setVisibleComparePageNumber</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1139</code> | Change the compare page by a visible page number from the toolbar page field. |
| <code>useDocumentViewer~setZoomMode</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1389</code> | Set zoom mode directly \(&#39;FIT_PAGE&#39;\|&#39;FIT_WIDTH&#39;\|&#39;FIT_CUSTOM&#39;\|&#39;ACTUAL_SIZE&#39;\|&#39;CUSTOM&#39;\). |
| <code>useDocumentViewer~thumbnailSelectionPageNumber</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1193</code> | The thumbnail pane should react immediately when the user changes page. |
| <code>useDocumentViewer~toggleFitZoomMode</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1466</code> | Toggle between the two fit modes from the page surface. |
| <code>useDocumentViewer~updatePageTarget</code> | constant | <code>src/components/DocumentViewer/useDocumentViewer.js:1092</code> | Generic primary/compare page setter that accepts either a visible-page updater function or a concrete original page number. |
| <code>useDocumentViewer</code> | function | <code>src/components/DocumentViewer/useDocumentViewer.js:520</code> | Hook that centralizes viewer UI state and event handlers. |
| <code>ViewerPageTarget</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:77</code> |  |
| <code>ZoomMode</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:481</code> | Sticky zoom modes used by the viewer \(subset is used here\). |
| <code>ZoomState</code> | typedef | <code>src/components/DocumentViewer/useDocumentViewer.js:486</code> | Zoom state \(mode + current numeric scale\). |
| <code>ImageRenderer</code> | constant | <code>src/components/ImageRenderer.jsx:51</code> | ImageRenderer component. |
| <code>ImgEventHandler</code> | typedef | <code>src/components/ImageRenderer.jsx:28</code> | Image load/error handler. |
| <code>LoadingMessage</code> | function | <code>src/components/LoadingMessage.jsx:43</code> | LoadingMessage component. |
| <code>LoadingSpinner.propTypes.className</code> | member | <code>src/components/LoadingSpinner.jsx:87</code> | Extra classes to append to the root element. |
| <code>LoadingSpinner.propTypes.label</code> | member | <code>src/components/LoadingSpinner.jsx:85</code> | Accessible label announced by assistive technologies. |
| <code>LoadingSpinner</code> | function | <code>src/components/LoadingSpinner.jsx:55</code> | LoadingSpinner component. |
| <code>LoadingSpinner.propTypes.size</code> | member | <code>src/components/LoadingSpinner.jsx:83</code> | Optional width/height; if omitted, CSS controls dimensions. |
| <code>srOnlyStyle</code> | constant | <code>src/components/LoadingSpinner.jsx:33</code> | Inline “visually hidden” style for screen-reader-only text \(no CSS dependency\). |
| <code>&lt;anonymous&gt;~handleDone</code> | function | <code>src/components/PrintSelectionWorkspace.jsx:1815</code> |  |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/PrintSelectionWorkspace.jsx:1755</code> |  |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | function | <code>src/components/PrintSelectionWorkspace.jsx:1788</code> |  |
| <code>&lt;anonymous&gt;~handleMove</code> | function | <code>src/components/PrintSelectionWorkspace.jsx:1808</code> |  |
| <code>Resizer.propTypes.ariaLabel</code> | member | <code>src/components/Resizer.jsx:103</code> | Accessible name for assistive technologies. |
| <code>Resizer.propTypes.className</code> | member | <code>src/components/Resizer.jsx:105</code> | Extra class names to append to the root element. |
| <code>&lt;anonymous&gt;~handleKeyDown</code> | constant | <code>src/components/Resizer.jsx:70</code> | Keyboard handler \(Enter/Space\) to initiate the same flow as mouse down. |
| <code>Resizer.propTypes.onMouseDown</code> | member | <code>src/components/Resizer.jsx:99</code> | Initiates resize in the parent \(mouse or keyboard-initiated\). |
| <code>Resizer.propTypes.orientation</code> | member | <code>src/components/Resizer.jsx:101</code> | Visual/semantic orientation of the separator. |
| <code>Resizer</code> | constant | <code>src/components/Resizer.jsx:61</code> | Resizer component. |
| <code>ResizerProps</code> | typedef | <code>src/components/Resizer.jsx:43</code> | Props for . |
| <code>ResizeStartHandler</code> | typedef | <code>src/components/Resizer.jsx:36</code> | Handler invoked when a resize interaction is initiated. |
| <code>module.exports</code> | function | <code>src/components/ViewerProblemNotice.jsx:197</code> |  |
| <code>ProblemNoticeTrigger</code> | typedef | <code>src/components/ViewerProblemNotice.jsx:26</code> |  |
| <code>resolveProblemTrigger</code> | function | <code>src/components/ViewerProblemNotice.jsx:44</code> |  |
| <code>toCount</code> | function | <code>src/components/ViewerProblemNotice.jsx:21</code> |  |
| <code>ThemeContext</code> | constant | <code>src/contexts/themeContext.js:26</code> | Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake. |
| <code>ThemeContextValue</code> | typedef | <code>src/contexts/themeContext.js:10</code> | Context value shape for the theme. |
| <code>ThemeMode</code> | typedef | <code>src/contexts/themeContext.js:4</code> | Theme identifier. |
| <code>applyThemeToDocument</code> | function | <code>src/contexts/ThemeProvider.jsx:69</code> | Apply the resolved theme to the DOM \(SSR-safe\). |
| <code>detectSystemTheme</code> | function | <code>src/contexts/ThemeProvider.jsx:38</code> | Detect system preferred color scheme \(SSR-safe; defaults to light\). |
| <code>&lt;anonymous&gt;~onChange</code> | function | <code>src/contexts/ThemeProvider.jsx:162</code> |  |
| <code>resolveInitialThemeMode</code> | function | <code>src/contexts/ThemeProvider.jsx:87</code> | Resolve the initial theme mode once during provider initialization. |
| <code>resolveThemeForMode</code> | function | <code>src/contexts/ThemeProvider.jsx:55</code> | Resolve the concrete theme for a theme mode. |
| <code>ThemeProvider~setThemeExplicit</code> | constant | <code>src/contexts/ThemeProvider.jsx:139</code> | Apply an explicit concrete theme. |
| <code>ThemeProvider~setThemeMode</code> | constant | <code>src/contexts/ThemeProvider.jsx:119</code> | Persist and apply a theme mode. |
| <code>ThemeMode</code> | typedef | <code>src/contexts/ThemeProvider.jsx:27</code> | Theme mode identifier. |
| <code>ThemeName</code> | typedef | <code>src/contexts/ThemeProvider.jsx:22</code> | Theme identifier. |
| <code>ThemeProvider</code> | constant | <code>src/contexts/ThemeProvider.jsx:103</code> | ThemeProvider component to manage and provide theme-related state and functions. |
| <code>ThemeProvider~toggleTheme</code> | constant | <code>src/contexts/ThemeProvider.jsx:149</code> | Toggle between the two highest-contrast explicit themes. |
| <code>DisposeDocumentSessionOptions</code> | typedef | <code>src/contexts/viewerContext.js:40</code> |  |
| <code>DocumentSessionInitOptions</code> | typedef | <code>src/contexts/viewerContext.js:32</code> |  |
| <code>EnsurePageAssetOptions</code> | typedef | <code>src/contexts/viewerContext.js:55</code> |  |
| <code>StoreSourceBlobInput</code> | typedef | <code>src/contexts/viewerContext.js:45</code> |  |
| <code>ViewerContextValue</code> | typedef | <code>src/contexts/viewerContext.js:165</code> |  |
| <code>ViewerPageEntry</code> | typedef | <code>src/contexts/viewerContext.js:4</code> |  |
| <code>ViewerPageLoadState</code> | typedef | <code>src/contexts/viewerContext.js:155</code> |  |
| <code>ViewerRuntimeDiagnostics</code> | typedef | <code>src/contexts/viewerContext.js:78</code> |  |
| <code>ViewerSourceDescriptor</code> | typedef | <code>src/contexts/viewerContext.js:65</code> |  |
| <code>ViewerProvider~addMessage</code> | constant | <code>src/contexts/ViewerProvider.jsx:918</code> |  |
| <code>ViewerProvider~announceIndexedDbAssetMode</code> | constant | <code>src/contexts/ViewerProvider.jsx:1243</code> |  |
| <code>ViewerProvider~applySessionConfig</code> | constant | <code>src/contexts/ViewerProvider.jsx:933</code> |  |
| <code>ViewerProvider~clearPageAssetReference</code> | constant | <code>src/contexts/ViewerProvider.jsx:1392</code> | Drop a page&#39;s current object URL reference from React state and the in-memory cache. |
| <code>ViewerProvider~clearWarmupQueue</code> | constant | <code>src/contexts/ViewerProvider.jsx:960</code> |  |
| <code>ViewerProvider~collectRuntimeDiagnostics</code> | constant | <code>src/contexts/ViewerProvider.jsx:519</code> | Collect a stable snapshot of runtime counters for the optional diagnostics overlay. |
| <code>createLimiter</code> | function | <code>src/contexts/ViewerProvider.jsx:203</code> |  |
| <code>ViewerProvider~disposeDocumentSession</code> | constant | <code>src/contexts/ViewerProvider.jsx:1032</code> |  |
| <code>DisposeDocumentSessionOptions</code> | typedef | <code>src/contexts/ViewerProvider.jsx:47</code> |  |
| <code>DocumentSessionInitOptions</code> | typedef | <code>src/contexts/ViewerProvider.jsx:41</code> |  |
| <code>ViewerProvider~enforceCacheLimit</code> | constant | <code>src/contexts/ViewerProvider.jsx:1490</code> |  |
| <code>ViewerProvider~enhancePdfPageResolution</code> | constant | <code>src/contexts/ViewerProvider.jsx:1862</code> | Render one PDF page again at twice the configured full-page PDF scale. |
| <code>ViewerProvider~ensurePageAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1701</code> |  |
| <code>EnsurePageAssetOptions</code> | typedef | <code>src/contexts/ViewerProvider.jsx:62</code> |  |
| <code>getPageAt</code> | function | <code>src/contexts/ViewerProvider.jsx:135</code> |  |
| <code>ViewerProvider~getPrintablePageUrls</code> | constant | <code>src/contexts/ViewerProvider.jsx:2239</code> |  |
| <code>ViewerProvider~getVariantCache</code> | constant | <code>src/contexts/ViewerProvider.jsx:1370</code> |  |
| <code>ViewerProvider~getVariantCacheLimit</code> | constant | <code>src/contexts/ViewerProvider.jsx:1466</code> |  |
| <code>ViewerProvider~initializeDocumentSession</code> | constant | <code>src/contexts/ViewerProvider.jsx:969</code> |  |
| <code>ViewerProvider~insertPageAtIndex</code> | constant | <code>src/contexts/ViewerProvider.jsx:832</code> |  |
| <code>ViewerProvider~insertPagesAtIndex</code> | constant | <code>src/contexts/ViewerProvider.jsx:849</code> |  |
| <code>isBlobObjectUrl</code> | function | <code>src/contexts/ViewerProvider.jsx:169</code> |  |
| <code>isPageFailedForSession</code> | function | <code>src/contexts/ViewerProvider.jsx:195</code> |  |
| <code>isPageReadyForSession</code> | function | <code>src/contexts/ViewerProvider.jsx:187</code> |  |
| <code>isPdfPageEntry</code> | function | <code>src/contexts/ViewerProvider.jsx:108</code> |  |
| <code>isReusableAssetUrl</code> | function | <code>src/contexts/ViewerProvider.jsx:177</code> |  |
| <code>makeAssetKey</code> | function | <code>src/contexts/ViewerProvider.jsx:77</code> |  |
| <code>makePdfResolutionPageKey</code> | function | <code>src/contexts/ViewerProvider.jsx:98</code> |  |
| <code>makePendingAssetKey</code> | function | <code>src/contexts/ViewerProvider.jsx:87</code> |  |
| <code>makePersistedAssetKey</code> | function | <code>src/contexts/ViewerProvider.jsx:118</code> |  |
| <code>ViewerProvider~maybeReleaseSinglePageRasterSource</code> | constant | <code>src/contexts/ViewerProvider.jsx:1255</code> |  |
| <code>createLimiter~normalizePriority</code> | function | <code>src/contexts/ViewerProvider.jsx:214</code> |  |
| <code>ViewerProvider~noteFullAssetReady</code> | constant | <code>src/contexts/ViewerProvider.jsx:496</code> | Record that a page now has a reusable full-size asset available. |
| <code>ViewerProvider~noteThumbnailAssetReady</code> | constant | <code>src/contexts/ViewerProvider.jsx:506</code> | Record that a page now has a reusable thumbnail asset available. |
| <code>ViewerProvider~patchPageAtIndex</code> | constant | <code>src/contexts/ViewerProvider.jsx:870</code> |  |
| <code>ViewerProvider~persistRenderedAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1302</code> |  |
| <code>ViewerProvider~pinPageAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1444</code> |  |
| <code>ViewerProvider~pumpWarmupQueue</code> | constant | <code>src/contexts/ViewerProvider.jsx:2105</code> | Drain background eager-render work without blocking the UI thread. |
| <code>ViewerProvider~readSourceArrayBuffer</code> | constant | <code>src/contexts/ViewerProvider.jsx:1226</code> |  |
| <code>ViewerProvider~readSourceBlob</code> | constant | <code>src/contexts/ViewerProvider.jsx:1235</code> |  |
| <code>ViewerProvider~recordLoaderPhaseTiming</code> | constant | <code>src/contexts/ViewerProvider.jsx:1925</code> |  |
| <code>ViewerProvider~registerSourceDescriptor</code> | constant | <code>src/contexts/ViewerProvider.jsx:1183</code> |  |
| <code>ViewerProvider~renderPageBlob</code> | constant | <code>src/contexts/ViewerProvider.jsx:1615</code> |  |
| <code>ViewerProvider~resetViewerState</code> | constant | <code>src/contexts/ViewerProvider.jsx:672</code> |  |
| <code>resolvePatch</code> | function | <code>src/contexts/ViewerProvider.jsx:145</code> |  |
| <code>ViewerProvider~restorePersistedAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1548</code> |  |
| <code>ViewerProvider~revokeSessionUrls</code> | constant | <code>src/contexts/ViewerProvider.jsx:650</code> |  |
| <code>ViewerProvider~scheduleSourceWarmup</code> | constant | <code>src/contexts/ViewerProvider.jsx:2196</code> | Enqueue eager page rendering for a newly discovered source range. |
| <code>ViewerProvider~shouldReuseFullAssetForThumbnail</code> | constant | <code>src/contexts/ViewerProvider.jsx:1535</code> |  |
| <code>ViewerProvider~storeSourceBlob</code> | constant | <code>src/contexts/ViewerProvider.jsx:1202</code> |  |
| <code>StoreSourceBlobInput</code> | typedef | <code>src/contexts/ViewerProvider.jsx:52</code> |  |
| <code>touchCacheEntry</code> | function | <code>src/contexts/ViewerProvider.jsx:158</code> |  |
| <code>ViewerProvider~touchPageAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1379</code> |  |
| <code>ViewerProvider~tryRenderPdfWarmupBatch</code> | constant | <code>src/contexts/ViewerProvider.jsx:1947</code> | Try to render a full-page PDF warm-up batch through the partitioned worker path. |
| <code>ViewerProvider~unpinPageAsset</code> | constant | <code>src/contexts/ViewerProvider.jsx:1455</code> |  |
| <code>ViewerProvider~updateAllPages</code> | constant | <code>src/contexts/ViewerProvider.jsx:472</code> |  |
| <code>ViewerProvider</code> | constant | <code>src/contexts/ViewerProvider.jsx:324</code> |  |
| <code>ViewerProviderProps</code> | typedef | <code>src/contexts/ViewerProvider.jsx:313</code> |  |
| <code>componentDidCatch</code> | function | <code>src/ErrorBoundary.jsx:152</code> | Log error details for diagnostics. |
| <code>module.exports#copyDetails</code> | member | <code>src/ErrorBoundary.jsx:189</code> | Copy a concise diagnostic bundle to the clipboard \(best effort\). |
| <code>ErrorBoundaryProps</code> | typedef | <code>src/ErrorBoundary.jsx:103</code> | Props for the ErrorBoundary component. |
| <code>ErrorBoundaryState</code> | typedef | <code>src/ErrorBoundary.jsx:115</code> | Internal state for the ErrorBoundary. |
| <code>module.exports</code> | class | <code>src/ErrorBoundary.jsx:130</code> | React Error Boundary implementation with: runtime-controlled stack visibility copy-to-clipboard helper for diagnostics reset handler to re-render child tree |
| <code>getDerivedStateFromError</code> | function | <code>src/ErrorBoundary.jsx:139</code> |  |
| <code>IS_DEV</code> | constant | <code>src/ErrorBoundary.jsx:34</code> | Determine whether we are in development mode. |
| <code>readConfigFlag</code> | function | <code>src/ErrorBoundary.jsx:80</code> | Read a runtime configuration flag \(SSR-safe\). |
| <code>render</code> | function | <code>src/ErrorBoundary.jsx:208</code> |  |
| <code>module.exports#reset</code> | member | <code>src/ErrorBoundary.jsx:166</code> | Reset the boundary and optionally call the external onReset handler. |
| <code>toBool</code> | function | <code>src/ErrorBoundary.jsx:59</code> | Coerce unknown values to boolean using common string/number forms. |
| <code>tr</code> | function | <code>src/ErrorBoundary.jsx:45</code> | Tiny helper to translate with safe fallback \(NS: &#39;common&#39;\). |
| <code>module.exports</code> | function | <code>src/hooks/useAcceleratingHoldRepeat.js:57</code> |  |
| <code>&lt;anonymous&gt;~applyState</code> | function | <code>src/hooks/useNavigationModifierState.js:59</code> |  |
| <code>&lt;anonymous&gt;~clearState</code> | function | <code>src/hooks/useNavigationModifierState.js:71</code> |  |
| <code>&lt;anonymous&gt;~handleVisibilityChange</code> | function | <code>src/hooks/useNavigationModifierState.js:88</code> |  |
| <code>hasActiveModalDialog</code> | function | <code>src/hooks/useNavigationModifierState.js:25</code> |  |
| <code>NavigationModifierState</code> | typedef | <code>src/hooks/useNavigationModifierState.js:16</code> |  |
| <code>resolveModifierState</code> | function | <code>src/hooks/useNavigationModifierState.js:34</code> |  |
| <code>&lt;anonymous&gt;~syncModifierState</code> | function | <code>src/hooks/useNavigationModifierState.js:79</code> |  |
| <code>useNavigationModifierState</code> | function | <code>src/hooks/useNavigationModifierState.js:44</code> |  |
| <code>usePageNavigation~fastNext</code> | constant | <code>src/hooks/usePageNavigation.js:140</code> | Fast step: next \(used by timers\). |
| <code>usePageNavigation~fastPrev</code> | constant | <code>src/hooks/usePageNavigation.js:131</code> | Fast step: previous \(used by timers\). |
| <code>usePageNavigation~handleFirstPageWrapper</code> | constant | <code>src/hooks/usePageNavigation.js:104</code> | Wrapper: go to first page. |
| <code>usePageNavigation~handleLastPageWrapper</code> | constant | <code>src/hooks/usePageNavigation.js:117</code> | Wrapper: go to last page. |
| <code>usePageNavigation~handleNextPageWrapper</code> | constant | <code>src/hooks/usePageNavigation.js:91</code> | Wrapper: go to next page \(logs once per user action\). |
| <code>usePageNavigation~handlePrevPageWrapper</code> | constant | <code>src/hooks/usePageNavigation.js:78</code> | Wrapper: go to previous page \(logs once per user action\). |
| <code>PageNavigationAPI</code> | typedef | <code>src/hooks/usePageNavigation.js:49</code> | API returned by usePageNavigation. |
| <code>usePageNavigation</code> | function | <code>src/hooks/usePageNavigation.js:69</code> | Custom hook to handle document page navigation with keyboard/mouse. |
| <code>DEFAULT_REPEAT_INTERVAL_MS</code> | constant | <code>src/hooks/usePageTimer.js:41</code> | Default repeat cadence \(ms\). |
| <code>PageDirection</code> | typedef | <code>src/hooks/usePageTimer.js:38</code> |  |
| <code>PageTimerAPI</code> | typedef | <code>src/hooks/usePageTimer.js:43</code> | API returned by usePageTimer. |
| <code>usePageTimer~startPageTimer</code> | constant | <code>src/hooks/usePageTimer.js:75</code> | Start the timer for continuous page navigation. |
| <code>usePageTimer~stopPageTimer</code> | constant | <code>src/hooks/usePageTimer.js:123</code> | Stop any active delay or interval timer \(idempotent\). |
| <code>usePageTimer</code> | function | <code>src/hooks/usePageTimer.js:60</code> | Custom hook to handle page change with a timer for continuous navigation. |
| <code>appendQuery</code> | function | <code>src/i18n.js:140</code> | Helper: append query params safely to a URL. |
| <code>BUNDLED_I18N_RESOURCE_REVISION</code> | constant | <code>src/i18n.js:90</code> | Fallback cache-busting token for bundled locale resources. |
| <code>computeBaseHref</code> | function | <code>src/i18n.js:372</code> | Compute a normalized base href. |
| <code>DIAGNOSTIC_RELOAD_DELAY_MS</code> | constant | <code>src/i18n.js:99</code> | Dev-only reload delay after diagnostic localStorage writes. |
| <code>getBaseLanguageCode</code> | function | <code>src/i18n.js:243</code> | Extract the lowercase base language code from a locale candidate. |
| <code>getI18nVersion</code> | function | <code>src/i18n.js:111</code> | Return cache-busting version token \(see header\). |
| <code>getImportMetaEnv</code> | function | <code>src/i18n.js:57</code> | Return Vite import.meta.env safely. |
| <code>getNormalizedSupportedLanguages</code> | function | <code>src/i18n.js:257</code> | Normalize configured supported languages to non-empty base language codes. |
| <code>getSafeWindow</code> | function | <code>src/i18n.js:40</code> | Return browser window safely in browser, SSR, test, and documentation contexts. |
| <code>getStaticI18nDefaults</code> | function | <code>src/i18n.js:217</code> | Compute app config &amp;amp; defaults safely. |
| <code>getUnsupportedVersionPlaceholders</code> | function | <code>src/i18n.js:173</code> | Find malformed version-like placeholders in loadPath without extra array passes. |
| <code>IS_DEV</code> | constant | <code>src/i18n.js:68</code> | Dev-mode detector \(Vite + Node envs\). |
| <code>normalizeSupportedLanguage</code> | function | <code>src/i18n.js:272</code> | Normalize an arbitrary language candidate to a supported base language. |
| <code>normalizeVersionToken</code> | function | <code>src/i18n.js:102</code> | Normalize optional version tokens from runtime config or globals. |
| <code>readQuery</code> | function | <code>src/i18n.js:73</code> | Read a query parameter by name \(no deps\). |
| <code>reloadAfterDiagnosticStorageWrite</code> | function | <code>src/i18n.js:196</code> | Refresh i18n resources after a diagnostic localStorage write. |
| <code>resolveInitialLanguage</code> | function | <code>src/i18n.js:302</code> | Resolve the initial UI language without relying on persisted i18next cache state. |
| <code>resolveLoadPath</code> | function | <code>src/i18n.js:390</code> | Resolve the final translation URL at request time \(with cache buster\). |
| <code>sanitizeI18nPathSegment</code> | function | <code>src/i18n.js:161</code> | Keep i18n URL template substitutions constrained to plain path segments. |
| <code>syncDocumentLanguage</code> | function | <code>src/i18n.js:353</code> | Keep the document language synchronized with the active UI language. |
| <code>WANT_DIAG</code> | constant | <code>src/i18n.js:82</code> | Diagnostics ON only in dev builds. |
| <code>container</code> | constant | <code>src/index.jsx:44</code> | Mount the app into #root. |
| <code>isDev</code> | constant | <code>src/index.jsx:34</code> | Determine environment and set a sensible client-side log level. |
| <code>BootstrapAny</code> | typedef | <code>src/integrations/bootstrapRuntime.js:44</code> |  |
| <code>BootstrapDebugInfo</code> | typedef | <code>src/integrations/bootstrapRuntime.js:33</code> | Opaque information about how startup data reached the viewer. |
| <code>bootstrapDetect</code> | function | <code>src/integrations/bootstrapRuntime.js:243</code> | Detect the best available bootstrap mode. |
| <code>BootstrapDetectOptions</code> | typedef | <code>src/integrations/bootstrapRuntime.js:58</code> | Options controlling bootstrap diagnostics collection. |
| <code>makeDebugInfo</code> | function | <code>src/integrations/bootstrapRuntime.js:117</code> | Build the debug envelope returned to the app shell. |
| <code>ODV_BOOTSTRAP_MODES</code> | constant | <code>src/integrations/bootstrapRuntime.js:24</code> | Canonical bootstrap modes. |
| <code>ODVHostApi</code> | typedef | <code>src/integrations/bootstrapRuntime.js:51</code> | Host API shape exposed on window.ODV. |
| <code>bootstrapDetect~probeParent</code> | function | <code>src/integrations/bootstrapRuntime.js:256</code> |  |
| <code>bootstrapDetect~probeSessionToken</code> | function | <code>src/integrations/bootstrapRuntime.js:284</code> |  |
| <code>bootstrapDetect~probeSessionUrl</code> | function | <code>src/integrations/bootstrapRuntime.js:270</code> |  |
| <code>&lt;anonymous&gt;~api.start</code> | function | <code>src/integrations/bootstrapRuntime.js:81</code> | Queue a start payload to be consumed by bootstrapDetect\(\). |
| <code>tryNormalizeBundle</code> | function | <code>src/integrations/bootstrapRuntime.js:94</code> | Try to normalize a candidate payload into a bundle with documents. |
| <code>normalizeToPortableBundle</code> | function | <code>src/integrations/normalizePortableBundle.js:116</code> | Normalize many incoming shapes to a neutral PortableDocumentBundle v1. |
| <code>PortableBundleMetadataAliasMap</code> | typedef | <code>src/integrations/normalizePortableBundle.js:94</code> | Runtime-configurable mapping between semantic metadata aliases and metadata record identifiers used by a host-specific object-document payload. |
| <code>PortableDocumentBundle</code> | typedef | <code>src/integrations/normalizePortableBundle.js:85</code> | A portable bundle groups a session and an array of document entries. |
| <code>PortableDocumentEntry</code> | typedef | <code>src/integrations/normalizePortableBundle.js:73</code> | A single document entry containing one or more files. |
| <code>PortableDocumentFile</code> | typedef | <code>src/integrations/normalizePortableBundle.js:27</code> | A single file reference inside a document. |
| <code>PortableMetadataAliasDetail</code> | typedef | <code>src/integrations/normalizePortableBundle.js:54</code> | One resolved semantic alias derived from raw metadata records. |
| <code>PortableMetadataRecord</code> | typedef | <code>src/integrations/normalizePortableBundle.js:38</code> | A normalized raw metadata record attached to a document. |
| <code>PortableSession</code> | typedef | <code>src/integrations/normalizePortableBundle.js:20</code> | Session info stored on a bundle. |
| <code>spreadUnknown</code> | function | <code>src/integrations/normalizePortableBundle.js:240</code> | Preserve unknown own enumerable properties from host input while excluding keys that were already normalized explicitly. |
| <code>b64DecodeUnicode</code> | function | <code>src/integrations/parentBridge.js:88</code> | Decode a base64-encoded Unicode string into text \(handles UTF-8\). |
| <code>getSameOriginOpener</code> | function | <code>src/integrations/parentBridge.js:52</code> | Try to obtain a same-origin opener window reference. |
| <code>getSameOriginParent</code> | function | <code>src/integrations/parentBridge.js:30</code> | Try to obtain a same-origin parent window reference. |
| <code>ParentBootstrapResult</code> | typedef | <code>src/integrations/parentBridge.js:15</code> | Result object when data is obtained from a same-origin parent. |
| <code>readFromOpener</code> | function | <code>src/integrations/parentBridge.js:168</code> | Attempt to read a bootstrap object from a same-origin opener. |
| <code>readFromParent</code> | function | <code>src/integrations/parentBridge.js:159</code> | Attempt to read a bootstrap object from a same-origin parent. |
| <code>readFromRelatedWindow</code> | function | <code>src/integrations/parentBridge.js:177</code> | Attempt to read a bootstrap object from a same-origin parent or opener. |
| <code>readFromWindow</code> | function | <code>src/integrations/parentBridge.js:107</code> | Attempt to read a bootstrap object from a same-origin related window. |
| <code>safeClone</code> | function | <code>src/integrations/parentBridge.js:73</code> | Perform a safe, structured clone of serializable data. |
| <code>b64DecodeUnicode</code> | function | <code>src/integrations/sessionToken.js:75</code> | Decode a Base64 string into a UTF-8 JavaScript string. |
| <code>MAX_B64_LEN</code> | constant | <code>src/integrations/sessionToken.js:34</code> | Upper bound for the Base64 token length \(~200 KB base64 ≈ 150 KB raw\). |
| <code>MAX_RAW_LEN</code> | constant | <code>src/integrations/sessionToken.js:36</code> | Upper bound for the decoded raw string length. |
| <code>normalizeBase64</code> | function | <code>src/integrations/sessionToken.js:54</code> | Normalize a Base64 string to a decodable form: Trim whitespace Convert URL-safe chars &#39;-&#39; → &#39;+&#39;, &#39;_&#39; → &#39;/&#39; Add &#39;=&#39; padding to reach a length divisible by 4 |
| <code>readFromSessionToken</code> | function | <code>src/integrations/sessionToken.js:104</code> | Read and decode a session payload from the URL query string. |
| <code>SessionTokenResult</code> | typedef | <code>src/integrations/sessionToken.js:38</code> | Session token read result. |
| <code>MAX_RESPONSE_TEXT_LEN</code> | constant | <code>src/integrations/sessionUrl.js:9</code> | Fetch a host-prepared Portable Document Bundle from a short URL query value. |
| <code>readFromSessionUrl</code> | function | <code>src/integrations/sessionUrl.js:85</code> | Read and fetch a session payload URL from the viewer query string. |
| <code>SessionUrlResult</code> | typedef | <code>src/integrations/sessionUrl.js:12</code> |  |
| <code>parsePositiveInt</code> | function | <code>src/integrations/urlParams.js:64</code> | Parse a positive integer from a string. |
| <code>pick</code> | function | <code>src/integrations/urlParams.js:51</code> | Pick the first non-empty value among a list of candidate query keys. |
| <code>readFromUrlParams</code> | function | <code>src/integrations/urlParams.js:83</code> | Reads common query params used by the demo and other hosts. |
| <code>UrlParamsData</code> | typedef | <code>src/integrations/urlParams.js:32</code> |  |
| <code>UrlParamsResult</code> | typedef | <code>src/integrations/urlParams.js:39</code> |  |
| <code>clearTimeoutSafe</code> | function | <code>src/integrations/viewerEvents.js:187</code> | Clear a timer if it exists \(tiny helper\). |
| <code>createCustomEvent</code> | function | <code>src/integrations/viewerEvents.js:56</code> | Create a CustomEvent with best-effort fallback for older browsers. |
| <code>emitODVEvent</code> | function | <code>src/integrations/viewerEvents.js:79</code> | Emit a namespaced OpenDocViewer event with an optional detail payload. |
| <code>ODVEventHandler</code> | typedef | <code>src/integrations/viewerEvents.js:29</code> | Listener signature for ODV events. |
| <code>OnceEventResult</code> | typedef | <code>src/integrations/viewerEvents.js:43</code> | Result returned by onceODVEvent when the event fires. |
| <code>onceODVEvent</code> | function | <code>src/integrations/viewerEvents.js:152</code> | Wait for a single occurrence of an event and resolve with { event, detail } . |
| <code>OnceOptions</code> | typedef | <code>src/integrations/viewerEvents.js:37</code> | Options for onceODVEvent. |
| <code>onODVEvent</code> | function | <code>src/integrations/viewerEvents.js:110</code> | Attach a listener for a given OpenDocViewer event. |
| <code>circularReplacer</code> | function | <code>src/logging/systemLogger.js:196</code> | Create a JSON replacer that: prevents circular references leaves values otherwise intact |
| <code>LogController#debug</code> | member | <code>src/logging/systemLogger.js:417</code> |  |
| <code>LogController#disableBackendLogging</code> | member | <code>src/logging/systemLogger.js:365</code> | Disable backend forwarding after a non-recoverable configuration/runtime failure. |
| <code>LogController#error</code> | member | <code>src/logging/systemLogger.js:426</code> |  |
| <code>LogController#info</code> | member | <code>src/logging/systemLogger.js:420</code> |  |
| <code>levelGte</code> | function | <code>src/logging/systemLogger.js:186</code> | Compare two log levels \(is a &amp;gt;= b ?\). |
| <code>LogController#log</code> | member | <code>src/logging/systemLogger.js:338</code> | Log a message with a given level and optional context. |
| <code>LOG_LEVELS</code> | constant | <code>src/logging/systemLogger.js:44</code> | Valid log levels in ascending verbosity. |
| <code>LogController</code> | class | <code>src/logging/systemLogger.js:210</code> | LogController — small facade around console + optional HTTP forwarding. |
| <code>logger</code> | constant | <code>src/logging/systemLogger.js:430</code> | Export a singleton instance \(sufficient for app usage\). |
| <code>LogLevel</code> | typedef | <code>src/logging/systemLogger.js:41</code> |  |
| <code>NOOP</code> | function | <code>src/logging/systemLogger.js:47</code> | No-op function used when we want to swallow calls cleanly. |
| <code>normalizeLevel</code> | function | <code>src/logging/systemLogger.js:175</code> | Normalize and validate a log level. |
| <code>readMeta</code> | function | <code>src/logging/systemLogger.js:54</code> | Resolve a string from a meta tag \(SSR-safe\). |
| <code>readMetaBool</code> | function | <code>src/logging/systemLogger.js:69</code> | Resolve a boolean from a meta tag content. |
| <code>readRuntimeConfig</code> | function | <code>src/logging/systemLogger.js:81</code> | Resolve a runtime config snapshot from runtime globals \(SSR-safe\). |
| <code>resolveAuthToken</code> | function | <code>src/logging/systemLogger.js:146</code> | Resolve the shared auth token used for posting to /log. |
| <code>resolveBackendUrl</code> | function | <code>src/logging/systemLogger.js:115</code> | Resolve a candidate backend URL using precedence rules and make it absolute relative to document.baseURI \(SSR-safe\). |
| <code>resolveEnabledOverride</code> | function | <code>src/logging/systemLogger.js:163</code> | Resolve an explicit &amp;quot;enabled&amp;quot; boolean if one exists. |
| <code>LogController#sendLogToBackend</code> | member | <code>src/logging/systemLogger.js:383</code> | Attempt to POST the log to the backend, with simple linear retries. |
| <code>LogController#setAuthToken</code> | member | <code>src/logging/systemLogger.js:311</code> | Update/replace the auth token used in &#39;x-log-token&#39;. |
| <code>LogController#setBackendUrl</code> | member | <code>src/logging/systemLogger.js:260</code> | Set the backend ingestion URL \(absolute or relative\). |
| <code>LogController#setHttpTimeout</code> | member | <code>src/logging/systemLogger.js:302</code> | Set axios timeout \(ms\) for backend posts. |
| <code>LogController#setLogLevel</code> | member | <code>src/logging/systemLogger.js:274</code> | Set the current log level. |
| <code>LogController#setLogToBackend</code> | member | <code>src/logging/systemLogger.js:247</code> | Enable/disable HTTP forwarding at runtime. |
| <code>LogController#setRetryInterval</code> | member | <code>src/logging/systemLogger.js:293</code> | Set retry interval \(ms\) for backend forwarding. |
| <code>LogController#setRetryLimit</code> | member | <code>src/logging/systemLogger.js:284</code> | Set retry limit for backend forwarding. |
| <code>LogController#shouldLog</code> | member | <code>src/logging/systemLogger.js:324</code> | Internal: should this level be logged at all \(console or backend\)? |
| <code>LogController#warn</code> | member | <code>src/logging/systemLogger.js:423</code> |  |
| <code>__DEV__</code> | constant | <code>src/logging/userLogger.js:59</code> | True when running in dev \(for debug logging only\). |
| <code>UserLogController#_captureCookieFingerprint</code> | function | <code>src/logging/userLogger.js:168</code> | Internal: hash document.cookie once \(non-blocking\). |
| <code>abToBase64</code> | function | <code>src/logging/userLogger.js:110</code> | Base64 from ArrayBuffer \(for cookie fingerprint\). |
| <code>BootContext</code> | typedef | <code>src/logging/userLogger.js:37</code> |  |
| <code>debug</code> | function | <code>src/logging/userLogger.js:62</code> | Dev-only logger. |
| <code>getRuntimeConfig</code> | function | <code>src/logging/userLogger.js:71</code> | Safely read runtime config from window. |
| <code>UserLogController#initContext</code> | function | <code>src/logging/userLogger.js:160</code> | Initialize context near iframe/viewer creation. |
| <code>isSameOrigin</code> | function | <code>src/logging/userLogger.js:91</code> | Determine if the target URL is same-origin with current document. |
| <code>PrintLogPayload</code> | typedef | <code>src/logging/userLogger.js:43</code> |  |
| <code>UserLogController#setUserResolver</code> | function | <code>src/logging/userLogger.js:142</code> | Optional identity resolver supplied by host app. |
| <code>UserLogController#setViewerVersion</code> | function | <code>src/logging/userLogger.js:150</code> | Optional viewer version to add in meta.viewerVersion. |
| <code>sha256Base64</code> | function | <code>src/logging/userLogger.js:120</code> | Async SHA-256 of a string → &amp;quot;sha256- &amp;quot; \(or null\). |
| <code>UserLogController#submitPrint</code> | function | <code>src/logging/userLogger.js:189</code> | Submit a &amp;quot;print&amp;quot; user-log event. |
| <code>toAbsoluteUrl</code> | function | <code>src/logging/userLogger.js:82</code> | Make absolute using document.baseURI when available. |
| <code>tzOffset</code> | function | <code>src/logging/userLogger.js:100</code> | Return timezone offset as &amp;quot;+HH:MM&amp;quot; or &amp;quot;-HH:MM&amp;quot;. |
| <code>UserIdentity</code> | typedef | <code>src/logging/userLogger.js:31</code> |  |
| <code>userLog</code> | constant | <code>src/logging/userLogger.js:306</code> | Export singleton instance. |
| <code>analyzePageIntegrity</code> | function | <code>src/PerformanceMonitor.jsx:103</code> | Check the flat viewer page list for ordering mistakes that would be user-visible. |
| <code>copyText</code> | function | <code>src/PerformanceMonitor.jsx:349</code> | Copy best-effort text to clipboard without throwing. |
| <code>countBundleMetaFields</code> | function | <code>src/PerformanceMonitor.jsx:305</code> |  |
| <code>describeValueType</code> | function | <code>src/PerformanceMonitor.jsx:218</code> |  |
| <code>downloadText</code> | function | <code>src/PerformanceMonitor.jsx:387</code> | Download best-effort text as a local file without throwing. |
| <code>formatCacheScope</code> | function | <code>src/PerformanceMonitor.jsx:194</code> |  |
| <code>formatDuration</code> | function | <code>src/PerformanceMonitor.jsx:46</code> |  |
| <code>formatTtl</code> | function | <code>src/PerformanceMonitor.jsx:182</code> |  |
| <code>getCaseIdCount</code> | function | <code>src/PerformanceMonitor.jsx:295</code> |  |
| <code>getPayloadTopLevelCount</code> | function | <code>src/PerformanceMonitor.jsx:285</code> |  |
| <code>isPlainObject</code> | function | <code>src/PerformanceMonitor.jsx:228</code> |  |
| <code>MemorySnapshot</code> | typedef | <code>src/PerformanceMonitor.jsx:26</code> |  |
| <code>PerformanceMonitor</code> | function | <code>src/PerformanceMonitor.jsx:417</code> | PerformanceMonitor component. |
| <code>resolveElapsedMs</code> | function | <code>src/PerformanceMonitor.jsx:207</code> |  |
| <code>safePrettyStringify</code> | function | <code>src/PerformanceMonitor.jsx:268</code> |  |
| <code>sanitizeForOverlay</code> | function | <code>src/PerformanceMonitor.jsx:242</code> | Redact auth-like values before showing transport payloads in the diagnostics HUD. |
| <code>summarizeBundleSources</code> | function | <code>src/PerformanceMonitor.jsx:318</code> |  |
| <code>PerformanceMonitor~tick</code> | constant | <code>src/PerformanceMonitor.jsx:475</code> |  |
| <code>toMB</code> | function | <code>src/PerformanceMonitor.jsx:37</code> |  |
| <code>PerformanceMonitor~updateMemory</code> | constant | <code>src/PerformanceMonitor.jsx:494</code> |  |
| <code>CreateBundleResult</code> | typedef | <code>src/schemas/portableBundle.js:82</code> | Result object for createPortableBundle |
| <code>createPortableBundle</code> | function | <code>src/schemas/portableBundle.js:343</code> | Convenience constructor: normalize → \(optionally validate\) → freeze. |
| <code>extFromString</code> | function | <code>src/schemas/portableBundle.js:107</code> | Extract lowercase file extension from a string \(best-effort\). |
| <code>freezePortableBundle</code> | function | <code>src/schemas/portableBundle.js:326</code> | Create a shallow, immutable copy of a normalized bundle \(Object.freeze tree\). |
| <code>normalizeDocumentEntry</code> | function | <code>src/schemas/portableBundle.js:225</code> | Normalize a single document entry. |
| <code>normalizeDocumentFile</code> | function | <code>src/schemas/portableBundle.js:197</code> | Normalize a file entry. |
| <code>normalizeMetadataAliasDetails</code> | function | <code>src/schemas/portableBundle.js:150</code> | Preserve a richer semantic alias object map without trying to deeply validate every property. |
| <code>normalizeMetadataAliases</code> | function | <code>src/schemas/portableBundle.js:126</code> | Normalize an alias-based metadata object to a predictable string map. |
| <code>normalizeMetadataIndex</code> | function | <code>src/schemas/portableBundle.js:172</code> | Preserve a raw metadata lookup map without imposing a rigid record schema here. |
| <code>normalizePortableBundle</code> | function | <code>src/schemas/portableBundle.js:253</code> | Normalize a bundle to a predictable, minimally validated shape: Ensures session.id and stringifies known fields. |
| <code>PORTABLE_BUNDLE_SCHEMA_VERSION</code> | constant | <code>src/schemas/portableBundle.js:29</code> | Schema version of this portable bundle definition. |
| <code>PortableDocumentBundle</code> | typedef | <code>src/schemas/portableBundle.js:65</code> | A portable bundle groups a session and an array of document entries. |
| <code>PortableDocumentEntry</code> | typedef | <code>src/schemas/portableBundle.js:53</code> | A single document entry containing one or more files. |
| <code>PortableDocumentFile</code> | typedef | <code>src/schemas/portableBundle.js:39</code> | A single file reference inside a document. |
| <code>PortableSession</code> | typedef | <code>src/schemas/portableBundle.js:31</code> | Session context for a bundle. |
| <code>toObject</code> | function | <code>src/schemas/portableBundle.js:98</code> | Coerce unknown input to a plain object \(or return null\). |
| <code>validatePortableBundle</code> | function | <code>src/schemas/portableBundle.js:283</code> | Validate a normalized \(or raw\) bundle. |
| <code>ValidateReport</code> | typedef | <code>src/schemas/portableBundle.js:74</code> | Validation report for a bundle. |
| <code>BumpPostZoom</code> | typedef | <code>src/types/jsdoc-types.js:84</code> | Step the per-pane post-zoom by ±0.1. |
| <code>DocumentRenderHandle</code> | typedef | <code>src/types/jsdoc-types.js:67</code> | Minimal imperative handle exposed by the page renderer for printing. |
| <code>FallbackRenderer</code> | typedef | <code>src/types/jsdoc-types.js:58</code> | Render function signature for ErrorBoundary fallbacks. |
| <code>PageDirection</code> | typedef | <code>src/types/jsdoc-types.js:52</code> | Direction token used by page timers / navigation. |
| <code>PostZoomApi</code> | typedef | <code>src/types/jsdoc-types.js:91</code> | Per-pane post-zoom API that augments the document viewer hook. |
| <code>RefLike</code> | typedef | <code>src/types/jsdoc-types.js:73</code> | Generic &amp;quot;ref-like&amp;quot; object \(for places where React.MutableRefObject is too specific\). |
| <code>SetBooleanState</code> | typedef | <code>src/types/jsdoc-types.js:36</code> | React-like state setter for booleans: accepts a boolean or an updater \(boolean\)-&amp;gt;boolean. |
| <code>SetNumber</code> | typedef | <code>src/types/jsdoc-types.js:22</code> | Simple number setter \(no updater function\). |
| <code>SetNumberState</code> | typedef | <code>src/types/jsdoc-types.js:7</code> | Generic React-like state setter for numbers: accepts either a number or an updater function \(number\)-&amp;gt;number. |
| <code>SetPageNumber</code> | typedef | <code>src/types/jsdoc-types.js:44</code> | React-like state setter for page number: accepts a number or an updater \(number\)-&amp;gt;number. |
| <code>SetString</code> | typedef | <code>src/types/jsdoc-types.js:29</code> | Simple string setter. |
| <code>SetStringNullable</code> | typedef | <code>src/types/jsdoc-types.js:15</code> | Setter for string-or-null values. |
| <code>ZoomMode</code> | typedef | <code>src/types/jsdoc-types.js:79</code> | Sticky zoom modes used by the viewer. |
| <code>countPdfPages</code> | function | <code>src/utils/documentLoadingConfig.js:506</code> | Count PDF pages in a page descriptor list. |
| <code>detectBrowserFamily</code> | function | <code>src/utils/documentLoadingConfig.js:167</code> |  |
| <code>DocumentLoadingAdaptiveMemoryConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:29</code> |  |
| <code>DocumentLoadingAssetStoreConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:71</code> |  |
| <code>DocumentLoadingConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:152</code> |  |
| <code>DocumentLoadingFetchConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:49</code> |  |
| <code>DocumentLoadingFetchStrategy</code> | typedef | <code>src/utils/documentLoadingConfig.js:21</code> |  |
| <code>DocumentLoadingMemoryPressureConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:133</code> |  |
| <code>DocumentLoadingMemoryPressureStage</code> | typedef | <code>src/utils/documentLoadingConfig.js:25</code> |  |
| <code>DocumentLoadingMode</code> | typedef | <code>src/utils/documentLoadingConfig.js:20</code> |  |
| <code>DocumentLoadingPdfWorkerPagePolicy</code> | typedef | <code>src/utils/documentLoadingConfig.js:120</code> |  |
| <code>DocumentLoadingRenderBackend</code> | typedef | <code>src/utils/documentLoadingConfig.js:23</code> |  |
| <code>DocumentLoadingRenderConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:87</code> |  |
| <code>DocumentLoadingRenderStrategy</code> | typedef | <code>src/utils/documentLoadingConfig.js:22</code> |  |
| <code>DocumentLoadingSourceStoreConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:60</code> |  |
| <code>DocumentLoadingWarningConfig</code> | typedef | <code>src/utils/documentLoadingConfig.js:40</code> |  |
| <code>formatBytes</code> | function | <code>src/utils/documentLoadingConfig.js:1009</code> |  |
| <code>formatCount</code> | function | <code>src/utils/documentLoadingConfig.js:1027</code> |  |
| <code>getPerformanceWindowPageCount</code> | function | <code>src/utils/documentLoadingConfig.js:835</code> | Return the page-count window where auto mode should still behave like the fast, eager path. |
| <code>getReportedCoreCount</code> | function | <code>src/utils/documentLoadingConfig.js:181</code> |  |
| <code>PdfToImageMode</code> | typedef | <code>src/utils/documentLoadingConfig.js:24</code> |  |
| <code>resolvePdfRenderConfigForPageCount</code> | function | <code>src/utils/documentLoadingConfig.js:590</code> | Return a render config with pdfToImageMode and pdfWorkerCount resolved for a known PDF page count. |
| <code>resolvePdfWorkerPlanForPageCount</code> | function | <code>src/utils/documentLoadingConfig.js:526</code> | Resolve the PDF page-worker policy for the current document size. |
| <code>resolveRecommendedRasterWorkerCount</code> | function | <code>src/utils/documentLoadingConfig.js:215</code> |  |
| <code>resolveRecommendedWorkerCount</code> | function | <code>src/utils/documentLoadingConfig.js:194</code> |  |
| <code>RuntimeMemoryTier</code> | typedef | <code>src/utils/documentLoadingConfig.js:19</code> |  |
| <code>shouldRecommendStopping</code> | function | <code>src/utils/documentLoadingConfig.js:1035</code> |  |
| <code>SourceStoreMode</code> | typedef | <code>src/utils/documentLoadingConfig.js:15</code> |  |
| <code>SourceStoreProtection</code> | typedef | <code>src/utils/documentLoadingConfig.js:16</code> |  |
| <code>StopRecommendationInput</code> | typedef | <code>src/utils/documentLoadingConfig.js:145</code> |  |
| <code>ThumbnailLoadingStrategy</code> | typedef | <code>src/utils/documentLoadingConfig.js:17</code> |  |
| <code>ThumbnailSourceStrategy</code> | typedef | <code>src/utils/documentLoadingConfig.js:18</code> |  |
| <code>buildAliasDetailRow</code> | function | <code>src/utils/documentMetadata.js:183</code> |  |
| <code>buildAliasLabelsByFieldId</code> | function | <code>src/utils/documentMetadata.js:209</code> |  |
| <code>buildDocumentMetadataMatrixView</code> | function | <code>src/utils/documentMetadata.js:341</code> | Build a session-wide metadata matrix with one row per document and one column per metadata field. |
| <code>buildDocumentMetadataView</code> | function | <code>src/utils/documentMetadata.js:311</code> | Build a UI-friendly projection of one document&#39;s metadata. |
| <code>buildDocumentRows</code> | function | <code>src/utils/documentMetadata.js:293</code> |  |
| <code>buildFieldPresentationHints</code> | function | <code>src/utils/documentMetadata.js:77</code> |  |
| <code>buildRowsFromMetadataAliases</code> | function | <code>src/utils/documentMetadata.js:274</code> |  |
| <code>buildRowsFromMetadataDetails</code> | function | <code>src/utils/documentMetadata.js:264</code> |  |
| <code>buildRowsFromRawMetadata</code> | function | <code>src/utils/documentMetadata.js:232</code> |  |
| <code>bundleDocumentHasMetadata</code> | function | <code>src/utils/documentMetadata.js:69</code> |  |
| <code>documentHasMetadata</code> | function | <code>src/utils/documentMetadata.js:55</code> |  |
| <code>getBundleDocumentById</code> | function | <code>src/utils/documentMetadata.js:44</code> |  |
| <code>isObject</code> | function | <code>src/utils/documentMetadata.js:14</code> |  |
| <code>normalizeStringArray</code> | function | <code>src/utils/documentMetadata.js:32</code> |  |
| <code>buildFieldPresentationHints~pushEntry</code> | function | <code>src/utils/documentMetadata.js:83</code> |  |
| <code>resolveMetadataLabel</code> | function | <code>src/utils/documentMetadata.js:129</code> | Resolve the label shown for one metadata row. |
| <code>resolveMetadataValue</code> | function | <code>src/utils/documentMetadata.js:161</code> |  |
| <code>toOptionalText</code> | function | <code>src/utils/documentMetadata.js:22</code> |  |
| <code>bytesToHex</code> | function | <code>src/utils/idUtils.js:17</code> |  |
| <code>createOpaqueId</code> | function | <code>src/utils/idUtils.js:56</code> | Create a prefixed opaque identifier. |
| <code>createOpaqueIdFragment</code> | function | <code>src/utils/idUtils.js:27</code> | Create an opaque identifier fragment suitable for synthetic keys and document ids. |
| <code>fallbackCounter</code> | member | <code>src/utils/idUtils.js:11</code> | OpenDocViewer — small opaque identifier helpers. |
| <code>I18nLike</code> | typedef | <code>src/utils/localizedValue.js:17</code> | Minimal shape of an i18n instance used by this module. |
| <code>I18nOptionsLike</code> | typedef | <code>src/utils/localizedValue.js:11</code> | A subset of the i18next options object we care about. |
| <code>LocalizedString</code> | typedef | <code>src/utils/localizedValue.js:2</code> | Localized string resolver for admin-supplied config values. |
| <code>OptionLike</code> | typedef | <code>src/utils/localizedValue.js:24</code> | Option-like shape used by the print reason selector. |
| <code>resolveLocalizedValue</code> | function | <code>src/utils/localizedValue.js:41</code> | Return the best string for the active language. |
| <code>resolveOptionLabel</code> | function | <code>src/utils/localizedValue.js:109</code> | Resolve a label for a reason option. |
| <code>getRuntimeMemoryProfile</code> | function | <code>src/utils/memoryProfile.js:63</code> |  |
| <code>readDeviceMemoryGb</code> | function | <code>src/utils/memoryProfile.js:24</code> |  |
| <code>readJsHeapLimitMiB</code> | function | <code>src/utils/memoryProfile.js:37</code> |  |
| <code>resolveTier</code> | function | <code>src/utils/memoryProfile.js:52</code> |  |
| <code>RuntimeMemoryProfile</code> | typedef | <code>src/utils/memoryProfile.js:12</code> |  |
| <code>RuntimeMemoryTier</code> | typedef | <code>src/utils/memoryProfile.js:10</code> |  |
| <code>clampPage</code> | function | <code>src/utils/navigationUtils.js:54</code> | Clamp a page number into \[1, totalPages\]. |
| <code>handleFirstPage</code> | constant | <code>src/utils/navigationUtils.js:124</code> | Navigate to the first page \(always sets page to 1\). |
| <code>handleLastPage</code> | constant | <code>src/utils/navigationUtils.js:149</code> | Navigate to the last page \(no-op if totalPages invalid\). |
| <code>handleNextPage</code> | constant | <code>src/utils/navigationUtils.js:94</code> | Navigate to the next page \(no-op if already at the last page\). |
| <code>handlePrevPage</code> | constant | <code>src/utils/navigationUtils.js:69</code> | Navigate to the previous page \(no-op if already at page 1\). |
| <code>isValidTotalPages</code> | function | <code>src/utils/navigationUtils.js:43</code> | Check whether totalPages looks valid \(&amp;gt;= 1\). |
| <code>toPositiveInt</code> | function | <code>src/utils/navigationUtils.js:31</code> | Coerce a value to a positive integer \(minimum 1\). |
| <code>createTrackedObjectUrl</code> | function | <code>src/utils/objectUrlRegistry.js:31</code> |  |
| <code>getTrackedObjectUrlCount</code> | function | <code>src/utils/objectUrlRegistry.js:81</code> |  |
| <code>isTrackedObjectUrl</code> | function | <code>src/utils/objectUrlRegistry.js:71</code> | Check whether a blob/object URL is still tracked as live by the viewer. |
| <code>revokeAllTrackedObjectUrls</code> | function | <code>src/utils/objectUrlRegistry.js:89</code> | Revoke every tracked object URL. |
| <code>revokeTrackedObjectUrl</code> | function | <code>src/utils/objectUrlRegistry.js:47</code> |  |
| <code>revokeTrackedObjectUrls</code> | function | <code>src/utils/objectUrlRegistry.js:60</code> |  |
| <code>PageAssetDescriptor</code> | typedef | <code>src/utils/pageAssetRenderer.js:34</code> |  |
| <code>PageAssetRendererOptions</code> | typedef | <code>src/utils/pageAssetRenderer.js:28</code> |  |
| <code>PageAssetRenderer#renderPageAsset</code> | function | <code>src/utils/pageAssetRenderer.js:660</code> | Render one requested page asset. |
| <code>RenderPageAssetOptions</code> | typedef | <code>src/utils/pageAssetRenderer.js:42</code> |  |
| <code>PageAssetRenderer#renderPdfPageAssetBatch</code> | function | <code>src/utils/pageAssetRenderer.js:534</code> | Render a PDF page set through the PDF worker pool as one partitioned batch. |
| <code>BlobLruCache</code> | class | <code>src/utils/pageAssetStore.js:170</code> |  |
| <code>PageAssetStore#cleanup</code> | function | <code>src/utils/pageAssetStore.js:455</code> |  |
| <code>PageAssetStore#cleanupStaleSessions</code> | function | <code>src/utils/pageAssetStore.js:499</code> |  |
| <code>createPageAssetStore</code> | function | <code>src/utils/pageAssetStore.js:211</code> |  |
| <code>createSessionId</code> | function | <code>src/utils/pageAssetStore.js:57</code> |  |
| <code>PageAssetStore#enqueueWrite</code> | function | <code>src/utils/pageAssetStore.js:333</code> |  |
| <code>PageAssetStore#ensureDb</code> | function | <code>src/utils/pageAssetStore.js:540</code> |  |
| <code>PageAssetStore#ensureKey</code> | function | <code>src/utils/pageAssetStore.js:549</code> |  |
| <code>BlobLruCache#get</code> | function | <code>src/utils/pageAssetStore.js:180</code> |  |
| <code>PageAssetStore#getAsset</code> | function | <code>src/utils/pageAssetStore.js:398</code> |  |
| <code>PageAssetStore#getIndexedDbRecord</code> | function | <code>src/utils/pageAssetStore.js:696</code> |  |
| <code>PageAssetStore#getStats</code> | function | <code>src/utils/pageAssetStore.js:281</code> |  |
| <code>hasIndexedDb</code> | function | <code>src/utils/pageAssetStore.js:33</code> |  |
| <code>hasWebCrypto</code> | function | <code>src/utils/pageAssetStore.js:44</code> |  |
| <code>PageAssetStore#makeIndexedDbRecord</code> | function | <code>src/utils/pageAssetStore.js:632</code> |  |
| <code>makeStorageKey</code> | function | <code>src/utils/pageAssetStore.js:26</code> |  |
| <code>PageAssetStore#maybePromote</code> | function | <code>src/utils/pageAssetStore.js:573</code> |  |
| <code>openAssetStoreDb</code> | function | <code>src/utils/pageAssetStore.js:101</code> |  |
| <code>PageAssetStore#PageAssetStore</code> | class | <code>src/utils/pageAssetStore.js:219</code> |  |
| <code>PageAssetStoreStats</code> | typedef | <code>src/utils/pageAssetStore.js:121</code> |  |
| <code>PageAssetStore#promoteToIndexedDb</code> | function | <code>src/utils/pageAssetStore.js:322</code> | Force promotion to IndexedDB for the current session when supported. |
| <code>PageAssetStore#putAsset</code> | function | <code>src/utils/pageAssetStore.js:343</code> |  |
| <code>PageAssetStore#putIndexedDbEntry</code> | function | <code>src/utils/pageAssetStore.js:617</code> |  |
| <code>PutPageAssetOptions</code> | typedef | <code>src/utils/pageAssetStore.js:154</code> |  |
| <code>PageAssetStore#ready</code> | function | <code>src/utils/pageAssetStore.js:272</code> |  |
| <code>PageAssetStore#recordToBlob</code> | function | <code>src/utils/pageAssetStore.js:728</code> |  |
| <code>PageAssetStore#recordToMeta</code> | function | <code>src/utils/pageAssetStore.js:675</code> |  |
| <code>requestToPromise</code> | function | <code>src/utils/pageAssetStore.js:79</code> |  |
| <code>BlobLruCache#set</code> | function | <code>src/utils/pageAssetStore.js:193</code> |  |
| <code>StoredPageAssetMeta</code> | typedef | <code>src/utils/pageAssetStore.js:138</code> |  |
| <code>PageAssetStore#touchIndexedDbRecord</code> | function | <code>src/utils/pageAssetStore.js:710</code> |  |
| <code>transactionDone</code> | function | <code>src/utils/pageAssetStore.js:90</code> |  |
| <code>PageAssetStore#updateConfig</code> | function | <code>src/utils/pageAssetStore.js:308</code> | Update runtime thresholds for the active session. |
| <code>PageAssetWorkerPool#allocateTaskId</code> | function | <code>src/utils/pageAssetWorkerPool.js:156</code> |  |
| <code>PageAssetWorkerPool#canRender</code> | function | <code>src/utils/pageAssetWorkerPool.js:128</code> |  |
| <code>createPageAssetWorkerPool</code> | function | <code>src/utils/pageAssetWorkerPool.js:51</code> |  |
| <code>PageAssetWorkerPool#dispose</code> | function | <code>src/utils/pageAssetWorkerPool.js:298</code> |  |
| <code>PageAssetWorkerPool#getWorkerCount</code> | function | <code>src/utils/pageAssetWorkerPool.js:119</code> |  |
| <code>PageAssetWorkerPool#handleError</code> | function | <code>src/utils/pageAssetWorkerPool.js:267</code> |  |
| <code>PageAssetWorkerPool#handleMessage</code> | function | <code>src/utils/pageAssetWorkerPool.js:226</code> |  |
| <code>isRasterExt</code> | function | <code>src/utils/pageAssetWorkerPool.js:59</code> |  |
| <code>PageAssetWorkerEntry</code> | typedef | <code>src/utils/pageAssetWorkerPool.js:19</code> |  |
| <code>PageAssetWorkerPool#PageAssetWorkerPool</code> | class | <code>src/utils/pageAssetWorkerPool.js:82</code> |  |
| <code>PageAssetWorkerPoolOptions</code> | typedef | <code>src/utils/pageAssetWorkerPool.js:11</code> |  |
| <code>PendingWorkerTask</code> | typedef | <code>src/utils/pageAssetWorkerPool.js:27</code> |  |
| <code>PageAssetWorkerPool#pump</code> | function | <code>src/utils/pageAssetWorkerPool.js:176</code> |  |
| <code>PageAssetWorkerPool#renderAsset</code> | function | <code>src/utils/pageAssetWorkerPool.js:140</code> |  |
| <code>WorkerTaskInput</code> | typedef | <code>src/utils/pageAssetWorkerPool.js:36</code> |  |
| <code>addBatchSizeCandidate</code> | function | <code>src/utils/pdfBenchmark.js:156</code> | Keep a batch-size list ordered and unique. |
| <code>addPhaseDuration</code> | function | <code>src/utils/pdfBenchmark.js:570</code> |  |
| <code>addPhaseDurations</code> | function | <code>src/utils/pdfBenchmark.js:661</code> |  |
| <code>addScenario</code> | function | <code>src/utils/pdfBenchmark.js:237</code> |  |
| <code>calculateTransitionPhaseDurations</code> | function | <code>src/utils/pdfBenchmark.js:584</code> | Convert progress markers into phase durations by measuring time between phase transitions. |
| <code>createBenchmarkScenarios</code> | function | <code>src/utils/pdfBenchmark.js:413</code> |  |
| <code>createEmptyPhaseDurations</code> | function | <code>src/utils/pdfBenchmark.js:546</code> |  |
| <code>createFocusedBenchmarkScenarios</code> | function | <code>src/utils/pdfBenchmark.js:326</code> | Create a compact benchmark matrix that answers the important tuning questions without spending most of the run on combinations that are already known to be poor: single worker vs... |
| <code>createMatrixBenchmarkScenarios</code> | function | <code>src/utils/pdfBenchmark.js:259</code> |  |
| <code>createScenarioKey</code> | function | <code>src/utils/pdfBenchmark.js:221</code> |  |
| <code>createScenarioLabel</code> | function | <code>src/utils/pdfBenchmark.js:208</code> |  |
| <code>createScenarioPdfConfig</code> | function | <code>src/utils/pdfBenchmark.js:425</code> |  |
| <code>delay</code> | function | <code>src/utils/pdfBenchmark.js:771</code> |  |
| <code>describeBenchmarkBatchPlan</code> | function | <code>src/utils/pdfBenchmark.js:182</code> | Describe the actual batch plan for one benchmark run. |
| <code>describeScenarioPlan</code> | function | <code>src/utils/pdfBenchmark.js:466</code> |  |
| <code>expandBenchmarkBatchSizes</code> | function | <code>src/utils/pdfBenchmark.js:502</code> | Expand configured benchmark sizes with values near the current auto plan. |
| <code>finalizePhaseSpans</code> | function | <code>src/utils/pdfBenchmark.js:644</code> |  |
| <code>finiteNumberOrNull</code> | function | <code>src/utils/pdfBenchmark.js:529</code> |  |
| <code>groupEventsByNumericKey</code> | function | <code>src/utils/pdfBenchmark.js:612</code> |  |
| <code>isPdfBenchmarkEnabled</code> | function | <code>src/utils/pdfBenchmark.js:762</code> |  |
| <code>normalizeBatchCounts</code> | function | <code>src/utils/pdfBenchmark.js:74</code> |  |
| <code>normalizeBatchSizes</code> | function | <code>src/utils/pdfBenchmark.js:57</code> |  |
| <code>normalizeBenchmarkConfig</code> | function | <code>src/utils/pdfBenchmark.js:736</code> |  |
| <code>normalizeInteger</code> | function | <code>src/utils/pdfBenchmark.js:47</code> |  |
| <code>normalizeIntegerList</code> | function | <code>src/utils/pdfBenchmark.js:93</code> |  |
| <code>normalizeMergeModes</code> | function | <code>src/utils/pdfBenchmark.js:127</code> |  |
| <code>normalizeProfile</code> | function | <code>src/utils/pdfBenchmark.js:144</code> |  |
| <code>normalizeStrategies</code> | function | <code>src/utils/pdfBenchmark.js:110</code> |  |
| <code>normalizeTimingPhase</code> | function | <code>src/utils/pdfBenchmark.js:538</code> |  |
| <code>recordPhaseSpan</code> | function | <code>src/utils/pdfBenchmark.js:556</code> |  |
| <code>resolveBenchmarkWorkerPolicy</code> | function | <code>src/utils/pdfBenchmark.js:168</code> | Resolve the PDF worker count with the same policy as generated-PDF output. |
| <code>roundMilliseconds</code> | function | <code>src/utils/pdfBenchmark.js:521</code> |  |
| <code>runPdfGenerationBenchmark</code> | function | <code>src/utils/pdfBenchmark.js:816</code> |  |
| <code>selectBenchmarkPages</code> | function | <code>src/utils/pdfBenchmark.js:796</code> |  |
| <code>summarizeBenchmarkTiming</code> | function | <code>src/utils/pdfBenchmark.js:672</code> |  |
| <code>summarizeTaskDurations</code> | function | <code>src/utils/pdfBenchmark.js:628</code> |  |
| <code>PDFJS_WASM_BASE_URL</code> | constant | <code>src/utils/pdfjsDocumentOptions.js:8</code> | Shared pdf.js document-loading options. |
| <code>withPdfJsDocumentOptions</code> | function | <code>src/utils/pdfjsDocumentOptions.js:21</code> |  |
| <code>PdfPageWorkerEntry</code> | typedef | <code>src/utils/pdfPageWorkerPool.js:50</code> |  |
| <code>PdfPageWorkerPool#PdfPageWorkerPool</code> | class | <code>src/utils/pdfPageWorkerPool.js:66</code> |  |
| <code>PdfPageWorkerPoolOptions</code> | typedef | <code>src/utils/pdfPageWorkerPool.js:43</code> |  |
| <code>buildSelectedOptionDetails</code> | function | <code>src/utils/pdfPrebuildPlan.js:138</code> |  |
| <code>clampInteger</code> | function | <code>src/utils/pdfPrebuildPlan.js:28</code> |  |
| <code>createPdfPrebuildAllPagesVariants</code> | function | <code>src/utils/pdfPrebuildPlan.js:289</code> | Create all cacheable all-pages PDF variant descriptors for a runtime config. |
| <code>createPdfPrebuildVariantKey</code> | function | <code>src/utils/pdfPrebuildPlan.js:334</code> |  |
| <code>createPrintFormatVariant</code> | function | <code>src/utils/pdfPrebuildPlan.js:214</code> |  |
| <code>createReasonVariants</code> | function | <code>src/utils/pdfPrebuildPlan.js:189</code> |  |
| <code>getActiveLanguageKey</code> | function | <code>src/utils/pdfPrebuildPlan.js:254</code> |  |
| <code>getPdfPrebuildAllPagesLanguageDependency</code> | function | <code>src/utils/pdfPrebuildPlan.js:269</code> | Return the language dependency that should invalidate an all-pages prebuild run. |
| <code>getReasonOptions</code> | function | <code>src/utils/pdfPrebuildPlan.js:178</code> |  |
| <code>isNonEmptyObject</code> | function | <code>src/utils/pdfPrebuildPlan.js:38</code> |  |
| <code>normalizeCopyMarkerStates</code> | function | <code>src/utils/pdfPrebuildPlan.js:64</code> |  |
| <code>normalizeLanguageList</code> | function | <code>src/utils/pdfPrebuildPlan.js:46</code> |  |
| <code>normalizePdfOrientationMode</code> | function | <code>src/utils/pdfPrebuildPlan.js:88</code> |  |
| <code>normalizePdfPrebuildAllPagesConfig</code> | function | <code>src/utils/pdfPrebuildPlan.js:156</code> |  |
| <code>resolveOptionPrintText</code> | function | <code>src/utils/pdfPrebuildPlan.js:116</code> | Resolve the string that should be used on physical print output for an option. |
| <code>resolvePrebuildPdfOrientation</code> | function | <code>src/utils/pdfPrebuildPlan.js:98</code> |  |
| <code>resolveVariantLanguageContext</code> | function | <code>src/utils/pdfPrebuildPlan.js:245</code> |  |
| <code>canReuseGeneratedPdfPrint</code> | function | <code>src/utils/pdfPrintCacheKey.js:101</code> | Active-page PDF output is based on the current rendered surface, including transient client-side edits such as rotation, brightness and contrast. |
| <code>getPdfPrintCacheKey</code> | function | <code>src/utils/pdfPrintCacheKey.js:75</code> | Compare the content-affecting print settings that determine whether an existing generated PDF can be reused. |
| <code>getPdfPrintCacheKeyOptions</code> | function | <code>src/utils/pdfPrintCacheKey.js:31</code> |  |
| <code>isFullSessionPageSequence</code> | function | <code>src/utils/pdfPrintCacheKey.js:110</code> |  |
| <code>isPdfPrintCacheLanguageIgnored</code> | function | <code>src/utils/pdfPrintCacheKey.js:52</code> |  |
| <code>normalizePdfPrintCacheLanguageMode</code> | function | <code>src/utils/pdfPrintCacheKey.js:21</code> |  |
| <code>normalizePdfPrintCachePageNumbers</code> | function | <code>src/utils/pdfPrintCacheKey.js:60</code> |  |
| <code>stablePrintText</code> | function | <code>src/utils/pdfPrintCacheKey.js:13</code> |  |
| <code>batchProgressUnitsFromEvent</code> | function | <code>src/utils/pdfWorkerDispatcher.js:156</code> | Convert worker phases to deterministic job units: 1 unit for loading the PDF engine per batch 1 unit per loaded page image 1 unit per generated page 1 unit for finalizing each par... |
| <code>clampInteger</code> | function | <code>src/utils/pdfWorkerDispatcher.js:41</code> |  |
| <code>clampNumber</code> | function | <code>src/utils/pdfWorkerDispatcher.js:114</code> |  |
| <code>countBatchJobUnits</code> | function | <code>src/utils/pdfWorkerDispatcher.js:124</code> |  |
| <code>createBatchJob</code> | function | <code>src/utils/pdfWorkerDispatcher.js:276</code> |  |
| <code>createPdfProgressPlan</code> | function | <code>src/utils/pdfWorkerDispatcher.js:135</code> |  |
| <code>createPdfWithWorkerDispatcher</code> | function | <code>src/utils/pdfWorkerDispatcher.js:382</code> | Dispatch generated-PDF work to the worker layer. |
| <code>mergePdfBlobs</code> | function | <code>src/utils/pdfWorkerDispatcher.js:361</code> |  |
| <code>mergePdfBlobsSinglePass</code> | function | <code>src/utils/pdfWorkerDispatcher.js:319</code> |  |
| <code>PdfWorkerBatch</code> | typedef | <code>src/utils/pdfWorkerDispatcher.js:16</code> |  |
| <code>PdfWorkerPlan</code> | typedef | <code>src/utils/pdfWorkerDispatcher.js:23</code> |  |
| <code>planPdfWorkerBatches</code> | function | <code>src/utils/pdfWorkerDispatcher.js:78</code> | Split pages into worker tasks. |
| <code>progressValueFromWorkerEvent</code> | function | <code>src/utils/pdfWorkerDispatcher.js:297</code> |  |
| <code>resolveAutoPdfWorkerBatchSize</code> | function | <code>src/utils/pdfWorkerDispatcher.js:56</code> | Pick a conservative future batch size from a pages-per-worker target. |
| <code>runLimitedTasks</code> | function | <code>src/utils/pdfWorkerDispatcher.js:188</code> | Run async work with a small in-process dispatcher. |
| <code>runPdfWorkerTask</code> | function | <code>src/utils/pdfWorkerDispatcher.js:217</code> |  |
| <code>sumProgress</code> | function | <code>src/utils/pdfWorkerDispatcher.js:308</code> |  |
| <code>throwIfAborted</code> | function | <code>src/utils/pdfWorkerDispatcher.js:101</code> |  |
| <code>escapeMetaName</code> | function | <code>src/utils/performanceOverlayFlag.js:14</code> |  |
| <code>isPerformanceOverlayEnabled</code> | function | <code>src/utils/performanceOverlayFlag.js:72</code> | Determine whether the diagnostics/performance overlay is enabled. |
| <code>readRuntimeBooleanFlag</code> | function | <code>src/utils/performanceOverlayFlag.js:34</code> | Resolve a boolean flag from \(precedence order\): window. |
| <code>collectAllPrintableDataUrlsFromDom</code> | function | <code>src/utils/printCore.js:390</code> | Collect printable image sources from the DOM as a fallback when the renderer handle cannot provide an explicit all-pages list. |
| <code>createHiddenIframe</code> | function | <code>src/utils/printCore.js:235</code> | Create the temporary hidden iframe used as the print document host. |
| <code>getODVConfig</code> | function | <code>src/utils/printCore.js:194</code> | Read runtime configuration from the globals populated by public/odv.config.js . |
| <code>getPrintableDataUrl</code> | function | <code>src/utils/printCore.js:145</code> | Safely derive a printable data URL from an element that is either a or an . |
| <code>handlePrint</code> | function | <code>src/utils/printCore.js:270</code> | Handles the print functionality for the CURRENT page/image. |
| <code>handlePrintAll</code> | function | <code>src/utils/printCore.js:443</code> | Print all available pages in viewer order. |
| <code>handlePrintCurrentComparison</code> | function | <code>src/utils/printCore.js:339</code> | Print both currently visible compare panes as a two-page print job. |
| <code>handlePrintRange</code> | function | <code>src/utils/printCore.js:585</code> | Print an inclusive page range. |
| <code>handlePrintSequence</code> | function | <code>src/utils/printCore.js:516</code> | Print an explicit page sequence such as 3,1,2 . |
| <code>HiddenIframe</code> | typedef | <code>src/utils/printCore.js:89</code> | Return type for the hidden-iframe factory. |
| <code>isVisiblyMeasurable</code> | function | <code>src/utils/printCore.js:103</code> | Check whether a candidate element is both present in layout and not hidden by basic CSS visibility. |
| <code>PageRange</code> | typedef | <code>src/utils/printCore.js:50</code> | A 1-based inclusive page range. |
| <code>pickLargestVisibleElement</code> | function | <code>src/utils/printCore.js:120</code> | Best-effort: pick the largest visible or inside a container \(or document\). |
| <code>PrintAllOptions</code> | typedef | <code>src/utils/printCore.js:57</code> | Options for printing multiple pages \(all/range/sequence\). |
| <code>PrintCandidate</code> | typedef | <code>src/utils/printCore.js:70</code> | Internal: candidate node for &amp;quot;largest visible&amp;quot; heuristics. |
| <code>PrintHeaderCfg</code> | typedef | <code>src/utils/printCore.js:77</code> | Print header config \(runtime\) consumed by the print overlay logic. |
| <code>PrintOptions</code> | typedef | <code>src/utils/printCore.js:37</code> | Options for single-page printing. |
| <code>resolveActiveNode</code> | function | <code>src/utils/printCore.js:217</code> | Attempt to resolve the currently active visual node to print. |
| <code>resolveAllPageDataUrls</code> | function | <code>src/utils/printCore.js:409</code> | Resolve all printable page URLs, preferring the renderer&#39;s imperative API and falling back to DOM inspection. |
| <code>resolveOrientation</code> | function | <code>src/utils/printCore.js:180</code> | Compute page orientation from dimensions when options.orientation === &#39;auto&#39;. |
| <code>buildOverlayElement</code> | function | <code>src/utils/printDom.js:227</code> | Build a header/footer DIV element for a page using config + tokens. |
| <code>buildPrintCss</code> | function | <code>src/utils/printDom.js:134</code> | Build the print-only CSS string \(inlined within the print iframe\). |
| <code>buildPrintFormatElements</code> | function | <code>src/utils/printDom.js:275</code> | Build configured print-format header/watermark elements for a page. |
| <code>enabled</code> | function | <code>src/utils/printDom.js:123</code> |  |
| <code>ensureBody</code> | function | <code>src/utils/printDom.js:202</code> |  |
| <code>ensureHead</code> | function | <code>src/utils/printDom.js:176</code> |  |
| <code>mergeOverlayCss</code> | function | <code>src/utils/printDom.js:404</code> |  |
| <code>normalizeApplyTo</code> | function | <code>src/utils/printDom.js:85</code> | Normalize runtime overlay application mode. |
| <code>normalizeNonNegativeNumber</code> | function | <code>src/utils/printDom.js:75</code> | Normalize an unknown configuration value to a non-negative number. |
| <code>normalizePageOrientation</code> | function | <code>src/utils/printDom.js:106</code> |  |
| <code>normalizeTrustedExtraCss</code> | function | <code>src/utils/printDom.js:115</code> |  |
| <code>populateBodyAndPrint</code> | function | <code>src/utils/printDom.js:349</code> | Attach pages and images into the \(cleared\) body, wait for image terminal states, then print. |
| <code>PrintOverlayCfg</code> | typedef | <code>src/utils/printDom.js:24</code> | Print overlay config \(runtime\) consumed by the print overlay logic. |
| <code>renderMultiDocument</code> | function | <code>src/utils/printDom.js:453</code> | Render a multi-page print document in the given print iframe document. |
| <code>renderSingleDocument</code> | function | <code>src/utils/printDom.js:424</code> | Render a single-page print document in the given print iframe document. |
| <code>shouldApplyOverlay</code> | function | <code>src/utils/printDom.js:96</code> |  |
| <code>TokenContext</code> | typedef | <code>src/utils/printDom.js:36</code> | Token context used by templates. |
| <code>tr</code> | function | <code>src/utils/printDom.js:62</code> | Tiny helper to translate with safe fallback. |
| <code>waitForImagesToLoad</code> | function | <code>src/utils/printDom.js:311</code> |  |
| <code>parsePrintSequence</code> | function | <code>src/utils/printParse.js:48</code> | Parse &amp;quot;Custom pages&amp;quot; into a sequence. |
| <code>ParseResult</code> | typedef | <code>src/utils/printParse.js:15</code> | Result of parsing a custom pages string. |
| <code>tr</code> | function | <code>src/utils/printParse.js:30</code> | Tiny helper to translate with safe fallback. |
| <code>addImageWithFallback</code> | function | <code>src/utils/printPdf.js:967</code> |  |
| <code>appendRichColumnLine</code> | function | <code>src/utils/printPdf.js:591</code> |  |
| <code>appendRichLineBreak</code> | function | <code>src/utils/printPdf.js:552</code> |  |
| <code>appendRichText</code> | function | <code>src/utils/printPdf.js:562</code> |  |
| <code>asNumber</code> | function | <code>src/utils/printPdf.js:216</code> | Convert a value to a finite number for PDF layout calculations. |
| <code>blobToDataUrl</code> | function | <code>src/utils/printPdf.js:2224</code> |  |
| <code>buildPdfPagePlans</code> | function | <code>src/utils/printPdf.js:1559</code> |  |
| <code>calculateOverlayReserve</code> | function | <code>src/utils/printPdf.js:1604</code> |  |
| <code>canvasToBlob</code> | function | <code>src/utils/printPdf.js:2209</code> |  |
| <code>canvasToPngDataUrl</code> | function | <code>src/utils/printPdf.js:2195</code> | Convert a canvas to a PNG data URL without using synchronous toDataURL when browser support for async toBlob is available. |
| <code>clamp01</code> | function | <code>src/utils/printPdf.js:241</code> | Clamp a numeric value to the inclusive 0..1 range. |
| <code>collectPrintablePdfSources</code> | function | <code>src/utils/printPdf.js:2117</code> | Collect printable page image URLs without creating or opening a PDF. |
| <code>createAbortError</code> | function | <code>src/utils/printPdf.js:248</code> |  |
| <code>createDefaultSegment</code> | function | <code>src/utils/printPdf.js:1143</code> |  |
| <code>createJsPdfOptions</code> | function | <code>src/utils/printPdf.js:1040</code> |  |
| <code>createPdfFromDocumentHandle</code> | function | <code>src/utils/printPdf.js:2141</code> |  |
| <code>createPrintPdfBlob</code> | function | <code>src/utils/printPdf.js:1662</code> | Build a PDF blob from page image URLs and print metadata. |
| <code>createPrintPdfBlobInWorker</code> | function | <code>src/utils/printPdf.js:1580</code> |  |
| <code>describeImageSource</code> | function | <code>src/utils/printPdf.js:796</code> |  |
| <code>describeModuleExports</code> | function | <code>src/utils/printPdf.js:1629</code> |  |
| <code>describeValueType</code> | function | <code>src/utils/printPdf.js:822</code> |  |
| <code>downloadPdfBlob</code> | function | <code>src/utils/printPdf.js:1814</code> |  |
| <code>drawRichSegments</code> | function | <code>src/utils/printPdf.js:1359</code> |  |
| <code>drawRichTextBlock</code> | function | <code>src/utils/printPdf.js:1382</code> |  |
| <code>drawWatermark</code> | function | <code>src/utils/printPdf.js:1414</code> |  |
| <code>drawWatermarkImage</code> | function | <code>src/utils/printPdf.js:1461</code> | Draw a prepared transparent PNG watermark, scaled to page width and centered. |
| <code>elementMatchesClassSelectorPart</code> | function | <code>src/utils/printPdf.js:358</code> |  |
| <code>ensureWritableRichLine</code> | function | <code>src/utils/printPdf.js:544</code> |  |
| <code>escapeRegExp</code> | function | <code>src/utils/printPdf.js:28</code> | Escape regular-expression metacharacters in literal text. |
| <code>executeOutputAction</code> | function | <code>src/utils/printPdf.js:2024</code> |  |
| <code>fitRichSegmentsToWidth</code> | function | <code>src/utils/printPdf.js:1184</code> |  |
| <code>fitRichSegmentTextToWidth</code> | function | <code>src/utils/printPdf.js:1154</code> |  |
| <code>flattenRichLines</code> | function | <code>src/utils/printPdf.js:611</code> |  |
| <code>getElementStyleHints</code> | function | <code>src/utils/printPdf.js:419</code> |  |
| <code>getImageDimension</code> | function | <code>src/utils/printPdf.js:940</code> |  |
| <code>getRichLineColumns</code> | function | <code>src/utils/printPdf.js:1073</code> |  |
| <code>getSelectedPrintableDataUrls</code> | function | <code>src/utils/printPdf.js:2059</code> | Read printable page image URLs from the document renderer. |
| <code>handlePdfCurrent</code> | function | <code>src/utils/printPdf.js:2245</code> | Generate/print/download a PDF from the currently rendered active page surface. |
| <code>handlePdfCurrentComparison</code> | function | <code>src/utils/printPdf.js:2268</code> | Generate/print/download a two-page PDF from the currently rendered comparison surfaces. |
| <code>handlePdfOutput</code> | function | <code>src/utils/printPdf.js:2152</code> |  |
| <code>htmlToRichLines</code> | function | <code>src/utils/printPdf.js:635</code> | Parse a small, print-template-oriented HTML subset into styled text lines for jsPDF. |
| <code>imageExtensionFromUrl</code> | function | <code>src/utils/printPdf.js:893</code> |  |
| <code>imageFormatAttempts</code> | function | <code>src/utils/printPdf.js:951</code> |  |
| <code>imageToJpegDataUrl</code> | function | <code>src/utils/printPdf.js:914</code> | Convert image to a JPEG data URL only as a last-resort fallback when jsPDF cannot consume the original image element/format directly. |
| <code>inferImageFormat</code> | function | <code>src/utils/printPdf.js:878</code> |  |
| <code>isBlockNode</code> | function | <code>src/utils/printPdf.js:435</code> | Check whether an HTML node name should be treated as block-level in PDF text flow. |
| <code>isBoldFontWeight</code> | function | <code>src/utils/printPdf.js:292</code> | Check whether a CSS font-weight value should be treated as bold text. |
| <code>layoutRichColumns</code> | function | <code>src/utils/printPdf.js:1228</code> |  |
| <code>loadImage</code> | function | <code>src/utils/printPdf.js:746</code> |  |
| <code>loadImagesConcurrently</code> | function | <code>src/utils/printPdf.js:837</code> |  |
| <code>loadJsPdf</code> | function | <code>src/utils/printPdf.js:1642</code> | Dynamically load the jsPDF constructor used by generated PDF output. |
| <code>makeTokenContext</code> | function | <code>src/utils/printPdf.js:1495</code> |  |
| <code>measureRichSegment</code> | function | <code>src/utils/printPdf.js:1122</code> |  |
| <code>measureRichSegments</code> | function | <code>src/utils/printPdf.js:1134</code> |  |
| <code>normalizePdfOrientationMode</code> | function | <code>src/utils/printPdf.js:999</code> |  |
| <code>normalizeQuality</code> | function | <code>src/utils/printPdf.js:228</code> | Normalize canvas/PDF image quality to the browser-supported 0..1 range. |
| <code>normalizeRichLine</code> | function | <code>src/utils/printPdf.js:1097</code> |  |
| <code>normalizeRichSegments</code> | function | <code>src/utils/printPdf.js:1056</code> |  |
| <code>pageFormatForImage</code> | function | <code>src/utils/printPdf.js:1028</code> |  |
| <code>pageNumberToIndex</code> | function | <code>src/utils/printPdf.js:2128</code> | Convert a 1-based printable page number into the matching 0-based data URL index. |
| <code>parseTemplateCssClassSelector</code> | function | <code>src/utils/printPdf.js:334</code> | Parse a supported class-only selector into descendant selector parts. |
| <code>parseTemplateCssStyleRules</code> | function | <code>src/utils/printPdf.js:397</code> | Parse only the small CSS subset used by trusted print header/footer templates. |
| <code>parseTextStyleDeclarations</code> | function | <code>src/utils/printPdf.js:304</code> |  |
| <code>PdfPrintOptions</code> | typedef | <code>src/utils/printPdf.js:156</code> |  |
| <code>PdfRichColumn</code> | typedef | <code>src/utils/printPdf.js:199</code> |  |
| <code>PdfRichLine</code> | typedef | <code>src/utils/printPdf.js:207</code> |  |
| <code>PdfRichSegment</code> | typedef | <code>src/utils/printPdf.js:191</code> |  |
| <code>PdfTemplateCssStyleRule</code> | typedef | <code>src/utils/printPdf.js:185</code> |  |
| <code>PdfTextStyleHints</code> | typedef | <code>src/utils/printPdf.js:175</code> |  |
| <code>printableSourceFromElement</code> | function | <code>src/utils/printPdf.js:2168</code> | Extract a safe printable image source from an already-rendered canvas or image element. |
| <code>printPdfBlob</code> | function | <code>src/utils/printPdf.js:1834</code> | Print a generated PDF through a hidden iframe. |
| <code>renderOverlayRichLines</code> | function | <code>src/utils/printPdf.js:730</code> |  |
| <code>reportProgress</code> | function | <code>src/utils/printPdf.js:1510</code> |  |
| <code>resolveJsPdfConstructor</code> | function | <code>src/utils/printPdf.js:1616</code> | Resolve jsPDF from common ESM/CJS export shapes used by bundlers. |
| <code>resolvePdfImageLoadConcurrency</code> | function | <code>src/utils/printPdf.js:1523</code> |  |
| <code>resolvePdfOrientationMode</code> | function | <code>src/utils/printPdf.js:1009</code> |  |
| <code>resolvePdfWorkerPlan</code> | function | <code>src/utils/printPdf.js:1536</code> | Resolve the generated-PDF worker plan. |
| <code>richLineHasText</code> | function | <code>src/utils/printPdf.js:513</code> |  |
| <code>richLineIsEmpty</code> | function | <code>src/utils/printPdf.js:521</code> |  |
| <code>sanitizeDiagnosticText</code> | function | <code>src/utils/printPdf.js:809</code> |  |
| <code>sanitizeParsedTemplateDocument</code> | function | <code>src/utils/printPdf.js:498</code> | Keep only the attributes used by the generated-PDF rich text subset. |
| <code>sanitizeTemplateHtmlForPdf</code> | function | <code>src/utils/printPdf.js:484</code> | Keep generated-PDF print templates inside the small rich-text subset consumed below. |
| <code>segmentFontStyle</code> | function | <code>src/utils/printPdf.js:1109</code> |  |
| <code>selectPageContexts</code> | function | <code>src/utils/printPdf.js:2014</code> |  |
| <code>stripDisallowedTemplateElements</code> | function | <code>src/utils/printPdf.js:447</code> | Remove elements that are never meaningful in generated PDF header/footer text. |
| <code>swapRichLineBufferContents</code> | function | <code>src/utils/printPdf.js:533</code> | Replace one line buffer with another while preserving the original array object. |
| <code>templateCssRuleMatchesElement</code> | function | <code>src/utils/printPdf.js:367</code> |  |
| <code>throwIfAborted</code> | function | <code>src/utils/printPdf.js:265</code> | Stop PDF generation as soon as the caller cancels the operation. |
| <code>htmlToRichLines~walk</code> | function | <code>src/utils/printPdf.js:650</code> |  |
| <code>warnDeprecatedPrintableUrlExportAlias</code> | function | <code>src/utils/printPdf.js:2040</code> |  |
| <code>wrapRichLines</code> | function | <code>src/utils/printPdf.js:1309</code> |  |
| <code>yieldToBrowser</code> | function | <code>src/utils/printPdf.js:275</code> | Yield one browser paint opportunity so progress updates become visible before expensive synchronous jsPDF operations run on the main thread. |
| <code>isSafeImageSrc</code> | function | <code>src/utils/printSanitize.js:16</code> | Allow-list image sources used for printing. |
| <code>applyBraceTokensEscaped</code> | function | <code>src/utils/printTemplate.js:649</code> |  |
| <code>applyConditionalBlocks</code> | function | <code>src/utils/printTemplate.js:720</code> | Resolve conditional blocks of the form \[\[{{path}}, &amp;quot;content&amp;quot;\]\]. |
| <code>applyLegacyTokensEscaped</code> | function | <code>src/utils/printTemplate.js:749</code> | Expand legacy ${...} tokens. |
| <code>applyTemplateTokensEscaped</code> | function | <code>src/utils/printTemplate.js:798</code> | Perform safe token substitution for print templates. |
| <code>buildMetadataTokenMap</code> | function | <code>src/utils/printTemplate.js:326</code> | Build a generic metadata lookup map from raw metadata, aliases and details. |
| <code>buildSessionTokenAliases</code> | function | <code>src/utils/printTemplate.js:407</code> |  |
| <code>convertNewlinesToBreaks</code> | function | <code>src/utils/printTemplate.js:737</code> | Convert template newlines to HTML line breaks after token expansion. |
| <code>decodeTemplateLiteral</code> | function | <code>src/utils/printTemplate.js:660</code> | Decode the small string literal grammar used inside conditional blocks. |
| <code>escapeHtmlSegment</code> | function | <code>src/utils/printTemplate.js:30</code> | Escape raw text characters for HTML text context. |
| <code>findCaseInsensitiveKey</code> | function | <code>src/utils/printTemplate.js:222</code> |  |
| <code>findFirstPresentText</code> | function | <code>src/utils/printTemplate.js:208</code> | Return the first present text value from an iterable collection. |
| <code>formatDateTokens</code> | function | <code>src/utils/printTemplate.js:105</code> | Format the built-in print date tokens. |
| <code>getByPath</code> | function | <code>src/utils/printTemplate.js:252</code> | Resolve a dotted-path property from an object \(e.g., &amp;quot;doc.title&amp;quot;\). |
| <code>hasPrintableValue</code> | function | <code>src/utils/printTemplate.js:143</code> | Treat null-like host values as absent so conditional blocks suppress their whole label/value pair. |
| <code>isPlainObject</code> | function | <code>src/utils/printTemplate.js:123</code> |  |
| <code>isPresentText</code> | function | <code>src/utils/printTemplate.js:199</code> | Test whether optionalText returned a usable string. |
| <code>makeBaseTokenContext</code> | function | <code>src/utils/printTemplate.js:474</code> | Build the base token context used by print templates. |
| <code>makePageTokenContext</code> | function | <code>src/utils/printTemplate.js:526</code> | Derive a page-specific token context by adding the document metadata tied to one printed page. |
| <code>normalizeDocumentOrdinal</code> | function | <code>src/utils/printTemplate.js:372</code> | Normalize host document numbers to the print-template convention. |
| <code>normalizePositiveInteger</code> | function | <code>src/utils/printTemplate.js:133</code> | Normalize page/document counters to a non-negative integer. |
| <code>ODVPrintWindow</code> | typedef | <code>src/utils/printTemplate.js:451</code> | Window-level values optionally supplied by embedding hosts. |
| <code>optionalText</code> | function | <code>src/utils/printTemplate.js:188</code> |  |
| <code>parseTokenExpression</code> | function | <code>src/utils/printTemplate.js:579</code> | Parse a token expression: path or path\|\|fallbackLiteral. |
| <code>putMetadataValue</code> | function | <code>src/utils/printTemplate.js:313</code> | Store a metadata value under a safe, useful key if that key is not already populated. |
| <code>resolveBundleDocumentForPage</code> | function | <code>src/utils/printTemplate.js:382</code> |  |
| <code>resolveCopyMarkerText</code> | function | <code>src/utils/printTemplate.js:235</code> | Resolve the configured copy/print-format marker text consistently across print backends. |
| <code>resolveMetadataRecordKey</code> | function | <code>src/utils/printTemplate.js:286</code> |  |
| <code>resolveMetadataRecordLabel</code> | function | <code>src/utils/printTemplate.js:295</code> |  |
| <code>resolveMetadataRecordValue</code> | function | <code>src/utils/printTemplate.js:277</code> |  |
| <code>resolvePriorityObjectValueText</code> | function | <code>src/utils/printTemplate.js:159</code> | Resolve the first printable display value from a host-supplied metadata object. |
| <code>resolveTokenExpressionEscaped</code> | function | <code>src/utils/printTemplate.js:637</code> |  |
| <code>tryGetDocumentMetadata</code> | function | <code>src/utils/printTemplate.js:435</code> | Read document metadata from a viewer handle without leaking handle-specific checks into the token-context builder. |
| <code>valueToText</code> | function | <code>src/utils/printTemplate.js:174</code> |  |
| <code>zeroPad2</code> | function | <code>src/utils/printTemplate.js:94</code> | Format a non-negative date/time component as at least two digits. |
| <code>currentLanguage</code> | function | <code>src/utils/printWatermark.js:13</code> |  |
| <code>normalizeWatermarkMode</code> | function | <code>src/utils/printWatermark.js:38</code> |  |
| <code>resolveWatermarkAssetSrc</code> | function | <code>src/utils/printWatermark.js:64</code> | Resolve the image asset for COPY/KOPIA watermark modes. |
| <code>resolveWatermarkMode</code> | function | <code>src/utils/printWatermark.js:51</code> |  |
| <code>toAbsoluteUrl</code> | function | <code>src/utils/printWatermark.js:21</code> |  |
| <code>getPublicAssetUrl</code> | function | <code>src/utils/publicAssetUrl.js:13</code> |  |
| <code>getReloadCacheAesKey</code> | function | <code>src/utils/reloadCacheCrypto.js:120</code> |  |
| <code>getReloadCacheAesKeyStorageState</code> | function | <code>src/utils/reloadCacheCrypto.js:105</code> |  |
| <code>STORAGE_PREFIX</code> | constant | <code>src/utils/reloadCacheCrypto.js:12</code> | Short-lived reload-cache key helpers. |
| <code>createDocumentSourceKey</code> | function | <code>src/utils/reloadCacheIdentity.js:115</code> |  |
| <code>createPersistedPageAssetKey</code> | function | <code>src/utils/reloadCacheIdentity.js:141</code> |  |
| <code>createReloadCacheSessionId</code> | function | <code>src/utils/reloadCacheIdentity.js:41</code> |  |
| <code>createRenderAssetSignature</code> | function | <code>src/utils/reloadCacheIdentity.js:123</code> |  |
| <code>describeDocumentSourceKey</code> | function | <code>src/utils/reloadCacheIdentity.js:53</code> |  |
| <code>part</code> | function | <code>src/utils/reloadCacheIdentity.js:33</code> |  |
| <code>stableHash</code> | function | <code>src/utils/reloadCacheIdentity.js:14</code> |  |
| <code>addScenario</code> | function | <code>src/utils/renderDecodeBenchmark.js:434</code> |  |
| <code>createAbortError</code> | function | <code>src/utils/renderDecodeBenchmark.js:293</code> |  |
| <code>createScenarios</code> | function | <code>src/utils/renderDecodeBenchmark.js:480</code> |  |
| <code>createTimeoutError</code> | function | <code>src/utils/renderDecodeBenchmark.js:338</code> |  |
| <code>delay</code> | function | <code>src/utils/renderDecodeBenchmark.js:304</code> |  |
| <code>deriveCountsFromMultipliers</code> | function | <code>src/utils/renderDecodeBenchmark.js:221</code> |  |
| <code>deriveWorkerCountsFromPageTargets</code> | function | <code>src/utils/renderDecodeBenchmark.js:234</code> |  |
| <code>getHardwareConcurrency</code> | function | <code>src/utils/renderDecodeBenchmark.js:189</code> |  |
| <code>isRenderDecodeBenchmarkEnabled</code> | function | <code>src/utils/renderDecodeBenchmark.js:285</code> |  |
| <code>mergePositiveCounts</code> | function | <code>src/utils/renderDecodeBenchmark.js:203</code> |  |
| <code>normalizeInteger</code> | function | <code>src/utils/renderDecodeBenchmark.js:50</code> |  |
| <code>normalizeMainThreadConcurrencies</code> | function | <code>src/utils/renderDecodeBenchmark.js:117</code> |  |
| <code>normalizeMultiplierList</code> | function | <code>src/utils/renderDecodeBenchmark.js:98</code> |  |
| <code>normalizePdfToImageModes</code> | function | <code>src/utils/renderDecodeBenchmark.js:146</code> |  |
| <code>normalizePdfWorkerBatchMode</code> | function | <code>src/utils/renderDecodeBenchmark.js:172</code> |  |
| <code>normalizePositiveNumberList</code> | function | <code>src/utils/renderDecodeBenchmark.js:80</code> |  |
| <code>normalizeRenderBenchmarkConfig</code> | function | <code>src/utils/renderDecodeBenchmark.js:245</code> |  |
| <code>normalizeSampleMode</code> | function | <code>src/utils/renderDecodeBenchmark.js:181</code> |  |
| <code>normalizeVariants</code> | function | <code>src/utils/renderDecodeBenchmark.js:129</code> |  |
| <code>normalizeWorkerCounts</code> | function | <code>src/utils/renderDecodeBenchmark.js:61</code> |  |
| <code>resolveScenarioConcurrency</code> | function | <code>src/utils/renderDecodeBenchmark.js:685</code> |  |
| <code>runLimited</code> | function | <code>src/utils/renderDecodeBenchmark.js:566</code> |  |
| <code>runRenderDecodeBenchmark</code> | function | <code>src/utils/renderDecodeBenchmark.js:1086</code> |  |
| <code>runScenario</code> | function | <code>src/utils/renderDecodeBenchmark.js:915</code> |  |
| <code>selectBenchmarkPages</code> | function | <code>src/utils/renderDecodeBenchmark.js:391</code> |  |
| <code>summarizeByExtension</code> | function | <code>src/utils/renderDecodeBenchmark.js:590</code> |  |
| <code>throwIfAborted</code> | function | <code>src/utils/renderDecodeBenchmark.js:329</code> |  |
| <code>withTimeout</code> | function | <code>src/utils/renderDecodeBenchmark.js:352</code> |  |
| <code>clampRenderSurfaceSize</code> | function | <code>src/utils/renderSurfaceBounds.js:25</code> | Clamp a requested raster surface into a conservative browser-safe envelope while preserving its aspect ratio. |
| <code>MAX_RENDER_SURFACE_DIMENSION</code> | constant | <code>src/utils/renderSurfaceBounds.js:9</code> | OpenDocViewer — conservative raster surface bounds. |
| <code>getKeyboardPrintShortcutBehavior</code> | function | <code>src/utils/runtimeConfig.js:83</code> | Resolve the configured Ctrl/Cmd+P behavior. |
| <code>getPrintDefaultMode</code> | function | <code>src/utils/runtimeConfig.js:275</code> | Resolve the default print page mode used when the user has not stored an override. |
| <code>getPrintSelectionWorkspaceConfig</code> | function | <code>src/utils/runtimeConfig.js:300</code> | Resolve the print-selection workspace configuration. |
| <code>getRuntimeConfig</code> | function | <code>src/utils/runtimeConfig.js:60</code> | Read the merged runtime configuration from the browser environment. |
| <code>getViewerCustomFitSizeLimits</code> | function | <code>src/utils/runtimeConfig.js:252</code> | Resolve the configured custom-size limits. |
| <code>getViewerCustomFitWidthFactorPercent</code> | function | <code>src/utils/runtimeConfig.js:238</code> | Resolve the custom-size width factor percentage. |
| <code>getViewerDefaultZoomMode</code> | function | <code>src/utils/runtimeConfig.js:225</code> | Resolve the initial page zoom mode. |
| <code>getViewerEdgeScrollPageTurnConfig</code> | function | <code>src/utils/runtimeConfig.js:324</code> | Resolve the optional scroll-at-edge page turn gesture. |
| <code>getViewerProblemNoticeConfig</code> | function | <code>src/utils/runtimeConfig.js:342</code> | Resolve the configurable viewer-level problem notice. |
| <code>isDocumentMetadataUiEnabled</code> | function | <code>src/utils/runtimeConfig.js:97</code> | Resolve whether document metadata UI affordances should be available. |
| <code>KeyboardPrintShortcutBehavior</code> | typedef | <code>src/utils/runtimeConfig.js:9</code> |  |
| <code>normalizeCustomFitSizeLimitPreference</code> | function | <code>src/utils/runtimeConfig.js:200</code> | Normalize the optional user custom-size limits. |
| <code>normalizeCustomFitWidthFactorPercent</code> | function | <code>src/utils/runtimeConfig.js:174</code> | Normalize a custom fit-width factor. |
| <code>normalizeOptionalCustomFitFactorPercent</code> | function | <code>src/utils/runtimeConfig.js:185</code> | Normalize an optional custom-size limit percentage. |
| <code>normalizePrintDefaultMode</code> | function | <code>src/utils/runtimeConfig.js:159</code> | Normalize a user-facing print default mode. |
| <code>PrintDefaultMode</code> | typedef | <code>src/utils/runtimeConfig.js:11</code> |  |
| <code>PrintSelectionWorkspaceConfig</code> | typedef | <code>src/utils/runtimeConfig.js:19</code> |  |
| <code>ViewerCustomFitSizeLimits</code> | typedef | <code>src/utils/runtimeConfig.js:12</code> |  |
| <code>ViewerDefaultZoomMode</code> | typedef | <code>src/utils/runtimeConfig.js:10</code> |  |
| <code>ViewerEdgeScrollPageTurnConfig</code> | typedef | <code>src/utils/runtimeConfig.js:26</code> |  |
| <code>ViewerProblemNoticeConfig</code> | typedef | <code>src/utils/runtimeConfig.js:34</code> |  |
| <code>BlobLruCache</code> | class | <code>src/utils/sourceTempStore.js:210</code> |  |
| <code>SourceTempStore#cleanup</code> | function | <code>src/utils/sourceTempStore.js:586</code> |  |
| <code>SourceTempStore#cleanupStaleSessions</code> | function | <code>src/utils/sourceTempStore.js:636</code> |  |
| <code>createSessionId</code> | function | <code>src/utils/sourceTempStore.js:74</code> |  |
| <code>createSourceTempStore</code> | function | <code>src/utils/sourceTempStore.js:260</code> |  |
| <code>BlobLruCache#delete</code> | function | <code>src/utils/sourceTempStore.js:247</code> |  |
| <code>SourceTempStore#deleteSource</code> | function | <code>src/utils/sourceTempStore.js:548</code> |  |
| <code>SourceTempStore#enqueueWrite</code> | function | <code>src/utils/sourceTempStore.js:410</code> |  |
| <code>SourceTempStore#ensureDb</code> | function | <code>src/utils/sourceTempStore.js:698</code> |  |
| <code>SourceTempStore#ensureKey</code> | function | <code>src/utils/sourceTempStore.js:707</code> |  |
| <code>BlobLruCache#get</code> | function | <code>src/utils/sourceTempStore.js:220</code> |  |
| <code>SourceTempStore#getArrayBuffer</code> | function | <code>src/utils/sourceTempStore.js:539</code> |  |
| <code>SourceTempStore#getBlob</code> | function | <code>src/utils/sourceTempStore.js:483</code> |  |
| <code>SourceTempStore#getIndexedDbRecord</code> | function | <code>src/utils/sourceTempStore.js:844</code> |  |
| <code>SourceTempStore#getMeta</code> | function | <code>src/utils/sourceTempStore.js:475</code> |  |
| <code>SourceTempStore#getSessionId</code> | function | <code>src/utils/sourceTempStore.js:340</code> |  |
| <code>SourceTempStore#getStats</code> | function | <code>src/utils/sourceTempStore.js:347</code> |  |
| <code>hasIndexedDb</code> | function | <code>src/utils/sourceTempStore.js:50</code> |  |
| <code>hasWebCrypto</code> | function | <code>src/utils/sourceTempStore.js:61</code> |  |
| <code>SourceTempStore#makeIndexedDbRecord</code> | function | <code>src/utils/sourceTempStore.js:793</code> |  |
| <code>makeStorageKey</code> | function | <code>src/utils/sourceTempStore.js:43</code> |  |
| <code>SourceTempStore#maybePromote</code> | function | <code>src/utils/sourceTempStore.js:731</code> |  |
| <code>normalizePositiveInteger</code> | function | <code>src/utils/sourceTempStore.js:113</code> |  |
| <code>normalizeTtlMs</code> | function | <code>src/utils/sourceTempStore.js:99</code> |  |
| <code>openTempStoreDb</code> | function | <code>src/utils/sourceTempStore.js:145</code> |  |
| <code>SourceTempStore#promoteToIndexedDb</code> | function | <code>src/utils/sourceTempStore.js:399</code> | Force promotion to IndexedDB for the current session when supported. |
| <code>SourceTempStore#putIndexedDbEntry</code> | function | <code>src/utils/sourceTempStore.js:777</code> |  |
| <code>SourceTempStore#putSource</code> | function | <code>src/utils/sourceTempStore.js:422</code> |  |
| <code>PutSourceOptions</code> | typedef | <code>src/utils/sourceTempStore.js:196</code> |  |
| <code>SourceTempStore#ready</code> | function | <code>src/utils/sourceTempStore.js:331</code> |  |
| <code>SourceTempStore#recordToBlob</code> | function | <code>src/utils/sourceTempStore.js:895</code> |  |
| <code>SourceTempStore#recordToMeta</code> | function | <code>src/utils/sourceTempStore.js:876</code> |  |
| <code>requestToPromise</code> | function | <code>src/utils/sourceTempStore.js:123</code> |  |
| <code>BlobLruCache#set</code> | function | <code>src/utils/sourceTempStore.js:234</code> |  |
| <code>SourceMeta</code> | typedef | <code>src/utils/sourceTempStore.js:182</code> |  |
| <code>SourceStoreStats</code> | typedef | <code>src/utils/sourceTempStore.js:165</code> |  |
| <code>SourceTempStore#SourceTempStore</code> | class | <code>src/utils/sourceTempStore.js:268</code> |  |
| <code>SourceTempStore#touchIndexedDbRecord</code> | function | <code>src/utils/sourceTempStore.js:858</code> |  |
| <code>transactionDone</code> | function | <code>src/utils/sourceTempStore.js:134</code> |  |
| <code>SourceTempStore#updateConfig</code> | function | <code>src/utils/sourceTempStore.js:374</code> | Update runtime thresholds for the active session. |
| <code>collectConfigDiagnostics</code> | function | <code>src/utils/supportDiagnostics.js:135</code> |  |
| <code>collectLocationDiagnostics</code> | function | <code>src/utils/supportDiagnostics.js:122</code> |  |
| <code>collectNavigatorDiagnostics</code> | function | <code>src/utils/supportDiagnostics.js:105</code> |  |
| <code>collectSupportDiagnostics</code> | function | <code>src/utils/supportDiagnostics.js:303</code> |  |
| <code>createDefaultDiagnosticsFilename</code> | function | <code>src/utils/supportDiagnostics.js:61</code> |  |
| <code>downloadJsonFile</code> | function | <code>src/utils/supportDiagnostics.js:337</code> | Download a JSON diagnostics payload in browser environments. |
| <code>getAppVersionFromWindowGlobals</code> | function | <code>src/utils/supportDiagnostics.js:26</code> |  |
| <code>hasOwn</code> | function | <code>src/utils/supportDiagnostics.js:52</code> |  |
| <code>loadLatestBenchmarkResult</code> | function | <code>src/utils/supportDiagnostics.js:246</code> |  |
| <code>loadLatestPdfBenchmarkResult</code> | function | <code>src/utils/supportDiagnostics.js:262</code> |  |
| <code>loadLatestRenderDecodeBenchmarkResult</code> | function | <code>src/utils/supportDiagnostics.js:282</code> |  |
| <code>logDiagnosticsDownloadFailure</code> | function | <code>src/utils/supportDiagnostics.js:81</code> |  |
| <code>normalizeDownloadFilename</code> | function | <code>src/utils/supportDiagnostics.js:72</code> |  |
| <code>resolveAppVersion</code> | function | <code>src/utils/supportDiagnostics.js:89</code> |  |
| <code>resolveBuildId</code> | function | <code>src/utils/supportDiagnostics.js:98</code> |  |
| <code>resolveImportMetaEnvValue</code> | function | <code>src/utils/supportDiagnostics.js:37</code> |  |
| <code>saveLatestPdfBenchmarkResult</code> | function | <code>src/utils/supportDiagnostics.js:270</code> |  |
| <code>saveLatestRenderDecodeBenchmarkResult</code> | function | <code>src/utils/supportDiagnostics.js:290</code> |  |
| <code>clearCustomFitSizeLimitPreference</code> | function | <code>src/utils/viewerPreferences.js:467</code> |  |
| <code>clearCustomFitWidthFactorPreference</code> | function | <code>src/utils/viewerPreferences.js:412</code> |  |
| <code>clearDefaultZoomModePreference</code> | function | <code>src/utils/viewerPreferences.js:377</code> |  |
| <code>clearPrintDefaultModePreference</code> | function | <code>src/utils/viewerPreferences.js:352</code> |  |
| <code>CustomFitSizeLimitPreference</code> | typedef | <code>src/utils/viewerPreferences.js:17</code> |  |
| <code>getCustomFitSizeLimitPreference</code> | function | <code>src/utils/viewerPreferences.js:427</code> |  |
| <code>getCustomFitWidthFactorPreference</code> | function | <code>src/utils/viewerPreferences.js:386</code> |  |
| <code>getDefaultZoomModePreference</code> | function | <code>src/utils/viewerPreferences.js:361</code> |  |
| <code>getLanguagePreference</code> | function | <code>src/utils/viewerPreferences.js:318</code> |  |
| <code>getPrintDefaultModePreference</code> | function | <code>src/utils/viewerPreferences.js:334</code> |  |
| <code>getThemeModePreference</code> | function | <code>src/utils/viewerPreferences.js:280</code> |  |
| <code>getThemePreference</code> | function | <code>src/utils/viewerPreferences.js:251</code> |  |
| <code>getViewerPreferences</code> | function | <code>src/utils/viewerPreferences.js:209</code> |  |
| <code>isExplicitTheme</code> | function | <code>src/utils/viewerPreferences.js:46</code> |  |
| <code>isThemeMode</code> | function | <code>src/utils/viewerPreferences.js:54</code> |  |
| <code>normalizeDefaultZoomModePreference</code> | function | <code>src/utils/viewerPreferences.js:74</code> |  |
| <code>normalizePreferences</code> | function | <code>src/utils/viewerPreferences.js:101</code> |  |
| <code>normalizeThemeModeValue</code> | function | <code>src/utils/viewerPreferences.js:64</code> | Normalize legacy theme-mode values. |
| <code>parsePreferences</code> | function | <code>src/utils/viewerPreferences.js:144</code> |  |
| <code>readPreferencesFromCookie</code> | function | <code>src/utils/viewerPreferences.js:156</code> |  |
| <code>readPreferencesFromStorage</code> | function | <code>src/utils/viewerPreferences.js:173</code> |  |
| <code>replaceViewerPreferences</code> | function | <code>src/utils/viewerPreferences.js:241</code> | Persist an already-normalized full preference object. |
| <code>setCustomFitSizeLimitPreference</code> | function | <code>src/utils/viewerPreferences.js:440</code> |  |
| <code>setCustomFitWidthFactorPreference</code> | function | <code>src/utils/viewerPreferences.js:399</code> |  |
| <code>setDefaultZoomModePreference</code> | function | <code>src/utils/viewerPreferences.js:369</code> |  |
| <code>setLanguagePreference</code> | function | <code>src/utils/viewerPreferences.js:327</code> |  |
| <code>setPrintDefaultModePreference</code> | function | <code>src/utils/viewerPreferences.js:345</code> |  |
| <code>setThemeModePreference</code> | function | <code>src/utils/viewerPreferences.js:297</code> | Persist the user&#39;s theme mode preference. |
| <code>setThemePreference</code> | function | <code>src/utils/viewerPreferences.js:270</code> |  |
| <code>setViewerPreferences</code> | function | <code>src/utils/viewerPreferences.js:219</code> |  |
| <code>ViewerPreferences</code> | typedef | <code>src/utils/viewerPreferences.js:24</code> |  |
| <code>writePreferencesToCookie</code> | function | <code>src/utils/viewerPreferences.js:186</code> |  |
| <code>writePreferencesToStorage</code> | function | <code>src/utils/viewerPreferences.js:199</code> |  |
| <code>applyZoom</code> | function | <code>src/utils/zoomUtils.js:140</code> | Set a new zoom value using the provided setter, clamped to \[MIN_ZOOM, MAX_ZOOM\]. |
| <code>calculateFitToScreenZoom</code> | function | <code>src/utils/zoomUtils.js:160</code> | Calculate and set a zoom that fits the render surface within both viewport axes. |
| <code>calculateFitToWidthZoom</code> | function | <code>src/utils/zoomUtils.js:200</code> | Calculate and set a zoom that fits the render surface width within the pane viewport. |
| <code>clamp</code> | function | <code>src/utils/zoomUtils.js:43</code> | Clamp a numeric value into the inclusive range \[min, max\]. |
| <code>getRenderableSize</code> | function | <code>src/utils/zoomUtils.js:95</code> | Read the intrinsic size of the active render surface. |
| <code>getViewport</code> | function | <code>src/utils/zoomUtils.js:80</code> | Resolve an exact viewport element from either a DOM node or a React-like ref. |
| <code>getViewportSize</code> | function | <code>src/utils/zoomUtils.js:126</code> | Read the exact client viewport available to the rendered pane. |
| <code>handleZoomIn</code> | function | <code>src/utils/zoomUtils.js:245</code> | Increase the zoom level by 10% \(multiplicative\), clamped to the safe range. |
| <code>handleZoomOut</code> | function | <code>src/utils/zoomUtils.js:260</code> | Decrease the zoom level by ~9.09% \(inverse of +10%\), clamped to the safe range. |
| <code>hasValidDimensions</code> | function | <code>src/utils/zoomUtils.js:60</code> |  |
| <code>isPositiveFiniteNumber</code> | function | <code>src/utils/zoomUtils.js:51</code> |  |
| <code>MAX_ZOOM</code> | constant | <code>src/utils/zoomUtils.js:15</code> | Maximum allowed zoom factor \(800%\). |
| <code>MIN_ZOOM</code> | constant | <code>src/utils/zoomUtils.js:13</code> | Minimum allowed zoom factor \(5%\). |
| <code>normalizeOptionalFactor</code> | function | <code>src/utils/zoomUtils.js:69</code> |  |
| <code>ZOOM_CHANGE_THRESHOLD</code> | constant | <code>src/utils/zoomUtils.js:21</code> | Treat zoom deltas smaller than this as unchanged to avoid redundant React updates. |
| <code>ZOOM_IN_MULTIPLIER</code> | constant | <code>src/utils/zoomUtils.js:17</code> | Zoom-in multiplier: each click increases zoom by 10% of the current zoom level \(1.1x\). |
| <code>ZOOM_OUT_MULTIPLIER</code> | constant | <code>src/utils/zoomUtils.js:19</code> | Zoom-out multiplier: inverse of +10%, approximately a 9.09% decrease. |
| <code>ZoomCalcOptions</code> | typedef | <code>src/utils/zoomUtils.js:23</code> | Optional calculation overrides. |
| <code>createFallbackMainThreadError</code> | function | <code>src/workers/imageWorker.js:44</code> | Creates an error that tells the caller this worker path is unsupported and should be retried on the main thread. |
| <code>PdfCacheEntry</code> | typedef | <code>src/workers/pdfPageWorker.js:20</code> |  |
| <code>workerScope</code> | constant | <code>src/workers/pdfWorker.js:9</code> | OpenDocViewer - generated PDF worker. |
