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
  countPdfPages,
  getDocumentLoadingConfig,
  getPerformanceWindowPageCount,
  isRasterImageExtension,
  shouldKeepAllFullImageAssets,
  shouldUseFullImagesForThumbnails,
} from '../utils/documentLoadingConfig.js';
import { createSourceTempStore } from '../utils/sourceTempStore.js';
import { createPageAssetStore } from '../utils/pageAssetStore.js';
import { createPageAssetRenderer } from '../utils/pageAssetRenderer.js';
import {
  createPersistedPageAssetKey,
  createRenderAssetSignature,
} from '../utils/reloadCacheIdentity.js';
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
 * @property {boolean=} forceRefresh
 * @property {boolean=} persist
 * @property {number=} fullPageScale
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
 * @param {('full'|'thumbnail')} variant
 * @param {number} pageIndex
 * @param {EnsurePageAssetOptions=} options
 * @returns {string}
 */
function makePendingAssetKey(variant, pageIndex, options = {}) {
  const scale = Number(options?.fullPageScale);
  return Number.isFinite(scale) && scale > 0
    ? `${makeAssetKey(variant, pageIndex)}:scale:${scale}`
    : makeAssetKey(variant, pageIndex);
}

/**
 * @param {*} page
 * @returns {string}
 */
function makePdfResolutionPageKey(page) {
  const sourceKey = String(page?.sourceKey || '');
  const sourcePageIndex = Math.max(0, Number(page?.pageIndex) || 0);
  return sourceKey ? `${sourceKey}:${sourcePageIndex}` : '';
}

/**
 * @param {*} page
 * @returns {boolean}
 */
function isPdfPageEntry(page) {
  return String(page?.fileExtension || '').toLowerCase() === 'pdf';
}

/**
 * @param {*} page
 * @param {('full'|'thumbnail')} variant
 * @param {*} renderConfig
 * @returns {string}
 */
function makePersistedAssetKey(page, variant, renderConfig) {
  const sourceKey = String(page?.sourceKey || '');
  const pageIndex = Math.max(0, Number(page?.pageIndex) || 0);
  const renderSignature = createRenderAssetSignature(renderConfig);
  return createPersistedPageAssetKey({
    sourceKey,
    pageIndex,
    variant,
    renderSignature,
  });
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
 * @param {*} page
 * @returns {boolean}
 */
function isPageReadyForSession(page) {
  return !!page && (Number(page.fullSizeStatus) === 1 || Number(page.fullSizeStatus) === -1 || Number(page.status) === -1);
}

/**
 * @param {*} page
 * @returns {boolean}
 */
function isPageFailedForSession(page) {
  return !!page && (Number(page.fullSizeStatus) === -1 || Number(page.status) === -1);
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
  let pumpTimer = 0;

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

  const schedulePump = () => {
    if (pumpTimer) return;
    pumpTimer = globalThis.setTimeout?.(() => {
      pumpTimer = 0;
      pump();
    }, 0) || 0;
  };

  const pump = () => {
    pumpTimer = 0;
    while (activeCount < Math.max(1, Number(getLimit()) || 1) && queue.length > 0) {
      const next = queue.splice(nextQueueIndex(), 1)[0];
      if (!next) return;
      activeCount += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          schedulePump();
        });
    }
  };

  return (task, priority = 'normal') => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject, priority: normalizePriority(priority), seq: sequence++ });
    pump();
  });
}

function createAssetPipelineStats() {
  return {
    renderCompletedCount: 0,
    renderTotalMs: 0,
    renderMaxMs: 0,
    workerQueueCount: 0,
    workerQueueTotalMs: 0,
    workerQueueMaxMs: 0,
    workerRunCount: 0,
    workerRunTotalMs: 0,
    workerRunMaxMs: 0,
    restoreAttemptCount: 0,
    restoreHitCount: 0,
    restoreMissCount: 0,
    restoreTotalMs: 0,
    persistPendingCount: 0,
    persistCompletedCount: 0,
    persistFailedCount: 0,
    persistTotalMs: 0,
    persistMaxMs: 0,
    persistLastError: '',
  };
}

function createLoaderPhaseStats() {
  return {
    prefetch: { count: 0, totalMs: 0, maxMs: 0 },
    fetch: { count: 0, totalMs: 0, maxMs: 0 },
    type: { count: 0, totalMs: 0, maxMs: 0 },
    store: { count: 0, totalMs: 0, maxMs: 0 },
    analysis: { count: 0, totalMs: 0, maxMs: 0 },
  };
}

