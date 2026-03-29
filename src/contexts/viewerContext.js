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
 */


/**
 * @typedef {Object} DocumentSessionInitOptions
 * @property {number=} expectedSourceCount
 * @property {Object=} config
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
 * @typedef {Object} ViewerContextValue
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
 */

const ViewerContext = createContext(/** @type {ViewerContextValue} */ ({}));

export default ViewerContext;
