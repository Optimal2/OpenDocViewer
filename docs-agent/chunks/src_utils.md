# OpenDocViewer / src/utils

File count: 34. Line count: 14530. JSDoc symbol count: 562.

## src/utils/documentLoadingConfig.js

Count PDF pages in a page descriptor list.

Exports: MAX_RELOAD_CACHE_TTL_MS, resolveRecommendedWorkerCount, DOCUMENT_LOADING_DEFAULTS, cloneDocumentLoadingConfig, countPdfPages, resolvePdfWorkerPlanForPageCount, resolvePdfRenderConfigForPageCount, applyDocumentLoadingMode, applyMemoryPressureStage, getPerformanceWindowPageCount, getDocumentLoadingConfig, isRasterImageExtension, shouldUseFullImagesForThumbnails, shouldKeepAllFullImageAssets, formatBytes, formatCount, shouldRecommendStopping

Local imports: src/utils/runtimeConfig.js, src/utils/memoryProfile.js

Symbols:

- `SourceStoreMode` (typedef) - No description.
- `SourceStoreProtection` (typedef) - No description.
- `ThumbnailLoadingStrategy` (typedef) - No description.
- `ThumbnailSourceStrategy` (typedef) - No description.
- `RuntimeMemoryTier` (typedef) - No description.
- `DocumentLoadingMode` (typedef) - No description.
- `DocumentLoadingFetchStrategy` (typedef) - No description.
- `DocumentLoadingRenderStrategy` (typedef) - No description.
- `DocumentLoadingRenderBackend` (typedef) - No description.
- `PdfToImageMode` (typedef) - No description.
- `DocumentLoadingMemoryPressureStage` (typedef) - No description.
- `DocumentLoadingAdaptiveMemoryConfig` (typedef) - No description.

## src/utils/documentMetadata.js

Build a UI-friendly projection of one document's metadata.

Exports: getBundleDocumentById, documentHasMetadata, bundleDocumentHasMetadata, buildDocumentMetadataView, buildDocumentMetadataMatrixView

Symbols:

- `isObject` (function) - No description.
- `toOptionalText` (function) - No description.
- `normalizeStringArray` (function) - No description.
- `getBundleDocumentById` (function) - No description.
- `documentHasMetadata` (function) - No description.
- `bundleDocumentHasMetadata` (function) - No description.
- `buildFieldPresentationHints` (function) - No description.
- `buildFieldPresentationHints~pushEntry` (function) - No description.
- `resolveMetadataLabel` (function) - Resolve the label shown for one metadata row.
- `resolveMetadataValue` (function) - No description.
- `buildAliasDetailRow` (function) - No description.
- `buildAliasLabelsByFieldId` (function) - No description.

## src/utils/idUtils.js

Create an opaque identifier fragment suitable for synthetic keys and document ids.

Exports: createOpaqueIdFragment, createOpaqueId

Symbols:

- `fallbackCounter` (member) - OpenDocViewer — small opaque identifier helpers.
- `bytesToHex` (function) - No description.
- `createOpaqueIdFragment` (function) - Create an opaque identifier fragment suitable for synthetic keys and document ids.
- `createOpaqueId` (function) - Create a prefixed opaque identifier.

## src/utils/localizedValue.js

Return the best string for the active language.

Exports: resolveLocalizedValue, resolveOptionLabel

Symbols:

- `LocalizedString` (typedef) - Localized string resolver for admin-supplied config values.
- `I18nOptionsLike` (typedef) - A subset of the i18next options object we care about.
- `I18nLike` (typedef) - Minimal shape of an i18n instance used by this module.
- `OptionLike` (typedef) - Option-like shape used by the print reason selector.
- `resolveLocalizedValue` (function) - Return the best string for the active language.
- `resolveOptionLabel` (function) - Resolve a label for a reason option.

## src/utils/memoryProfile.js

Exports getRuntimeMemoryProfile.

Exports: getRuntimeMemoryProfile

Symbols:

- `RuntimeMemoryTier` (typedef) - No description.
- `RuntimeMemoryProfile` (typedef) - No description.
- `readDeviceMemoryGb` (function) - No description.
- `readJsHeapLimitMiB` (function) - No description.
- `resolveTier` (function) - No description.
- `getRuntimeMemoryProfile` (function) - No description.

## src/utils/navigationUtils.js

