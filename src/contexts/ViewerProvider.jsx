// File: src/contexts/ViewerProvider.jsx
/**
 * OpenDocViewer — Viewer state provider.
 *
 * The provider now owns the runtime resources that make large document batches tractable:
 *   - browser temp storage for original source bytes,
 *   - a registry of source descriptors,
 *   - lazy page asset rendering,
 *   - small LRU caches for full pages and thumbnails.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import logger from '../logging/systemLogger.js';
import ViewerContext from './viewerContext.js';
import {
  getDocumentLoadingConfig,
  isRasterImageExtension,
  shouldKeepAllFullImageAssets,
  shouldUseFullImagesForThumbnails,
} from '../utils/documentLoadingConfig.js';
import { createSourceTempStore } from '../utils/sourceTempStore.js';
import { createPageAssetStore } from '../utils/pageAssetStore.js';
import { createPageAssetRenderer } from '../utils/pageAssetRenderer.js';
import {
  createTrackedObjectUrl,
  revokeTrackedObjectUrl,
  revokeTrackedObjectUrls,
} from '../utils/objectUrlRegistry.js';


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
 */

/**
 * @param {('full'|'thumbnail')} variant
 * @param {number} pageIndex
 * @returns {string}
 */
function makeAssetKey(variant, pageIndex) {
  return `${variant}:${pageIndex}`;
}

/**
 * @param {*} page
 * @param {('full'|'thumbnail')} variant
 * @returns {string}
 */
function makePersistedAssetKey(page, variant) {
  const sourceKey = String(page?.sourceKey || '');
  const pageIndex = Math.max(0, Number(page?.pageIndex) || 0);
  return `${sourceKey}:${pageIndex}:${variant}`;
}

/**
 * @param {Array<any>} pages
 * @param {number} index
 * @returns {any}
 */
function getPageAt(pages, index) {
  if (!Array.isArray(pages)) return null;
  return pages[index] || null;
}

/**
 * @param {*} patch
 * @param {*} current
 * @returns {Object}
 */
function resolvePatch(patch, current) {
  if (typeof patch === 'function') {
    const next = patch(current);
    return next && typeof next === 'object' ? next : {};
  }
  return patch && typeof patch === 'object' ? patch : {};
}

/**
 * @param {Map<number, { url:string, lastAccess:number }>} map
 * @param {number} index
 * @returns {void}
 */
function touchCacheEntry(map, index) {
  const entry = map.get(index);
  if (!entry) return;
  map.delete(index);
  map.set(index, { ...entry, lastAccess: Date.now() });
}

/**
 * @param {function(): number} getLimit
 * @returns {function(function(): Promise<any>, ('critical'|'high'|'normal'|'low'|number)=): Promise<any>}
 */
function createLimiter(getLimit) {
  let activeCount = 0;
  let sequence = 0;
  /** @type {Array<{ task:function():Promise<any>, resolve:function(any):void, reject:function(*):void, priority:number, seq:number }>} */
  const queue = [];

  /**
   * @param {('critical'|'high'|'normal'|'low'|number|undefined)} priority
   * @returns {number}
   */
  const normalizePriority = (priority) => {
    if (typeof priority === 'number' && Number.isFinite(priority)) return Number(priority);
    switch (String(priority || 'normal').toLowerCase()) {
      case 'critical': return 300;
      case 'high': return 200;
      case 'low': return 0;
      default: return 100;
    }
  };

  const nextQueueIndex = () => {
    if (queue.length <= 1) return 0;
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      const candidate = queue[i];
      const currentBest = queue[bestIndex];
      if (candidate.priority > currentBest.priority) {
        bestIndex = i;
        continue;
      }
      if (candidate.priority === currentBest.priority && candidate.seq < currentBest.seq) {
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  const pump = () => {
    while (activeCount < Math.max(1, Number(getLimit()) || 1) && queue.length > 0) {
      const next = queue.splice(nextQueueIndex(), 1)[0];
      if (!next) return;
      activeCount += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          pump();
        });
    }
  };

  return (task, priority = 'normal') => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject, priority: normalizePriority(priority), seq: sequence++ });
    pump();
  });
}

