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
  applyMemoryPressureStage,
  cloneDocumentLoadingConfig,
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
  isTrackedObjectUrl,
  revokeTrackedObjectUrl,
  revokeTrackedObjectUrls,
  getTrackedObjectUrlCount,
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
 * @param {(string|null|undefined)} url
 * @returns {boolean}
 */
function isBlobObjectUrl(url) {
  return /^blob:/i.test(String(url || '').trim());
}

/**
 * @param {(string|null|undefined)} url
 * @returns {boolean}
 */
function isReusableAssetUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  return !isBlobObjectUrl(value) || isTrackedObjectUrl(value);
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
  const [documentLoadingConfig, setDocumentLoadingConfig] = useState(getDocumentLoadingConfig());
  const [memoryPressureStage, setMemoryPressureStage] = useState('normal');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState({
    sessionStartedAtMs: 0,
    loadRunStartedAtMs: 0,
    loadRunCompletedAtMs: 0,
    sourceStoreMode: 'memory',
    assetStoreMode: 'disabled',
    sourceCount: 0,
    assetCount: 0,
    sourceBytes: 0,
    assetBytes: 0,
    fullReadyCount: 0,
    thumbnailReadyCount: 0,
    fullCacheCount: 0,
    thumbnailCacheCount: 0,
    trackedObjectUrlCount: 0,
    warmupQueueLength: 0,
    pendingAssetCount: 0,
    sourceStoreEncrypted: false,
    assetStoreEncrypted: false,
  });

  const allPagesRef = useRef([]);
  const sourceDescriptorsRef = useRef(new Map());
  const tempStoreRef = useRef(null);
  const pageAssetStoreRef = useRef(null);
  const pageRendererRef = useRef(null);
  const sessionBaseConfigRef = useRef(getDocumentLoadingConfig());
  const sessionConfigRef = useRef(getDocumentLoadingConfig());
  const sessionEpochRef = useRef(0);
  const memoryMonitorTimerRef = useRef(null);
  const warmupQueueRef = useRef([]);
  const warmupRunningRef = useRef(false);
  const pendingAssetPromisesRef = useRef(new Map());
  const fullPageCacheRef = useRef(new Map());
  const thumbnailCacheRef = useRef(new Map());
  const pinnedAssetsRef = useRef(new Map());
  const ephemeralPrintUrlsRef = useRef(new Set());
  const indexedDbModeAnnouncedRef = useRef(false);
  const assetIndexedDbModeAnnouncedRef = useRef(false);
  const releasedRasterSourceKeysRef = useRef(new Set());
  const diagnosticsTimerRef = useRef(null);
  const previousLoadingRunActiveRef = useRef(false);
  const sessionStartedAtMsRef = useRef(0);
  const loadRunStartedAtMsRef = useRef(0);
  const loadRunCompletedAtMsRef = useRef(0);

  const renderWithLimit = useRef(createLimiter(
    () => sessionConfigRef.current?.render?.maxConcurrentMainThreadRenders || sessionConfigRef.current?.render?.maxConcurrentAssetRenders || 2
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
    warmupQueueRef.current = [];
    warmupRunningRef.current = false;
    if (memoryMonitorTimerRef.current) {
      try { window.clearInterval(memoryMonitorTimerRef.current); } catch {}
      memoryMonitorTimerRef.current = null;
    }
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
    const defaultConfig = getDocumentLoadingConfig();
    sessionBaseConfigRef.current = defaultConfig;
    sessionConfigRef.current = defaultConfig;
    setDocumentLoadingConfig(defaultConfig);
    setMemoryPressureStage('normal');
    if (diagnosticsTimerRef.current) {
      try { window.clearInterval(diagnosticsTimerRef.current); } catch {}
      diagnosticsTimerRef.current = null;
    }
    previousLoadingRunActiveRef.current = false;
    sessionStartedAtMsRef.current = 0;
    loadRunStartedAtMsRef.current = 0;
    loadRunCompletedAtMsRef.current = 0;
    setRuntimeDiagnostics({
      sessionStartedAtMs: 0,
      loadRunStartedAtMs: 0,
      loadRunCompletedAtMs: 0,
      sourceStoreMode: 'memory',
      assetStoreMode: 'disabled',
      sourceCount: 0,
      assetCount: 0,
      sourceBytes: 0,
      assetBytes: 0,
      fullReadyCount: 0,
      thumbnailReadyCount: 0,
      fullCacheCount: 0,
      thumbnailCacheCount: 0,
      trackedObjectUrlCount: 0,
      warmupQueueLength: 0,
      pendingAssetCount: 0,
      sourceStoreEncrypted: false,
      assetStoreEncrypted: false,
    });
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
   * @param {Object} nextConfig
   * @param {'normal'|'soft'|'hard'=} stage
   * @param {boolean=} forceIndexedDbPromotion
   * @returns {Promise<void>}
   */
  const applySessionConfig = useCallback(async (nextConfig, stage = 'normal', forceIndexedDbPromotion = false) => {
    const normalized = cloneDocumentLoadingConfig(nextConfig || sessionConfigRef.current || getDocumentLoadingConfig());
    sessionConfigRef.current = normalized;
    setDocumentLoadingConfig(normalized);
    setMemoryPressureStage(String(stage || 'normal').toLowerCase());

    if (tempStoreRef.current?.updateConfig) tempStoreRef.current.updateConfig(normalized.sourceStore);
    if (pageAssetStoreRef.current?.updateConfig) pageAssetStoreRef.current.updateConfig(normalized.assetStore);
    if (pageRendererRef.current?.updateConfig) pageRendererRef.current.updateConfig(normalized.render);

    if (forceIndexedDbPromotion) {
      try { await tempStoreRef.current?.promoteToIndexedDb?.(); } catch {}
      try { await pageAssetStoreRef.current?.promoteToIndexedDb?.(); } catch {}
    }

    setWorkerCount(Math.max(0, Number(pageRendererRef.current?.getWorkerCount?.() || 0)));
  }, []);

  /**
   * @returns {void}
   */
  const clearWarmupQueue = useCallback(() => {
    warmupQueueRef.current = [];
  }, []);


  /**
   * @param {DocumentSessionInitOptions=} options
   * @returns {Promise<void>}
   */
  const initializeDocumentSession = useCallback(async (options = {}) => {
    await resetViewerState();

    const baseConfig = cloneDocumentLoadingConfig(options?.config || getDocumentLoadingConfig());
    sessionBaseConfigRef.current = baseConfig;
    sessionConfigRef.current = cloneDocumentLoadingConfig(baseConfig);
    setDocumentLoadingConfig(sessionConfigRef.current);
    setMemoryPressureStage('normal');

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
    const now = Date.now();
    sessionStartedAtMsRef.current = now;
    loadRunStartedAtMsRef.current = 0;
    loadRunCompletedAtMsRef.current = 0;
    previousLoadingRunActiveRef.current = false;
    setWorkerCount(Math.max(0, Number(pageRendererRef.current?.getWorkerCount?.() || 0)));
    logger.info('Initialized document session', {
      mode: tempStore.getStats?.().mode,
      assetMode: pageAssetStoreRef.current?.getStats?.().mode || 'disabled',
      requestedMode: sessionConfigRef.current.mode,
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
    warmupQueueRef.current = [];
    warmupRunningRef.current = false;
    if (memoryMonitorTimerRef.current) {
      try { window.clearInterval(memoryMonitorTimerRef.current); } catch {}
      memoryMonitorTimerRef.current = null;
    }
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
    const defaultConfig = getDocumentLoadingConfig();
    sessionBaseConfigRef.current = defaultConfig;
    sessionConfigRef.current = defaultConfig;
    setDocumentLoadingConfig(defaultConfig);
    setMemoryPressureStage('normal');
    setWorkerCount(0);
    if (diagnosticsTimerRef.current) {
      try { window.clearInterval(diagnosticsTimerRef.current); } catch {}
      diagnosticsTimerRef.current = null;
    }
    previousLoadingRunActiveRef.current = false;
    sessionStartedAtMsRef.current = 0;
    loadRunStartedAtMsRef.current = 0;
    loadRunCompletedAtMsRef.current = 0;
    setRuntimeDiagnostics({
      sessionStartedAtMs: 0,
      loadRunStartedAtMs: 0,
      loadRunCompletedAtMs: 0,
      sourceStoreMode: 'memory',
      assetStoreMode: 'disabled',
      sourceCount: 0,
      assetCount: 0,
      sourceBytes: 0,
      assetBytes: 0,
      fullReadyCount: 0,
      thumbnailReadyCount: 0,
      fullCacheCount: 0,
      thumbnailCacheCount: 0,
      trackedObjectUrlCount: 0,
      warmupQueueLength: 0,
      pendingAssetCount: 0,
      sourceStoreEncrypted: false,
      assetStoreEncrypted: false,
    });
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

    const tempStore = tempStoreRef.current;
    const assetStore = pageAssetStoreRef.current;
    if (!tempStore?.deleteSource || !assetStore?.getAsset) return;

    const tempStoreMode = String(tempStore.getStats?.().mode || 'memory');
    const assetStoreMode = String(assetStore.getStats?.().mode || 'memory');
    if (tempStoreMode !== 'memory' || assetStoreMode !== 'indexeddb') return;

    try {
      const persisted = await assetStore.getAsset(makePersistedAssetKey(page, 'full'));
      if (!persisted?.blob || Number(persisted.blob.size || 0) <= 0) return;

      await tempStore.deleteSource(page.sourceKey);
      releasedRasterSourceKeysRef.current.add(page.sourceKey);
      logger.info('Released original single-page raster source after verified full-asset persist', {
        sourceKey: page.sourceKey,
        fileExtension: source.fileExtension,
        tempStoreMode,
        assetStoreMode,
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
   * Drop a page's current object URL reference from React state and the in-memory cache.
   * Persisted page-asset blobs remain untouched and can be restored immediately.
   *
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {string=} expectedUrl
   * @returns {void}
   */
  const clearPageAssetReference = useCallback((pageIndex, variant, expectedUrl = '') => {
    const safeIndex = Math.max(0, Number(pageIndex) || 0);
    const cache = getVariantCache(variant);
    const urlField = variant === 'thumbnail' ? 'thumbnailUrl' : 'fullSizeUrl';
    const normalizedExpected = String(expectedUrl || '').trim();
    const currentPage = getPageAt(allPagesRef.current, safeIndex);
    const cacheEntry = cache.get(safeIndex);
    const cacheUrl = String(cacheEntry?.url || '').trim();
    const pageUrl = String(currentPage?.[urlField] || '').trim();

    if (!normalizedExpected || (cacheUrl && cacheUrl === normalizedExpected)) {
      cache.delete(safeIndex);
    }

    const urlsToRevoke = new Set();
    if (cacheUrl && (!normalizedExpected || cacheUrl === normalizedExpected)) urlsToRevoke.add(cacheUrl);
    if (pageUrl && (!normalizedExpected || pageUrl === normalizedExpected)) urlsToRevoke.add(pageUrl);
    if (urlsToRevoke.size > 0) revokeTrackedObjectUrls(urlsToRevoke);

    if (!currentPage) return;

    patchPageAtIndex(safeIndex, (current) => {
      const activeUrl = String(current?.[urlField] || '').trim();
      if (normalizedExpected && activeUrl && activeUrl !== normalizedExpected) return {};

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
  }, [getVariantCache, patchPageAtIndex]);

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

    const reuseThumbnail = variant === 'full' && shouldReuseFullAssetForThumbnail(pageIndex);
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
          ...(reuseThumbnail
            ? {
                thumbnailUsesFullAsset: true,
                thumbnailUrl: '',
                thumbnailStatus: 1,
              }
            : {}),
        }
    );

    if (options.trackInCache !== false) enforceCacheLimit(variant);
    return url;
  }, [enforceCacheLimit, getVariantCache, patchPageAtIndex, shouldReuseFullAssetForThumbnail]);
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

    const renderTask = () => pageRendererRef.current.renderPageAsset({
      sourceKey: source.sourceKey,
      fileExtension: source.fileExtension,
      fileIndex: source.fileIndex,
      pageIndex: page.pageIndex,
    }, {
      variant,
      thumbnailMaxWidth: sessionConfigRef.current.render.thumbnailMaxWidth,
      thumbnailMaxHeight: sessionConfigRef.current.render.thumbnailMaxHeight,
    });

    if (pageRendererRef.current?.canRenderInWorker?.(source.fileExtension, variant)) {
      return renderTask();
    }

    return renderWithLimit(renderTask, priority);
  }, [renderWithLimit]);

  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {EnsurePageAssetOptions=} options
   * @returns {Promise<(string|null)>}
   */
  const ensurePageAsset = useCallback(async (pageIndex, variant, options = {}) => {
    const safeIndex = Math.max(0, Number(pageIndex) || 0);
    let workingPage = getPageAt(allPagesRef.current, safeIndex);
    if (!workingPage || workingPage.status === -1) {
      return workingPage?.fullSizeUrl || workingPage?.thumbnailUrl || null;
    }

    const cache = getVariantCache(variant);
    const urlField = variant === 'thumbnail' ? 'thumbnailUrl' : 'fullSizeUrl';
    const statusField = variant === 'thumbnail' ? 'thumbnailStatus' : 'fullSizeStatus';

    if (options.forceRefresh === true) {
      clearPageAssetReference(safeIndex, variant);
      workingPage = getPageAt(allPagesRef.current, safeIndex) || workingPage;
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

    const cacheEntry = cache.get(safeIndex);
    if (cacheEntry?.url) {
      if (isReusableAssetUrl(cacheEntry.url)) {
        touchCacheEntry(cache, safeIndex);
        return cacheEntry.url;
      }
      clearPageAssetReference(safeIndex, variant, cacheEntry.url);
    }

    workingPage = getPageAt(allPagesRef.current, safeIndex) || workingPage;
    const existingUrl = workingPage[urlField];
    if (existingUrl) {
      if (isReusableAssetUrl(existingUrl)) {
        if (options.trackInCache !== false) {
          cache.set(safeIndex, { url: existingUrl, lastAccess: Date.now() });
          touchCacheEntry(cache, safeIndex);
        }
        return existingUrl;
      }
      clearPageAssetReference(safeIndex, variant, existingUrl);
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

        const reuseThumbnail = variant === 'full' && shouldReuseFullAssetForThumbnail(safeIndex);
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
              ...(reuseThumbnail
                ? {
                    thumbnailUsesFullAsset: true,
                    thumbnailUrl: '',
                    thumbnailStatus: 1,
                  }
                : {}),
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
  }, [clearPageAssetReference, enforceCacheLimit, getVariantCache, patchPageAtIndex, persistRenderedAsset, renderPageBlob, restorePersistedAsset, shouldReuseFullAssetForThumbnail, touchPageAsset]);

  /**
   * Drain background eager-render work without blocking the UI thread.
   * The queue is intentionally best-effort: memory pressure or session resets may clear it at any time.
   *
   * @returns {Promise<void>}
   */
  const pumpWarmupQueue = useCallback(async () => {
    if (warmupRunningRef.current) return;
    warmupRunningRef.current = true;

    try {
      while (warmupQueueRef.current.length > 0) {
        const renderStrategy = String(sessionConfigRef.current?.render?.strategy || 'lazy-viewport').toLowerCase();
        if (renderStrategy === 'lazy-viewport') {
          warmupQueueRef.current = [];
          break;
        }

        const batchSize = Math.max(1, Number(sessionConfigRef.current?.render?.warmupBatchSize) || 1);
        const batch = warmupQueueRef.current.splice(0, batchSize);
        for (const task of batch) {
          try {
            const page = getPageAt(allPagesRef.current, task?.pageIndex);
            if (!page || page.status === -1) continue;
            await ensurePageAsset(task.pageIndex, task.variant, {
              priority: task.priority || 'low',
            });
          } catch (error) {
            logger.debug('Warm-up task skipped after render failure', {
              pageIndex: Number(task?.pageIndex || 0),
              variant: String(task?.variant || 'full'),
              error: String(error?.message || error),
            });
          }
        }

        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      warmupRunningRef.current = false;
      if (warmupQueueRef.current.length > 0) {
        window.setTimeout(() => {
          void pumpWarmupQueue();
        }, 0);
      }
    }
  }, [ensurePageAsset]);

  /**
   * Enqueue eager page rendering for a newly discovered source range.
   * Performance mode warms every page. Auto mode warms an initial nearby window. Memory mode does nothing.
   *
   * @param {number} startIndex
   * @param {number} pageCount
   * @returns {void}
   */
  const scheduleSourceWarmup = useCallback((startIndex, pageCount) => {
    const renderConfig = sessionConfigRef.current?.render || {};
    const strategy = String(renderConfig.strategy || 'lazy-viewport').toLowerCase();
    const safeStartIndex = Math.max(0, Number(startIndex) || 0);
    const safePageCount = Math.max(0, Number(pageCount) || 0);
    if (safePageCount <= 0 || strategy === 'lazy-viewport') return;

    const warmPageCount = strategy === 'eager-all'
      ? safePageCount
      : Math.min(safePageCount, Math.max(1, Number(renderConfig.warmupBatchSize) || 1));

    const queue = warmupQueueRef.current.slice();
    const queued = new Set(queue.map((item) => `${String(item?.variant || 'full')}:${Math.max(0, Number(item?.pageIndex) || 0)}`));
    const addTask = (pageIndex, variant, priority) => {
      const key = `${variant}:${pageIndex}`;
      if (queued.has(key)) return;
      queued.add(key);
      queue.push({ pageIndex, variant, priority });
    };

    for (let offset = 0; offset < warmPageCount; offset += 1) {
      const pageIndex = safeStartIndex + offset;
      addTask(pageIndex, 'full', offset === 0 ? 'high' : 'low');
      if (renderConfig.thumbnailLoadingStrategy !== 'viewport' || strategy === 'eager-all') {
        addTask(pageIndex, 'thumbnail', offset === 0 ? 'normal' : 'low');
      }
    }

    warmupQueueRef.current = queue;
    void pumpWarmupQueue();
  }, [pumpWarmupQueue]);

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

  useEffect(() => {
    enforceCacheLimit('full');
    enforceCacheLimit('thumbnail');
  }, [
    documentLoadingConfig.render.fullPageCacheLimit,
    documentLoadingConfig.render.thumbnailCacheLimit,
    enforceCacheLimit,
  ]);

  useEffect(() => {
    if (!tempStoreRef.current) return undefined;
    if (String(sessionBaseConfigRef.current?.mode || '').toLowerCase() !== 'auto') return undefined;
    if (documentLoadingConfig.memoryPressure.enabled === false) return undefined;

    let disposed = false;
    const rankOf = (stage) => (stage === 'hard' ? 2 : stage === 'soft' ? 1 : 0);

    const evaluate = async () => {
      if (disposed || !tempStoreRef.current) return;

      const baseConfig = sessionBaseConfigRef.current || getDocumentLoadingConfig();
      const memoryConfig = baseConfig.memoryPressure || {};
      const tempStats = tempStoreRef.current?.getStats?.() || {};
      const assetStats = pageAssetStoreRef.current?.getStats?.() || {};
      const sourceCount = sourceDescriptorsRef.current.size;
      const pageCount = Array.isArray(allPagesRef.current) ? allPagesRef.current.length : 0;
      const residentBytes = Math.max(0, Number(tempStats.totalBytes || 0)) + Math.max(0, Number(assetStats.totalBytes || 0));
      const residentMiB = residentBytes / (1024 * 1024);

      let heapRatio = 0;
      try {
        const perfMemory = globalThis.performance?.memory;
        const used = Number(perfMemory?.usedJSHeapSize || 0);
        const limit = Number(perfMemory?.jsHeapSizeLimit || 0);
        if (used > 0 && limit > 0) heapRatio = used / limit;
      } catch {}

      let nextStage = 'normal';
      if (
        (Number(memoryConfig.forceMemoryModeAbovePageCount || 0) > 0 && pageCount >= Number(memoryConfig.forceMemoryModeAbovePageCount || 0))
        || (Number(memoryConfig.forceMemoryModeAboveSourceCount || 0) > 0 && sourceCount >= Number(memoryConfig.forceMemoryModeAboveSourceCount || 0))
        || (Number(memoryConfig.hardResidentMiB || 0) > 0 && residentMiB >= Number(memoryConfig.hardResidentMiB || 0))
        || (Number(memoryConfig.hardHeapUsageRatio || 0) > 0 && heapRatio >= Number(memoryConfig.hardHeapUsageRatio || 0))
      ) {
        nextStage = 'hard';
      } else if (
        (Number(memoryConfig.softResidentMiB || 0) > 0 && residentMiB >= Number(memoryConfig.softResidentMiB || 0))
        || (Number(memoryConfig.softHeapUsageRatio || 0) > 0 && heapRatio >= Number(memoryConfig.softHeapUsageRatio || 0))
      ) {
        nextStage = 'soft';
      }

      const currentStage = String(memoryPressureStage || 'normal').toLowerCase();
      if (rankOf(nextStage) <= rankOf(currentStage)) return;

      const nextConfig = applyMemoryPressureStage(baseConfig, nextStage);
      if (nextStage !== 'normal') clearWarmupQueue();
      await applySessionConfig(nextConfig, nextStage, nextStage === 'hard');

      addMessage(
        nextStage === 'hard'
          ? 'Automatic memory protection activated. Switching to memory-efficient document rendering.'
          : 'Memory pressure detected. Reducing eager rendering and cache sizes.'
      );
    };

    void evaluate();
    const timerId = window.setInterval(() => {
      void evaluate();
    }, Math.max(250, Number(documentLoadingConfig.memoryPressure.sampleIntervalMs) || 2000));
    memoryMonitorTimerRef.current = timerId;

    return () => {
      disposed = true;
      if (memoryMonitorTimerRef.current === timerId) memoryMonitorTimerRef.current = null;
      try { window.clearInterval(timerId); } catch {}
    };
  }, [
    addMessage,
    allPages.length,
    applySessionConfig,
    clearWarmupQueue,
    documentLoadingConfig.memoryPressure.enabled,
    documentLoadingConfig.memoryPressure.sampleIntervalMs,
    memoryPressureStage,
  ]);


  useEffect(() => {
    const wasActive = previousLoadingRunActiveRef.current;
    if (loadingRunActive && !wasActive) {
      loadRunStartedAtMsRef.current = Date.now();
      loadRunCompletedAtMsRef.current = 0;
    } else if (!loadingRunActive && wasActive && loadRunStartedAtMsRef.current > 0) {
      loadRunCompletedAtMsRef.current = Date.now();
    }
    previousLoadingRunActiveRef.current = loadingRunActive;
  }, [loadingRunActive]);

  useEffect(() => {
    const collectRuntimeDiagnostics = () => {
      const tempStats = tempStoreRef.current?.getStats?.() || {};
      const assetStats = pageAssetStoreRef.current?.getStats?.() || {};
      const pages = Array.isArray(allPagesRef.current) ? allPagesRef.current : [];
      let fullReadyCount = 0;
      let thumbnailReadyCount = 0;
      for (const page of pages) {
        if (!page) continue;
        if (page.fullSizeStatus === 1 && page.fullSizeUrl) fullReadyCount += 1;
        const thumbnailReady = page.thumbnailUsesFullAsset
          ? (page.fullSizeStatus === 1 && !!page.fullSizeUrl)
          : (page.thumbnailStatus === 1 && !!page.thumbnailUrl);
        if (thumbnailReady) thumbnailReadyCount += 1;
      }

      setRuntimeDiagnostics((current) => {
        const next = {
          sessionStartedAtMs: Number(sessionStartedAtMsRef.current || 0),
          loadRunStartedAtMs: Number(loadRunStartedAtMsRef.current || 0),
          loadRunCompletedAtMs: Number(loadRunCompletedAtMsRef.current || 0),
          sourceStoreMode: String(tempStats.mode || 'memory'),
          assetStoreMode: pageAssetStoreRef.current ? String(assetStats.mode || 'memory') : 'disabled',
          sourceCount: Math.max(0, Number(tempStats.sourceCount || sourceDescriptorsRef.current.size || 0)),
          assetCount: Math.max(0, Number(assetStats.assetCount || 0)),
          sourceBytes: Math.max(0, Number(tempStats.totalBytes || 0)),
          assetBytes: Math.max(0, Number(assetStats.totalBytes || 0)),
          fullReadyCount,
          thumbnailReadyCount,
          fullCacheCount: fullPageCacheRef.current.size,
          thumbnailCacheCount: thumbnailCacheRef.current.size,
          trackedObjectUrlCount: getTrackedObjectUrlCount(),
          warmupQueueLength: warmupQueueRef.current.length,
          pendingAssetCount: pendingAssetPromisesRef.current.size,
          sourceStoreEncrypted: !!tempStats.encrypted,
          assetStoreEncrypted: !!assetStats.encrypted,
        };

        const same = Object.keys(next).every((key) => next[key] === current[key]);
        return same ? current : next;
      });
    };

    collectRuntimeDiagnostics();
    const timerId = window.setInterval(collectRuntimeDiagnostics, 1000);
    diagnosticsTimerRef.current = timerId;
    return () => {
      if (diagnosticsTimerRef.current === timerId) diagnosticsTimerRef.current = null;
      try { window.clearInterval(timerId); } catch {}
    };
  }, []);

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
    documentLoadingConfig,
    memoryPressureStage,
    runtimeDiagnostics,
    scheduleSourceWarmup,
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
    documentLoadingConfig,
    memoryPressureStage,
    runtimeDiagnostics,
    scheduleSourceWarmup,
  ]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