Navigate to the previous page (no-op if already at page 1).

Exports: handlePrevPage, handleNextPage, handleFirstPage, handleLastPage

Local imports: src/logging/systemLogger.js

Symbols:

- `toPositiveInt` (function) - Coerce a value to a positive integer (minimum 1).
- `isValidTotalPages` (function) - Check whether totalPages looks valid (&gt;= 1).
- `clampPage` (function) - Clamp a page number into [1, totalPages].
- `handlePrevPage` (constant) - Navigate to the previous page (no-op if already at page 1).
- `handleNextPage` (constant) - Navigate to the next page (no-op if already at the last page).
- `handleFirstPage` (constant) - Navigate to the first page (always sets page to 1).
- `handleLastPage` (constant) - Navigate to the last page (no-op if totalPages invalid).

## src/utils/objectUrlRegistry.js

Check whether a blob/object URL is still tracked as live by the viewer.

Exports: createTrackedObjectUrl, revokeTrackedObjectUrl, revokeTrackedObjectUrls, isTrackedObjectUrl, getTrackedObjectUrlCount, revokeAllTrackedObjectUrls

Symbols:

- `createTrackedObjectUrl` (function) - No description.
- `revokeTrackedObjectUrl` (function) - No description.
- `revokeTrackedObjectUrls` (function) - No description.
- `isTrackedObjectUrl` (function) - Check whether a blob/object URL is still tracked as live by the viewer.
- `getTrackedObjectUrlCount` (function) - No description.
- `revokeAllTrackedObjectUrls` (function) - Revoke every tracked object URL.

## src/utils/pageAssetRenderer.js

Render a PDF page set through the PDF worker pool as one partitioned batch.

Exports: createPageAssetRenderer, PageAssetRenderer

Local imports: src/utils/documentLoadingConfig.js, src/utils/pageAssetWorkerPool.js, src/utils/pdfPageWorkerPool.js, src/utils/pdfjsDocumentOptions.js

Symbols:

- `PageAssetRendererOptions` (typedef) - No description.
- `PageAssetDescriptor` (typedef) - No description.
- `RenderPageAssetOptions` (typedef) - No description.
- `PageAssetRenderer#renderPdfPageAssetBatch` (function) - Render a PDF page set through the PDF worker pool as one partitioned batch.
- `PageAssetRenderer#renderPageAsset` (function) - Render one requested page asset.

## src/utils/pageAssetStore.js

Update runtime thresholds for the active session.

Exports: createPageAssetStore, PageAssetStore

Local imports: src/logging/systemLogger.js, src/utils/documentLoadingConfig.js, src/utils/reloadCacheCrypto.js

Symbols:

- `makeStorageKey` (function) - No description.
- `hasIndexedDb` (function) - No description.
- `hasWebCrypto` (function) - No description.
- `createSessionId` (function) - No description.
- `requestToPromise` (function) - No description.
- `transactionDone` (function) - No description.
- `openAssetStoreDb` (function) - No description.
- `PageAssetStoreStats` (typedef) - No description.
- `StoredPageAssetMeta` (typedef) - No description.
- `PutPageAssetOptions` (typedef) - No description.
- `BlobLruCache` (class) - No description.
- `BlobLruCache#get` (function) - No description.

## src/utils/pageAssetWorkerPool.js

Exports createPageAssetWorkerPool, PageAssetWorkerPool.

Exports: createPageAssetWorkerPool, PageAssetWorkerPool

Local imports: src/logging/systemLogger.js, ../workers/imageWorker.js?worker

Symbols:

- `PageAssetWorkerPoolOptions` (typedef) - No description.
- `PageAssetWorkerEntry` (typedef) - No description.
- `PendingWorkerTask` (typedef) - No description.
- `WorkerTaskInput` (typedef) - No description.
- `createPageAssetWorkerPool` (function) - No description.
- `isRasterExt` (function) - No description.
- `PageAssetWorkerPool#PageAssetWorkerPool` (class) - No description.
- `PageAssetWorkerPool#getWorkerCount` (function) - No description.
- `PageAssetWorkerPool#canRender` (function) - No description.
- `PageAssetWorkerPool#renderAsset` (function) - No description.
- `PageAssetWorkerPool#allocateTaskId` (function) - No description.
- `PageAssetWorkerPool#pump` (function) - No description.

