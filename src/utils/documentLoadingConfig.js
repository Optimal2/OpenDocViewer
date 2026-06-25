// File: src/utils/documentLoadingConfig.js
/**
 * OpenDocViewer — runtime helpers for fetch/render/memory policies.
 *
 * This module centralizes the configuration that drives the hybrid loading engine:
 * - explicit customer-facing modes (`performance`, `memory`, `auto`)
 * - fetch strategy selection (true sequential vs limited parallel)
 * - worker usage and eager/lazy render behavior
 * - memory-pressure thresholds for one-way degradation from `auto`
 */

import { getRuntimeConfig } from './runtimeConfig.js';
import { getRuntimeMemoryProfile } from './memoryProfile.js';

/** @typedef {'memory'|'indexeddb'|'adaptive'} SourceStoreMode */
/** @typedef {'none'|'aes-gcm-session'} SourceStoreProtection */
/** @typedef {'adaptive'|'eager'|'viewport'} ThumbnailLoadingStrategy */
/** @typedef {'auto'|'dedicated'|'prefer-full-images'} ThumbnailSourceStrategy */
/** @typedef {'unknown'|'low'|'medium'|'high'|'very-high'} RuntimeMemoryTier */
/** @typedef {'performance'|'memory'|'auto'} DocumentLoadingMode */
/** @typedef {'sequential'|'parallel-limited'} DocumentLoadingFetchStrategy */
/** @typedef {'eager-all'|'eager-nearby'|'lazy-viewport'} DocumentLoadingRenderStrategy */
/** @typedef {'worker-preferred'|'main-only'|'hybrid-by-format'} DocumentLoadingRenderBackend */
/** @typedef {'auto'|'main-thread'|'worker'} PdfToImageMode */
/** @typedef {'normal'|'soft'|'hard'} DocumentLoadingMemoryPressureStage */

export const MAX_RELOAD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} DocumentLoadingAdaptiveMemoryConfig
 * @property {boolean} enabled
 * @property {number} preferPerformanceWhenDeviceMemoryAtLeastGb
 * @property {number} preferPerformanceWhenJsHeapLimitAtLeastMiB
 * @property {number} reuseFullImageThumbnailsBelowPageCount
 * @property {number} performanceWindowPageCount
 * @property {RuntimeMemoryTier} resolvedTier
 * @property {boolean} preferPerformance
 */

/**
 * @typedef {Object} DocumentLoadingWarningConfig
 * @property {number} sourceCountThreshold
 * @property {number} pageCountThreshold
 * @property {number} probePageThresholdSources
 * @property {number} minStopRecommendationSources
 * @property {number} minStopRecommendationPages
 */

/**
 * @typedef {Object} DocumentLoadingFetchConfig
 * @property {DocumentLoadingFetchStrategy} strategy
 * @property {number} prefetchConcurrency
 * @property {number} prefetchRetryCount
 * @property {number} prefetchRetryBaseDelayMs
 * @property {number} prefetchRequestTimeoutMs
 * @property {number} maxSourceSizeMiB
 * @property {number} abortOnSourceUnavailableCount
 */

/**
 * @typedef {Object} DocumentLoadingSourceStoreConfig
 * @property {SourceStoreMode} mode
 * @property {number} switchToIndexedDbAboveSourceCount
 * @property {number} switchToIndexedDbAboveTotalMiB
 * @property {SourceStoreProtection} protection
 * @property {number} staleSessionTtlMs
 * @property {number} reloadCacheTtlMs
 * @property {number} blobCacheEntries
 */

/**
 * @typedef {Object} DocumentLoadingAssetStoreConfig
 * @property {boolean} enabled
 * @property {SourceStoreMode} mode
 * @property {number} switchToIndexedDbAboveAssetCount
 * @property {number} switchToIndexedDbAboveTotalMiB
 * @property {SourceStoreProtection} protection
 * @property {number} staleSessionTtlMs
 * @property {number} reloadCacheTtlMs
 * @property {number} blobCacheEntries
 * @property {boolean} persistThumbnails
 * @property {boolean} persistFullPagesInBackground
 * @property {boolean} restoreBeforeRender
 * @property {boolean} releaseSinglePageRasterSourceAfterFullPersist
 */

/**
 * @typedef {Object} DocumentLoadingRenderConfig
 * @property {DocumentLoadingRenderStrategy} strategy
 * @property {DocumentLoadingRenderBackend} backend
 * @property {number} workerCount
 * @property {boolean} useWorkersForRasterImages
 * @property {boolean} useWorkersForTiff
 * @property {PdfToImageMode} pdfToImageMode
 * @property {number=} pdfWorkerCount
 * @property {number} pdfWorkerMaxCount
 * @property {DocumentLoadingPdfWorkerPagePolicy} pdfWorkerPagePolicy
 * @property {'off'|'partitioned'} pdfWorkerWarmupBatchMode
 * @property {number} pdfWorkerWarmupBatchSize
 * @property {number} pdfWorkerWarmupRendersPerWorker
 * @property {number} maxConcurrentMainThreadRenders
 * @property {number} maxConcurrentAssetRenders
 * @property {number} warmupBatchSize
 * @property {number} loadingOverlayDelayMs
 * @property {number} fullPageScale
 * @property {number} thumbnailMaxWidth
 * @property {number} thumbnailMaxHeight
 * @property {ThumbnailLoadingStrategy} thumbnailLoadingStrategy
 * @property {ThumbnailSourceStrategy} thumbnailSourceStrategy
 * @property {number} thumbnailEagerPageThreshold
 * @property {number} lookAheadPageCount
 * @property {number} lookBehindPageCount
 * @property {number} visibleThumbnailOverscan
 * @property {number} fullPageCacheLimit
 * @property {number} thumbnailCacheLimit
 * @property {number} maxOpenPdfDocuments
 * @property {number} maxOpenTiffDocuments
 */

/**
 * @typedef {Object} DocumentLoadingPdfWorkerPagePolicy
 * @property {boolean} enabled
 * @property {number} mainThreadBelowPageCount
 * @property {number} mainThreadBelowHardwareConcurrency
 * @property {number} smallWorkerBelowPageCount
 * @property {number} smallWorkerCount
 * @property {number} fixedWorkerBelowPageCount
 * @property {number} fixedWorkerCount
 * @property {number} pagesPerWorker
 * @property {number} maxWorkerCount
 */

/**
 * @typedef {Object} DocumentLoadingMemoryPressureConfig
 * @property {boolean} enabled
 * @property {number} sampleIntervalMs
 * @property {number} softHeapUsageRatio
 * @property {number} hardHeapUsageRatio
 * @property {number} softResidentMiB
 * @property {number} hardResidentMiB
 * @property {number} forceMemoryModeAbovePageCount
 * @property {number} forceMemoryModeAboveSourceCount
 */

/**
 * @typedef {Object} StopRecommendationInput
 * @property {number=} sourceCount
 * @property {number=} pageCount
 * @property {DocumentLoadingConfig=} config
 */

