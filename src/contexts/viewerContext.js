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
 * @property {boolean} sourceStoreEncrypted
 * @property {boolean} assetStoreEncrypted
 * @property {number} sourceCacheHits
 * @property {number} sourceCacheMisses
 * @property {number} assetCacheHits
 * @property {number} assetCacheMisses
 * @property {number} sourceReloadCacheTtlMs
 * @property {number} assetReloadCacheTtlMs
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
 * @property {function(number, ('full'|'thumbnail'), (EnsurePageAssetOptions|undefined)=): Promise<(string|null)>} ensurePageAsset
 * @property {function(number, ('full'|'thumbnail')): void} touchPageAsset
 * @property {function(number, ('full'|'thumbnail')): void} pinPageAsset
 * @property {function(number, ('full'|'thumbnail')): void} unpinPageAsset
 * @property {function(Array.<number>=): Promise<Array.<string>>} getPrintablePageUrls
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
 */

const ViewerContext = createContext(/** @type {ViewerContextValue} */ ({ bundle: null }));

export default ViewerContext;
