// File: src/utils/supportDiagnostics.js
/**
 * Support diagnostics helpers for opt-in troubleshooting tools.
 */

import { getRuntimeConfig } from './runtimeConfig.js';
import { createPdfPrebuildAllPagesVariants } from './pdfPrebuildPlan.js';
import { getPdfPrintCacheKeyOptions } from './pdfPrintCacheKey.js';

// The .v1 suffix is part of the local diagnostics storage contract. Future
// incompatible payloads should use a new key; old entries are tiny,
// best-effort support data and do not require migration.
const LATEST_PDF_BENCHMARK_KEY = 'odv.pdfBenchmark.latest.v1';
const LATEST_RENDER_DECODE_BENCHMARK_KEY = 'odv.renderDecodeBenchmark.latest.v1';

/**
 * @returns {string}
 */
function resolveAppVersion() {
  return String(
    (typeof window !== 'undefined' && (window.__ODV_APP_VERSION__ || window.__APP_VERSION__))
      || (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_APP_VERSION || import.meta.env.APP_VERSION))
      || 'unknown'
  );
}

/**
 * @returns {string}
 */
function resolveBuildId() {
  return String(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ODV_BUILD_ID)
      || ''
  ).trim();
}

/**
 * @returns {Object}
 */
function collectNavigatorDiagnostics() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return {
    userAgent: String(nav?.userAgent || ''),
    language: String(nav?.language || ''),
    languages: Array.isArray(nav?.languages) ? nav.languages.slice(0, 8) : [],
    hardwareConcurrency: Number(nav?.hardwareConcurrency || 0) || 0,
    deviceMemoryGb: Number(nav?.deviceMemory || 0) || 0,
    platform: String(nav?.platform || ''),
  };
}

/**
 * @returns {Object}
 */
function collectLocationDiagnostics() {
  if (typeof window === 'undefined') return {};
  return {
    origin: String(window.location?.origin || ''),
    pathname: String(window.location?.pathname || ''),
    searchPresent: !!window.location?.search,
    hashPresent: !!window.location?.hash,
  };
}

/**
 * @returns {Object}
 */
function collectConfigDiagnostics() {
  const cfg = getRuntimeConfig();
  const pdf = cfg?.print?.pdf || {};
  const benchmark = pdf?.benchmark || {};
  const prebuildPlan = createPdfPrebuildAllPagesVariants(cfg, 'current');
  const pdfCacheOptions = getPdfPrintCacheKeyOptions(cfg);
  const loading = cfg?.documentLoading || {};
  const render = loading?.render || {};
  const renderBenchmark = loading?.renderBenchmark || {};
  return {
    printPdf: {
      enabled: pdf.enabled === true,
      workerEnabled: pdf.workerEnabled !== false,
      workerPageThreshold: Number(pdf.workerPageThreshold || 0) || 0,
      partialMergeEnabled: pdf.partialMergeEnabled !== false,
      workerCount: Number(pdf.workerCount || 0) || 0,
      workerBatchSize: Number(pdf.workerBatchSize || 0) || 0,
      imageLoadConcurrency: Number(pdf.imageLoadConcurrency || 0) || 0,
      benchmarkEnabled: benchmark.enabled === true,
      benchmarkProfile: String(benchmark.profile || ''),
      benchmarkStrategies: Array.isArray(benchmark.strategies) ? benchmark.strategies.slice(0, 12) : [],
      benchmarkWorkerCounts: Array.isArray(benchmark.workerCounts) ? benchmark.workerCounts.slice(0, 32) : [],
      benchmarkImageLoadConcurrencies: Array.isArray(benchmark.imageLoadConcurrencies)
        ? benchmark.imageLoadConcurrencies.slice(0, 32)
        : [],
      benchmarkBatchCounts: Array.isArray(benchmark.batchCounts) ? benchmark.batchCounts.slice(0, 16) : [],
      benchmarkMergeModes: Array.isArray(benchmark.mergeModes) ? benchmark.mergeModes.slice(0, 12) : [],
      benchmarkMaxRuns: Number(benchmark.maxRuns || 0) || 0,
      cacheLanguageMode: pdfCacheOptions.languageMode,
      prebuildAllPages: {
        enabled: prebuildPlan.enabled === true,
        languages: prebuildPlan.config.languages,
        copyMarkerStates: prebuildPlan.config.copyMarkerStates,
        maxPages: prebuildPlan.config.maxPages,
        maxVariants: prebuildPlan.config.maxVariants,
        concurrency: prebuildPlan.config.concurrency,
        plannedVariantCount: prebuildPlan.variants.length,
        plannedVariantKeys: prebuildPlan.variants.map((variant) => variant.key).slice(0, 32),
      },
    },
    documentLoading: {
      mode: String(loading.mode || ''),
      renderStrategy: String(render.strategy || ''),
      renderBackend: String(render.backend || ''),
      workerCount: Number(render.workerCount || 0) || 0,
      useWorkersForRasterImages: render.useWorkersForRasterImages !== false,
      useWorkersForTiff: render.useWorkersForTiff !== false,
      renderBenchmarkEnabled: renderBenchmark.enabled === true,
      renderBenchmarkVariants: Array.isArray(renderBenchmark.variants) ? renderBenchmark.variants.slice(0, 12) : [],
      renderBenchmarkSampleMode: String(renderBenchmark.sampleMode || ''),
      renderBenchmarkWorkerCounts: Array.isArray(renderBenchmark.workerCounts)
        ? renderBenchmark.workerCounts.slice(0, 32)
        : [],
      renderBenchmarkMaxRuns: Number(renderBenchmark.maxRuns || 0) || 0,
    },
  };
}