/**
 * @typedef {Object} DocumentLoadingConfig
 * @property {DocumentLoadingMode} mode
 * @property {DocumentLoadingAdaptiveMemoryConfig} adaptiveMemory
 * @property {DocumentLoadingWarningConfig} warning
 * @property {DocumentLoadingFetchConfig} fetch
 * @property {DocumentLoadingSourceStoreConfig} sourceStore
 * @property {DocumentLoadingAssetStoreConfig} assetStore
 * @property {DocumentLoadingRenderConfig} render
 * @property {DocumentLoadingMemoryPressureConfig} memoryPressure
 */

/**
 * @returns {'firefox'|'edge'|'chrome'|'safari'|'unknown'}
 */
function detectBrowserFamily() {
  try {
    const ua = String(globalThis.navigator?.userAgent || '').toLowerCase();
    if (ua.includes('firefox/')) return 'firefox';
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('chrome/') || ua.includes('chromium/')) return 'chrome';
    if (ua.includes('safari/')) return 'safari';
  } catch {}
  return 'unknown';
}

/**
 * Return the browser-reported logical core count.
 *
 * A return value of 0 means "unknown/unavailable", not "no CPU cores". Worker recommendation
 * helpers intentionally treat 0 as a signal to use their conservative runtime fallback.
 *
 * @returns {number}
 */
function getReportedCoreCount() {
  try {
    return Math.max(0, Math.floor(Number(globalThis.navigator?.hardwareConcurrency) || 0));
  } catch {
    return 0;
  }
}

function clampRecommendedWorkerCount(suggested, browserCap, memoryMode = false) {
  const modeCap = memoryMode ? Math.min(2, browserCap) : browserCap;
  return Math.max(1, Math.min(modeCap, suggested));
}

/**
 * @param {number} preferred
 * @param {DocumentLoadingMode=} mode
 * @returns {number}
 */
export function resolveRecommendedWorkerCount(preferred = 0, mode = 'auto') {
  const explicit = Math.max(0, Number(preferred) || 0);
  if (explicit > 0) return explicit;

  const cores = getReportedCoreCount();
  // Treat missing or very low hardwareConcurrency as at least four workers. Real host-driven
  // large-document sessions showed this remains stable on weak clients, while a one-worker
  // fallback makes large documents feel broken rather than merely slower.
  const suggested = Math.max(4, cores);
  const browserFamily = detectBrowserFamily();
  const browserCap = browserFamily === 'firefox' ? 8 : 32;

  return clampRecommendedWorkerCount(suggested, browserCap, mode === 'memory');
}

/**
 * @param {number} preferred
 * @param {DocumentLoadingMode=} mode
 * @returns {number}
 */
function resolveRecommendedRasterWorkerCount(preferred = 0, mode = 'auto') {
  const explicit = Math.max(0, Number(preferred) || 0);
  if (explicit > 0) return explicit;

  const cores = getReportedCoreCount();
  const browserFamily = detectBrowserFamily();
  const browserCap = browserFamily === 'firefox' ? 8 : 32;
  // See resolveRecommendedWorkerCount: min 4 is deliberate for large-document throughput. Chromium/Edge
  // raster decoding can profit from slight oversubscription on low-core clients because source
  // transfer, image decode, and canvas serialization do not all keep the same core busy at once.
  let suggested = Math.max(4, cores);
  if (browserFamily !== 'firefox') {
    if (cores > 0 && cores <= 4) suggested = Math.max(suggested, cores + 2);
    if (cores >= 6) suggested = Math.max(8, suggested);
  }

  return clampRecommendedWorkerCount(suggested, browserCap, mode === 'memory');
}

export const DOCUMENT_LOADING_DEFAULTS = Object.freeze(
  /** @type {DocumentLoadingConfig} */ ({
    mode: 'auto',
    adaptiveMemory: {
      enabled: true,
      preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
      preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
      reuseFullImageThumbnailsBelowPageCount: 2000,
      performanceWindowPageCount: 2000,
      resolvedTier: 'unknown',
      preferPerformance: false,
    },
    warning: {
      sourceCountThreshold: 0,
      pageCountThreshold: 10000,
      probePageThresholdSources: 2,
      minStopRecommendationSources: 0,
      minStopRecommendationPages: 10000,
    },
    fetch: {
      strategy: 'sequential',
      prefetchConcurrency: 4,
      prefetchRetryCount: 0,
      prefetchRetryBaseDelayMs: 750,
      prefetchRequestTimeoutMs: 10000,
      maxSourceSizeMiB: 512,
      abortOnSourceUnavailableCount: 8,
    },
    sourceStore: {
      mode: 'adaptive',
      switchToIndexedDbAboveSourceCount: 0,
      switchToIndexedDbAboveTotalMiB: 1536,
      protection: 'aes-gcm-session',
      staleSessionTtlMs: 24 * 60 * 60 * 1000,
      reloadCacheTtlMs: 0,
      blobCacheEntries: 16,
    },
    assetStore: {
      enabled: true,
      mode: 'adaptive',
      switchToIndexedDbAboveAssetCount: 0,
      switchToIndexedDbAboveTotalMiB: 4096,
      protection: 'aes-gcm-session',
      staleSessionTtlMs: 24 * 60 * 60 * 1000,
      reloadCacheTtlMs: 0,
      blobCacheEntries: 24,
      persistThumbnails: false,
      persistFullPagesInBackground: true,
      restoreBeforeRender: true,
      releaseSinglePageRasterSourceAfterFullPersist: false,
    },
    render: {
      strategy: 'eager-nearby',
      backend: 'hybrid-by-format',
      workerCount: resolveRecommendedRasterWorkerCount(0, 'auto'),
      useWorkersForRasterImages: true,
      useWorkersForTiff: true,
      pdfToImageMode: 'auto',
      pdfWorkerCount: 0,
      // 0 means the automatic PDF policy is capped only by the runtime-recommended worker count.
      pdfWorkerMaxCount: 0,
      pdfWorkerPagePolicy: {
        enabled: true,
        mainThreadBelowPageCount: 0,
        mainThreadBelowHardwareConcurrency: 0,
        smallWorkerBelowPageCount: 0,
        smallWorkerCount: 1,
        fixedWorkerBelowPageCount: 0,
        fixedWorkerCount: 1,
        pagesPerWorker: 1,
        maxWorkerCount: 0,
      },
      pdfWorkerWarmupBatchMode: 'off',
      pdfWorkerWarmupBatchSize: 0,
      pdfWorkerWarmupRendersPerWorker: 1,
      // These are the actual normalized render defaults for the current loading path.
      // Viewer providers can override them through runtime config, but there is no
      // separate provider-only concurrency default layered on top of this module.
      maxConcurrentMainThreadRenders: 3,
      maxConcurrentAssetRenders: 3,
      warmupBatchSize: 48,
      loadingOverlayDelayMs: 90,
      fullPageScale: 2.0,
      thumbnailMaxWidth: 220,
      thumbnailMaxHeight: 310,
      thumbnailLoadingStrategy: 'adaptive',
      thumbnailSourceStrategy: 'prefer-full-images',
      thumbnailEagerPageThreshold: 10000,
      lookAheadPageCount: 12,
      lookBehindPageCount: 8,
      visibleThumbnailOverscan: 24,
      fullPageCacheLimit: 500,
      thumbnailCacheLimit: 8192,
      maxOpenPdfDocuments: 16,
      maxOpenTiffDocuments: 16,
    },
    memoryPressure: {
      enabled: true,
      sampleIntervalMs: 2000,
      softHeapUsageRatio: 0.82,
      hardHeapUsageRatio: 0.92,
      softResidentMiB: 1200,
      hardResidentMiB: 1800,
      forceMemoryModeAbovePageCount: 10000,
      forceMemoryModeAboveSourceCount: 0,
    },
  })
);