function nowMs() {
  try {
    return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

/**
 * @typedef {Object} ViewerProviderProps
 * @property {React.ReactNode} children
 * @property {(Object|null|undefined)} [bundle]
 * @property {boolean} [diagnosticsEnabled=false]
 */

/**
 * @param {ViewerProviderProps} props
 * @returns {React.ReactElement}
 */
export const ViewerProvider = ({ children, bundle = null, diagnosticsEnabled = false }) => {
  const [allPages, setAllPages] = useState([]);
  const [error, setError] = useState(/** @type {(string|null)} */ (null));
  const [workerCount, setWorkerCount] = useState(0);
  const [loadingRunActive, setLoadingRunActive] = useState(false);
  const [plannedPageCount, setPlannedPageCount] = useState(0);
  const [messageQueue, setMessageQueue] = useState([]);
  const [documentLoadingConfig, setDocumentLoadingConfig] = useState(getDocumentLoadingConfig());
  const [memoryPressureStage, setMemoryPressureStage] = useState('normal');
  const [pdfResolutionBoostState, setPdfResolutionBoostState] = useState({ boostedKeys: [], pendingKeys: [] });
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
    fullCacheLimit: 0,
    thumbnailCacheLimit: 0,
    trackedObjectUrlCount: 0,
    warmupQueueLength: 0,
    pendingAssetCount: 0,
    activeWorkerCount: 0,
    activePdfWorkerCount: 0,
    activePageAssetWorkerCount: 0,
    pdfWorkerRenderedCount: 0,
    pdfWorkerFallbackCount: 0,
    mainPdfRenderedCount: 0,
    assetRenderCompletedCount: 0,
    assetRenderTotalMs: 0,
    assetRenderMaxMs: 0,
    assetWorkerQueueCount: 0,
    assetWorkerQueueTotalMs: 0,
    assetWorkerQueueMaxMs: 0,
    assetWorkerRunCount: 0,
    assetWorkerRunTotalMs: 0,
    assetWorkerRunMaxMs: 0,
    assetRestoreAttemptCount: 0,
    assetRestoreHitCount: 0,
    assetRestoreMissCount: 0,
    assetRestoreTotalMs: 0,
    assetPersistPendingCount: 0,
    assetPersistCompletedCount: 0,
    assetPersistFailedCount: 0,
    assetPersistTotalMs: 0,
    assetPersistMaxMs: 0,
    assetPersistLastError: '',
    loaderPrefetchCount: 0,
    loaderPrefetchTotalMs: 0,
    loaderPrefetchMaxMs: 0,
    loaderFetchCount: 0,
    loaderFetchTotalMs: 0,
    loaderFetchMaxMs: 0,
    loaderTypeCount: 0,
    loaderTypeTotalMs: 0,
    loaderTypeMaxMs: 0,
    loaderStoreCount: 0,
    loaderStoreTotalMs: 0,
    loaderStoreMaxMs: 0,
    loaderAnalysisCount: 0,
    loaderAnalysisTotalMs: 0,
    loaderAnalysisMaxMs: 0,
    sourceStoreEncrypted: false,
    assetStoreEncrypted: false,
    sourceCacheHits: 0,
    sourceCacheMisses: 0,
    assetCacheHits: 0,
    assetCacheMisses: 0,
    sourceReloadCacheTtlMs: 0,
    assetReloadCacheTtlMs: 0,
    sourceCacheReadFailures: 0,
    assetCacheReadFailures: 0,
    sourceCacheLastMissReason: '',
    assetCacheLastMissReason: '',
    sourceCacheLastReadFailure: '',
    assetCacheLastReadFailure: '',
    sourceCacheSessionId: '',
    assetCacheSessionId: '',
    sourceCacheKeyStorage: '',
    assetCacheKeyStorage: '',
    sourceCacheKeyModeDocumentVersion: 0,
    sourceCacheKeyModeUrlFallback: 0,
    sourceCacheKeyModeUrl: 0,
  });

  const allPagesRef = useRef([]);
  const sourceDescriptorsRef = useRef(new Map());
  const cacheIdentityStatsRef = useRef({ documentVersion: 0, documentUrlFallback: 0, url: 0 });
  const tempStoreRef = useRef(null);
  const pageAssetStoreRef = useRef(null);
  const pageRendererRef = useRef(null);
  const sessionBaseConfigRef = useRef(getDocumentLoadingConfig());
  const sessionConfigRef = useRef(getDocumentLoadingConfig());
  const sessionEpochRef = useRef(0);
  const memoryMonitorTimerRef = useRef(null);
  const warmupQueueRef = useRef(/** @type {Array<{ pageIndex:number, variant:('full'|'thumbnail'), priority:('critical'|'high'|'normal'|'low'|number), reason:(('warmup'|'readiness')|undefined) }>} */ ([]));
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
  const knownFullAssetPagesRef = useRef(new Set());
  const knownThumbnailAssetPagesRef = useRef(new Set());
  const pdfResolutionBoostedKeysRef = useRef(new Set());
  const pdfResolutionPendingKeysRef = useRef(new Set());
  const pdfPageCountRef = useRef(0);
  const assetPipelineStatsRef = useRef(createAssetPipelineStats());
  const loaderPhaseStatsRef = useRef(createLoaderPhaseStats());

  const renderWithLimit = useRef(createLimiter(
    () => Math.max(1, Number(sessionConfigRef.current?.render?.maxConcurrentMainThreadRenders) || 2)
  )).current;
  const pdfWorkerRenderWithLimit = useRef(createLimiter(
    () => Math.max(
      1,
      Number(pageRendererRef.current?.getPdfWorkerCount?.() || 0)
        || Number(sessionConfigRef.current?.render?.workerCount || 0)
        || 1
    )
  )).current;

  const publishPdfResolutionBoostState = useCallback(() => {
    setPdfResolutionBoostState({
      boostedKeys: Array.from(pdfResolutionBoostedKeysRef.current),
      pendingKeys: Array.from(pdfResolutionPendingKeysRef.current),
    });
  }, []);

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

  const syncRendererPdfPageCount = useCallback(() => {
    const nextPdfPageCount = countPdfPages(allPagesRef.current);
    if (pdfPageCountRef.current === nextPdfPageCount) return;
    pdfPageCountRef.current = nextPdfPageCount;
    pageRendererRef.current?.updateConfig?.({ pdfPageCount: nextPdfPageCount });
    setWorkerCount(Math.max(0, Number(pageRendererRef.current?.getWorkerCount?.() || 0)));
  }, []);

  /**
   * Record that a page now has a reusable full-size asset available.
   * The overlay tracks availability cumulatively across cache eviction, so these counters are not
   * decremented when object URLs are later revoked.
   *
   * @param {number} pageIndex
   * @returns {void}
   */
  const noteFullAssetReady = useCallback((pageIndex) => {
    knownFullAssetPagesRef.current.add(Math.max(0, Number(pageIndex) || 0));
  }, []);

  /**
   * Record that a page now has a reusable thumbnail asset available.
   *
   * @param {number} pageIndex
   * @returns {void}
   */
  const noteThumbnailAssetReady = useCallback((pageIndex) => {
    knownThumbnailAssetPagesRef.current.add(Math.max(0, Number(pageIndex) || 0));
  }, []);


  /**
   * Collect a stable snapshot of runtime counters for the optional diagnostics overlay.
   *
   * The collector reads only refs/store stats, so it remains valid across session resets and can be
   * reused by timers as well as key session transitions.
   *
   * @returns {void}
   */
  const collectRuntimeDiagnostics = useCallback(() => {
    if (!diagnosticsEnabled) return;

    const tempStats = tempStoreRef.current?.getStats?.() || {};
    const assetStats = pageAssetStoreRef.current?.getStats?.() || {};
    const rendererStats = pageRendererRef.current?.getStats?.() || {};
    const pipelineStats = assetPipelineStatsRef.current || createAssetPipelineStats();
    const loaderStats = loaderPhaseStatsRef.current || createLoaderPhaseStats();
    const pages = Array.isArray(allPagesRef.current) ? allPagesRef.current : [];
    const totalPages = pages.length;
    const renderConfig = sessionConfigRef.current?.render || {};
    let fullReadyCount = 0;
    let thumbnailReadyCount = 0;
    const fullCacheLimit = shouldKeepAllFullImageAssets(sessionConfigRef.current, pages)
      ? Math.max(totalPages, Math.max(1, Number(renderConfig.fullPageCacheLimit) || 1))
      : Math.max(1, Number(renderConfig.fullPageCacheLimit) || 1);
    const eagerThumbnailThreshold = Math.max(1, Number(renderConfig.thumbnailEagerPageThreshold) || 1);
    const keepAllThumbnails = String(renderConfig.thumbnailLoadingStrategy || 'adaptive').toLowerCase() === 'eager'
      || (String(renderConfig.thumbnailLoadingStrategy || 'adaptive').toLowerCase() !== 'viewport'
          && totalPages > 0
          && totalPages <= eagerThumbnailThreshold);
    const thumbnailCacheLimit = keepAllThumbnails
      ? Math.max(totalPages, Math.max(1, Number(renderConfig.thumbnailCacheLimit) || 1))
      : Math.max(1, Number(renderConfig.thumbnailCacheLimit) || 1);

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const page = pages[pageIndex];
      if (!page) continue;
      const hasKnownFull = knownFullAssetPagesRef.current.has(pageIndex)
        || (page.fullSizeStatus === 1 && !!page.fullSizeUrl);
      if (hasKnownFull) fullReadyCount += 1;

      const thumbnailReady = page.thumbnailUsesFullAsset
        ? hasKnownFull
        : (knownThumbnailAssetPagesRef.current.has(pageIndex)
            || (page.thumbnailStatus === 1 && !!page.thumbnailUrl));
      if (thumbnailReady) thumbnailReadyCount += 1;
    }

    setRuntimeDiagnostics((current) => {
      const cacheIdentityStats = cacheIdentityStatsRef.current || {};
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
        fullCacheLimit,
        thumbnailCacheLimit,
        trackedObjectUrlCount: getTrackedObjectUrlCount(),
        warmupQueueLength: warmupQueueRef.current.length,
        pendingAssetCount: pendingAssetPromisesRef.current.size,
        activeWorkerCount: Math.max(0, Number(rendererStats.activeWorkerCount || 0)),
        activePdfWorkerCount: Math.max(0, Number(rendererStats.activePdfWorkerCount || 0)),
        activePageAssetWorkerCount: Math.max(0, Number(rendererStats.activePageAssetWorkerCount || 0)),
        pdfWorkerRenderedCount: Math.max(0, Number(rendererStats.pdfWorkerCount || 0)),
        pdfWorkerFallbackCount: Math.max(0, Number(rendererStats.pdfWorkerFallbackCount || 0)),
        mainPdfRenderedCount: Math.max(0, Number(rendererStats.mainPdfCount || 0)),
        assetRenderCompletedCount: Math.max(0, Number(pipelineStats.renderCompletedCount || 0)),
        assetRenderTotalMs: Math.max(0, Number(pipelineStats.renderTotalMs || 0)),
        assetRenderMaxMs: Math.max(0, Number(pipelineStats.renderMaxMs || 0)),
        assetWorkerQueueCount: Math.max(0, Number(pipelineStats.workerQueueCount || 0)),
        assetWorkerQueueTotalMs: Math.max(0, Number(pipelineStats.workerQueueTotalMs || 0)),
        assetWorkerQueueMaxMs: Math.max(0, Number(pipelineStats.workerQueueMaxMs || 0)),
        assetWorkerRunCount: Math.max(0, Number(pipelineStats.workerRunCount || 0)),
        assetWorkerRunTotalMs: Math.max(0, Number(pipelineStats.workerRunTotalMs || 0)),
        assetWorkerRunMaxMs: Math.max(0, Number(pipelineStats.workerRunMaxMs || 0)),
        assetRestoreAttemptCount: Math.max(0, Number(pipelineStats.restoreAttemptCount || 0)),
        assetRestoreHitCount: Math.max(0, Number(pipelineStats.restoreHitCount || 0)),
        assetRestoreMissCount: Math.max(0, Number(pipelineStats.restoreMissCount || 0)),
        assetRestoreTotalMs: Math.max(0, Number(pipelineStats.restoreTotalMs || 0)),
        assetPersistPendingCount: Math.max(0, Number(pipelineStats.persistPendingCount || 0)),
        assetPersistCompletedCount: Math.max(0, Number(pipelineStats.persistCompletedCount || 0)),
        assetPersistFailedCount: Math.max(0, Number(pipelineStats.persistFailedCount || 0)),
        assetPersistTotalMs: Math.max(0, Number(pipelineStats.persistTotalMs || 0)),
        assetPersistMaxMs: Math.max(0, Number(pipelineStats.persistMaxMs || 0)),
        assetPersistLastError: String(pipelineStats.persistLastError || ''),
        loaderPrefetchCount: Math.max(0, Number(loaderStats.prefetch?.count || 0)),
        loaderPrefetchTotalMs: Math.max(0, Number(loaderStats.prefetch?.totalMs || 0)),
        loaderPrefetchMaxMs: Math.max(0, Number(loaderStats.prefetch?.maxMs || 0)),
        loaderFetchCount: Math.max(0, Number(loaderStats.fetch?.count || 0)),
        loaderFetchTotalMs: Math.max(0, Number(loaderStats.fetch?.totalMs || 0)),
        loaderFetchMaxMs: Math.max(0, Number(loaderStats.fetch?.maxMs || 0)),
        loaderTypeCount: Math.max(0, Number(loaderStats.type?.count || 0)),
        loaderTypeTotalMs: Math.max(0, Number(loaderStats.type?.totalMs || 0)),
        loaderTypeMaxMs: Math.max(0, Number(loaderStats.type?.maxMs || 0)),
        loaderStoreCount: Math.max(0, Number(loaderStats.store?.count || 0)),
        loaderStoreTotalMs: Math.max(0, Number(loaderStats.store?.totalMs || 0)),
        loaderStoreMaxMs: Math.max(0, Number(loaderStats.store?.maxMs || 0)),
        loaderAnalysisCount: Math.max(0, Number(loaderStats.analysis?.count || 0)),
        loaderAnalysisTotalMs: Math.max(0, Number(loaderStats.analysis?.totalMs || 0)),
        loaderAnalysisMaxMs: Math.max(0, Number(loaderStats.analysis?.maxMs || 0)),
        sourceStoreEncrypted: !!tempStats.encrypted,
        assetStoreEncrypted: !!assetStats.encrypted,
        sourceCacheHits: Math.max(0, Number(tempStats.cacheHits || 0)),
        sourceCacheMisses: Math.max(0, Number(tempStats.cacheMisses || 0)),
        assetCacheHits: Math.max(0, Number(assetStats.cacheHits || 0)),
        assetCacheMisses: Math.max(0, Number(assetStats.cacheMisses || 0)),
        sourceReloadCacheTtlMs: Math.max(0, Number(tempStats.reloadCacheTtlMs || 0)),
        assetReloadCacheTtlMs: Math.max(0, Number(assetStats.reloadCacheTtlMs || 0)),
        sourceCacheReadFailures: Math.max(0, Number(tempStats.cacheReadFailures || 0)),
        assetCacheReadFailures: Math.max(0, Number(assetStats.cacheReadFailures || 0)),
        sourceCacheLastMissReason: String(tempStats.lastCacheMissReason || ''),
        assetCacheLastMissReason: String(assetStats.lastCacheMissReason || ''),
        sourceCacheLastReadFailure: String(tempStats.lastCacheReadFailure || ''),
        assetCacheLastReadFailure: String(assetStats.lastCacheReadFailure || ''),
        sourceCacheSessionId: String(tempStats.sessionId || ''),
        assetCacheSessionId: String(assetStats.sessionId || ''),
        sourceCacheKeyStorage: String(tempStats.keyStorage || ''),
        assetCacheKeyStorage: String(assetStats.keyStorage || ''),
        sourceCacheKeyModeDocumentVersion: Math.max(0, Number(cacheIdentityStats.documentVersion || 0)),
        sourceCacheKeyModeUrlFallback: Math.max(0, Number(cacheIdentityStats.documentUrlFallback || 0)),
        sourceCacheKeyModeUrl: Math.max(0, Number(cacheIdentityStats.url || 0)),
      };

      const same = Object.keys(next).every((key) => next[key] === current[key]);
      return same ? current : next;
    });
  }, [diagnosticsEnabled]);

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
    cacheIdentityStatsRef.current = { documentVersion: 0, documentUrlFallback: 0, url: 0 };
    assetPipelineStatsRef.current = createAssetPipelineStats();
    indexedDbModeAnnouncedRef.current = false;
    assetIndexedDbModeAnnouncedRef.current = false;
    releasedRasterSourceKeysRef.current.clear();
    knownFullAssetPagesRef.current.clear();
    knownThumbnailAssetPagesRef.current.clear();
    pdfResolutionBoostedKeysRef.current.clear();
    pdfResolutionPendingKeysRef.current.clear();
    loaderPhaseStatsRef.current = createLoaderPhaseStats();
    setPdfResolutionBoostState({ boostedKeys: [], pendingKeys: [] });
    warmupQueueRef.current = [];
    warmupRunningRef.current = false;
    if (memoryMonitorTimerRef.current) {
      try { globalThis.clearInterval(memoryMonitorTimerRef.current); } catch {}
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
    pdfPageCountRef.current = 0;
    setDocumentLoadingConfig(defaultConfig);
    setMemoryPressureStage('normal');
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
      fullCacheLimit: 0,
      thumbnailCacheLimit: 0,
      trackedObjectUrlCount: 0,
      warmupQueueLength: 0,
      pendingAssetCount: 0,
      activeWorkerCount: 0,
      activePdfWorkerCount: 0,
      activePageAssetWorkerCount: 0,
      pdfWorkerRenderedCount: 0,
      pdfWorkerFallbackCount: 0,
      mainPdfRenderedCount: 0,
      assetRenderCompletedCount: 0,
      assetRenderTotalMs: 0,
      assetRenderMaxMs: 0,
      assetWorkerQueueCount: 0,
      assetWorkerQueueTotalMs: 0,
      assetWorkerQueueMaxMs: 0,
      assetWorkerRunCount: 0,
      assetWorkerRunTotalMs: 0,
      assetWorkerRunMaxMs: 0,
      assetRestoreAttemptCount: 0,
      assetRestoreHitCount: 0,
      assetRestoreMissCount: 0,
      assetRestoreTotalMs: 0,
      assetPersistPendingCount: 0,
      assetPersistCompletedCount: 0,
      assetPersistFailedCount: 0,
      assetPersistTotalMs: 0,
      assetPersistMaxMs: 0,
      assetPersistLastError: '',
      loaderPrefetchCount: 0,
      loaderPrefetchTotalMs: 0,
      loaderPrefetchMaxMs: 0,
      loaderFetchCount: 0,
      loaderFetchTotalMs: 0,
      loaderFetchMaxMs: 0,
      loaderTypeCount: 0,
      loaderTypeTotalMs: 0,
      loaderTypeMaxMs: 0,
      loaderStoreCount: 0,
      loaderStoreTotalMs: 0,
      loaderStoreMaxMs: 0,
      loaderAnalysisCount: 0,
      loaderAnalysisTotalMs: 0,
      loaderAnalysisMaxMs: 0,
      sourceStoreEncrypted: false,
      assetStoreEncrypted: false,
      sourceCacheHits: 0,
      sourceCacheMisses: 0,
      assetCacheHits: 0,
      assetCacheMisses: 0,
      sourceReloadCacheTtlMs: 0,
      assetReloadCacheTtlMs: 0,
      sourceCacheReadFailures: 0,
      assetCacheReadFailures: 0,
      sourceCacheLastMissReason: '',
      assetCacheLastMissReason: '',
      sourceCacheLastReadFailure: '',
      assetCacheLastReadFailure: '',
      sourceCacheSessionId: '',
      assetCacheSessionId: '',
      sourceCacheKeyStorage: '',
      assetCacheKeyStorage: '',
      sourceCacheKeyModeDocumentVersion: 0,
      sourceCacheKeyModeUrlFallback: 0,
      sourceCacheKeyModeUrl: 0,
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
      const current = next[safeIndex];
      next[safeIndex] = current && page && typeof current === 'object' && typeof page === 'object'
        ? { ...current, ...page }
        : page;
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
      for (let i = 0; i < pages.length; i += 1) {
        const current = next[start + i];
        const incoming = pages[i];
        next[start + i] = current && incoming && typeof current === 'object' && typeof incoming === 'object'
          ? { ...current, ...incoming }
          : incoming;
      }
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

      let changed = false;
      for (const [key, value] of Object.entries(nextPatch)) {
        if (!Object.is(current[key], value)) {
          changed = true;
          break;
        }
      }
      if (!changed) return prev;

      const nextPage = { ...current, ...nextPatch };
      for (const [field, cache] of [
        ['fullSizeUrl', fullPageCacheRef.current],
        ['thumbnailUrl', thumbnailCacheRef.current],
      ]) {
        const previousUrl = String(current?.[field] || '').trim();
        const nextUrl = String(nextPage?.[field] || '').trim();
        if (!previousUrl || previousUrl === nextUrl) continue;

        const stillReferenced = ['fullSizeUrl', 'thumbnailUrl']
          .some((candidate) => String(nextPage?.[candidate] || '').trim() === previousUrl);
        if (!stillReferenced && isTrackedObjectUrl(previousUrl)) {
          revokeTrackedObjectUrl(previousUrl);
        }

        const cachedUrl = String(cache.get(safeIndex)?.url || '').trim();
        if (cachedUrl && cachedUrl === previousUrl && cachedUrl !== nextUrl) {
          cache.delete(safeIndex);
        }
      }

      const next = prev.slice();
      next[safeIndex] = nextPage;
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
    if (pageRendererRef.current?.updateConfig) {
      pageRendererRef.current.updateConfig({
        ...normalized.render,
        pdfPageCount: pdfPageCountRef.current,
      });
    }

    if (forceIndexedDbPromotion) {
      try { await tempStoreRef.current?.promoteToIndexedDb?.(); } catch {}
      try { await pageAssetStoreRef.current?.promoteToIndexedDb?.(); } catch {}
    }

    setWorkerCount(Math.max(0, Number(pageRendererRef.current?.getWorkerCount?.() || 0)));
    collectRuntimeDiagnostics();
  }, [collectRuntimeDiagnostics]);

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
    cacheIdentityStatsRef.current = {
      documentVersion: Math.max(0, Number(options?.cacheIdentityStats?.documentVersion || 0)),
      documentUrlFallback: Math.max(0, Number(options?.cacheIdentityStats?.documentUrlFallback || 0)),
      url: Math.max(0, Number(options?.cacheIdentityStats?.url || 0)),
    };
    assetPipelineStatsRef.current = createAssetPipelineStats();
    loaderPhaseStatsRef.current = createLoaderPhaseStats();
    sessionBaseConfigRef.current = baseConfig;
    sessionConfigRef.current = cloneDocumentLoadingConfig(baseConfig);
    setDocumentLoadingConfig(sessionConfigRef.current);
    setMemoryPressureStage('normal');

    const tempStore = createSourceTempStore({
      ...sessionConfigRef.current.sourceStore,
      expectedSourceCount: Math.max(0, Number(options?.expectedSourceCount) || 0),
      sessionId: options?.cacheSessionId,
    });
    await tempStore.ready();
    tempStoreRef.current = tempStore;

    if (sessionConfigRef.current.assetStore.enabled !== false) {
      const pageAssetStore = createPageAssetStore({
        ...sessionConfigRef.current.assetStore,
        sessionId: options?.cacheSessionId,
      });
      await pageAssetStore.ready();
      pageAssetStoreRef.current = pageAssetStore;
    }

    pageRendererRef.current = createPageAssetRenderer({
      tempStore,
      config: {
        ...sessionConfigRef.current.render,
        pdfPageCount: pdfPageCountRef.current,
      },
    });

    sessionEpochRef.current += 1;
    const now = Date.now();
    sessionStartedAtMsRef.current = now;
    loadRunStartedAtMsRef.current = 0;
    loadRunCompletedAtMsRef.current = 0;
    previousLoadingRunActiveRef.current = false;
    setWorkerCount(Math.max(0, Number(pageRendererRef.current?.getWorkerCount?.() || 0)));
    collectRuntimeDiagnostics();
    logger.info('Initialized document session', {
      mode: tempStore.getStats?.().mode,
      assetMode: pageAssetStoreRef.current?.getStats?.().mode || 'disabled',
      requestedMode: sessionConfigRef.current.mode,
      expectedSourceCount: options?.expectedSourceCount || 0,
      cacheSessionId: options?.cacheSessionId || undefined,
      cacheIdentityStats: cacheIdentityStatsRef.current,
    });
  }, [collectRuntimeDiagnostics, resetViewerState]);

  /**
   * @param {DisposeDocumentSessionOptions=} options
   * @returns {Promise<void>}
   */
  const disposeDocumentSession = useCallback(async (options = {}) => {
    const clearPages = options?.clearPages !== false;
    sessionEpochRef.current += 1;
    pendingAssetPromisesRef.current.clear();
    sourceDescriptorsRef.current.clear();
    cacheIdentityStatsRef.current = { documentVersion: 0, documentUrlFallback: 0, url: 0 };
    indexedDbModeAnnouncedRef.current = false;
    assetIndexedDbModeAnnouncedRef.current = false;
    releasedRasterSourceKeysRef.current.clear();
    knownFullAssetPagesRef.current.clear();
    knownThumbnailAssetPagesRef.current.clear();
    pdfResolutionBoostedKeysRef.current.clear();
    pdfResolutionPendingKeysRef.current.clear();
    loaderPhaseStatsRef.current = createLoaderPhaseStats();
    setPdfResolutionBoostState({ boostedKeys: [], pendingKeys: [] });
    warmupQueueRef.current = [];
    warmupRunningRef.current = false;
    if (memoryMonitorTimerRef.current) {
      try { globalThis.clearInterval(memoryMonitorTimerRef.current); } catch {}
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
    pdfPageCountRef.current = 0;
    assetPipelineStatsRef.current = createAssetPipelineStats();
    loaderPhaseStatsRef.current = createLoaderPhaseStats();
    setDocumentLoadingConfig(defaultConfig);
    setMemoryPressureStage('normal');
    setWorkerCount(0);
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
      fullCacheLimit: 0,
      thumbnailCacheLimit: 0,
      trackedObjectUrlCount: 0,
      warmupQueueLength: 0,
      pendingAssetCount: 0,
      activeWorkerCount: 0,
      activePdfWorkerCount: 0,
      activePageAssetWorkerCount: 0,
      pdfWorkerRenderedCount: 0,
      pdfWorkerFallbackCount: 0,
      mainPdfRenderedCount: 0,
      assetRenderCompletedCount: 0,
      assetRenderTotalMs: 0,
      assetRenderMaxMs: 0,
      assetWorkerQueueCount: 0,
      assetWorkerQueueTotalMs: 0,
      assetWorkerQueueMaxMs: 0,
      assetWorkerRunCount: 0,
      assetWorkerRunTotalMs: 0,
      assetWorkerRunMaxMs: 0,
      assetRestoreAttemptCount: 0,
      assetRestoreHitCount: 0,
      assetRestoreMissCount: 0,
      assetRestoreTotalMs: 0,
      assetPersistPendingCount: 0,
      assetPersistCompletedCount: 0,
      assetPersistFailedCount: 0,
      assetPersistTotalMs: 0,
      assetPersistMaxMs: 0,
      assetPersistLastError: '',
      loaderPrefetchCount: 0,
      loaderPrefetchTotalMs: 0,
      loaderPrefetchMaxMs: 0,
      loaderFetchCount: 0,
      loaderFetchTotalMs: 0,
      loaderFetchMaxMs: 0,
      loaderTypeCount: 0,
      loaderTypeTotalMs: 0,
      loaderTypeMaxMs: 0,
      loaderStoreCount: 0,
      loaderStoreTotalMs: 0,
      loaderStoreMaxMs: 0,
      loaderAnalysisCount: 0,
      loaderAnalysisTotalMs: 0,
      loaderAnalysisMaxMs: 0,
      sourceStoreEncrypted: false,
      assetStoreEncrypted: false,
      sourceCacheHits: 0,
      sourceCacheMisses: 0,
      assetCacheHits: 0,
      assetCacheMisses: 0,
      sourceReloadCacheTtlMs: 0,
      assetReloadCacheTtlMs: 0,
      sourceCacheReadFailures: 0,
      assetCacheReadFailures: 0,
      sourceCacheLastMissReason: '',
      assetCacheLastMissReason: '',
      sourceCacheLastReadFailure: '',
      assetCacheLastReadFailure: '',
      sourceCacheSessionId: '',
      assetCacheSessionId: '',
      sourceCacheKeyStorage: '',
      assetCacheKeyStorage: '',
      sourceCacheKeyModeDocumentVersion: 0,
      sourceCacheKeyModeUrlFallback: 0,
      sourceCacheKeyModeUrl: 0,
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
      cacheKeyMode: String(descriptor?.cacheKeyMode || ''),
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
      const persisted = await assetStore.getAsset(
        makePersistedAssetKey(page, 'full', sessionConfigRef.current.render)
      );
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
      assetKey: makePersistedAssetKey(page, variant, sessionConfigRef.current.render),
      sourceKey: page.sourceKey,
      pageIndex: Math.max(0, Number(page.pageIndex) || 0),
      variant,
      blob: rendered.blob,
      mimeType: rendered.mimeType,
      width: rendered.width,
      height: rendered.height,
    });

    if (variant === 'thumbnail') noteThumbnailAssetReady(pageIndex);
    else noteFullAssetReady(pageIndex);

    announceIndexedDbAssetMode();
    if (variant === 'full') await maybeReleaseSinglePageRasterSource(pageIndex);
  }, [announceIndexedDbAssetMode, maybeReleaseSinglePageRasterSource, noteFullAssetReady, noteThumbnailAssetReady]);

  const persistRenderedAssetInBackground = useCallback((pageIndex, variant, rendered, sessionEpoch) => {
    const stats = assetPipelineStatsRef.current;
    stats.persistPendingCount += 1;
    const startedAt = nowMs();

    Promise.resolve()
      .then(() => {
        if (sessionEpochRef.current !== sessionEpoch) return null;
        return persistRenderedAsset(pageIndex, variant, rendered);
      })
      .then(() => {
        const durationMs = Math.max(0, nowMs() - startedAt);
        stats.persistCompletedCount += 1;
        stats.persistTotalMs += durationMs;
        stats.persistMaxMs = Math.max(Number(stats.persistMaxMs) || 0, durationMs);
      })
      .catch((error) => {
        const durationMs = Math.max(0, nowMs() - startedAt);
        stats.persistFailedCount += 1;
        stats.persistTotalMs += durationMs;
        stats.persistMaxMs = Math.max(Number(stats.persistMaxMs) || 0, durationMs);
        stats.persistLastError = String(error?.message || error).slice(0, 180);
        logger.warn('Background page-asset persist failed', {
          pageIndex,
          variant,
          error: stats.persistLastError,
        });
      })
      .finally(() => {
        stats.persistPendingCount = Math.max(0, Number(stats.persistPendingCount || 0) - 1);
        if (sessionEpochRef.current === sessionEpoch && stats.persistPendingCount <= 0) {
          collectRuntimeDiagnostics();
        }
      });
  }, [collectRuntimeDiagnostics, persistRenderedAsset]);



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

    const stats = assetPipelineStatsRef.current;
    const startedAt = nowMs();
    stats.restoreAttemptCount += 1;
    const stored = await store.getAsset(
      makePersistedAssetKey(page, variant, sessionConfigRef.current.render)
    );
    stats.restoreTotalMs += Math.max(0, nowMs() - startedAt);
    if (!stored?.blob || !stored?.meta) {
      stats.restoreMissCount += 1;
      return null;
    }
    stats.restoreHitCount += 1;

    const cache = getVariantCache(variant);
    const url = createTrackedObjectUrl(stored.blob);
    if (options.trackInCache !== false) {
      cache.set(pageIndex, { url, lastAccess: Date.now() });
      touchCacheEntry(cache, pageIndex);
    }

    const reuseThumbnail = variant === 'full' && shouldReuseFullAssetForThumbnail(pageIndex);
    if (variant === 'thumbnail') noteThumbnailAssetReady(pageIndex);
    else {
      noteFullAssetReady(pageIndex);
      if (reuseThumbnail) noteThumbnailAssetReady(pageIndex);
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
  }, [enforceCacheLimit, getVariantCache, noteFullAssetReady, noteThumbnailAssetReady, patchPageAtIndex, shouldReuseFullAssetForThumbnail]);
  /**
   * @param {number} pageIndex
   * @param {('full'|'thumbnail')} variant
   * @param {('critical'|'high'|'normal'|'low'|number|EnsurePageAssetOptions)=} optionsOrPriority
   * @returns {Promise<{ blob:Blob, width:number, height:number, mimeType:string }>}
   */
  const renderPageBlob = useCallback(async (pageIndex, variant, optionsOrPriority = 'normal') => {
    const renderOptions = optionsOrPriority && typeof optionsOrPriority === 'object'
      ? optionsOrPriority
      : { priority: optionsOrPriority };
    const page = getPageAt(allPagesRef.current, pageIndex);
    if (!page || page.status === -1) throw new Error(`Page ${pageIndex} is not available.`);
    if (!page.sourceKey) throw new Error(`Page ${pageIndex} does not have a source key yet.`);
    const source = sourceDescriptorsRef.current.get(page.sourceKey);
    if (!source) throw new Error(`Missing source descriptor for ${page.sourceKey}.`);
    if (!pageRendererRef.current) throw new Error('No active page renderer.');
    syncRendererPdfPageCount();

    const renderTask = () => pageRendererRef.current.renderPageAsset({
      sourceKey: source.sourceKey,
      fileExtension: source.fileExtension,
      fileIndex: source.fileIndex,
      pageIndex: page.pageIndex,
    }, {
      variant,
      thumbnailMaxWidth: sessionConfigRef.current.render.thumbnailMaxWidth,
      thumbnailMaxHeight: sessionConfigRef.current.render.thumbnailMaxHeight,
      fullPageScale: renderOptions.fullPageScale,
    });

    if (pageRendererRef.current?.canRenderInWorker?.(source.fileExtension, variant)) {
      return renderTask();
    }

    if (String(source.fileExtension || '').toLowerCase() === 'pdf'
      && pageRendererRef.current?.canRenderPdfInWorker?.()) {
      return pdfWorkerRenderWithLimit(renderTask, renderOptions.priority || 'normal');
    }

    return renderWithLimit(renderTask, renderOptions.priority || 'normal');
  }, [pdfWorkerRenderWithLimit, renderWithLimit, syncRendererPdfPageCount]);

  const commitRenderedPageAsset = useCallback((pageIndex, variant, rendered, options = {}) => {
    const safeIndex = Math.max(0, Number(pageIndex) || 0);
    const cache = getVariantCache(variant);
    const url = createTrackedObjectUrl(rendered.blob);
    if (options.trackInCache !== false) {
      cache.set(safeIndex, { url, lastAccess: Date.now() });
      touchCacheEntry(cache, safeIndex);
    }

    const reuseThumbnail = variant === 'full' && shouldReuseFullAssetForThumbnail(safeIndex);
    if (variant === 'thumbnail') noteThumbnailAssetReady(safeIndex);
    else {
      noteFullAssetReady(safeIndex);
      if (reuseThumbnail) noteThumbnailAssetReady(safeIndex);
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
  }, [enforceCacheLimit, getVariantCache, noteFullAssetReady, noteThumbnailAssetReady, patchPageAtIndex, shouldReuseFullAssetForThumbnail]);

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
        noteThumbnailAssetReady(safeIndex);
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
      if (fullUrl) noteThumbnailAssetReady(safeIndex);
      patchPageAtIndex(safeIndex, {
        thumbnailUsesFullAsset: true,
        thumbnailUrl: '',
        thumbnailStatus: fullUrl ? 1 : (getPageAt(allPagesRef.current, safeIndex)?.status === -1 ? -1 : 0),
      });
      return fullUrl;
    }

    workingPage = getPageAt(allPagesRef.current, safeIndex) || workingPage;
    const existingUrl = String(workingPage[urlField] || '').trim();
    const cacheEntry = cache.get(safeIndex);
    if (cacheEntry?.url) {
      const cachedUrl = String(cacheEntry.url || '').trim();
      if (isReusableAssetUrl(cachedUrl)) {
        // Page state may carry a freshly replaced object URL while the cache still points at
        // the previous asset, for example after a one-shot PDF resolution boost.
        if (existingUrl && existingUrl !== cachedUrl && isReusableAssetUrl(existingUrl)) {
          cache.set(safeIndex, { url: existingUrl, lastAccess: Date.now() });
          touchCacheEntry(cache, safeIndex);
          return existingUrl;
        }

        touchCacheEntry(cache, safeIndex);
        return cachedUrl;
      }
      clearPageAssetReference(safeIndex, variant, cachedUrl);
    }

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

    const pendingKey = makePendingAssetKey(variant, safeIndex, options);
    if (pendingAssetPromisesRef.current.has(pendingKey)) {
      return pendingAssetPromisesRef.current.get(pendingKey);
    }

    const sessionEpoch = sessionEpochRef.current;
    patchPageAtIndex(safeIndex, { [statusField]: 0 });

    const promise = (async () => {
      try {
        const skipPersistedRestore = options.forceRefresh === true
          && Number.isFinite(Number(options.fullPageScale))
          && Number(options.fullPageScale) > 0;
        const restoreBeforeRender = sessionConfigRef.current.assetStore.restoreBeforeRender !== false;
        if (!skipPersistedRestore && restoreBeforeRender) {
          const restoredUrl = await restorePersistedAsset(safeIndex, variant, options);
          if (sessionEpochRef.current !== sessionEpoch) return null;
          if (restoredUrl) return restoredUrl;
        }

        const renderStartedAt = nowMs();
        const rendered = await renderPageBlob(safeIndex, variant, {
          priority: options.priority || 'normal',
          fullPageScale: options.fullPageScale,
        });
        if (sessionEpochRef.current !== sessionEpoch) return null;
        const renderDurationMs = Math.max(0, nowMs() - renderStartedAt);
        const stats = assetPipelineStatsRef.current;
        stats.renderCompletedCount += 1;
        stats.renderTotalMs += renderDurationMs;
        stats.renderMaxMs = Math.max(Number(stats.renderMaxMs) || 0, renderDurationMs);
        const workerQueueMs = Number(rendered?.workerQueueMs);
        if (Number.isFinite(workerQueueMs) && workerQueueMs >= 0) {
          stats.workerQueueCount += 1;
          stats.workerQueueTotalMs += workerQueueMs;
          stats.workerQueueMaxMs = Math.max(Number(stats.workerQueueMaxMs) || 0, workerQueueMs);
        }
        const workerRunMs = Number(rendered?.workerRunMs);
        if (Number.isFinite(workerRunMs) && workerRunMs >= 0) {
          stats.workerRunCount += 1;
          stats.workerRunTotalMs += workerRunMs;
          stats.workerRunMaxMs = Math.max(Number(stats.workerRunMaxMs) || 0, workerRunMs);
        }

        const persistFullInBackground = variant === 'full'
          && sessionConfigRef.current.assetStore.persistFullPagesInBackground !== false;
        if (options.persist !== false && !persistFullInBackground) {
          await persistRenderedAsset(safeIndex, variant, rendered);
          if (sessionEpochRef.current !== sessionEpoch) return null;
        }

        const url = commitRenderedPageAsset(safeIndex, variant, rendered, options);

        if (options.persist !== false && persistFullInBackground) {
          persistRenderedAssetInBackground(safeIndex, variant, rendered, sessionEpoch);
        }

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
  }, [clearPageAssetReference, commitRenderedPageAsset, getVariantCache, noteThumbnailAssetReady, patchPageAtIndex, persistRenderedAsset, persistRenderedAssetInBackground, renderPageBlob, restorePersistedAsset, shouldReuseFullAssetForThumbnail, touchPageAsset]);

  /**
   * Render one PDF page again at twice the configured full-page PDF scale.
   * The boost is intentionally session-local and one-shot per PDF page; it replaces the visible
   * object URL without changing the persisted normal-resolution cache entry.
   *
   * @param {number} pageIndex
   * @returns {Promise<boolean>}
   */
  const enhancePdfPageResolution = useCallback(async (pageIndex) => {
    const safeIndex = Math.max(0, Number(pageIndex) || 0);
    const page = getPageAt(allPagesRef.current, safeIndex);
    if (!page || page.status === -1 || !isPdfPageEntry(page)) return false;

    const pageKey = makePdfResolutionPageKey(page);
    if (!pageKey) return false;
    if (pdfResolutionBoostedKeysRef.current.has(pageKey) || pdfResolutionPendingKeysRef.current.has(pageKey)) {
      return false;
    }

    pdfResolutionPendingKeysRef.current.add(pageKey);
    publishPdfResolutionBoostState();

    const baseScale = Math.max(0.5, Number(sessionConfigRef.current?.render?.fullPageScale) || 2.0);
    const previousUrl = String(page.fullSizeUrl || '').trim();
    try {
      const url = await ensurePageAsset(safeIndex, 'full', {
        forceRefresh: true,
        priority: 'critical',
        fullPageScale: baseScale * 2,
        persist: false,
      });
      if (url) {
        const nextUrl = String(url || '').trim();
        const pageAfterRender = getPageAt(allPagesRef.current, safeIndex);
        const committedUrl = String(pageAfterRender?.fullSizeUrl || '').trim();
        const replacedVisibleAsset = !previousUrl || nextUrl !== previousUrl || committedUrl !== previousUrl;
        if (!replacedVisibleAsset) {
          logger.warn('PDF page resolution boost rendered without replacing the visible asset URL', {
            pageIndex: safeIndex,
            sourcePageIndex: Math.max(0, Number(page.pageIndex) || 0),
            scale: baseScale * 2,
          });
          return false;
        }

        pdfResolutionBoostedKeysRef.current.add(pageKey);
        logger.info('Enhanced PDF page resolution for current session', {
          pageIndex: safeIndex,
          sourcePageIndex: Math.max(0, Number(page.pageIndex) || 0),
          scale: baseScale * 2,
        });
        return true;
      }
      return false;
    } catch (error) {
      logger.warn('Failed to enhance PDF page resolution', {
        pageIndex: safeIndex,
        error: String(error?.message || error),
      });
      return false;
    } finally {
      pdfResolutionPendingKeysRef.current.delete(pageKey);
      publishPdfResolutionBoostState();
    }
  }, [ensurePageAsset, publishPdfResolutionBoostState]);

  /**
   * @param {string} phase
   * @param {number} durationMs
   * @returns {void}
   */
  const recordLoaderPhaseTiming = useCallback((phase, durationMs) => {
    const phaseKey = String(phase || '').toLowerCase();
    const stats = loaderPhaseStatsRef.current?.[phaseKey];
    if (!stats) return;
    const safeDurationMs = Math.max(0, Number(durationMs) || 0);
    stats.count += 1;
    stats.totalMs += safeDurationMs;
    stats.maxMs = Math.max(Number(stats.maxMs) || 0, safeDurationMs);
  }, []);

  /**
   * Try to render a full-page PDF warm-up batch through the partitioned worker path.
   *
   * This is deliberately opt-in because it trades the simple per-page queue for a larger
   * worker batch. Each selected page is registered in the normal pending-asset map so foreground
   * navigation and nearby warm-up cannot render the same page at the same time. If the batch path
   * fails, returns no item result, or cannot commit a rendered blob, the affected page falls back
   * to the regular `ensurePageAsset` path.
   *
   * @param {Array<*>} tasks
   * @returns {Promise<boolean>}
   */
  const tryRenderPdfWarmupBatch = useCallback(async (tasks) => {
    const renderConfig = sessionConfigRef.current?.render || {};
    if (String(renderConfig.pdfWorkerWarmupBatchMode || 'off').toLowerCase() !== 'partitioned') return false;
    if (!pageRendererRef.current?.canRenderPdfBatchInWorker?.()) return false;
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    if (safeTasks.length < 2) return false;

    const descriptors = [];
    const taskByItem = [];
    const seenBatchPageIndexes = new Set();
    for (const task of safeTasks) {
      const safeIndex = Math.max(0, Number(task?.pageIndex) || 0);
      if (String(task?.variant || 'full') !== 'full') continue;
      if (seenBatchPageIndexes.has(safeIndex)) continue;
      if (pendingAssetPromisesRef.current.has(makePendingAssetKey('full', safeIndex))) continue;
      const page = getPageAt(allPagesRef.current, safeIndex);
      if (!page || page.status === -1 || page.fullSizeStatus === 1 || page.fullSizeUrl || !page.sourceKey) continue;
      const source = sourceDescriptorsRef.current.get(page.sourceKey);
      if (String(source?.fileExtension || page.fileExtension || '').toLowerCase() !== 'pdf') continue;
      seenBatchPageIndexes.add(safeIndex);
      descriptors.push({
        sourceKey: source.sourceKey,
        fileExtension: source.fileExtension,
        fileIndex: source.fileIndex,
        pageIndex: page.pageIndex,
      });
      taskByItem.push({ ...task, pageIndex: safeIndex });
    }

    if (descriptors.length < 2) return false;

    const sessionEpoch = sessionEpochRef.current;
    const completedItems = new Set();
    const failedTasks = [];
    const batchPendingByItem = new Map();
    const stats = assetPipelineStatsRef.current;
    const persistFullInBackground = sessionConfigRef.current.assetStore.persistFullPagesInBackground !== false;
    const rendersPerWorker = Math.max(1, Number(renderConfig.pdfWorkerWarmupRendersPerWorker) || 1);
    const markBatchPending = (itemId, pageIndex) => {
      const key = makePendingAssetKey('full', pageIndex);
      let resolvePending;
      const promise = new Promise((resolve) => {
        resolvePending = resolve;
      });
      batchPendingByItem.set(itemId, {
        key,
        promise,
        resolve: resolvePending,
        resolved: false,
      });
      pendingAssetPromisesRef.current.set(key, promise);
    };
    const resolveBatchPending = (itemId, value = null) => {
      const entry = batchPendingByItem.get(itemId);
      if (!entry || entry.resolved) return;
      entry.resolved = true;
      entry.resolve(value || null);
      if (pendingAssetPromisesRef.current.get(entry.key) === entry.promise) {
        pendingAssetPromisesRef.current.delete(entry.key);
      }
    };

    for (let index = 0; index < taskByItem.length; index += 1) {
      markBatchPending(index, taskByItem[index].pageIndex);
    }

    const recordBatchItem = (result) => {
      const itemId = Math.max(0, Number(result?.itemId) || 0);
      const task = taskByItem[itemId];
      if (!task || completedItems.has(itemId)) return;
      completedItems.add(itemId);

      try {
        if (sessionEpochRef.current !== sessionEpoch) {
          resolveBatchPending(itemId, null);
          return;
        }
        if (!result?.ok || !(result.blob instanceof Blob)) {
          resolveBatchPending(itemId, null);
          failedTasks.push(task);
          return;
        }

        const page = getPageAt(allPagesRef.current, task.pageIndex);
        const existingUrl = String(page?.fullSizeUrl || '').trim();
        if (!page || page.status === -1) {
          resolveBatchPending(itemId, null);
          return;
        }
        if (page.fullSizeStatus === 1 && existingUrl && isReusableAssetUrl(existingUrl)) {
          resolveBatchPending(itemId, existingUrl);
          return;
        }

        const renderDurationMs = Math.max(0, Number(result.durationMs) || 0);
        stats.renderCompletedCount += 1;
        stats.renderTotalMs += renderDurationMs;
        stats.renderMaxMs = Math.max(Number(stats.renderMaxMs) || 0, renderDurationMs);

        const rendered = {
          blob: result.blob,
          width: Math.max(1, Number(result.width) || 1),
          height: Math.max(1, Number(result.height) || 1),
          mimeType: String(result.mimeType || result.blob.type || 'image/png'),
        };
        const url = commitRenderedPageAsset(task.pageIndex, 'full', rendered, { priority: task.priority || 'low' });
        resolveBatchPending(itemId, url);
        if (persistFullInBackground) {
          persistRenderedAssetInBackground(task.pageIndex, 'full', rendered, sessionEpoch);
        }
      } catch (error) {
        resolveBatchPending(itemId, null);
        failedTasks.push(task);
        logger.warn('PDF warm-up batch item could not be committed; falling back to per-page rendering', {
          pageIndex: task.pageIndex,
          error: String(error?.message || error),
        });
      }
    };

    try {
      await pageRendererRef.current.renderPdfPageAssetBatch(descriptors, {
        variant: 'full',
        fullPageScale: renderConfig.fullPageScale,
        thumbnailMaxWidth: renderConfig.thumbnailMaxWidth,
        thumbnailMaxHeight: renderConfig.thumbnailMaxHeight,
        rendersPerWorker,
        onItemResult: recordBatchItem,
      });
    } catch (error) {
      logger.warn('PDF warm-up batch failed; falling back to per-page rendering', {
        count: descriptors.length,
        error: String(error?.message || error),
      });
    }

    for (let index = 0; index < taskByItem.length; index += 1) {
      if (!completedItems.has(index)) {
        resolveBatchPending(index, null);
        failedTasks.push(taskByItem[index]);
      }
    }

    if (sessionEpochRef.current === sessionEpoch && failedTasks.length > 0) {
      await Promise.allSettled(failedTasks.map((task) => ensurePageAsset(task.pageIndex, 'full', {
        priority: task.priority || 'low',
      })));
    }

    return true;
  }, [commitRenderedPageAsset, ensurePageAsset, persistRenderedAssetInBackground]);

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
          const readinessTasks = warmupQueueRef.current.filter((task) => String(task?.reason || '') === 'readiness');
          if (readinessTasks.length <= 0) {
            warmupQueueRef.current = [];
            break;
          }
          warmupQueueRef.current = readinessTasks;
        }

        const renderConfig = sessionConfigRef.current?.render || {};
        if (String(renderConfig.pdfWorkerWarmupBatchMode || 'off').toLowerCase() === 'partitioned'
          && pageRendererRef.current?.canRenderPdfBatchInWorker?.()) {
          const pdfBatchLimit = Math.max(
            2,
            Number(renderConfig.pdfWorkerWarmupBatchSize)
              || Number(renderConfig.warmupBatchSize)
              || 2
          );
          const selected = [];
          const remaining = [];
          for (const task of warmupQueueRef.current) {
            const safeIndex = Math.max(0, Number(task?.pageIndex) || 0);
            const page = getPageAt(allPagesRef.current, safeIndex);
            const source = page?.sourceKey ? sourceDescriptorsRef.current.get(page.sourceKey) : null;
            const isBatchCandidate = selected.length < pdfBatchLimit
              && String(task?.variant || 'full') === 'full'
              && page
              && page.status !== -1
              && page.fullSizeStatus !== 1
              && !page.fullSizeUrl
              && String(source?.fileExtension || page.fileExtension || '').toLowerCase() === 'pdf';
            if (isBatchCandidate) selected.push(task);
            else remaining.push(task);
          }

          if (selected.length >= 2) {
            warmupQueueRef.current = remaining;
            const handled = await tryRenderPdfWarmupBatch(selected);
            if (handled) {
              await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
              continue;
            }
            warmupQueueRef.current = selected.concat(warmupQueueRef.current);
          }
        }

        const batchSize = Math.max(1, Number(sessionConfigRef.current?.render?.warmupBatchSize) || 1);
        const batch = warmupQueueRef.current.splice(0, batchSize);
        await Promise.allSettled(batch.map(async (task) => {
          try {
            const page = getPageAt(allPagesRef.current, task?.pageIndex);
            if (!page || page.status === -1) return;
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
        }));

        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
      }
    } finally {
      warmupRunningRef.current = false;
      if (warmupQueueRef.current.length > 0) {
        globalThis.setTimeout(() => {
          void pumpWarmupQueue();
        }, 0);
      }
    }
  }, [ensurePageAsset, tryRenderPdfWarmupBatch]);

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
    const totalPages = Array.isArray(allPagesRef.current) ? allPagesRef.current.length : 0;
    const performanceWindowPageCount = getPerformanceWindowPageCount(sessionConfigRef.current);
    const keepFastWarmupWindow = String(sessionConfigRef.current?.mode || 'auto').toLowerCase() !== 'memory'
      && String(memoryPressureStage || 'normal').toLowerCase() === 'normal'
      && totalPages > 0
      && totalPages <= performanceWindowPageCount;
    if (safePageCount <= 0 || (strategy === 'lazy-viewport' && !keepFastWarmupWindow)) return;

    const warmPageCount = (strategy === 'eager-all' || keepFastWarmupWindow)
      ? safePageCount
      : Math.min(safePageCount, Math.max(1, Number(renderConfig.warmupBatchSize) || 1));

    const queue = warmupQueueRef.current.slice();
    const queued = new Set(queue.map((item) => `${String(item?.variant || 'full')}:${Math.max(0, Number(item?.pageIndex) || 0)}`));
    const addTask = (pageIndex, variant, priority, reason = 'warmup') => {
      const key = `${variant}:${pageIndex}`;
      if (queued.has(key)) return;
      queued.add(key);
      queue.push({ pageIndex, variant, priority, reason });
    };

    for (let offset = 0; offset < warmPageCount; offset += 1) {
      const pageIndex = safeStartIndex + offset;
      addTask(pageIndex, 'full', offset === 0 ? 'high' : 'low');
      if (shouldReuseFullAssetForThumbnail(pageIndex)) continue;
      if (renderConfig.thumbnailLoadingStrategy !== 'viewport' || strategy === 'eager-all') {
        addTask(pageIndex, 'thumbnail', offset === 0 ? 'normal' : 'low');
      }
    }

    warmupQueueRef.current = queue;
    void pumpWarmupQueue();
  }, [memoryPressureStage, pumpWarmupQueue, shouldReuseFullAssetForThumbnail]);

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
        const stored = await pageAssetStoreRef.current?.getAsset?.(
          makePersistedAssetKey(page, 'full', sessionConfigRef.current.render)
        );
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
    syncRendererPdfPageCount();
  }, [allPages, syncRendererPdfPageCount]);

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
      const performanceWindowPageCount = getPerformanceWindowPageCount(baseConfig);
      const currentStage = String(memoryPressureStage || 'normal').toLowerCase();
      const protectFastPath = pageCount > 0
        && pageCount <= performanceWindowPageCount
        && currentStage === 'normal';

      if (protectFastPath) {
        const catastrophicResidentMiB = Math.max(
          Number(memoryConfig.hardResidentMiB || 0) * 2,
          2048
        );
        const catastrophicHeapRatio = Math.max(
          Number(memoryConfig.hardHeapUsageRatio || 0),
          0.97
        );

        if (
          (catastrophicResidentMiB > 0 && residentMiB >= catastrophicResidentMiB)
          || (catastrophicHeapRatio > 0 && heapRatio >= catastrophicHeapRatio)
        ) {
          nextStage = 'hard';
        }
      } else if (
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
    const timerId = globalThis.setInterval(() => {
      void evaluate();
    }, Math.max(250, Number(documentLoadingConfig.memoryPressure.sampleIntervalMs) || 2000));
    memoryMonitorTimerRef.current = timerId;

    return () => {
      disposed = true;
      if (memoryMonitorTimerRef.current === timerId) memoryMonitorTimerRef.current = null;
      try { globalThis.clearInterval(timerId); } catch {}
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
    if (!diagnosticsEnabled) return undefined;
    const wasActive = previousLoadingRunActiveRef.current;
    if (loadingRunActive && !wasActive) {
      loadRunStartedAtMsRef.current = Date.now();
      loadRunCompletedAtMsRef.current = 0;
    }
    previousLoadingRunActiveRef.current = loadingRunActive;
    collectRuntimeDiagnostics();
  }, [collectRuntimeDiagnostics, diagnosticsEnabled, loadingRunActive]);

  useEffect(() => {
    if (!diagnosticsEnabled) return undefined;
    collectRuntimeDiagnostics();
    const timerId = globalThis.setInterval(collectRuntimeDiagnostics, 500);
    diagnosticsTimerRef.current = timerId;
    return () => {
      if (diagnosticsTimerRef.current === timerId) diagnosticsTimerRef.current = null;
      try { globalThis.clearInterval(timerId); } catch {}
    };
  }, [collectRuntimeDiagnostics, diagnosticsEnabled]);

  const pageLoadState = useMemo(() => {
    const pages = Array.isArray(allPages) ? allPages : [];
    const discoveredPages = pages.length;
    let readyPages = 0;
    let failedPages = 0;

    for (const page of pages) {
      if (isPageFailedForSession(page)) {
        failedPages += 1;
        continue;
      }
      if (isPageReadyForSession(page)) readyPages += 1;
    }

    const pendingPages = Math.max(0, discoveredPages - readyPages - failedPages);
    const expectedPages = Math.max(discoveredPages, Number(plannedPageCount) || 0);
    const allPagesReady = expectedPages > 0
      && !loadingRunActive
      && discoveredPages >= expectedPages
      && pendingPages === 0;

    return {
      discoveredPages,
      expectedPages,
      readyPages,
      failedPages,
      pendingPages,
      allPagesReady,
    };
  }, [allPages, loadingRunActive, plannedPageCount]);

  useEffect(() => {
    if (!diagnosticsEnabled) return undefined;
    if (!pageLoadState.allPagesReady) return undefined;
    if (loadRunStartedAtMsRef.current <= 0 || loadRunCompletedAtMsRef.current > 0) return undefined;

    loadRunCompletedAtMsRef.current = Date.now();
    collectRuntimeDiagnostics();
    return undefined;
  }, [collectRuntimeDiagnostics, diagnosticsEnabled, pageLoadState.allPagesReady]);

  useEffect(() => {
    if (loadingRunActive) return undefined;
    if (pageLoadState.allPagesReady) return undefined;
    if (pageLoadState.discoveredPages <= 0) return undefined;

    const queue = warmupQueueRef.current.slice();
    const queued = new Set(queue.map((task) => `${String(task?.variant || 'full')}:${Math.max(0, Number(task?.pageIndex) || 0)}`));
    let added = 0;

    for (let pageIndex = 0; pageIndex < pageLoadState.discoveredPages; pageIndex += 1) {
      const page = allPages[pageIndex];
      if (!page || isPageReadyForSession(page)) continue;
      const key = `full:${pageIndex}`;
      if (queued.has(key)) continue;
      queued.add(key);
      queue.push({ pageIndex, variant: 'full', priority: 'low', reason: 'readiness' });
      added += 1;
    }

    if (added > 0) {
      warmupQueueRef.current = queue;
      void pumpWarmupQueue();
    }

    return undefined;
  }, [allPages, loadingRunActive, pageLoadState, pumpWarmupQueue]);

  useEffect(() => () => {
    resetViewerState().catch((e) => {
      logger.warn('ViewerProvider unmount cleanup failed', { error: String(e?.message || e) });
    });
  }, [resetViewerState]);

  const contextValue = useMemo(() => ({
    bundle,
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
    recordLoaderPhaseTiming,
    ensurePageAsset,
    enhancePdfPageResolution,
    pdfResolutionBoostState,
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
    pageLoadState,
    scheduleSourceWarmup,
  }), [
    bundle,
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
    recordLoaderPhaseTiming,
    ensurePageAsset,
    enhancePdfPageResolution,
    pdfResolutionBoostState,
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
    pageLoadState,
    scheduleSourceWarmup,
  ]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