## src/utils/pdfBenchmark.js

Keep a batch-size list ordered and unique.

Exports: isPdfBenchmarkEnabled, runPdfGenerationBenchmark

Local imports: src/logging/systemLogger.js, src/utils/documentLoadingConfig.js, src/utils/printPdf.js, src/utils/pdfWorkerDispatcher.js, src/utils/runtimeConfig.js, src/utils/supportDiagnostics.js

Symbols:

- `normalizeInteger` (function) - No description.
- `normalizeBatchSizes` (function) - No description.
- `normalizeBatchCounts` (function) - No description.
- `normalizeIntegerList` (function) - No description.
- `normalizeStrategies` (function) - No description.
- `normalizeMergeModes` (function) - No description.
- `normalizeProfile` (function) - No description.
- `addBatchSizeCandidate` (function) - Keep a batch-size list ordered and unique.
- `resolveBenchmarkWorkerPolicy` (function) - Resolve the PDF worker count with the same policy as generated-PDF output.
- `describeBenchmarkBatchPlan` (function) - Describe the actual batch plan for one benchmark run.
- `createScenarioLabel` (function) - No description.
- `createScenarioKey` (function) - No description.

## src/utils/pdfjsDocumentOptions.js

Shared pdf.js document-loading options.

Exports: withPdfJsDocumentOptions, PDFJS_WASM_BASE_URL

Symbols:

- `PDFJS_WASM_BASE_URL` (constant) - Shared pdf.js document-loading options.
- `withPdfJsDocumentOptions` (function) - No description.

## src/utils/pdfPageWorkerPool.js

Exports createPdfPageWorkerPool, PdfPageWorkerPool.

Exports: createPdfPageWorkerPool, PdfPageWorkerPool

Local imports: src/logging/systemLogger.js, ../workers/pdfPageWorker.js?worker

Symbols:

- `PdfPageWorkerPoolOptions` (typedef) - No description.
- `PdfPageWorkerEntry` (typedef) - No description.
- `PdfPageWorkerPool#PdfPageWorkerPool` (class) - No description.

## src/utils/pdfPrebuildPlan.js

Return the language dependency that should invalidate an all-pages prebuild run.

Exports: normalizePdfPrebuildAllPagesConfig, getPdfPrebuildAllPagesLanguageDependency, createPdfPrebuildAllPagesVariants, createPdfPrebuildVariantKey

Local imports: src/utils/localizedValue.js, src/utils/pdfPrintCacheKey.js

Symbols:

- `clampInteger` (function) - No description.
- `isNonEmptyObject` (function) - No description.
- `normalizeLanguageList` (function) - No description.
- `normalizeCopyMarkerStates` (function) - No description.
- `normalizePdfOrientationMode` (function) - No description.
- `resolvePrebuildPdfOrientation` (function) - No description.
- `resolveOptionPrintText` (function) - Resolve the string that should be used on physical print output for an option.
- `buildSelectedOptionDetails` (function) - No description.
- `normalizePdfPrebuildAllPagesConfig` (function) - No description.
- `getReasonOptions` (function) - No description.
- `createReasonVariants` (function) - No description.
- `createPrintFormatVariant` (function) - No description.

## src/utils/pdfPrintCacheKey.js

Compare the content-affecting print settings that determine whether an existing generated PDF can be reused.

Exports: normalizePdfPrintCacheLanguageMode, getPdfPrintCacheKeyOptions, isPdfPrintCacheLanguageIgnored, normalizePdfPrintCachePageNumbers, getPdfPrintCacheKey, canReuseGeneratedPdfPrint, isFullSessionPageSequence

Symbols:

- `stablePrintText` (function) - No description.
- `normalizePdfPrintCacheLanguageMode` (function) - No description.
- `getPdfPrintCacheKeyOptions` (function) - No description.
- `isPdfPrintCacheLanguageIgnored` (function) - No description.
- `normalizePdfPrintCachePageNumbers` (function) - No description.
- `getPdfPrintCacheKey` (function) - Compare the content-affecting print settings that determine whether an existing generated PDF can be reused.
- `canReuseGeneratedPdfPrint` (function) - Active-page PDF output is based on the current rendered surface, including transient client-side edits such as rotation, brightness and contrast.
- `isFullSessionPageSequence` (function) - No description.