function normalizeNumber(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  const bounded = Math.max(min, typeof max === 'number' ? Math.min(max, next) : next);
  return Math.floor(bounded);
}

function normalizeFloat(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, typeof max === 'number' ? Math.min(max, next) : next);
}

function normalizeThreshold(value, fallback, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return Math.max(0, Number(fallback) || 0);
  if (next <= 0) return 0;
  const bounded = typeof max === 'number' ? Math.min(max, next) : next;
  return Math.floor(Math.max(0, bounded));
}

function normalizeMiBThreshold(value, fallback, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return Math.max(0, Number(fallback) || 0);
  if (next <= 0) return 0;
  return Math.max(0, typeof max === 'number' ? Math.min(max, next) : next);
}

function normalizeStoreMode(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'memory' || raw === 'indexeddb') return raw;
  return 'adaptive';
}

function normalizeProtection(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'aes-gcm-session') return 'aes-gcm-session';
  return 'none';
}

function normalizeThumbnailLoadingStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'eager' || raw === 'viewport') return raw;
  return 'adaptive';
}

function normalizeThumbnailSourceStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'auto' || raw === 'dedicated' || raw === 'prefer-full-images') return raw;
  // Invalid or unknown values intentionally normalize to `auto`, which keeps runtime behavior
  // adaptive instead of silently pinning the viewer to a more opinionated thumbnail source mode.
  return 'auto';
}

function normalizeMode(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'performance' || raw === 'memory') return raw;
  return 'auto';
}

function normalizeFetchStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'parallel-limited') return 'parallel-limited';
  return 'sequential';
}

function normalizeRenderStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'eager-all' || raw === 'eager-nearby') return raw;
  return 'lazy-viewport';
}

function normalizeRenderBackend(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'main-only' || raw === 'worker-preferred') return raw;
  return 'hybrid-by-format';
}

function normalizePdfToImageMode(value, fallback) {
  if (value === true) return 'worker';
  if (value === false) return 'main-thread';
  const raw = String(value || fallback || '').trim().toLowerCase().replace(/_/g, '-');
  if (raw === 'auto' || raw === 'adaptive') return 'auto';
  if (raw === 'worker' || raw === 'workers' || raw === 'offscreen-worker') return 'worker';
  return 'main-thread';
}

function normalizePdfWorkerPagePolicy(value, fallback = DOCUMENT_LOADING_DEFAULTS.render.pdfWorkerPagePolicy) {
  const raw = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    enabled: normalizeBoolean(raw.enabled, base.enabled !== false),
    mainThreadBelowPageCount: normalizeNumber(
      raw.mainThreadBelowPageCount,
      base.mainThreadBelowPageCount ?? 0,
      0,
      1000000
    ),
    // mainThreadBelowCores is a legacy alias kept for site configs created before the property
    // was renamed to match navigator.hardwareConcurrency terminology.
    mainThreadBelowHardwareConcurrency: normalizeNumber(
      raw.mainThreadBelowHardwareConcurrency ?? raw.mainThreadBelowCores,
      base.mainThreadBelowHardwareConcurrency ?? 0,
      0,
      128
    ),
    smallWorkerBelowPageCount: normalizeNumber(
      raw.smallWorkerBelowPageCount,
      base.smallWorkerBelowPageCount ?? 0,
      0,
      1000000
    ),
    smallWorkerCount: normalizeNumber(raw.smallWorkerCount, base.smallWorkerCount ?? 1, 1, 32),
    fixedWorkerBelowPageCount: normalizeNumber(
      raw.fixedWorkerBelowPageCount,
      base.fixedWorkerBelowPageCount ?? 0,
      0,
      1000000
    ),
    fixedWorkerCount: normalizeNumber(raw.fixedWorkerCount, base.fixedWorkerCount ?? 1, 1, 32),
    pagesPerWorker: normalizeNumber(raw.pagesPerWorker, base.pagesPerWorker ?? 1, 1, 1000000),
    maxWorkerCount: normalizeNumber(raw.maxWorkerCount, base.maxWorkerCount ?? 0, 0, 32),
  };
}

function shouldUseMainThreadForPdf(policy, pageCount, mainThreadLimit, mainThreadHardwareLimit, hardwareConcurrency) {
  return !policy.enabled
    || pageCount <= 0
    || (mainThreadLimit > 0 && pageCount < mainThreadLimit)
    || (mainThreadHardwareLimit > 0 && hardwareConcurrency < mainThreadHardwareLimit);
}

function normalizePdfWorkerWarmupBatchMode(value, fallback = DOCUMENT_LOADING_DEFAULTS.render.pdfWorkerWarmupBatchMode) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'partitioned') return 'partitioned';
  if (normalized === 'off' || normalized === 'disabled' || normalized === 'none') return 'off';
  return String(fallback || 'off').toLowerCase() === 'partitioned' ? 'partitioned' : 'off';
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return fallback;
}

export function cloneDocumentLoadingConfig(base = DOCUMENT_LOADING_DEFAULTS) {
  return {
    mode: base.mode,
    adaptiveMemory: { ...base.adaptiveMemory },
    warning: { ...base.warning },
    fetch: { ...base.fetch },
    sourceStore: { ...base.sourceStore },
    assetStore: { ...base.assetStore },
    render: {
      ...base.render,
      pdfWorkerPagePolicy: { ...(base.render?.pdfWorkerPagePolicy || DOCUMENT_LOADING_DEFAULTS.render.pdfWorkerPagePolicy) },
    },
    memoryPressure: { ...base.memoryPressure },
  };
}

/**
 * Count PDF pages in a page descriptor list.
 *
 * @param {Array<*>} pages
 * @returns {number}
 */
export function countPdfPages(pages) {
  if (!Array.isArray(pages)) return 0;
  let count = 0;
  for (const page of pages) {
    if (String(page?.fileExtension || '').toLowerCase() === 'pdf') count += 1;
  }
  return count;
}

/**
 * Resolve the PDF page-worker policy for the current document size.
 *
 * The default policy uses the same runtime-recommended worker count as raster/TIFF rendering,
 * capped by PDF page count and explicit site caps only when those caps are configured. Set
 * mainThreadBelowPageCount above 0 to keep very small PDFs on the legacy main-thread path.
 *
 * @param {number} pageCount
 * @param {DocumentLoadingRenderConfig=} renderConfig
 * @returns {{mode:string, workerCount:number, policy:DocumentLoadingPdfWorkerPagePolicy, hardwareCap:number}}
 */
