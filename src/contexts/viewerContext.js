// File: src/contexts/viewerContext.js
import { createContext } from 'react';

/**
 * @typedef {Object} ViewerPageEntry
 * @property {string} sourceKey
 * @property {string} fileExtension
 * @property {number} fileIndex
 * @property {number} pageIndex
 * @property {number=} allPagesIndex
 * @property {string} fullSizeUrl
 * @property {string} thumbnailUrl
 * @property {number} status
 * @property {number} fullSizeStatus
 * @property {number} thumbnailStatus
 * @property {boolean=} thumbnailUsesFullAsset
 * @property {boolean} loaded
 * @property {(number|undefined)} realWidth
 * @property {(number|undefined)} realHeight
 * @property {(string|undefined)} sourceMimeType
 * @property {(number|undefined)} sourceSizeBytes
 * @property {(string|undefined)} documentId
 * @property {(number|undefined)} documentNumber
 * @property {(number|undefined)} totalDocuments
 * @property {(number|undefined)} documentPageNumber
 * @property {(number|undefined)} documentPageCount
 * @property {(boolean|undefined)} isDocumentStart
 * @property {(boolean|undefined)} isDocumentEnd
 */


/**
 * @typedef {Object} DocumentSessionInitOptions
 * @property {number=} expectedSourceCount
 * @property {Object=} config
 * @property {string=} cacheSessionId
 * @property {{ documentVersion:number, documentUrlFallback:number, url:number }=} cacheIdentityStats
 */

/**
 * @typedef {Object} DisposeDocumentSessionOptions
 * @property {boolean=} clearPages
 */

/**
 * @typedef {Object} StoreSourceBlobInput
 * @property {string} sourceKey
 * @property {Blob} blob
 * @property {string=} fileExtension
 * @property {string=} mimeType
 * @property {string=} originalUrl
 * @property {number=} fileIndex
 */

/**
 * @typedef {Object} EnsurePageAssetOptions
 * @property {boolean=} trackInCache
 * @property {('critical'|'high'|'normal'|'low'|number)=} priority
 * @property {boolean=} skipFullReuse
 * @property {boolean=} forceRefresh
 * @property {boolean=} persist
 * @property {number=} fullPageScale
 */

/**
 * @typedef {Object} ViewerSourceDescriptor
 * @property {string} sourceKey
 * @property {string} fileExtension
 * @property {number} fileIndex
 * @property {number} pageCount
 * @property {string=} mimeType
 * @property {string=} sourceUrl
 * @property {number=} sizeBytes
 * @property {('document-version'|'document-url-fallback'|'url')=} cacheKeyMode
 */


/**
 * @typedef {Object} ViewerRuntimeDiagnostics
 * @property {number} sessionStartedAtMs
 * @property {number} loadRunStartedAtMs
 * @property {number} loadRunCompletedAtMs
 * @property {string} sourceStoreMode
 * @property {string} assetStoreMode
 * @property {number} sourceCount
 * @property {number} assetCount
 * @property {number} sourceBytes
 * @property {number} assetBytes
 * @property {number} fullReadyCount
 * @property {number} thumbnailReadyCount
 * @property {number} fullCacheCount
 * @property {number} thumbnailCacheCount
 * @property {number} fullCacheLimit
 * @property {number} thumbnailCacheLimit
 * @property {number} trackedObjectUrlCount
 * @property {number} warmupQueueLength
 * @property {number} pendingAssetCount
 * @property {number} activeWorkerCount
 * @property {number} activePdfWorkerCount
 * @property {number} activePageAssetWorkerCount
 * @property {number} pdfWorkerRenderedCount
 * @property {number} pdfWorkerFallbackCount
 * @property {number} mainPdfRenderedCount
 * @property {number} assetRenderCompletedCount
 * @property {number} assetRenderTotalMs
 * @property {number} assetRenderMaxMs
 * @property {number} assetRestoreAttemptCount
 * @property {number} assetRestoreHitCount
 * @property {number} assetRestoreMissCount
 * @property {number} assetRestoreTotalMs
 * @property {number} assetPersistPendingCount
 * @property {number} assetPersistCompletedCount
 * @property {number} assetPersistFailedCount
 * @property {number} assetPersistTotalMs
 * @property {number} assetPersistMaxMs
 * @property {string} assetPersistLastError
 * @property {number} loaderPrefetchCount
 * @property {number} loaderPrefetchTotalMs
 * @property {number} loaderPrefetchMaxMs
 * @property {number} loaderFetchCount
 * @property {number} loaderFetchTotalMs
 * @property {number} loaderFetchMaxMs
 * @property {number} loaderTypeCount
 * @property {number} loaderTypeTotalMs
 * @property {number} loaderTypeMaxMs
 * @property {number} loaderStoreCount
 * @property {number} loaderStoreTotalMs
 * @property {number} loaderStoreMaxMs
 * @property {number} loaderAnalysisCount
 * @property {number} loaderAnalysisTotalMs
 * @property {number} loaderAnalysisMaxMs
 * @property {boolean} sourceStoreEncrypted
 * @property {boolean} assetStoreEncrypted
 * @property {number} sourceCacheHits
 * @property {number} sourceCacheMisses
 * @property {number} assetCacheHits
 * @property {number} assetCacheMisses
 * @property {number} sourceReloadCacheTtlMs
 * @property {number} assetReloadCacheTtlMs
 * @property {number} sourceCacheReadFailures
 * @property {number} assetCacheReadFailures
 * @property {string} sourceCacheLastMissReason
 * @property {string} assetCacheLastMissReason
 * @property {string} sourceCacheLastReadFailure
 * @property {string} assetCacheLastReadFailure
 * @property {string} sourceCacheSessionId
 * @property {string} assetCacheSessionId
 * @property {string} sourceCacheKeyStorage
 * @property {string} assetCacheKeyStorage
 * @property {number} sourceCacheKeyModeDocumentVersion
 * @property {number} sourceCacheKeyModeUrlFallback
 * @property {number} sourceCacheKeyModeUrl
 */

