// File: src/utils/pdfBenchmark.js
/**
 * Opt-in generated-PDF benchmark tooling.
 */

import logger from '../logging/systemLogger.js';
import { collectPrintablePdfSources, createPrintPdfBlob } from './printPdf.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { collectSupportDiagnostics, saveLatestPdfBenchmarkResult } from './supportDiagnostics.js';

const DEFAULT_BATCH_SIZES = Object.freeze([0, 5, 10, 20, 40]);
const DEFAULT_PAGE_LIMIT = 80;
const DEFAULT_ITERATIONS = 1;
const DEFAULT_DELAY_BETWEEN_RUNS_MS = 150;

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalizeInteger(value, fallback, min, max) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {*} value
 * @returns {Array<number>}
 */
function normalizeBatchSizes(value) {
  const raw = Array.isArray(value) ? value : DEFAULT_BATCH_SIZES;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(0, Math.floor(Number(item) || 0));
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : DEFAULT_BATCH_SIZES.slice();
}

/**
 * @param {Object=} config
 * @returns {{enabled:boolean,pageLimit:number,iterations:number,batchSizes:Array<number>,delayBetweenRunsMs:number}}
 */
function normalizeBenchmarkConfig(config = getRuntimeConfig()) {
  const cfg = config?.print?.pdf?.benchmark || {};
  return {
    enabled: cfg.enabled === true,
    pageLimit: normalizeInteger(cfg.pageLimit, DEFAULT_PAGE_LIMIT, 1, 10000),
    iterations: normalizeInteger(cfg.iterations, DEFAULT_ITERATIONS, 1, 10),
    batchSizes: normalizeBatchSizes(cfg.batchSizes),
    delayBetweenRunsMs: normalizeInteger(cfg.delayBetweenRunsMs, DEFAULT_DELAY_BETWEEN_RUNS_MS, 0, 10000),
  };
}

/**
 * @param {Object=} config
 * @returns {boolean}
 */
export function isPdfBenchmarkEnabled(config = getRuntimeConfig()) {
  return normalizeBenchmarkConfig(config).enabled;
}

/**
 * @param {number} ms
 * @param {AbortSignal=} signal
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('PDF benchmark was cancelled.');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      window.clearTimeout(timer);
      const error = new Error('PDF benchmark was cancelled.');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

/**
 * @param {Array<string>} urls
 * @param {Object} baseOptions
 * @param {Object} config
 * @returns {{urls:Array<string>,pageContexts:Array<*>}}
 */
function selectBenchmarkPages(urls, baseOptions, config) {
  const count = Math.min(urls.length, config.pageLimit);
  return {
    urls: urls.slice(0, count),
    pageContexts: Array.isArray(baseOptions?.pageContexts)
      ? baseOptions.pageContexts.slice(0, count)
      : [],
  };
}

/**
 * @param {Object} args
 * @param {{current:*}} args.documentRenderRef
 * @param {Array<number>=} args.pageNumbers
 * @param {Object=} args.baseOptions
 * @param {Object=} args.config
 * @param {AbortSignal=} args.signal
 * @param {function(Object):void=} args.onProgress
 * @returns {Promise<Object>}
 */
export async function runPdfGenerationBenchmark({
  documentRenderRef,
  pageNumbers,
  baseOptions = {},
  config = getRuntimeConfig(),
  signal,
  onProgress,
} = {}) {
  const benchmarkCfg = normalizeBenchmarkConfig(config);
  if (!benchmarkCfg.enabled) throw new Error('PDF benchmark is disabled by configuration.');

  const sourceUrls = await collectPrintablePdfSources(documentRenderRef, pageNumbers, signal);
  const selected = selectBenchmarkPages(sourceUrls, baseOptions, benchmarkCfg);
  const basePdfCfg = baseOptions.pdfCfg || config?.print?.pdf || {};
  const runs = [];
  const totalRuns = benchmarkCfg.batchSizes.length * benchmarkCfg.iterations;
  let completedRuns = 0;

  for (const batchSize of benchmarkCfg.batchSizes) {
    for (let iteration = 1; iteration <= benchmarkCfg.iterations; iteration += 1) {
      if (signal?.aborted) {
        const error = new Error('PDF benchmark was cancelled.');
        error.name = 'AbortError';
        throw error;
      }

      onProgress?.({
        phase: 'running',
        batchSize,
        iteration,
        completedRuns,
        totalRuns,
      });

      const pdfCfg = {
        ...basePdfCfg,
        workerEnabled: true,
        workerPageThreshold: 1,
        partialMergeEnabled: true,
        workerBatchSize: batchSize,
      };
      const started = performance.now();
      const blob = await createPrintPdfBlob(selected.urls, {
        ...baseOptions,
        pageContexts: selected.pageContexts,
        pdfCfg,
        signal,
        onProgress: undefined,
      });
      const durationMs = performance.now() - started;
      runs.push({
        batchSize,
        batchSizeLabel: batchSize === 0 ? 'auto' : String(batchSize),
        iteration,
        durationMs: Math.round(durationMs),
        outputBytes: Math.max(0, Number(blob?.size) || 0),
      });
      completedRuns += 1;
      onProgress?.({
        phase: 'completed-run',
        batchSize,
        iteration,
        completedRuns,
        totalRuns,
      });
      await delay(benchmarkCfg.delayBetweenRunsMs, signal);
    }
  }

  const best = runs.slice().sort((a, b) => a.durationMs - b.durationMs)[0] || null;
  const result = {
    schema: 'opendocviewer.pdf-benchmark.v1',
    createdUtc: new Date().toISOString(),
    pageCount: selected.urls.length,
    sourcePageCount: sourceUrls.length,
    pageLimit: benchmarkCfg.pageLimit,
    iterations: benchmarkCfg.iterations,
    batchSizes: benchmarkCfg.batchSizes,
    runs,
    best,
    diagnostics: collectSupportDiagnostics({ latestPdfBenchmark: null }),
  };

  saveLatestPdfBenchmarkResult(result);
  logger.info('PDF benchmark completed', {
    pageCount: result.pageCount,
    runCount: runs.length,
    bestBatchSize: best?.batchSizeLabel || null,
    bestDurationMs: best?.durationMs || null,
  });
  onProgress?.({ phase: 'done', completedRuns, totalRuns, result });
  return result;
}
