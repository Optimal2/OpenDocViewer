// File: src/utils/documentLoadingConfig.js
/**
 * OpenDocViewer — Large-document loading runtime configuration helpers.
 *
 * The loader, temp store, and lazy renderer use this module so the deployment can tune thresholds
 * from `public/odv.config.js` without scattering normalization logic throughout the app.
 */

import { getRuntimeConfig } from './runtimeConfig.js';
import { getRuntimeMemoryProfile } from './memoryProfile.js';

/** @typedef {'memory'|'indexeddb'|'adaptive'} SourceStoreMode */
/** @typedef {'none'|'aes-gcm-session'} SourceStoreProtection */
/** @typedef {'adaptive'|'eager'|'viewport'} ThumbnailLoadingStrategy */
/** @typedef {'auto'|'dedicated'|'prefer-full-images'} ThumbnailSourceStrategy */
/** @typedef {'unknown'|'low'|'medium'|'high'|'very-high'} RuntimeMemoryTier */

/**
 * @typedef {Object} DocumentLoadingAdaptiveMemoryConfig
 * @property {boolean} enabled
 * @property {number} preferPerformanceWhenDeviceMemoryAtLeastGb
 * @property {number} preferPerformanceWhenJsHeapLimitAtLeastMiB
 * @property {number} reuseFullImageThumbnailsBelowPageCount
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
 * @property {number} prefetchConcurrency
 * @property {number} prefetchRetryCount
 * @property {number} prefetchRetryBaseDelayMs
 * @property {number} prefetchRequestTimeoutMs
 */

/**
 * @typedef {Object} DocumentLoadingSourceStoreConfig
 * @property {SourceStoreMode} mode
 * @property {number} switchToIndexedDbAboveSourceCount
 * @property {number} switchToIndexedDbAboveTotalMiB
 * @property {SourceStoreProtection} protection
 * @property {number} staleSessionTtlMs
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
 * @property {number} blobCacheEntries
 * @property {boolean} persistThumbnails
 * @property {boolean} releaseSinglePageRasterSourceAfterFullPersist
 */

/**
 * @typedef {Object} DocumentLoadingRenderConfig
 * @property {number} maxConcurrentAssetRenders
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
 * @typedef {Object} StopRecommendationInput
 * @property {number=} sourceCount
 * @property {number=} pageCount
 * @property {DocumentLoadingConfig=} config
 */

/**
 * @typedef {Object} DocumentLoadingConfig
 * @property {DocumentLoadingAdaptiveMemoryConfig} adaptiveMemory
 * @property {DocumentLoadingWarningConfig} warning
 * @property {DocumentLoadingFetchConfig} fetch
 * @property {DocumentLoadingSourceStoreConfig} sourceStore
 * @property {DocumentLoadingAssetStoreConfig} assetStore
 * @property {DocumentLoadingRenderConfig} render
 */