export function resolvePdfWorkerPlanForPageCount(pageCount, renderConfig = DOCUMENT_LOADING_DEFAULTS.render) {
  const safePageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  const policy = normalizePdfWorkerPagePolicy(
    renderConfig?.pdfWorkerPagePolicy,
    DOCUMENT_LOADING_DEFAULTS.render.pdfWorkerPagePolicy
  );
  const recommendedCap = Math.max(1, Math.min(32, resolveRecommendedWorkerCount(0, 'auto')));
  let hardwareConcurrency = 4;
  try {
    hardwareConcurrency = Math.max(1, Math.floor(Number(globalThis.navigator?.hardwareConcurrency) || 4));
  } catch {}
  const explicitPolicyCap = Math.max(0, Number(policy.maxWorkerCount) || 0);
  const explicitLegacyCap = Math.max(0, Number(renderConfig?.pdfWorkerMaxCount) || 0);
  let hardwareCap = recommendedCap;
  if (explicitPolicyCap > 0) hardwareCap = Math.min(hardwareCap, explicitPolicyCap);
  if (explicitLegacyCap > 0) hardwareCap = Math.min(hardwareCap, explicitLegacyCap);
  hardwareCap = Math.max(1, Math.floor(hardwareCap));

  const mainThreadLimit = Math.max(0, Math.floor(Number(policy.mainThreadBelowPageCount) || 0));
  const mainThreadHardwareLimit = Math.max(0, Math.floor(Number(policy.mainThreadBelowHardwareConcurrency) || 0));
  if (shouldUseMainThreadForPdf(policy, safePageCount, mainThreadLimit, mainThreadHardwareLimit, hardwareConcurrency)) {
    return { mode: 'main-thread', workerCount: 0, policy, hardwareCap };
  }

  const smallWorkerCount = Math.max(1, Math.floor(Number(policy.smallWorkerCount) || 1));
  const fixedWorkerCount = Math.max(1, Math.floor(Number(policy.fixedWorkerCount) || 1));
  const pagesPerWorker = Math.max(1, Math.floor(Number(policy.pagesPerWorker) || 1));
  const smallLimit = Math.max(
    mainThreadLimit,
    Math.floor(Number(policy.smallWorkerBelowPageCount) || 0)
  );
  const fixedLimit = Math.max(
    smallLimit,
    Math.floor(Number(policy.fixedWorkerBelowPageCount) || 0)
  );
  let desiredWorkerCount = fixedWorkerCount;
  if (smallLimit > mainThreadLimit && safePageCount < smallLimit) {
    // Small PDFs use a deliberately small pool so worker startup and transfer overhead stay low.
    desiredWorkerCount = smallWorkerCount;
  } else if (safePageCount >= fixedLimit) {
    // With the default fixedLimit=0 policy, large PDFs scale from pagesPerWorker immediately.
    // fixedWorkerCount remains the floor; pagesPerWorker controls how aggressively workers scale.
    desiredWorkerCount = Math.max(fixedWorkerCount, Math.round(safePageCount / pagesPerWorker));
  }
  return {
    mode: 'worker',
    workerCount: Math.max(1, Math.min(hardwareCap, desiredWorkerCount)),
    policy,
    hardwareCap,
  };
}

/**
 * Return a render config with `pdfToImageMode` and `pdfWorkerCount` resolved for a known PDF page
 * count. Explicit `main-thread` and `worker` modes still behave as overrides; `auto` uses the
 * automatic worker policy.
 *
 * @param {DocumentLoadingRenderConfig=} renderConfig
 * @param {number=} pdfPageCount
 * @returns {DocumentLoadingRenderConfig}
 */
export function resolvePdfRenderConfigForPageCount(renderConfig = DOCUMENT_LOADING_DEFAULTS.render, pdfPageCount = 0) {
  const base = {
    ...(renderConfig || {}),
    pdfWorkerPagePolicy: normalizePdfWorkerPagePolicy(
      renderConfig?.pdfWorkerPagePolicy,
      DOCUMENT_LOADING_DEFAULTS.render.pdfWorkerPagePolicy
    ),
  };
  const requestedMode = normalizePdfToImageMode(base.pdfToImageMode, DOCUMENT_LOADING_DEFAULTS.render.pdfToImageMode);

  if (requestedMode === 'auto') {
    const plan = resolvePdfWorkerPlanForPageCount(pdfPageCount, base);
    return {
      ...base,
      pdfToImageMode: plan.mode,
      pdfWorkerCount: plan.workerCount,
      pdfWorkerResolvedPageCount: Math.max(0, Math.floor(Number(pdfPageCount) || 0)),
      pdfWorkerResolvedHardwareCap: plan.hardwareCap,
    };
  }

  if (requestedMode === 'worker') {
    const recommendedCap = Math.max(1, Math.min(32, resolveRecommendedWorkerCount(0, 'auto')));
    const explicitPolicyCap = Math.max(0, Number(base.pdfWorkerPagePolicy?.maxWorkerCount) || 0);
    const explicitLegacyCap = Math.max(0, Number(base.pdfWorkerMaxCount) || 0);
    let cap = recommendedCap;
    if (explicitPolicyCap > 0) cap = Math.min(cap, explicitPolicyCap);
    if (explicitLegacyCap > 0) cap = Math.min(cap, explicitLegacyCap);
    const requestedWorkerCount = Math.max(0, Math.floor(Number(base.pdfWorkerCount || base.workerCount) || 0));
    return {
      ...base,
      pdfToImageMode: 'worker',
      pdfWorkerCount: Math.max(1, Math.min(cap, requestedWorkerCount || cap)),
      pdfWorkerResolvedPageCount: Math.max(0, Math.floor(Number(pdfPageCount) || 0)),
      pdfWorkerResolvedHardwareCap: Math.max(1, Math.floor(cap)),
    };
  }

  return {
    ...base,
    pdfToImageMode: 'main-thread',
    pdfWorkerCount: 0,
    pdfWorkerResolvedPageCount: Math.max(0, Math.floor(Number(pdfPageCount) || 0)),
    pdfWorkerResolvedHardwareCap: 0,
  };
}