/**
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export const ViewerProvider = ({ children }) => {
  const [allPages, setAllPages] = useState([]);
  const [error, setError] = useState(/** @type {(string|null)} */ (null));
  const [workerCount, setWorkerCount] = useState(0);
  const [loadingRunActive, setLoadingRunActive] = useState(false);
  const [plannedPageCount, setPlannedPageCount] = useState(0);
  const [messageQueue, setMessageQueue] = useState([]);

  const allPagesRef = useRef([]);
  const sourceDescriptorsRef = useRef(new Map());
  const tempStoreRef = useRef(null);
  const pageAssetStoreRef = useRef(null);
  const pageRendererRef = useRef(null);
  const sessionConfigRef = useRef(getDocumentLoadingConfig());
  const sessionEpochRef = useRef(0);
  const pendingAssetPromisesRef = useRef(new Map());
  const fullPageCacheRef = useRef(new Map());
  const thumbnailCacheRef = useRef(new Map());
  const pinnedAssetsRef = useRef(new Map());
  const ephemeralPrintUrlsRef = useRef(new Set());
  const indexedDbModeAnnouncedRef = useRef(false);
  const assetIndexedDbModeAnnouncedRef = useRef(false);
  const releasedRasterSourceKeysRef = useRef(new Set());

  const renderWithLimit = useRef(createLimiter(
    () => sessionConfigRef.current?.render?.maxConcurrentAssetRenders || 2
  )).current;

  /**
   * @param {Array<any>|function(Array<any>): Array<any>} updater
   * @returns {void}
   */
  const updateAllPages = useCallback((updater) => {
    setAllPages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      allPagesRef.current = Array.isArray(next) ? next : [];
      return allPagesRef.current;
    });
  }, []);

  /**
   * @returns {void}
   */
  const revokeSessionUrls = useCallback(() => {
    const urls = new Set();

    for (const page of allPagesRef.current) {
      if (!page) continue;
      if (page.fullSizeUrl) urls.add(page.fullSizeUrl);
      if (page.thumbnailUrl) urls.add(page.thumbnailUrl);
    }
    for (const entry of fullPageCacheRef.current.values()) urls.add(entry.url);
    for (const entry of thumbnailCacheRef.current.values()) urls.add(entry.url);
    for (const url of ephemeralPrintUrlsRef.current.values()) urls.add(url);

    revokeTrackedObjectUrls(urls);
    fullPageCacheRef.current.clear();
    thumbnailCacheRef.current.clear();
    pinnedAssetsRef.current.clear();
    ephemeralPrintUrlsRef.current.clear();
  }, []);

  /**
   * @returns {Promise<void>}
   */
  const resetViewerState = useCallback(async () => {
    sessionEpochRef.current += 1;
    pendingAssetPromisesRef.current.clear();
    sourceDescriptorsRef.current.clear();
    indexedDbModeAnnouncedRef.current = false;
    assetIndexedDbModeAnnouncedRef.current = false;
    releasedRasterSourceKeysRef.current.clear();
    revokeSessionUrls();

    if (pageRendererRef.current) {
      try {
        await pageRendererRef.current.dispose?.();
      } catch (e) {
        logger.warn('Failed to dispose page asset renderer during reset', {
          error: String(e?.message || e),
        });
      }
      pageRendererRef.current = null;
    }

    if (pageAssetStoreRef.current) {
      try {
        await pageAssetStoreRef.current.cleanup?.();
      } catch (e) {
        logger.warn('Failed to clean page-asset store during reset', {
          error: String(e?.message || e),
        });
      }
      pageAssetStoreRef.current = null;
    }

    if (tempStoreRef.current) {
      try {
        await tempStoreRef.current.cleanup?.();
      } catch (e) {
        logger.warn('Failed to clean temp store during reset', {
          error: String(e?.message || e),
        });
      }
      tempStoreRef.current = null;
    }

    updateAllPages([]);
    setError(null);
    setWorkerCount(0);
    setLoadingRunActive(false);
    setPlannedPageCount(0);
    setMessageQueue([]);
  }, [revokeSessionUrls, updateAllPages]);

  /**
   * @param {*} page
   * @param {number} index
   * @returns {void}
   */
  const insertPageAtIndex = useCallback((page, index) => {
    const safeIndex = Math.max(0, Number(index) || 0);
    updateAllPages((prev) => {
      const next = prev.slice();
      next[safeIndex] = page;
      return next;
    });
  }, [updateAllPages]);

  /**
   * @param {Array<any>} pages
   * @param {number} startIndex
   * @returns {void}
   */
  const insertPagesAtIndex = useCallback((pages, startIndex) => {
    const start = Math.max(0, Number(startIndex) || 0);
    if (!Array.isArray(pages) || pages.length === 0) return;
    updateAllPages((prev) => {
      const next = prev.slice();
      for (let i = 0; i < pages.length; i += 1) next[start + i] = pages[i];
      return next;
    });
  }, [updateAllPages]);

  /**
   * @param {number} index
   * @param {Object|function(*): Object} patch
   * @returns {void}
   */
  const patchPageAtIndex = useCallback((index, patch) => {
    const safeIndex = Math.max(0, Number(index) || 0);
    updateAllPages((prev) => {
      const current = getPageAt(prev, safeIndex);
      if (!current) return prev;
      const nextPatch = resolvePatch(patch, current);
      if (!nextPatch || Object.keys(nextPatch).length === 0) return prev;
      const next = prev.slice();
      next[safeIndex] = { ...current, ...nextPatch };
      return next;
    });
  }, [updateAllPages]);

  /**
   * @param {string} message
   * @returns {void}
   */
  const addMessage = useCallback((message) => {
    const text = String(message || '').trim();
    if (!text) return;
    setMessageQueue((prev) => {
      const next = prev.concat(text);
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  /**
   * @param {DocumentSessionInitOptions=} options
   * @returns {Promise<void>}
   */
  const initializeDocumentSession = useCallback(async (options = {}) => {
    await resetViewerState();

    sessionConfigRef.current = options?.config || getDocumentLoadingConfig();
    const tempStore = createSourceTempStore({
      ...sessionConfigRef.current.sourceStore,
      expectedSourceCount: Math.max(0, Number(options?.expectedSourceCount) || 0),
    });
    await tempStore.ready();
    tempStoreRef.current = tempStore;

    if (sessionConfigRef.current.assetStore.enabled !== false) {
      const pageAssetStore = createPageAssetStore({
        ...sessionConfigRef.current.assetStore,
      });
      await pageAssetStore.ready();
      pageAssetStoreRef.current = pageAssetStore;
    }

    pageRendererRef.current = createPageAssetRenderer({
      tempStore,
      config: sessionConfigRef.current.render,
    });

    sessionEpochRef.current += 1;
    logger.info('Initialized document session', {
      mode: tempStore.getStats?.().mode,
      assetMode: pageAssetStoreRef.current?.getStats?.().mode || 'disabled',
      expectedSourceCount: options?.expectedSourceCount || 0,
    });
  }, [resetViewerState]);

  /**
   * @param {DisposeDocumentSessionOptions=} options
   * @returns {Promise<void>}
   */
  const disposeDocumentSession = useCallback(async (options = {}) => {
    const clearPages = options?.clearPages !== false;
    sessionEpochRef.current += 1;
    pendingAssetPromisesRef.current.clear();
    sourceDescriptorsRef.current.clear();
    indexedDbModeAnnouncedRef.current = false;
    assetIndexedDbModeAnnouncedRef.current = false;
    releasedRasterSourceKeysRef.current.clear();
    revokeSessionUrls();

    if (pageRendererRef.current) {
      try {
        await pageRendererRef.current.dispose?.();
      } catch (e) {
        logger.warn('Failed to dispose page asset renderer', { error: String(e?.message || e) });
      }
      pageRendererRef.current = null;
    }

    if (pageAssetStoreRef.current) {
      try {
        await pageAssetStoreRef.current.cleanup?.();
      } catch (e) {
        logger.warn('Failed to cleanup page-asset store', { error: String(e?.message || e) });
      }
      pageAssetStoreRef.current = null;
    }

    if (tempStoreRef.current) {
      try {
        await tempStoreRef.current.cleanup?.();
      } catch (e) {
        logger.warn('Failed to cleanup temp store', { error: String(e?.message || e) });
      }
      tempStoreRef.current = null;
    }

    if (clearPages) updateAllPages([]);
  }, [revokeSessionUrls, updateAllPages]);

  /**
   * @param {*} descriptor
   * @returns {void}
   */
  const registerSourceDescriptor = useCallback((descriptor) => {
    const sourceKey = String(descriptor?.sourceKey || '');
    if (!sourceKey) return;
    sourceDescriptorsRef.current.set(sourceKey, {
      sourceKey,
      fileExtension: String(descriptor?.fileExtension || '').toLowerCase(),
      fileIndex: Number.isFinite(descriptor?.fileIndex) ? Number(descriptor.fileIndex) : 0,
      pageCount: Math.max(1, Number(descriptor?.pageCount) || 1),
      mimeType: String(descriptor?.mimeType || ''),
      sourceUrl: String(descriptor?.sourceUrl || ''),
      sizeBytes: Number(descriptor?.sizeBytes || 0),
    });
  }, []);

  /**
   * @param {StoreSourceBlobInput} input
   * @returns {Promise<*>}
   */
  const storeSourceBlob = useCallback(async (input) => {
    if (!tempStoreRef.current) throw new Error('No active document session.');
    const meta = await tempStoreRef.current.putSource({
      sourceKey: input.sourceKey,
      blob: input.blob,
      fileExtension: input.fileExtension,
      mimeType: input.mimeType,
      originalUrl: input.originalUrl,
      fileIndex: input.fileIndex,
    });

    const stats = tempStoreRef.current.getStats?.();
    if (stats?.mode === 'indexeddb' && !indexedDbModeAnnouncedRef.current) {
      indexedDbModeAnnouncedRef.current = true;
      addMessage('Source temp storage switched to browser disk cache (IndexedDB).');
    }

    return { ...meta, stats };
  }, [addMessage]);

  /**
   * @param {string} sourceKey
   * @returns {Promise<(ArrayBuffer|null)>}
   */
  const readSourceArrayBuffer = useCallback(async (sourceKey) => {
    if (!tempStoreRef.current) return null;
    return tempStoreRef.current.getArrayBuffer(sourceKey);
  }, []);

  /**
   * @param {string} sourceKey
   * @returns {Promise<(Blob|null)>}
   */
  const readSourceBlob = useCallback(async (sourceKey) => {
    if (!tempStoreRef.current) return null;
    return tempStoreRef.current.getBlob(sourceKey);
  }, []);

  /**
   * @returns {void}
   */
  const announceIndexedDbAssetMode = useCallback(() => {
    const stats = pageAssetStoreRef.current?.getStats?.();
    if (stats?.mode === 'indexeddb' && !assetIndexedDbModeAnnouncedRef.current) {
      assetIndexedDbModeAnnouncedRef.current = true;
      addMessage('Rendered page assets switched to browser disk cache (IndexedDB).');
    }
  }, [addMessage]);

  /**
   * @param {number} pageIndex
   * @returns {Promise<void>}
   */
  const maybeReleaseSinglePageRasterSource = useCallback(async (pageIndex) => {
    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || !page.sourceKey) return;
    if (!sessionConfigRef.current.assetStore.releaseSinglePageRasterSourceAfterFullPersist) return;
    if (releasedRasterSourceKeysRef.current.has(page.sourceKey)) return;

    const source = sourceDescriptorsRef.current.get(page.sourceKey);
    if (!source) return;
    if (Number(source.pageCount || 0) !== 1) return;
    if (!isRasterImageExtension(source.fileExtension)) return;
    if (!tempStoreRef.current?.deleteSource) return;

    try {
      await tempStoreRef.current.deleteSource(page.sourceKey);
      releasedRasterSourceKeysRef.current.add(page.sourceKey);
      logger.info('Released original single-page raster source after full asset persist', {
        sourceKey: page.sourceKey,
        fileExtension: source.fileExtension,
      });
    } catch (error) {
      logger.warn('Failed to release original single-page raster source', {
        sourceKey: page.sourceKey,
        error: String(error?.message || error),
      });
    }
  }, []);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {{ blob:Blob, width:number, height:number, mimeType:string }} rendered
   * @returns {Promise<void>}
   */
  const persistRenderedAsset = useCallback(async (pageIndex, variant, rendered) => {
    const store = pageAssetStoreRef.current;
    if (!store) return;
    if (variant === 'thumbnail' && sessionConfigRef.current.assetStore.persistThumbnails === false) return;

    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || !page.sourceKey) return;

    await store.putAsset({
      assetKey: makePersistedAssetKey(page, variant),
      sourceKey: page.sourceKey,
      pageIndex: Math.max(0, Number(page.pageIndex) || 0),
      variant,
      blob: rendered.blob,
      mimeType: rendered.mimeType,
      width: rendered.width,
      height: rendered.height,
    });

    announceIndexedDbAssetMode();
    if (variant === 'full') await maybeReleaseSinglePageRasterSource(pageIndex);
  }, [announceIndexedDbAssetMode, maybeReleaseSinglePageRasterSource]);



  /**
   * @param {('full'|'thumbnail')} variant
   * @returns {Map<number, { url:string, lastAccess:number }>}
   */
  const getVariantCache = useCallback((variant) => (
    variant === 'thumbnail' ? thumbnailCacheRef.current : fullPageCacheRef.current
  ), []);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const touchPageAsset = useCallback((pageIndex, variant) => {
    touchCacheEntry(getVariantCache(variant), pageIndex);
  }, [getVariantCache]);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const pinPageAsset = useCallback((pageIndex, variant) => {
    const key = makeAssetKey(variant, pageIndex);
    const current = Number(pinnedAssetsRef.current.get(key) || 0);
    pinnedAssetsRef.current.set(key, current + 1);
  }, []);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const unpinPageAsset = useCallback((pageIndex, variant) => {
    const key = makeAssetKey(variant, pageIndex);
    const current = Number(pinnedAssetsRef.current.get(key) || 0);
    if (current <= 1) pinnedAssetsRef.current.delete(key);
    else pinnedAssetsRef.current.set(key, current - 1);
  }, []);

  /**
   * @param {('full'|'thumbnail')} variant
   * @returns {number}
   */
  const getVariantCacheLimit = useCallback((variant) => {
    const renderConfig = sessionConfigRef.current.render;
    const totalPages = Array.isArray(allPagesRef.current) ? allPagesRef.current.length : 0;

    if (variant !== 'thumbnail') {
      const baseLimit = Math.max(1, Number(renderConfig.fullPageCacheLimit) || 1);
      return shouldKeepAllFullImageAssets(sessionConfigRef.current, allPagesRef.current)
        ? Math.max(baseLimit, totalPages)
        : baseLimit;
    }

    const baseLimit = Math.max(1, Number(renderConfig.thumbnailCacheLimit) || 1);
    const strategy = String(renderConfig.thumbnailLoadingStrategy || 'adaptive').toLowerCase();
    const eagerThreshold = Math.max(1, Number(renderConfig.thumbnailEagerPageThreshold) || 1);
    const keepAllThumbnails = strategy === 'eager'
      || (strategy !== 'viewport' && totalPages > 0 && totalPages <= eagerThreshold);

    return keepAllThumbnails ? Math.max(baseLimit, totalPages) : baseLimit;
  }, []);

  /**
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const enforceCacheLimit = useCallback((variant) => {
    const cache = getVariantCache(variant);
    const limit = getVariantCacheLimit(variant);

    if (cache.size <= limit) return;

    const entries = Array.from(cache.entries())
      .sort((a, b) => Number(a[1]?.lastAccess || 0) - Number(b[1]?.lastAccess || 0));

    for (const [pageIndex, entry] of entries) {
      if (cache.size <= limit) break;
      const pinKey = makeAssetKey(variant, pageIndex);
      if (pinnedAssetsRef.current.has(pinKey)) continue;

      cache.delete(pageIndex);
      revokeTrackedObjectUrl(entry.url);
      patchPageAtIndex(pageIndex, (current) => {
        if (variant === 'thumbnail') {
          return {
            thumbnailUrl: '',
            thumbnailStatus: current?.status === -1 ? -1 : 0,
            thumbnailUsesFullAsset: false,
          };
        }
        return {
          fullSizeUrl: '',
          fullSizeStatus: current?.status === -1 ? -1 : 0,
          loaded: false,
          ...(current?.thumbnailUsesFullAsset
            ? {
                thumbnailUrl: '',
                thumbnailStatus: current?.status === -1 ? -1 : 0,
              }
            : {}),
        };
      });
    }
  }, [getVariantCache, getVariantCacheLimit, patchPageAtIndex]);


  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {EnsurePageAssetOptions=} options
   * @returns {Promise<(string|null)>}
   */
  const restorePersistedAsset = useCallback(async (pageIndex, variant, options = {}) => {
    const store = pageAssetStoreRef.current;
    if (!store) return null;

    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || !page.sourceKey) return null;

    const stored = await store.getAsset(makePersistedAssetKey(page, variant));
    if (!stored?.blob || !stored?.meta) return null;

    const cache = getVariantCache(variant);
    const url = createTrackedObjectUrl(stored.blob);
    if (options.trackInCache !== false) {
      cache.set(pageIndex, { url, lastAccess: Date.now() });
      touchCacheEntry(cache, pageIndex);
    }

    patchPageAtIndex(pageIndex, variant === 'thumbnail'
      ? {
          thumbnailUrl: url,
          thumbnailStatus: 1,
          thumbnailUsesFullAsset: false,
          realWidth: stored.meta.width,
          realHeight: stored.meta.height,
        }
      : {
          fullSizeUrl: url,
          fullSizeStatus: 1,
          loaded: true,
          realWidth: stored.meta.width,
          realHeight: stored.meta.height,
          status: 1,
        }
    );

    if (options.trackInCache !== false) enforceCacheLimit(variant);
    return url;
  }, [enforceCacheLimit, getVariantCache, patchPageAtIndex]);
  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {('critical'|'high'|'normal'|'low'|number)=} priority
   * @returns {Promise<{ blob:Blob, width:number, height:number, mimeType:string }>}
   */
  const renderPageBlob = useCallback(async (pageIndex, variant, priority = 'normal') => {
    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || page.status === -1) throw new Error(`Page ${pageIndex} is not available.`);
    if (!page.sourceKey) throw new Error(`Page ${pageIndex} does not have a source key yet.`);
    const source = sourceDescriptorsRef.current.get(page.sourceKey);
    if (!source) throw new Error(`Missing source descriptor for ${page.sourceKey}.`);
    if (!pageRendererRef.current) throw new Error('No active page renderer.');

    return renderWithLimit(() => pageRendererRef.current.renderPageAsset({
      sourceKey: source.sourceKey,
      fileExtension: source.fileExtension,
      fileIndex: source.fileIndex,
      pageIndex: page.pageIndex,
    }, {
      variant,
      thumbnailMaxWidth: sessionConfigRef.current.render.thumbnailMaxWidth,
      thumbnailMaxHeight: sessionConfigRef.current.render.thumbnailMaxHeight,
    }), priority);
  }, [renderWithLimit]);

  /**
   * @param {number} pageIndex
   * @returns {boolean}
   */
  const shouldReuseFullAssetForThumbnail = useCallback((pageIndex) => {
    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || page.status === -1) return false;
    const totalPages = Array.isArray(allPagesRef.current) ? allPagesRef.current.length : 0;
    return shouldUseFullImagesForThumbnails(sessionConfigRef.current, page, totalPages);
  }, []);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {EnsurePageAssetOptions=} options
   * @returns {Promise<(string|null)>}
   */
  const ensurePageAsset = useCallback(async (pageIndex, variant, options = {}) => {
    const safeIndex = Math.max(0, Number(pageIndex) || 0);
    const currentPage = getPageAt(allPagesRef.current, safeIndex);
    if (!currentPage || currentPage.status === -1) {
      return currentPage?.fullSizeUrl || currentPage?.thumbnailUrl || null;
    }

    if (variant === 'thumbnail' && options.skipFullReuse !== true && shouldReuseFullAssetForThumbnail(safeIndex)) {
      const page = getPageAt(allPagesRef.current, safeIndex);
      if (page?.fullSizeStatus === 1 && page?.fullSizeUrl) {
        patchPageAtIndex(safeIndex, {
          thumbnailUsesFullAsset: true,
          thumbnailUrl: '',
          thumbnailStatus: 1,
        });
        touchPageAsset(safeIndex, 'full');
        return page.fullSizeUrl;
      }

      const fullUrl = await ensurePageAsset(safeIndex, 'full', {
        ...options,
        skipFullReuse: true,
      });
      patchPageAtIndex(safeIndex, {
        thumbnailUsesFullAsset: true,
        thumbnailUrl: '',
        thumbnailStatus: fullUrl ? 1 : (getPageAt(allPagesRef.current, safeIndex)?.status === -1 ? -1 : 0),
      });
      return fullUrl;
    }

    const cache = getVariantCache(variant);
    const cacheEntry = cache.get(safeIndex);
    if (cacheEntry?.url) {
      touchCacheEntry(cache, safeIndex);
      return cacheEntry.url;
    }

    const urlField = variant === 'thumbnail' ? 'thumbnailUrl' : 'fullSizeUrl';
    const statusField = variant === 'thumbnail' ? 'thumbnailStatus' : 'fullSizeStatus';
    const existingUrl = currentPage[urlField];
    if (existingUrl) {
      if (options.trackInCache !== false) {
        cache.set(safeIndex, { url: existingUrl, lastAccess: Date.now() });
        touchCacheEntry(cache, safeIndex);
      }
      return existingUrl;
    }

    const pendingKey = makeAssetKey(variant, safeIndex);
    if (pendingAssetPromisesRef.current.has(pendingKey)) {
      return pendingAssetPromisesRef.current.get(pendingKey);
    }

    const sessionEpoch = sessionEpochRef.current;
    patchPageAtIndex(safeIndex, { [statusField]: 0 });

    const promise = (async () => {
      try {
        const restoredUrl = await restorePersistedAsset(safeIndex, variant, options);
        if (sessionEpochRef.current !== sessionEpoch) return null;
        if (restoredUrl) return restoredUrl;

        const rendered = await renderPageBlob(safeIndex, variant, options.priority || 'normal');
        if (sessionEpochRef.current !== sessionEpoch) return null;

        await persistRenderedAsset(safeIndex, variant, rendered);
        if (sessionEpochRef.current !== sessionEpoch) return null;

        const url = createTrackedObjectUrl(rendered.blob);
        if (options.trackInCache !== false) {
          cache.set(safeIndex, { url, lastAccess: Date.now() });
          touchCacheEntry(cache, safeIndex);
        }

        patchPageAtIndex(safeIndex, variant === 'thumbnail'
          ? {
              thumbnailUrl: url,
              thumbnailStatus: 1,
              thumbnailUsesFullAsset: false,
              realWidth: rendered.width,
              realHeight: rendered.height,
            }
          : {
              fullSizeUrl: url,
              fullSizeStatus: 1,
              loaded: true,
              realWidth: rendered.width,
              realHeight: rendered.height,
              status: 1,
            }
        );

        if (options.trackInCache !== false) enforceCacheLimit(variant);
        return url;
      } catch (e) {
        if (sessionEpochRef.current === sessionEpoch) {
          patchPageAtIndex(safeIndex, variant === 'thumbnail'
            ? { thumbnailStatus: -1, thumbnailUsesFullAsset: false }
            : { fullSizeStatus: -1, status: -1 }
          );
        }
        logger.error('Failed to ensure page asset', {
          pageIndex: safeIndex,
          variant,
          error: String(e?.message || e),
        });
        return null;
      } finally {
        pendingAssetPromisesRef.current.delete(pendingKey);
      }
    })();

    pendingAssetPromisesRef.current.set(pendingKey, promise);
    return promise;
  }, [enforceCacheLimit, getVariantCache, patchPageAtIndex, persistRenderedAsset, renderPageBlob, restorePersistedAsset, shouldReuseFullAssetForThumbnail, touchPageAsset]);

  /**
   * @param {Array<number>=} pageIndexes
   * @returns {Promise<Array<string>>}
   */
  const getPrintablePageUrls = useCallback(async (pageIndexes) => {
    const indexes = Array.isArray(pageIndexes) && pageIndexes.length > 0
      ? pageIndexes
      : allPagesRef.current.map((_, index) => index);

    /** @type {Array<string>} */
    const urls = [];

    for (const rawIndex of indexes) {
      const pageIndex = Math.max(0, Number(rawIndex) || 0);
      const page = getPageAt(allPagesRef.current, pageIndex);
      if (!page || page.status === -1) continue;

      if (page.fullSizeUrl && page.fullSizeStatus === 1) {
        touchPageAsset(pageIndex, 'full');
        urls.push(page.fullSizeUrl);
        continue;
      }

      try {
        let blob = null;
        const stored = await pageAssetStoreRef.current?.getAsset?.(makePersistedAssetKey(page, 'full'));
        if (stored?.blob) {
          blob = stored.blob;
        } else {
          const rendered = await renderPageBlob(pageIndex, 'full', 'high');
          await persistRenderedAsset(pageIndex, 'full', rendered);
          blob = rendered.blob;
        }

        if (blob) {
          const url = createTrackedObjectUrl(blob);
          ephemeralPrintUrlsRef.current.add(url);
          urls.push(url);
        }
      } catch (e) {
        logger.warn('Failed to resolve print asset for page', {
          pageIndex,
          error: String(e?.message || e),
        });
      }
    }

    return urls;
  }, [persistRenderedAsset, renderPageBlob, touchPageAsset]);

  useEffect(() => () => {
    resetViewerState().catch((e) => {
      logger.warn('ViewerProvider unmount cleanup failed', { error: String(e?.message || e) });
    });
  }, [resetViewerState]);

  const contextValue = useMemo(() => ({
    allPages,
    insertPageAtIndex,
    insertPagesAtIndex,
    patchPageAtIndex,
    resetViewerState,
    initializeDocumentSession,
    disposeDocumentSession,
    storeSourceBlob,
    readSourceArrayBuffer,
    readSourceBlob,
    registerSourceDescriptor,
    ensurePageAsset,
    touchPageAsset,
    pinPageAsset,
    unpinPageAsset,
    getPrintablePageUrls,
    error,
    setError,
    workerCount,
    setWorkerCount,
    loadingRunActive,
    setLoadingRunActive,
    plannedPageCount,
    setPlannedPageCount,
    messageQueue,
    addMessage,
  }), [
    allPages,
    insertPageAtIndex,
    insertPagesAtIndex,
    patchPageAtIndex,
    resetViewerState,
    initializeDocumentSession,
    disposeDocumentSession,
    storeSourceBlob,
    readSourceArrayBuffer,
    readSourceBlob,
    registerSourceDescriptor,
    ensurePageAsset,
    touchPageAsset,
    pinPageAsset,
    unpinPageAsset,
    getPrintablePageUrls,
    error,
    workerCount,
    loadingRunActive,
    plannedPageCount,
    messageQueue,
    addMessage,
  ]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