export const DOCUMENT_LOADING_DEFAULTS = Object.freeze(
  /** @type {DocumentLoadingConfig} */ ({
    adaptiveMemory: {
      enabled: true,
      preferPerformanceWhenDeviceMemoryAtLeastGb: 8,
      preferPerformanceWhenJsHeapLimitAtLeastMiB: 2048,
      reuseFullImageThumbnailsBelowPageCount: 600,
      resolvedTier: 'unknown',
      preferPerformance: false,
    },
    warning: {
      sourceCountThreshold: 0,
      pageCountThreshold: 5000,
      probePageThresholdSources: 2,
      minStopRecommendationSources: 0,
      minStopRecommendationPages: 10000,
    },
    fetch: {
      // Customer-tuned default: stay conservative enough for proxied backends, but fail fast so
      // slow or broken source fetches do not stall the whole thumbnail/page pipeline for long.
      prefetchConcurrency: 4,
      // Prefer fail-fast behavior over conservative retries in environments where the user values
      // responsive navigation more than retrying the same timed-out request.
      prefetchRetryCount: 0,
      // Retained for deployments that explicitly re-enable retries.
      prefetchRetryBaseDelayMs: 750,
      // Abort a single prefetch attempt after this many milliseconds so one stuck request does not
      // hold back later source analysis for too long.
      prefetchRequestTimeoutMs: 10000,
    },
    sourceStore: {
      mode: 'adaptive',
      switchToIndexedDbAboveSourceCount: 0,
      switchToIndexedDbAboveTotalMiB: 768,
      protection: 'aes-gcm-session',
      staleSessionTtlMs: 24 * 60 * 60 * 1000,
      blobCacheEntries: 16,
    },
    assetStore: {
      enabled: true,
      mode: 'adaptive',
      switchToIndexedDbAboveAssetCount: 0,
      switchToIndexedDbAboveTotalMiB: 3072,
      protection: 'aes-gcm-session',
      staleSessionTtlMs: 24 * 60 * 60 * 1000,
      blobCacheEntries: 24,
      persistThumbnails: true,
      releaseSinglePageRasterSourceAfterFullPersist: false,
    },
    render: {
      maxConcurrentAssetRenders: 6,
      fullPageScale: 1.5,
      thumbnailMaxWidth: 220,
      thumbnailMaxHeight: 310,
      // This customer profile prioritizes a warm thumbnail pane and quick scroll response over
      // minimizing background work. Thumbnails are therefore queued eagerly.
      thumbnailLoadingStrategy: 'eager',
      // Dedicated thumbnail rasters keep the pane lighter than reusing full-size images for every
      // thumbnail when the document set contains many large raster pages.
      thumbnailSourceStrategy: 'dedicated',
      thumbnailEagerPageThreshold: 10000,
      lookAheadPageCount: 12,
      lookBehindPageCount: 8,
      visibleThumbnailOverscan: 24,
      fullPageCacheLimit: 256,
      thumbnailCacheLimit: 8192,
      maxOpenPdfDocuments: 16,
      maxOpenTiffDocuments: 16,
    },
  })
);

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number=} max
 * @returns {number}
 */
function normalizeNumber(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  const bounded = Math.max(min, typeof max === 'number' ? Math.min(max, next) : next);
  return Math.floor(bounded);
}

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number=} max
 * @returns {number}
 */
function normalizeFloat(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, typeof max === 'number' ? Math.min(max, next) : next);
}


/**
 * Normalize a threshold-like integer where 0 disables the threshold.
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number=} max
 * @returns {number}
 */
function normalizeThreshold(value, fallback, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return Math.max(0, Number(fallback) || 0);
  if (next <= 0) return 0;
  const bounded = typeof max === 'number' ? Math.min(max, next) : next;
  return Math.floor(Math.max(0, bounded));
}

/**
 * Normalize a MiB threshold where 0 disables the threshold.
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number=} max
 * @returns {number}
 */
function normalizeMiBThreshold(value, fallback, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return Math.max(0, Number(fallback) || 0);
  if (next <= 0) return 0;
  return Math.max(0, typeof max === 'number' ? Math.min(max, next) : next);
}

/**
 * @param {*} value
 * @param {SourceStoreMode} fallback
 * @returns {SourceStoreMode}
 */
function normalizeStoreMode(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'memory' || raw === 'indexeddb') return raw;
  return 'adaptive';
}

/**
 * @param {*} value
 * @param {SourceStoreProtection} fallback
 * @returns {SourceStoreProtection}
 */
function normalizeProtection(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'aes-gcm-session') return 'aes-gcm-session';
  return 'none';
}

/**
 * @param {*} value
 * @param {ThumbnailLoadingStrategy} fallback
 * @returns {ThumbnailLoadingStrategy}
 */
function normalizeThumbnailLoadingStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'eager' || raw === 'viewport') return raw;
  return 'adaptive';
}

/**
 * @param {*} value
 * @param {ThumbnailSourceStrategy} fallback
 * @returns {ThumbnailSourceStrategy}
 */
function normalizeThumbnailSourceStrategy(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase();
  if (raw === 'dedicated' || raw === 'prefer-full-images') return raw;
  return 'auto';
}

/**
 * @param {*} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return fallback;
}

/**
 * @param {DocumentLoadingConfig} base
 * @returns {DocumentLoadingConfig}
 */
function cloneDefaults(base) {
  return {
    adaptiveMemory: { ...base.adaptiveMemory },
    warning: { ...base.warning },
    fetch: { ...base.fetch },
    sourceStore: { ...base.sourceStore },
    assetStore: { ...base.assetStore },
    render: { ...base.render },
  };
}