function buildAdaptiveDefaults(adaptiveRaw = {}) {
  const base = cloneDocumentLoadingConfig(DOCUMENT_LOADING_DEFAULTS);
  const profile = getRuntimeMemoryProfile();

  const enabled = normalizeBoolean(
    adaptiveRaw?.enabled,
    DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.enabled
  );
  const preferDeviceMemoryAtLeastGb = normalizeFloat(
    adaptiveRaw?.preferPerformanceWhenDeviceMemoryAtLeastGb,
    DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.preferPerformanceWhenDeviceMemoryAtLeastGb,
    1,
    1024
  );
  const preferHeapAtLeastMiB = normalizeFloat(
    adaptiveRaw?.preferPerformanceWhenJsHeapLimitAtLeastMiB,
    DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.preferPerformanceWhenJsHeapLimitAtLeastMiB,
    256,
    1024 * 1024
  );
  const reuseFullImageThumbnailsBelowPageCount = normalizeNumber(
    adaptiveRaw?.reuseFullImageThumbnailsBelowPageCount,
    DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.reuseFullImageThumbnailsBelowPageCount,
    1,
    1000000
  );
  const performanceWindowPageCount = normalizeNumber(
    adaptiveRaw?.performanceWindowPageCount,
    DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.performanceWindowPageCount,
    1,
    1000000
  );

  const preferPerformance = enabled && (
    (profile.deviceMemoryGb > 0 && profile.deviceMemoryGb >= preferDeviceMemoryAtLeastGb)
    || (profile.jsHeapLimitMiB > 0 && profile.jsHeapLimitMiB >= preferHeapAtLeastMiB)
    || profile.tier === 'very-high'
  );

  base.adaptiveMemory = {
    enabled,
    preferPerformanceWhenDeviceMemoryAtLeastGb: preferDeviceMemoryAtLeastGb,
    preferPerformanceWhenJsHeapLimitAtLeastMiB: preferHeapAtLeastMiB,
    reuseFullImageThumbnailsBelowPageCount,
    performanceWindowPageCount,
    resolvedTier: profile.tier,
    preferPerformance,
  };

  switch (profile.tier) {
    case 'very-high':
      base.fetch.prefetchConcurrency = 6;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 2048;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 4096;
      base.render.workerCount = resolveRecommendedRasterWorkerCount(0, 'performance');
      base.render.maxConcurrentMainThreadRenders = 3;
      base.render.maxConcurrentAssetRenders = 3;
      break;
    case 'high':
      base.fetch.prefetchConcurrency = 4;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 1536;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 3072;
      base.render.workerCount = resolveRecommendedRasterWorkerCount(0, 'auto');
      base.render.maxConcurrentMainThreadRenders = 2;
      base.render.maxConcurrentAssetRenders = 2;
      break;
    case 'medium':
      base.fetch.prefetchConcurrency = 3;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 1024;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 2048;
      base.render.workerCount = resolveRecommendedRasterWorkerCount(0, 'auto');
      base.render.maxConcurrentMainThreadRenders = 2;
      base.render.maxConcurrentAssetRenders = 2;
      break;
    case 'low':
      base.fetch.prefetchConcurrency = 1;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 256;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 512;
      base.render.workerCount = resolveRecommendedRasterWorkerCount(1, 'memory');
      base.render.maxConcurrentMainThreadRenders = 1;
      base.render.maxConcurrentAssetRenders = 1;
      base.render.fullPageCacheLimit = 16;
      base.render.thumbnailCacheLimit = 128;
      base.render.lookAheadPageCount = 1;
      base.render.lookBehindPageCount = 1;
      break;
    default:
      break;
  }

  return base;
}

export function applyDocumentLoadingMode(baseConfig, mode) {
  const next = cloneDocumentLoadingConfig(baseConfig);
  next.mode = normalizeMode(mode, baseConfig?.mode || 'auto');

  if (next.mode === 'performance') {
    next.fetch.strategy = 'sequential';
    next.fetch.prefetchConcurrency = Math.max(1, next.fetch.prefetchConcurrency);
    if (next.sourceStore.mode !== 'indexeddb') next.sourceStore.mode = 'memory';
    if (next.assetStore.mode !== 'indexeddb') next.assetStore.mode = 'memory';
    next.assetStore.persistThumbnails = false;
    next.assetStore.releaseSinglePageRasterSourceAfterFullPersist = false;
    next.render.strategy = 'eager-all';
    next.render.backend = 'hybrid-by-format';
    next.render.useWorkersForRasterImages = true;
    next.render.useWorkersForTiff = true;
    next.render.workerCount = resolveRecommendedRasterWorkerCount(next.render.workerCount, 'performance');
    next.render.maxConcurrentMainThreadRenders = Math.max(3, next.render.maxConcurrentMainThreadRenders || next.render.maxConcurrentAssetRenders || 1);
    next.render.maxConcurrentAssetRenders = next.render.maxConcurrentMainThreadRenders;
    next.render.warmupBatchSize = Math.max(48, next.render.warmupBatchSize || 0);
    next.render.loadingOverlayDelayMs = Math.max(60, next.render.loadingOverlayDelayMs || 0);
    next.render.thumbnailLoadingStrategy = 'eager';
    next.render.thumbnailSourceStrategy = 'prefer-full-images';
    next.render.fullPageCacheLimit = Math.max(500, next.render.fullPageCacheLimit || 0);
    next.render.thumbnailCacheLimit = Math.max(4096, next.render.thumbnailCacheLimit || 0);
    next.adaptiveMemory.preferPerformance = true;
    return next;
  }

  if (next.mode === 'memory') {
    next.fetch.strategy = 'sequential';
    next.fetch.prefetchConcurrency = 1;
    if (next.sourceStore.mode === 'memory') next.sourceStore.mode = 'adaptive';
    if (next.assetStore.mode === 'memory') next.assetStore.mode = 'adaptive';
    next.assetStore.persistThumbnails = true;
    next.assetStore.releaseSinglePageRasterSourceAfterFullPersist = true;
    next.render.strategy = 'lazy-viewport';
    next.render.backend = next.render.backend === 'main-only' ? 'main-only' : 'hybrid-by-format';
    next.render.useWorkersForRasterImages = true;
    next.render.useWorkersForTiff = true;
    next.render.workerCount = Math.min(2, resolveRecommendedRasterWorkerCount(next.render.workerCount, 'memory'));
    next.render.maxConcurrentMainThreadRenders = 1;
    next.render.maxConcurrentAssetRenders = 1;
    next.render.warmupBatchSize = Math.min(8, Math.max(1, next.render.warmupBatchSize || 8));
    next.render.loadingOverlayDelayMs = Math.max(100, next.render.loadingOverlayDelayMs || 0);
    next.render.thumbnailLoadingStrategy = 'viewport';
    next.render.thumbnailSourceStrategy = 'dedicated';
    next.render.fullPageCacheLimit = Math.min(next.render.fullPageCacheLimit || 24, 24);
    next.render.thumbnailCacheLimit = Math.min(next.render.thumbnailCacheLimit || 256, 256);
    next.render.lookAheadPageCount = Math.min(next.render.lookAheadPageCount || 2, 2);
    next.render.lookBehindPageCount = Math.min(next.render.lookBehindPageCount || 1, 1);
    next.adaptiveMemory.preferPerformance = false;
    return next;
  }

  next.fetch.strategy = next.fetch.strategy || 'sequential';
  next.render.strategy = next.render.strategy || 'eager-nearby';
  next.render.backend = next.render.backend || 'hybrid-by-format';
  next.render.useWorkersForRasterImages = normalizeBoolean(next.render.useWorkersForRasterImages, true);
  next.render.useWorkersForTiff = normalizeBoolean(next.render.useWorkersForTiff, true);
  next.render.pdfToImageMode = normalizePdfToImageMode(next.render.pdfToImageMode, DOCUMENT_LOADING_DEFAULTS.render.pdfToImageMode);
  next.render.pdfWorkerCount = Math.max(0, Number(next.render.pdfWorkerCount) || 0);
  next.render.pdfWorkerPagePolicy = normalizePdfWorkerPagePolicy(next.render.pdfWorkerPagePolicy);
  next.render.workerCount = resolveRecommendedRasterWorkerCount(next.render.workerCount, 'auto');
  next.render.maxConcurrentMainThreadRenders = Math.max(1, next.render.maxConcurrentMainThreadRenders || next.render.maxConcurrentAssetRenders || 1);
  next.render.maxConcurrentAssetRenders = next.render.maxConcurrentMainThreadRenders;
  next.render.warmupBatchSize = Math.max(24, next.render.warmupBatchSize || 24);
  next.render.loadingOverlayDelayMs = Math.max(80, next.render.loadingOverlayDelayMs || 0);
  next.render.thumbnailSourceStrategy = next.render.thumbnailSourceStrategy || 'prefer-full-images';
  if (next.render.thumbnailSourceStrategy === 'prefer-full-images') {
    next.assetStore.persistThumbnails = false;
    next.render.fullPageCacheLimit = Math.max(500, next.render.fullPageCacheLimit || 0);
  }
  return next;
}