## src/utils/pdfWorkerDispatcher.js

Pick a conservative future batch size from a pages-per-worker target.

Exports: resolveAutoPdfWorkerBatchSize, planPdfWorkerBatches, createPdfWithWorkerDispatcher

Local imports: ../workers/pdfWorker.js?worker

Symbols:

- `PdfWorkerBatch` (typedef) - No description.
- `PdfWorkerPlan` (typedef) - No description.
- `clampInteger` (function) - No description.
- `resolveAutoPdfWorkerBatchSize` (function) - Pick a conservative future batch size from a pages-per-worker target.
- `planPdfWorkerBatches` (function) - Split pages into worker tasks.
- `throwIfAborted` (function) - No description.
- `clampNumber` (function) - No description.
- `countBatchJobUnits` (function) - No description.
- `createPdfProgressPlan` (function) - No description.
- `batchProgressUnitsFromEvent` (function) - Convert worker phases to deterministic job units: 1 unit for loading the PDF engine per batch 1 unit per loaded page image 1 unit per generated page 1 unit for finalizing each par...
- `runLimitedTasks` (function) - Run async work with a small in-process dispatcher.
- `runPdfWorkerTask` (function) - No description.

## src/utils/performanceOverlayFlag.js

Resolve a boolean flag from (precedence order): window.

Exports: readRuntimeBooleanFlag, isPerformanceOverlayEnabled, default

Symbols:

- `escapeMetaName` (function) - No description.
- `readRuntimeBooleanFlag` (function) - Resolve a boolean flag from (precedence order): window.
- `isPerformanceOverlayEnabled` (function) - Determine whether the diagnostics/performance overlay is enabled.

## src/utils/printCore.js

Handles the print functionality for the CURRENT page/image.

Exports: handlePrint, handlePrintCurrentComparison, handlePrintAll, handlePrintSequence, handlePrintRange

Local imports: src/logging/systemLogger.js, src/utils/printDom.js, src/utils/printTemplate.js, src/utils/printSanitize.js

Symbols:

- `PrintOptions` (typedef) - Options for single-page printing.
- `PageRange` (typedef) - A 1-based inclusive page range.
- `PrintAllOptions` (typedef) - Options for printing multiple pages (all/range/sequence).
- `PrintCandidate` (typedef) - Internal: candidate node for &quot;largest visible&quot; heuristics.
- `PrintHeaderCfg` (typedef) - Print header config (runtime) consumed by the print overlay logic.
- `HiddenIframe` (typedef) - Return type for the hidden-iframe factory.
- `isVisiblyMeasurable` (function) - Check whether a candidate element is both present in layout and not hidden by basic CSS visibility.
- `pickLargestVisibleElement` (function) - Best-effort: pick the largest visible or inside a container (or document).
- `getPrintableDataUrl` (function) - Safely derive a printable data URL from an element that is either a or an .
- `resolveOrientation` (function) - Compute page orientation from dimensions when options.orientation === 'auto'.
- `getODVConfig` (function) - Read runtime configuration from the globals populated by public/odv.config.js .
- `resolveActiveNode` (function) - Attempt to resolve the currently active visual node to print.

## src/utils/printDom.js

Render a single-page print document in the given print iframe document.

Exports: renderSingleDocument, renderMultiDocument

Local imports: src/logging/systemLogger.js, src/utils/printTemplate.js, src/utils/printSanitize.js, src/utils/localizedValue.js, src/utils/printWatermark.js

Symbols:

- `PrintOverlayCfg` (typedef) - Print overlay config (runtime) consumed by the print overlay logic.
- `TokenContext` (typedef) - Token context used by templates.
- `tr` (function) - Tiny helper to translate with safe fallback.
- `normalizeNonNegativeNumber` (function) - Normalize an unknown configuration value to a non-negative number.
- `normalizeApplyTo` (function) - Normalize runtime overlay application mode.
- `shouldApplyOverlay` (function) - No description.
- `normalizePageOrientation` (function) - No description.
- `normalizeTrustedExtraCss` (function) - No description.
- `enabled` (function) - No description.
- `buildPrintCss` (function) - Build the print-only CSS string (inlined within the print iframe).
- `ensureHead` (function) - No description.
- `ensureBody` (function) - No description.

## src/utils/printParse.js

Parse &quot;Custom pages&quot; into a sequence.