/**
 * @param {Object=} adaptiveRaw
 * @returns {DocumentLoadingConfig}
 */
function buildAdaptiveDefaults(adaptiveRaw = {}) {
  const base = cloneDefaults(DOCUMENT_LOADING_DEFAULTS);
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
    resolvedTier: profile.tier,
    preferPerformance,
  };

  if (!enabled) return base;

  switch (profile.tier) {
    case 'very-high':
      base.fetch.prefetchConcurrency = 4;
      base.fetch.prefetchRetryCount = 0;
      base.fetch.prefetchRetryBaseDelayMs = 750;
      base.fetch.prefetchRequestTimeoutMs = 10000;
      base.sourceStore.switchToIndexedDbAboveSourceCount = 0;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 2048;
      base.sourceStore.blobCacheEntries = 24;
      base.assetStore.switchToIndexedDbAboveAssetCount = 0;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 4096;
      base.assetStore.blobCacheEntries = 32;
      base.render.maxConcurrentAssetRenders = 3;
      base.render.fullPageCacheLimit = 160;
      base.render.thumbnailCacheLimit = 1536;
      base.render.thumbnailEagerPageThreshold = 800;
      base.render.lookAheadPageCount = 4;
      base.render.lookBehindPageCount = 2;
      base.render.maxOpenPdfDocuments = 10;
      base.render.maxOpenTiffDocuments = 10;
      break;
    case 'high':
      base.fetch.prefetchConcurrency = 4;
      base.fetch.prefetchRetryCount = 0;
      base.fetch.prefetchRetryBaseDelayMs = 750;
      base.fetch.prefetchRequestTimeoutMs = 10000;
      base.sourceStore.switchToIndexedDbAboveSourceCount = 0;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 1536;
      base.sourceStore.blobCacheEntries = 18;
      base.assetStore.switchToIndexedDbAboveAssetCount = 0;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 3072;
      base.assetStore.blobCacheEntries = 24;
      base.render.maxConcurrentAssetRenders = 3;
      base.render.fullPageCacheLimit = 120;
      base.render.thumbnailCacheLimit = 1024;
      base.render.thumbnailEagerPageThreshold = 600;
      base.render.lookAheadPageCount = 3;
      base.render.lookBehindPageCount = 2;
      base.render.maxOpenPdfDocuments = 8;
      base.render.maxOpenTiffDocuments = 8;
      break;
    case 'medium':
      base.fetch.prefetchConcurrency = 4;
      base.fetch.prefetchRetryCount = 0;
      base.fetch.prefetchRetryBaseDelayMs = 750;
      base.fetch.prefetchRequestTimeoutMs = 10000;
      base.sourceStore.switchToIndexedDbAboveSourceCount = 0;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 1024;
      base.sourceStore.blobCacheEntries = 14;
      base.assetStore.switchToIndexedDbAboveAssetCount = 0;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 2048;
      base.assetStore.blobCacheEntries = 20;
      base.render.maxConcurrentAssetRenders = 2;
      base.render.fullPageCacheLimit = 80;
      base.render.thumbnailCacheLimit = 640;
      base.render.thumbnailEagerPageThreshold = 360;
      base.render.maxOpenPdfDocuments = 7;
      base.render.maxOpenTiffDocuments = 7;
      break;
    case 'low':
      base.fetch.prefetchConcurrency = 1;
      base.fetch.prefetchRetryCount = 0;
      base.fetch.prefetchRetryBaseDelayMs = 750;
      base.fetch.prefetchRequestTimeoutMs = 10000;
      base.sourceStore.switchToIndexedDbAboveSourceCount = 0;
      base.sourceStore.switchToIndexedDbAboveTotalMiB = 256;
      base.sourceStore.blobCacheEntries = 8;
      base.assetStore.switchToIndexedDbAboveAssetCount = 0;
      base.assetStore.switchToIndexedDbAboveTotalMiB = 512;
      base.assetStore.blobCacheEntries = 8;
      base.render.maxConcurrentAssetRenders = 1;
      base.render.fullPageCacheLimit = 16;
      base.render.thumbnailCacheLimit = 128;
      base.render.thumbnailEagerPageThreshold = 120;
      base.render.lookAheadPageCount = 1;
      base.render.lookBehindPageCount = 1;
      base.render.maxOpenPdfDocuments = 3;
      base.render.maxOpenTiffDocuments = 3;
      break;
    default:
      break;
  }

  return base;
}