export function applyMemoryPressureStage(baseConfig, stage) {
  const safeStage = String(stage || 'normal').toLowerCase();
  if (safeStage === 'normal') return cloneDocumentLoadingConfig(baseConfig);
  if (safeStage === 'hard') return applyDocumentLoadingMode(baseConfig, 'memory');

  const next = cloneDocumentLoadingConfig(baseConfig);
  next.fetch.strategy = 'sequential';
  next.fetch.prefetchConcurrency = 1;
  next.assetStore.persistThumbnails = true;
  next.render.strategy = next.render.strategy === 'eager-all' ? 'eager-nearby' : next.render.strategy;
  next.render.workerCount = Math.max(1, Math.min(3, resolveRecommendedRasterWorkerCount(next.render.workerCount, 'memory')));
  next.render.maxConcurrentMainThreadRenders = 2;
  next.render.maxConcurrentAssetRenders = 2;
  next.render.warmupBatchSize = Math.max(1, Math.min(12, next.render.warmupBatchSize || 12));
  next.render.thumbnailLoadingStrategy = 'eager';
  next.render.thumbnailSourceStrategy = 'dedicated';
  next.render.fullPageCacheLimit = Math.max(128, Math.min(next.render.fullPageCacheLimit || 512, 512));
  next.render.thumbnailCacheLimit = Math.max(512, Math.min(next.render.thumbnailCacheLimit || 4096, 4096));
  next.assetStore.releaseSinglePageRasterSourceAfterFullPersist = true;
  return next;
}

/**
 * Return the page-count window where auto mode should still behave like the fast, eager path.
 * This lets ordinary large batches stay snappy while still preserving the ability to degrade for
 * genuinely extreme document runs.
 *
 * @param {DocumentLoadingConfig=} config
 * @returns {number}
 */
export function getPerformanceWindowPageCount(config = DOCUMENT_LOADING_DEFAULTS) {
  return Math.max(
    1,
    Number(config?.adaptiveMemory?.performanceWindowPageCount || DOCUMENT_LOADING_DEFAULTS.adaptiveMemory.performanceWindowPageCount) || 1
  );
}