/**
 * @typedef {Object} ViewerPageLoadState
 * @property {number} discoveredPages
 * @property {number} expectedPages
 * @property {number} readyPages
 * @property {number} failedPages
 * @property {number} pendingPages
 * @property {boolean} allPagesReady
 */

/**
 * @typedef {Object} ViewerContextValue
 * @property {(Object|null)} bundle
 * @property {Array.<ViewerPageEntry>} allPages
 * @property {function(ViewerPageEntry, number): void} insertPageAtIndex
 * @property {function(Array.<ViewerPageEntry>, number): void} insertPagesAtIndex
 * @property {function(number, *): void} patchPageAtIndex
 * @property {function(): Promise<void>} resetViewerState
 * @property {function((DocumentSessionInitOptions|undefined)=): Promise<void>} initializeDocumentSession
 * @property {function((DisposeDocumentSessionOptions|undefined)=): Promise<void>} disposeDocumentSession
 * @property {function(StoreSourceBlobInput): Promise<*>} storeSourceBlob
 * @property {function(string): Promise<(ArrayBuffer|null)>} readSourceArrayBuffer
 * @property {function(string): Promise<(Blob|null)>} readSourceBlob
 * @property {function(ViewerSourceDescriptor): void} registerSourceDescriptor
 * @property {function(string, number): void} recordLoaderPhaseTiming
 * @property {function(number, ('full'|'thumbnail'), (EnsurePageAssetOptions|undefined)=): Promise<(string|null)>} ensurePageAsset
 * @property {function(number): Promise<boolean>} enhancePdfPageResolution
 * @property {{ boostedKeys:Array<string>, pendingKeys:Array<string>, maxedKeys:Array<string> }} pdfResolutionBoostState
 * @property {function(number, ('full'|'thumbnail')): void} touchPageAsset
 * @property {function(number, ('full'|'thumbnail')): void} pinPageAsset
 * @property {function(number, ('full'|'thumbnail')): void} unpinPageAsset
 * @property {function(Array.<number>=): Promise<Array.<string>>} getPrintablePageUrls
 *   Every returned URL is leased: the caller must pass it to releasePrintablePageUrls
 *   when the print flow ends, or superseded blobs are never revoked.
 * @property {function((Array.<string>|string)): void} releasePrintablePageUrls
 *   Release URLs previously acquired through getPrintablePageUrls when the print flow ends
 *   (completed or cancelled), so superseded page URLs can be revoked without leaking.
 * @property {function(string): void} leasePrintablePageUrl
 *   Lease one live surface blob URL (for example the <img> source a
 *   surface-capture print or PDF export is consuming) so a supersession cannot
 *   revoke it mid-flow. Every leased URL must be passed to
 *   releasePrintablePageUrls when the flow ends.
 * @property {(string|null)} error
 * @property {function((string|null)): void} setError
 * @property {number} workerCount
 * @property {function(number): void} setWorkerCount
 * @property {boolean} loadingRunActive
 * @property {function(boolean): void} setLoadingRunActive
 * @property {number} plannedPageCount
 * @property {function(number): void} setPlannedPageCount
 * @property {Array.<string>} messageQueue
 * @property {function(string): void} addMessage
 * @property {Object} documentLoadingConfig
 * @property {'normal'|'soft'|'hard'} memoryPressureStage
 * @property {ViewerRuntimeDiagnostics} runtimeDiagnostics
 * @property {ViewerPageLoadState} pageLoadState
 * @property {function(number, number): void} scheduleSourceWarmup
 * @property {CompareTransformState} compareTransforms
 *   Free per-page transform of the compare view (docs-src/compare-transform.md).
 * @property {function(('primary'|'compare')): CompareTransform} getCompareTransform
 * @property {function(('primary'|'compare'), (Object|function(CompareTransform): Object)): void} setCompareTransform
 * @property {function(Object): void} dispatchCompareTransform compareTransformReducer action.
 * @property {CompareOverlayState} compareOverlay
 *   Overlay view settings of the compare mode: top page and its opacity (utils/compareOverlay.js).
 * @property {function(Object): void} dispatchCompareOverlay compareOverlayReducer action.
 */

/**
 * Per-page compare transform (utils/compareTransform.js): `scale` multiplies the base zoom
 * (1 = 100 %), `dx`/`dy` are CSS px at transform scale 1, `rotation` is degrees in [0, 360).
 * @typedef {Object} CompareTransform
 * @property {number} scale
 * @property {number} dx
 * @property {number} dy
 * @property {number} rotation
 */

/**
 * @typedef {Object} CompareOverlayState
 * @property {number} opacity Opacity of the top page in percent (0–100).
 * @property {('primary'|'compare')} top The page drawn on top.
 * @property {boolean} calibrated True once the overlay view has calibrated in this compare session.
 */

/**
 * @typedef {Object} CompareTransformState
 * @property {CompareTransform} primary
 * @property {CompareTransform} compare
 */

const ViewerContext = createContext(/** @type {ViewerContextValue} */ ({ bundle: null }));

export default ViewerContext;