/**
 * Normalize runtime config under `window.__ODV_CONFIG__.documentLoading`.
 *
 * @param {Object=} runtimeConfig
 * @returns {DocumentLoadingConfig}
 */
export function getDocumentLoadingConfig(runtimeConfig = getRuntimeConfig()) {
  const raw = runtimeConfig?.documentLoading || {};
  const adaptiveDefaults = buildAdaptiveDefaults(raw?.adaptiveMemory);

  return {
    adaptiveMemory: {
      enabled: normalizeBoolean(raw?.adaptiveMemory?.enabled, adaptiveDefaults.adaptiveMemory.enabled),
      preferPerformanceWhenDeviceMemoryAtLeastGb: normalizeFloat(
        raw?.adaptiveMemory?.preferPerformanceWhenDeviceMemoryAtLeastGb,
        adaptiveDefaults.adaptiveMemory.preferPerformanceWhenDeviceMemoryAtLeastGb,
        1,
        1024
      ),
      preferPerformanceWhenJsHeapLimitAtLeastMiB: normalizeFloat(
        raw?.adaptiveMemory?.preferPerformanceWhenJsHeapLimitAtLeastMiB,
        adaptiveDefaults.adaptiveMemory.preferPerformanceWhenJsHeapLimitAtLeastMiB,
        256,
        1024 * 1024
      ),
      reuseFullImageThumbnailsBelowPageCount: normalizeNumber(
        raw?.adaptiveMemory?.reuseFullImageThumbnailsBelowPageCount,
        adaptiveDefaults.adaptiveMemory.reuseFullImageThumbnailsBelowPageCount,
        1,
        1000000
      ),
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
      prefetchConcurrency: normalizeNumber(raw?.fetch?.prefetchConcurrency, adaptiveDefaults.fetch.prefetchConcurrency, 1, 16),
      prefetchRetryCount: normalizeNumber(raw?.fetch?.prefetchRetryCount, adaptiveDefaults.fetch.prefetchRetryCount, 0, 5),
      prefetchRetryBaseDelayMs: normalizeNumber(raw?.fetch?.prefetchRetryBaseDelayMs, adaptiveDefaults.fetch.prefetchRetryBaseDelayMs, 100, 60000),
      prefetchRequestTimeoutMs: normalizeNumber(raw?.fetch?.prefetchRequestTimeoutMs, adaptiveDefaults.fetch.prefetchRequestTimeoutMs, 1000, 120000),
    },
    sourceStore: {
      mode: normalizeStoreMode(raw?.sourceStore?.mode, adaptiveDefaults.sourceStore.mode),
      switchToIndexedDbAboveSourceCount: normalizeThreshold(raw?.sourceStore?.switchToIndexedDbAboveSourceCount, adaptiveDefaults.sourceStore.switchToIndexedDbAboveSourceCount, 1000000),
      switchToIndexedDbAboveTotalMiB: normalizeMiBThreshold(raw?.sourceStore?.switchToIndexedDbAboveTotalMiB, adaptiveDefaults.sourceStore.switchToIndexedDbAboveTotalMiB, 1048576),
      protection: normalizeProtection(raw?.sourceStore?.protection, adaptiveDefaults.sourceStore.protection),
      staleSessionTtlMs: normalizeNumber(raw?.sourceStore?.staleSessionTtlMs, adaptiveDefaults.sourceStore.staleSessionTtlMs, 1000, 365 * 24 * 60 * 60 * 1000),
      blobCacheEntries: normalizeNumber(raw?.sourceStore?.blobCacheEntries, adaptiveDefaults.sourceStore.blobCacheEntries, 1, 64),
    },
    assetStore: {
      enabled: normalizeBoolean(raw?.assetStore?.enabled, adaptiveDefaults.assetStore.enabled),
      mode: normalizeStoreMode(raw?.assetStore?.mode, adaptiveDefaults.assetStore.mode),
      switchToIndexedDbAboveAssetCount: normalizeThreshold(raw?.assetStore?.switchToIndexedDbAboveAssetCount, adaptiveDefaults.assetStore.switchToIndexedDbAboveAssetCount, 1000000),
      switchToIndexedDbAboveTotalMiB: normalizeMiBThreshold(raw?.assetStore?.switchToIndexedDbAboveTotalMiB, adaptiveDefaults.assetStore.switchToIndexedDbAboveTotalMiB, 1048576),
      protection: normalizeProtection(raw?.assetStore?.protection, adaptiveDefaults.assetStore.protection),
      staleSessionTtlMs: normalizeNumber(raw?.assetStore?.staleSessionTtlMs, adaptiveDefaults.assetStore.staleSessionTtlMs, 1000, 365 * 24 * 60 * 60 * 1000),
      blobCacheEntries: normalizeNumber(raw?.assetStore?.blobCacheEntries, adaptiveDefaults.assetStore.blobCacheEntries, 1, 256),
      persistThumbnails: normalizeBoolean(raw?.assetStore?.persistThumbnails, adaptiveDefaults.assetStore.persistThumbnails),
      releaseSinglePageRasterSourceAfterFullPersist: normalizeBoolean(raw?.assetStore?.releaseSinglePageRasterSourceAfterFullPersist, adaptiveDefaults.assetStore.releaseSinglePageRasterSourceAfterFullPersist),
    },
    render: {
      maxConcurrentAssetRenders: normalizeNumber(raw?.render?.maxConcurrentAssetRenders, adaptiveDefaults.render.maxConcurrentAssetRenders, 1, 8),
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
      thumbnailCacheLimit: normalizeNumber(raw?.render?.thumbnailCacheLimit, adaptiveDefaults.render.thumbnailCacheLimit, 1, 8192),
      maxOpenPdfDocuments: normalizeNumber(raw?.render?.maxOpenPdfDocuments, adaptiveDefaults.render.maxOpenPdfDocuments, 1, 64),
      maxOpenTiffDocuments: normalizeNumber(raw?.render?.maxOpenTiffDocuments, adaptiveDefaults.render.maxOpenTiffDocuments, 1, 64),
    },
  };
}