export function getDocumentLoadingConfig(runtimeConfig = getRuntimeConfig()) {
  const raw = runtimeConfig?.documentLoading || {};
  const adaptiveDefaults = buildAdaptiveDefaults(raw?.adaptiveMemory);
  const requestedMode = normalizeMode(raw?.mode, adaptiveDefaults.mode);

  const configuredSoftHeapUsageRatio = normalizeFloat(
    raw?.memoryPressure?.softHeapUsageRatio,
    adaptiveDefaults.memoryPressure.softHeapUsageRatio,
    0.1,
    0.99
  );
  const normalizedHardHeapUsageRatio = Math.min(
    0.99,
    Math.max(
      0.11,
      normalizeFloat(
        raw?.memoryPressure?.hardHeapUsageRatio,
        adaptiveDefaults.memoryPressure.hardHeapUsageRatio,
        0.1,
        0.99
      )
    )
  );
  const normalizedSoftHeapUsageRatio = Math.min(
    configuredSoftHeapUsageRatio,
    normalizedHardHeapUsageRatio - 0.01
  );
  // Keep the pressure thresholds ordered even when a site override accidentally swaps them.

  const normalized = {
    mode: requestedMode,
    adaptiveMemory: {
      enabled: normalizeBoolean(raw?.adaptiveMemory?.enabled, adaptiveDefaults.adaptiveMemory.enabled),
      preferPerformanceWhenDeviceMemoryAtLeastGb: normalizeFloat(raw?.adaptiveMemory?.preferPerformanceWhenDeviceMemoryAtLeastGb, adaptiveDefaults.adaptiveMemory.preferPerformanceWhenDeviceMemoryAtLeastGb, 1, 1024),
      preferPerformanceWhenJsHeapLimitAtLeastMiB: normalizeFloat(raw?.adaptiveMemory?.preferPerformanceWhenJsHeapLimitAtLeastMiB, adaptiveDefaults.adaptiveMemory.preferPerformanceWhenJsHeapLimitAtLeastMiB, 256, 1024 * 1024),
      reuseFullImageThumbnailsBelowPageCount: normalizeNumber(raw?.adaptiveMemory?.reuseFullImageThumbnailsBelowPageCount, adaptiveDefaults.adaptiveMemory.reuseFullImageThumbnailsBelowPageCount, 1, 1000000),
      performanceWindowPageCount: normalizeNumber(raw?.adaptiveMemory?.performanceWindowPageCount, adaptiveDefaults.adaptiveMemory.performanceWindowPageCount, 1, 1000000),
      resolvedTier: adaptiveDefaults.adaptiveMemory.resolvedTier,
      preferPerformance: adaptiveDefaults.adaptiveMemory.preferPerformance,
    },
    warning: {
      sourceCountThreshold: normalizeThreshold(raw?.warning?.sourceCountThreshold, adaptiveDefaults.warning.sourceCountThreshold, 1000000),
      pageCountThreshold: normalizeThreshold(raw?.warning?.pageCountThreshold, adaptiveDefaults.warning.pageCountThreshold, 10000000),
      probePageThresholdSources: normalizeNumber(raw?.warning?.probePageThresholdSources, adaptiveDefaults.warning.probePageThresholdSources, 1, 1000),
      minStopRecommendationSources: normalizeThreshold(raw?.warning?.minStopRecommendationSources, adaptiveDefaults.warning.minStopRecommendationSources, 1000000),
      minStopRecommendationPages: normalizeThreshold(raw?.warning?.minStopRecommendationPages, adaptiveDefaults.warning.minStopRecommendationPages, 10000000),
    },
    fetch: {
      strategy: normalizeFetchStrategy(raw?.fetch?.strategy, adaptiveDefaults.fetch.strategy),
      prefetchConcurrency: normalizeNumber(raw?.fetch?.prefetchConcurrency, adaptiveDefaults.fetch.prefetchConcurrency, 1, 32),
      prefetchRetryCount: normalizeNumber(raw?.fetch?.prefetchRetryCount, adaptiveDefaults.fetch.prefetchRetryCount, 0, 5),
      prefetchRetryBaseDelayMs: normalizeNumber(raw?.fetch?.prefetchRetryBaseDelayMs, adaptiveDefaults.fetch.prefetchRetryBaseDelayMs, 100, 60000),
      prefetchRequestTimeoutMs: normalizeNumber(raw?.fetch?.prefetchRequestTimeoutMs, adaptiveDefaults.fetch.prefetchRequestTimeoutMs, 1000, 120000),
      maxSourceSizeMiB: normalizeNumber(raw?.fetch?.maxSourceSizeMiB, adaptiveDefaults.fetch.maxSourceSizeMiB, 16, 4096),
      abortOnSourceUnavailableCount: normalizeThreshold(raw?.fetch?.abortOnSourceUnavailableCount, adaptiveDefaults.fetch.abortOnSourceUnavailableCount, 1000000),
    },
    sourceStore: {
      mode: normalizeStoreMode(raw?.sourceStore?.mode, adaptiveDefaults.sourceStore.mode),
      switchToIndexedDbAboveSourceCount: normalizeThreshold(raw?.sourceStore?.switchToIndexedDbAboveSourceCount, adaptiveDefaults.sourceStore.switchToIndexedDbAboveSourceCount, 1000000),
      switchToIndexedDbAboveTotalMiB: normalizeMiBThreshold(raw?.sourceStore?.switchToIndexedDbAboveTotalMiB, adaptiveDefaults.sourceStore.switchToIndexedDbAboveTotalMiB, 1048576),
      protection: normalizeProtection(raw?.sourceStore?.protection, adaptiveDefaults.sourceStore.protection),
      staleSessionTtlMs: normalizeNumber(raw?.sourceStore?.staleSessionTtlMs, adaptiveDefaults.sourceStore.staleSessionTtlMs, 1000, 365 * 24 * 60 * 60 * 1000),
      reloadCacheTtlMs: normalizeNumber(raw?.sourceStore?.reloadCacheTtlMs, adaptiveDefaults.sourceStore.reloadCacheTtlMs, 0, MAX_RELOAD_CACHE_TTL_MS),
      blobCacheEntries: normalizeNumber(raw?.sourceStore?.blobCacheEntries, adaptiveDefaults.sourceStore.blobCacheEntries, 1, 64),
    },
    assetStore: {
      enabled: normalizeBoolean(raw?.assetStore?.enabled, adaptiveDefaults.assetStore.enabled),
      mode: normalizeStoreMode(raw?.assetStore?.mode, adaptiveDefaults.assetStore.mode),
      switchToIndexedDbAboveAssetCount: normalizeThreshold(raw?.assetStore?.switchToIndexedDbAboveAssetCount, adaptiveDefaults.assetStore.switchToIndexedDbAboveAssetCount, 1000000),
      switchToIndexedDbAboveTotalMiB: normalizeMiBThreshold(raw?.assetStore?.switchToIndexedDbAboveTotalMiB, adaptiveDefaults.assetStore.switchToIndexedDbAboveTotalMiB, 1048576),
      protection: normalizeProtection(raw?.assetStore?.protection, adaptiveDefaults.assetStore.protection),
      staleSessionTtlMs: normalizeNumber(raw?.assetStore?.staleSessionTtlMs, adaptiveDefaults.assetStore.staleSessionTtlMs, 1000, 365 * 24 * 60 * 60 * 1000),
      reloadCacheTtlMs: normalizeNumber(raw?.assetStore?.reloadCacheTtlMs, adaptiveDefaults.assetStore.reloadCacheTtlMs, 0, MAX_RELOAD_CACHE_TTL_MS),
      blobCacheEntries: normalizeNumber(raw?.assetStore?.blobCacheEntries, adaptiveDefaults.assetStore.blobCacheEntries, 1, 256),
      persistThumbnails: normalizeBoolean(raw?.assetStore?.persistThumbnails, adaptiveDefaults.assetStore.persistThumbnails),
      persistFullPagesInBackground: normalizeBoolean(raw?.assetStore?.persistFullPagesInBackground, adaptiveDefaults.assetStore.persistFullPagesInBackground),
      restoreBeforeRender: normalizeBoolean(raw?.assetStore?.restoreBeforeRender, adaptiveDefaults.assetStore.restoreBeforeRender),
      releaseSinglePageRasterSourceAfterFullPersist: normalizeBoolean(raw?.assetStore?.releaseSinglePageRasterSourceAfterFullPersist, adaptiveDefaults.assetStore.releaseSinglePageRasterSourceAfterFullPersist),
    },
    render: {
      strategy: normalizeRenderStrategy(raw?.render?.strategy, adaptiveDefaults.render.strategy),
      backend: normalizeRenderBackend(raw?.render?.backend, adaptiveDefaults.render.backend),
      workerCount: normalizeNumber(raw?.render?.workerCount, adaptiveDefaults.render.workerCount, 0, 32),
      useWorkersForRasterImages: normalizeBoolean(raw?.render?.useWorkersForRasterImages, adaptiveDefaults.render.useWorkersForRasterImages),
      useWorkersForTiff: normalizeBoolean(raw?.render?.useWorkersForTiff, adaptiveDefaults.render.useWorkersForTiff),
      pdfToImageMode: normalizePdfToImageMode(raw?.render?.pdfToImageMode ?? raw?.render?.['pdf-to-image-mode'], adaptiveDefaults.render.pdfToImageMode),
      pdfWorkerCount: normalizeNumber(raw?.render?.pdfWorkerCount, adaptiveDefaults.render.pdfWorkerCount || 0, 0, 32),
      pdfWorkerMaxCount: normalizeNumber(raw?.render?.pdfWorkerMaxCount ?? raw?.render?.maxPdfWorkerCount, adaptiveDefaults.render.pdfWorkerMaxCount, 0, 32),
      pdfWorkerPagePolicy: normalizePdfWorkerPagePolicy(
        raw?.render?.pdfWorkerPagePolicy ?? raw?.render?.pdfWorkerAutoPolicy,
        adaptiveDefaults.render.pdfWorkerPagePolicy
      ),
      pdfWorkerWarmupBatchMode: normalizePdfWorkerWarmupBatchMode(
        raw?.render?.pdfWorkerWarmupBatchMode,
        adaptiveDefaults.render.pdfWorkerWarmupBatchMode
      ),
      pdfWorkerWarmupBatchSize: normalizeNumber(raw?.render?.pdfWorkerWarmupBatchSize, adaptiveDefaults.render.pdfWorkerWarmupBatchSize, 0, 4096),
      pdfWorkerWarmupRendersPerWorker: normalizeNumber(raw?.render?.pdfWorkerWarmupRendersPerWorker, adaptiveDefaults.render.pdfWorkerWarmupRendersPerWorker, 1, 8),
      maxConcurrentMainThreadRenders: normalizeNumber(raw?.render?.maxConcurrentMainThreadRenders, adaptiveDefaults.render.maxConcurrentMainThreadRenders, 1, 32),
      maxConcurrentAssetRenders: normalizeNumber(raw?.render?.maxConcurrentAssetRenders, adaptiveDefaults.render.maxConcurrentAssetRenders, 1, 8),
      warmupBatchSize: normalizeNumber(raw?.render?.warmupBatchSize, adaptiveDefaults.render.warmupBatchSize, 1, 512),
      loadingOverlayDelayMs: normalizeNumber(raw?.render?.loadingOverlayDelayMs, adaptiveDefaults.render.loadingOverlayDelayMs, 0, 5000),
      fullPageScale: normalizeFloat(raw?.render?.fullPageScale, adaptiveDefaults.render.fullPageScale, 0.5, 4),
      thumbnailMaxWidth: normalizeNumber(raw?.render?.thumbnailMaxWidth, adaptiveDefaults.render.thumbnailMaxWidth, 32, 4096),
      thumbnailMaxHeight: normalizeNumber(raw?.render?.thumbnailMaxHeight, adaptiveDefaults.render.thumbnailMaxHeight, 32, 4096),
      thumbnailLoadingStrategy: normalizeThumbnailLoadingStrategy(raw?.render?.thumbnailLoadingStrategy, adaptiveDefaults.render.thumbnailLoadingStrategy),
      thumbnailSourceStrategy: normalizeThumbnailSourceStrategy(raw?.render?.thumbnailSourceStrategy, adaptiveDefaults.render.thumbnailSourceStrategy),
      thumbnailEagerPageThreshold: normalizeNumber(raw?.render?.thumbnailEagerPageThreshold, adaptiveDefaults.render.thumbnailEagerPageThreshold, 1, 100000),
      lookAheadPageCount: normalizeNumber(raw?.render?.lookAheadPageCount, adaptiveDefaults.render.lookAheadPageCount, 0, 64),
      lookBehindPageCount: normalizeNumber(raw?.render?.lookBehindPageCount, adaptiveDefaults.render.lookBehindPageCount, 0, 64),
      visibleThumbnailOverscan: normalizeNumber(raw?.render?.visibleThumbnailOverscan, adaptiveDefaults.render.visibleThumbnailOverscan, 0, 256),
      fullPageCacheLimit: normalizeNumber(raw?.render?.fullPageCacheLimit, adaptiveDefaults.render.fullPageCacheLimit, 1, 8192),
      thumbnailCacheLimit: normalizeNumber(raw?.render?.thumbnailCacheLimit, adaptiveDefaults.render.thumbnailCacheLimit, 1, 32768),
      maxOpenPdfDocuments: normalizeNumber(raw?.render?.maxOpenPdfDocuments, adaptiveDefaults.render.maxOpenPdfDocuments, 1, 64),
      maxOpenTiffDocuments: normalizeNumber(raw?.render?.maxOpenTiffDocuments, adaptiveDefaults.render.maxOpenTiffDocuments, 1, 64),
    },
    memoryPressure: {
      enabled: normalizeBoolean(raw?.memoryPressure?.enabled, adaptiveDefaults.memoryPressure.enabled),
      sampleIntervalMs: normalizeNumber(raw?.memoryPressure?.sampleIntervalMs, adaptiveDefaults.memoryPressure.sampleIntervalMs, 250, 60000),
      softHeapUsageRatio: normalizedSoftHeapUsageRatio,
      hardHeapUsageRatio: normalizedHardHeapUsageRatio,
      softResidentMiB: normalizeMiBThreshold(raw?.memoryPressure?.softResidentMiB, adaptiveDefaults.memoryPressure.softResidentMiB, 1048576),
      hardResidentMiB: normalizeMiBThreshold(raw?.memoryPressure?.hardResidentMiB, adaptiveDefaults.memoryPressure.hardResidentMiB, 1048576),
      forceMemoryModeAbovePageCount: normalizeThreshold(raw?.memoryPressure?.forceMemoryModeAbovePageCount, adaptiveDefaults.memoryPressure.forceMemoryModeAbovePageCount, 10000000),
      forceMemoryModeAboveSourceCount: normalizeThreshold(raw?.memoryPressure?.forceMemoryModeAboveSourceCount, adaptiveDefaults.memoryPressure.forceMemoryModeAboveSourceCount, 1000000),
    },
  };

  return applyDocumentLoadingMode(normalized, requestedMode);
}