/**
 * @param {string} storageKey
 * @returns {Object|null}
 */
function loadLatestBenchmarkResult(storageKey) {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(storageKey)
      : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Object|null}
 */
export function loadLatestPdfBenchmarkResult() {
  return loadLatestBenchmarkResult(LATEST_PDF_BENCHMARK_KEY);
}

/**
 * @param {Object} result
 * @returns {void}
 */
export function saveLatestPdfBenchmarkResult(result) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LATEST_PDF_BENCHMARK_KEY, JSON.stringify(result));
  } catch {
    // Diagnostics persistence is best-effort only.
  }
}

/**
 * @returns {Object|null}
 */
export function loadLatestRenderDecodeBenchmarkResult() {
  return loadLatestBenchmarkResult(LATEST_RENDER_DECODE_BENCHMARK_KEY);
}

/**
 * @param {Object} result
 * @returns {void}
 */
export function saveLatestRenderDecodeBenchmarkResult(result) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LATEST_RENDER_DECODE_BENCHMARK_KEY, JSON.stringify(result));
  } catch {
    // Diagnostics persistence is best-effort only.
  }
}

/**
 * @param {Object=} extra
 * @returns {Object}
 */
export function collectSupportDiagnostics(extra = {}) {
  const hasLatestPdfBenchmark = Object.prototype.hasOwnProperty.call(extra, 'latestPdfBenchmark');
  const hasLatestRenderDecodeBenchmark = Object.prototype.hasOwnProperty.call(extra, 'latestRenderDecodeBenchmark');
  return {
    schema: 'opendocviewer.support-diagnostics.v1',
    createdUtc: new Date().toISOString(),
    app: {
      version: resolveAppVersion(),
      buildId: resolveBuildId(),
    },
    navigator: collectNavigatorDiagnostics(),
    location: collectLocationDiagnostics(),
    config: collectConfigDiagnostics(),
    latestPdfBenchmark: hasLatestPdfBenchmark
      ? extra.latestPdfBenchmark
      : loadLatestPdfBenchmarkResult(),
    latestRenderDecodeBenchmark: hasLatestRenderDecodeBenchmark
      ? extra.latestRenderDecodeBenchmark
      : loadLatestRenderDecodeBenchmarkResult(),
    extra: extra.extra || undefined,
  };
}

/**
 * @param {string} filename
 * @param {*} payload
 * @returns {boolean}
 */
export function downloadJsonFile(filename, payload) {
  if (
    typeof document === 'undefined'
    || !document.body
    || typeof Blob === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }

  let url = '';
  try {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'opendocviewer-diagnostics.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    const revokeUrl = () => URL.revokeObjectURL(url);
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(revokeUrl, 30 * 1000);
    } else if (typeof setTimeout === 'function') {
      setTimeout(revokeUrl, 30 * 1000);
    } else {
      revokeUrl();
    }
    return true;
  } catch {
    if (url && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
    return false;
  }
}