/**
 * @param {*} value
 * @returns {boolean}
 */
export function isRasterImageExtension(value) {
  const ext = String(value || '').trim().toLowerCase();
  return ext === 'jpg'
    || ext === 'jpeg'
    || ext === 'png'
    || ext === 'gif'
    || ext === 'webp'
    || ext === 'bmp'
    || ext === 'avif';
}

/**
 * @param {DocumentLoadingConfig} config
 * @param {*} page
 * @param {number} totalPages
 * @returns {boolean}
 */
export function shouldUseFullImagesForThumbnails(config, page, totalPages) {
  const strategy = String(config?.render?.thumbnailSourceStrategy || 'auto').toLowerCase();
  if (strategy === 'dedicated') return false;
  if (!isRasterImageExtension(page?.fileExtension)) return false;
  if (strategy === 'prefer-full-images') return true;

  const preferPerformance = !!config?.adaptiveMemory?.preferPerformance;
  const limit = Math.max(1, Number(config?.adaptiveMemory?.reuseFullImageThumbnailsBelowPageCount) || 1);
  return preferPerformance && totalPages > 0 && totalPages <= limit;
}

/**
 * @param {DocumentLoadingConfig} config
 * @param {Array<any>} pages
 * @returns {boolean}
 */
export function shouldKeepAllFullImageAssets(config, pages) {
  const list = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (!list.length) return false;
  const totalPages = list.length;
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
  config = getDocumentLoadingConfig(),
}) {
  const sourceThreshold = Math.max(0, Number(config.warning.minStopRecommendationSources) || 0);
  const pageThreshold = Math.max(0, Number(config.warning.minStopRecommendationPages) || 0);
  return (
    (sourceThreshold > 0 && Math.max(0, Number(sourceCount) || 0) >= sourceThreshold)
    || (pageThreshold > 0 && Math.max(0, Number(pageCount) || 0) >= pageThreshold)
  );
}