Exports: parsePrintSequence

Symbols:

- `ParseResult` (typedef) - Result of parsing a custom pages string.
- `tr` (function) - Tiny helper to translate with safe fallback.
- `parsePrintSequence` (function) - Parse &quot;Custom pages&quot; into a sequence.

## src/utils/printPdf.js

Build a PDF blob from page image URLs and print metadata.

Exports: createPrintPdfBlob, downloadPdfBlob, printPdfBlob, collectPrintablePdfSources, createPdfFromDocumentHandle, handlePdfOutput, handlePdfCurrent, handlePdfCurrentComparison

Local imports: src/logging/systemLogger.js, src/utils/printTemplate.js, src/utils/localizedValue.js, src/utils/printSanitize.js, src/utils/printWatermark.js, src/utils/documentLoadingConfig.js, src/utils/pdfWorkerDispatcher.js

Symbols:

- `escapeRegExp` (function) - Escape regular-expression metacharacters in literal text.
- `PdfPrintOptions` (typedef) - No description.
- `PdfTextStyleHints` (typedef) - No description.
- `PdfTemplateCssStyleRule` (typedef) - No description.
- `PdfRichSegment` (typedef) - No description.
- `PdfRichColumn` (typedef) - No description.
- `PdfRichLine` (typedef) - No description.
- `asNumber` (function) - Convert a value to a finite number for PDF layout calculations.
- `normalizeQuality` (function) - Normalize canvas/PDF image quality to the browser-supported 0..1 range.
- `clamp01` (function) - Clamp a numeric value to the inclusive 0..1 range.
- `createAbortError` (function) - No description.
- `throwIfAborted` (function) - Stop PDF generation as soon as the caller cancels the operation.

## src/utils/printSanitize.js

Allow-list image sources used for printing.

Exports: isSafeImageSrc

Symbols:

- `isSafeImageSrc` (function) - Allow-list image sources used for printing.

## src/utils/printTemplate.js

Resolve the configured copy/print-format marker text consistently across print backends.

Exports: escapeHtml, resolveCopyMarkerText, getByPath, makeBaseTokenContext, makePageTokenContext, applyTemplateTokensEscaped

Symbols:

- `escapeHtmlSegment` (function) - Escape raw text characters for HTML text context.
- `zeroPad2` (function) - Format a non-negative date/time component as at least two digits.
- `formatDateTokens` (function) - Format the built-in print date tokens.
- `isPlainObject` (function) - No description.
- `normalizePositiveInteger` (function) - Normalize page/document counters to a non-negative integer.
- `hasPrintableValue` (function) - Treat null-like host values as absent so conditional blocks suppress their whole label/value pair.
- `resolvePriorityObjectValueText` (function) - Resolve the first printable display value from a host-supplied metadata object.
- `valueToText` (function) - No description.
- `optionalText` (function) - No description.
- `isPresentText` (function) - Test whether optionalText returned a usable string.
- `findFirstPresentText` (function) - Return the first present text value from an iterable collection.
- `findCaseInsensitiveKey` (function) - No description.

## src/utils/printUtils.js

Exports handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence.

Exports: handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence, parsePrintSequence, handlePdfOutput, handlePdfCurrent, handlePdfCurrentComparison, createPrintPdfBlob, printPdfBlob, downloadPdfBlob, default

Local imports: src/utils/printCore.js, src/utils/printParse.js, src/utils/printPdf.js

## src/utils/printWatermark.js

Resolve the image asset for COPY/KOPIA watermark modes.

Exports: normalizeWatermarkMode, resolveWatermarkMode, resolveWatermarkAssetSrc, default

Symbols:

- `currentLanguage` (function) - No description.
- `toAbsoluteUrl` (function) - No description.
- `normalizeWatermarkMode` (function) - No description.
- `resolveWatermarkMode` (function) - No description.
- `resolveWatermarkAssetSrc` (function) - Resolve the image asset for COPY/KOPIA watermark modes.

## src/utils/publicAssetUrl.js

Exports getPublicAssetUrl, default.

Exports: getPublicAssetUrl, default

Symbols:

- `getPublicAssetUrl` (function) - No description.

## src/utils/reloadCacheCrypto.js

Short-lived reload-cache key helpers.

Exports: getReloadCacheAesKeyStorageState, getReloadCacheAesKey