export function isRasterImageExtension(value) {
  const ext = String(value || '').trim().toLowerCase();
  return ext === 'jpg'
    || ext === 'jpeg'
    || ext === 'png'
    || ext === 'gif'
    || ext === 'webp'
    || ext === 'bmp'
    || ext === 'tif'
    || ext === 'tiff'
    || ext === 'avif';
}

export function shouldUseFullImagesForThumbnails(config, page, totalPages) {
  const strategy = String(config?.render?.thumbnailSourceStrategy || 'auto').toLowerCase();
  if (strategy === 'dedicated') return false;
  if (strategy === 'prefer-full-images') return true;
  if (!isRasterImageExtension(page?.fileExtension)) return false;

  const preferPerformance = !!config?.adaptiveMemory?.preferPerformance || String(config?.mode || '') === 'performance';
  const limit = Math.max(1, Number(config?.adaptiveMemory?.reuseFullImageThumbnailsBelowPageCount) || 1);
  return preferPerformance && totalPages > 0 && totalPages <= limit;
}

export function shouldKeepAllFullImageAssets(config, pages) {
  const list = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (!list.length) return false;
  const totalPages = list.length;
  if (String(config?.mode || '').toLowerCase() === 'performance') return true;
  return list.every((page) => shouldUseFullImagesForThumbnails(config, page, totalPages));
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 'B';
  for (const nextUnit of units) {
    size /= 1024;
    unit = nextUnit;
    if (size < 1024) break;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

/**
 * @param {number} count
 * @returns {string}
 */
export function formatCount(count) {
  return new Intl.NumberFormat().format(Math.max(0, Number(count) || 0));
}

/**
 * @param {StopRecommendationInput} input
 * @returns {boolean}
 */
export function shouldRecommendStopping({
  sourceCount = 0,
  pageCount = 0,
  config = null,
}) {
  const resolvedConfig = config || getDocumentLoadingConfig();
  const sourceThreshold = Math.max(0, Number(resolvedConfig.warning.minStopRecommendationSources) || 0);
  const pageThreshold = Math.max(0, Number(resolvedConfig.warning.minStopRecommendationPages) || 0);
  return (
    (sourceThreshold > 0 && Math.max(0, Number(sourceCount) || 0) >= sourceThreshold)
    || (pageThreshold > 0 && Math.max(0, Number(pageCount) || 0) >= pageThreshold)
  );
}