Symbols:

- `STORAGE_PREFIX` (constant) - Short-lived reload-cache key helpers.
- `getReloadCacheAesKeyStorageState` (function) - No description.
- `getReloadCacheAesKey` (function) - No description.

## src/utils/reloadCacheIdentity.js

Exports stableHash, createReloadCacheSessionId, describeDocumentSourceKey, createDocumentSourceKey, createRenderAssetSignature.

Exports: stableHash, createReloadCacheSessionId, describeDocumentSourceKey, createDocumentSourceKey, createRenderAssetSignature, createPersistedPageAssetKey

Symbols:

- `stableHash` (function) - No description.
- `part` (function) - No description.
- `createReloadCacheSessionId` (function) - No description.
- `describeDocumentSourceKey` (function) - No description.
- `createDocumentSourceKey` (function) - No description.
- `createRenderAssetSignature` (function) - No description.
- `createPersistedPageAssetKey` (function) - No description.

## src/utils/renderDecodeBenchmark.js

Exports isRenderDecodeBenchmarkEnabled, runRenderDecodeBenchmark.

Exports: isRenderDecodeBenchmarkEnabled, runRenderDecodeBenchmark

Local imports: src/logging/systemLogger.js, src/utils/pageAssetRenderer.js, src/utils/pdfPageWorkerPool.js, src/utils/documentLoadingConfig.js, src/utils/supportDiagnostics.js

Symbols:

- `normalizeInteger` (function) - No description.
- `normalizeWorkerCounts` (function) - No description.
- `normalizePositiveNumberList` (function) - No description.
- `normalizeMultiplierList` (function) - No description.
- `normalizeMainThreadConcurrencies` (function) - No description.
- `normalizeVariants` (function) - No description.
- `normalizePdfToImageModes` (function) - No description.
- `normalizePdfWorkerBatchMode` (function) - No description.
- `normalizeSampleMode` (function) - No description.
- `getHardwareConcurrency` (function) - No description.
- `mergePositiveCounts` (function) - No description.
- `deriveCountsFromMultipliers` (function) - No description.

## src/utils/runtimeConfig.js

Read the merged runtime configuration from the browser environment.

Exports: getRuntimeConfig, getKeyboardPrintShortcutBehavior, isDocumentMetadataUiEnabled, normalizePrintDefaultMode, normalizeCustomFitWidthFactorPercent, normalizeOptionalCustomFitFactorPercent, normalizeCustomFitSizeLimitPreference, getViewerDefaultZoomMode, getViewerCustomFitWidthFactorPercent, getViewerCustomFitSizeLimits, getPrintDefaultMode, getPrintSelectionWorkspaceConfig, getViewerEdgeScrollPageTurnConfig, getViewerProblemNoticeConfig

Symbols:

- `KeyboardPrintShortcutBehavior` (typedef) - No description.
- `ViewerDefaultZoomMode` (typedef) - No description.
- `PrintDefaultMode` (typedef) - No description.
- `ViewerCustomFitSizeLimits` (typedef) - No description.
- `PrintSelectionWorkspaceConfig` (typedef) - No description.
- `ViewerEdgeScrollPageTurnConfig` (typedef) - No description.
- `ViewerProblemNoticeConfig` (typedef) - No description.
- `getRuntimeConfig` (function) - Read the merged runtime configuration from the browser environment.
- `getKeyboardPrintShortcutBehavior` (function) - Resolve the configured Ctrl/Cmd+P behavior.
- `isDocumentMetadataUiEnabled` (function) - Resolve whether document metadata UI affordances should be available.
- `normalizePrintDefaultMode` (function) - Normalize a user-facing print default mode.
- `normalizeCustomFitWidthFactorPercent` (function) - Normalize a custom fit-width factor.

## src/utils/sourceTempStore.js

Update runtime thresholds for the active session.

Exports: createSourceTempStore, SourceTempStore

Local imports: src/logging/systemLogger.js, src/utils/documentLoadingConfig.js, src/utils/reloadCacheCrypto.js

Symbols:

- `makeStorageKey` (function) - No description.
- `hasIndexedDb` (function) - No description.
- `hasWebCrypto` (function) - No description.
- `createSessionId` (function) - No description.
- `normalizeTtlMs` (function) - No description.
- `normalizePositiveInteger` (function) - No description.
- `requestToPromise` (function) - No description.
- `transactionDone` (function) - No description.
- `openTempStoreDb` (function) - No description.
- `SourceStoreStats` (typedef) - No description.
- `SourceMeta` (typedef) - No description.
- `PutSourceOptions` (typedef) - No description.

## src/utils/supportDiagnostics.js

Download a JSON diagnostics payload in browser environments.

Exports: loadLatestPdfBenchmarkResult, saveLatestPdfBenchmarkResult, loadLatestRenderDecodeBenchmarkResult, saveLatestRenderDecodeBenchmarkResult, collectSupportDiagnostics, downloadJsonFile

Local imports: src/utils/runtimeConfig.js, src/utils/pdfPrebuildPlan.js, src/utils/pdfPrintCacheKey.js

Symbols:

- `getAppVersionFromWindowGlobals` (function) - No description.
- `resolveImportMetaEnvValue` (function) - No description.
- `hasOwn` (function) - No description.
- `createDefaultDiagnosticsFilename` (function) - No description.
- `normalizeDownloadFilename` (function) - No description.
- `logDiagnosticsDownloadFailure` (function) - No description.
- `resolveAppVersion` (function) - No description.
- `resolveBuildId` (function) - No description.
- `collectNavigatorDiagnostics` (function) - No description.
- `collectLocationDiagnostics` (function) - No description.
- `collectConfigDiagnostics` (function) - No description.
- `loadLatestBenchmarkResult` (function) - No description.

## src/utils/viewerPreferences.js

Persist the user's theme mode preference.

Exports: getViewerPreferences, setViewerPreferences, getThemePreference, setThemePreference, getThemeModePreference, setThemeModePreference, getLanguagePreference, setLanguagePreference, getPrintDefaultModePreference, setPrintDefaultModePreference, clearPrintDefaultModePreference, getDefaultZoomModePreference, setDefaultZoomModePreference, clearDefaultZoomModePreference, getCustomFitWidthFactorPreference, setCustomFitWidthFactorPreference, clearCustomFitWidthFactorPreference, getCustomFitSizeLimitPreference, setCustomFitSizeLimitPreference, clearCustomFitSizeLimitPreference

Local imports: src/utils/runtimeConfig.js

Symbols:

- `CustomFitSizeLimitPreference` (typedef) - No description.
- `ViewerPreferences` (typedef) - No description.
- `isExplicitTheme` (function) - No description.
- `isThemeMode` (function) - No description.
- `normalizeThemeModeValue` (function) - Normalize legacy theme-mode values.
- `normalizeDefaultZoomModePreference` (function) - No description.
- `normalizePreferences` (function) - No description.
- `parsePreferences` (function) - No description.
- `readPreferencesFromCookie` (function) - No description.
- `readPreferencesFromStorage` (function) - No description.
- `writePreferencesToCookie` (function) - No description.
- `writePreferencesToStorage` (function) - No description.

## src/utils/zoomUtils.js

Calculate and set a zoom that fits the render surface within both viewport axes.

Exports: calculateFitToScreenZoom, calculateFitToWidthZoom, handleZoomIn, handleZoomOut

Local imports: src/logging/systemLogger.js

Symbols:

- `MIN_ZOOM` (constant) - Minimum allowed zoom factor (5%).
- `MAX_ZOOM` (constant) - Maximum allowed zoom factor (800%).
- `ZOOM_IN_MULTIPLIER` (constant) - Zoom-in multiplier: each click increases zoom by 10% of the current zoom level (1.1x).
- `ZOOM_OUT_MULTIPLIER` (constant) - Zoom-out multiplier: inverse of +10%, approximately a 9.09% decrease.
- `ZOOM_CHANGE_THRESHOLD` (constant) - Treat zoom deltas smaller than this as unchanged to avoid redundant React updates.
- `ZoomCalcOptions` (typedef) - Optional calculation overrides.
- `clamp` (function) - Clamp a numeric value into the inclusive range [min, max].
- `isPositiveFiniteNumber` (function) - No description.
- `hasValidDimensions` (function) - No description.
- `normalizeOptionalFactor` (function) - No description.
- `getViewport` (function) - Resolve an exact viewport element from either a DOM node or a React-like ref.
- `getRenderableSize` (function) - Read the intrinsic size of the active render surface.
