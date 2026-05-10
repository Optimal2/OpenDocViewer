// File: src/utils/renderDecodeBenchmark.js
/**
 * Opt-in render/decode benchmark tooling for the already loaded document session.
 *
 * The benchmark uses the same original source blobs that the viewer loaded into its temporary
 * store, but it renders through an isolated PageAssetRenderer instance so support tests do not
 * overwrite the visible page cache or mutate the current viewer state.
 */

import logger from '../logging/systemLogger.js';
import { createPageAssetRenderer } from './pageAssetRenderer.js';
import { getDocumentLoadingConfig, resolveRecommendedWorkerCount } from './documentLoadingConfig.js';
import { collectSupportDiagnostics, saveLatestRenderDecodeBenchmarkResult } from './supportDiagnostics.js';

const DEFAULT_PAGE_LIMIT = 120;
const DEFAULT_ITERATIONS = 1;
const DEFAULT_WORKER_COUNTS = Object.freeze([0]);
const DEFAULT_VARIANTS = Object.freeze(['full']);
const DEFAULT_MAX_RUNS = 40;
const DEFAULT_DELAY_BETWEEN_RUNS_MS = 150;
const MAX_RENDER_BENCHMARK_WORKER_COUNT = 32;
const MAX_RENDER_BENCHMARK_PAGE_LIMIT = 1000;
const RENDER_VARIANTS = Object.freeze(['full', 'thumbnail']);

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
 * @param {Array<number>} fallback
 * @returns {Array<number>}
 */
function normalizeWorkerCounts(value, fallback = DEFAULT_WORKER_COUNTS) {
  const raw = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(0, Math.min(MAX_RENDER_BENCHMARK_WORKER_COUNT, Math.floor(Number(item) || 0)));
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : fallback.slice();
}

/**
 * @param {*} value
 * @returns {Array<string>}
 */
function normalizeVariants(value) {
  const raw = Array.isArray(value) ? value : DEFAULT_VARIANTS;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = String(item || '').trim().toLowerCase();
    if (!RENDER_VARIANTS.includes(next) || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : DEFAULT_VARIANTS.slice();
}

/**
 * @param {Object=} config
 * @returns {{enabled:boolean,pageLimit:number,iterations:number,workerCounts:Array<number>,variants:Array<string>,maxRuns:number,delayBetweenRunsMs:number}}
 */
function normalizeRenderBenchmarkConfig(config = {}) {
  const cfg = config?.documentLoading?.renderBenchmark || {};
  return {
    enabled: cfg.enabled === true,
    pageLimit: normalizeInteger(cfg.pageLimit, DEFAULT_PAGE_LIMIT, 1, MAX_RENDER_BENCHMARK_PAGE_LIMIT),
    iterations: normalizeInteger(cfg.iterations, DEFAULT_ITERATIONS, 1, 10),
    workerCounts: normalizeWorkerCounts(cfg.workerCounts),
    variants: normalizeVariants(cfg.variants),
    maxRuns: normalizeInteger(cfg.maxRuns, DEFAULT_MAX_RUNS, 1, 200),
    delayBetweenRunsMs: normalizeInteger(cfg.delayBetweenRunsMs, DEFAULT_DELAY_BETWEEN_RUNS_MS, 0, 10000),
  };
}

/**
 * @param {Object=} config
 * @returns {boolean}
 */
export function isRenderDecodeBenchmarkEnabled(config = {}) {
  return normalizeRenderBenchmarkConfig(config).enabled;
}

/**
 * @param {number} ms
 * @param {AbortSignal=} signal
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  const duration = Math.max(0, Number(ms) || 0);
  if (duration <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      const error = new Error('Render/decode benchmark was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, duration);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * @param {AbortSignal=} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Render/decode benchmark was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/**
 * @param {Array<*>} pages
 * @param {number} limit
 * @returns {Array<Object>}
 */
function selectBenchmarkPages(pages, limit) {
  const selected = [];
  const max = Math.max(1, Number(limit) || DEFAULT_PAGE_LIMIT);
  const source = Array.isArray(pages) ? pages : [];
  for (let index = 0; index < source.length && selected.length < max; index += 1) {
    const page = source[index] || null;
    const sourceKey = String(page?.sourceKey || '').trim();
    const fileExtension = String(page?.fileExtension || '').trim().toLowerCase();
    if (!page || page.status === -1 || !sourceKey || !fileExtension) continue;
    selected.push({
      originalPageIndex: index,
      sourceKey,
      fileExtension,
      fileIndex: Number.isFinite(page.fileIndex) ? Number(page.fileIndex) : 0,
      pageIndex: Math.max(0, Number(page.pageIndex) || 0),
      sourceSizeBytes: Math.max(0, Number(page.sourceSizeBytes) || 0),
    });
  }
  return selected;
}

/**
 * @param {Array<Object>} scenarios
 * @param {Set<string>} seen
 * @param {Object} scenario
 * @returns {void}
 */
function addScenario(scenarios, seen, scenario) {
  const normalized = {
    variant: RENDER_VARIANTS.includes(String(scenario?.variant || '').toLowerCase())
      ? String(scenario.variant).toLowerCase()
      : 'full',
    workerCount: Math.max(0, Math.min(MAX_RENDER_BENCHMARK_WORKER_COUNT, Math.floor(Number(scenario?.workerCount) || 0))),
  };
  const key = `${normalized.variant}|${normalized.workerCount}`;
  if (seen.has(key)) return;
  seen.add(key);
  const workerLabel = normalized.workerCount === 0 ? 'auto' : String(normalized.workerCount);
  scenarios.push({
    ...normalized,
    scenarioLabel: `${normalized.variant}/w${workerLabel}`,
  });
}

/**
 * @param {Object} benchmarkCfg
 * @returns {{scenarios:Array<Object>, totalScenarioCount:number}}
 */
function createScenarios(benchmarkCfg) {
  const scenarios = [];
  const seen = new Set();
  for (const variant of benchmarkCfg.variants) {
    for (const workerCount of benchmarkCfg.workerCounts) {
      addScenario(scenarios, seen, { variant, workerCount });
    }
  }
  return {
    scenarios: scenarios.slice(0, benchmarkCfg.maxRuns),
    totalScenarioCount: scenarios.length,
  };
}

/**
 * @param {Array<*>} items
 * @param {number} concurrency
 * @param {function(*, number): Promise<*>} runItem
 * @param {AbortSignal=} signal
 * @returns {Promise<Array<*>>}
 */
async function runLimited(items, concurrency, runItem, signal) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const workerCount = Math.max(1, Math.min(list.length, Math.floor(Number(concurrency) || 1)));
  const results = new Array(list.length);
  let nextIndex = 0;

  const runLoop = async () => {
    while (nextIndex < list.length) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      nextIndex += 1;
      results[itemIndex] = await runItem(list[itemIndex], itemIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runLoop()));
  return results;
}

/**
 * @param {Array<Object>} taskResults
 * @returns {Object}
 */
function summarizeByExtension(taskResults) {
  const byExtension = {};
  for (const result of taskResults) {
    const ext = String(result?.fileExtension || 'unknown');
    const current = byExtension[ext] || {
      count: 0,
      successCount: 0,
      errorCount: 0,
      totalMs: 0,
      outputBytes: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
    };
    const duration = Math.max(0, Number(result?.durationMs) || 0);
    current.count += 1;
    current.totalMs += duration;
    current.outputBytes += Math.max(0, Number(result?.outputBytes) || 0);
    if (result?.ok) current.successCount += 1;
    else current.errorCount += 1;
    current.minMs = current.minMs ? Math.min(current.minMs, duration) : duration;
    current.maxMs = Math.max(current.maxMs, duration);
    current.avgMs = current.count ? Math.round(current.totalMs / current.count) : 0;
    byExtension[ext] = current;
  }
  return byExtension;
}

/**
 * @param {Object} args
 * @param {Array<Object>} args.pages
 * @param {Object} args.scenario
 * @param {Object} args.viewerContext
 * @param {Object} args.baseRenderConfig
 * @param {number} args.completedRuns
 * @param {number} args.totalRuns
 * @param {function(Object): void=} args.onProgress
 * @param {AbortSignal=} args.signal
 * @returns {Promise<Object>}
 */
async function runScenario(args) {
  const scenario = args.scenario;
  const requestedWorkerCount = Math.max(0, Number(scenario.workerCount) || 0);
  const resolvedWorkerCount = requestedWorkerCount > 0
    ? requestedWorkerCount
    : resolveRecommendedWorkerCount(0, 'auto');
  const renderConfig = {
    ...(args.baseRenderConfig || {}),
    workerCount: resolvedWorkerCount,
  };
  const tempStore = {
    getBlob: (sourceKey) => args.viewerContext.readSourceBlob?.(sourceKey),
    getArrayBuffer: async (sourceKey) => {
      const direct = await args.viewerContext.readSourceArrayBuffer?.(sourceKey);
      if (direct) return direct;
      const blob = await args.viewerContext.readSourceBlob?.(sourceKey);
      return blob ? blob.arrayBuffer() : null;
    },
  };
  const renderer = createPageAssetRenderer({ tempStore, config: renderConfig });
  const concurrency = Math.max(
    1,
    Math.min(
      args.pages.length,
      resolvedWorkerCount || Number(renderConfig.maxConcurrentAssetRenders) || 1
    )
  );
  const startedAt = performance.now();
  let completed = 0;

  try {
    const taskResults = await runLimited(args.pages, concurrency, async (page, taskIndex) => {
      throwIfAborted(args.signal);
      const taskStart = performance.now();
      try {
        const rendered = await renderer.renderPageAsset(page, {
          variant: scenario.variant,
          thumbnailMaxWidth: renderConfig.thumbnailMaxWidth,
          thumbnailMaxHeight: renderConfig.thumbnailMaxHeight,
        });
        const durationMs = Math.round(performance.now() - taskStart);
        completed += 1;
        args.onProgress?.({
          phase: 'running',
          completedRuns: args.completedRuns,
          totalRuns: args.totalRuns,
          scenarioLabel: scenario.scenarioLabel,
          renderedPages: completed,
          pageCount: args.pages.length,
        });
        return {
          ok: true,
          taskIndex,
          originalPageIndex: page.originalPageIndex,
          fileExtension: page.fileExtension,
          durationMs,
          outputBytes: Math.max(0, Number(rendered?.blob?.size) || 0),
          width: Math.max(0, Number(rendered?.width) || 0),
          height: Math.max(0, Number(rendered?.height) || 0),
          mimeType: String(rendered?.mimeType || rendered?.blob?.type || ''),
        };
      } catch (error) {
        const durationMs = Math.round(performance.now() - taskStart);
        completed += 1;
        return {
          ok: false,
          taskIndex,
          originalPageIndex: page.originalPageIndex,
          fileExtension: page.fileExtension,
          durationMs,
          error: String(error?.message || error),
        };
      }
    }, args.signal);

    const durationMs = Math.round(performance.now() - startedAt);
    const successCount = taskResults.filter((result) => result?.ok).length;
    const errorCount = taskResults.length - successCount;
    const outputBytes = taskResults.reduce((sum, result) => sum + Math.max(0, Number(result?.outputBytes) || 0), 0);
    const successfulDurations = taskResults
      .filter((result) => result?.ok)
      .map((result) => Math.max(0, Number(result.durationMs) || 0));
    const taskSummary = {
      count: taskResults.length,
      successCount,
      errorCount,
      minMs: successfulDurations.length ? Math.min(...successfulDurations) : 0,
      maxMs: successfulDurations.length ? Math.max(...successfulDurations) : 0,
      avgMs: successfulDurations.length
        ? Math.round(successfulDurations.reduce((sum, value) => sum + value, 0) / successfulDurations.length)
        : 0,
    };

    return {
      scenarioLabel: scenario.scenarioLabel,
      variant: scenario.variant,
      workerCountSetting: scenario.workerCount,
      workerCount: resolvedWorkerCount,
      concurrency,
      durationMs,
      pageCount: args.pages.length,
      successCount,
      errorCount,
      outputBytes,
      byExtension: summarizeByExtension(taskResults),
      taskSummary,
      slowestTasks: taskResults
        .slice()
        .sort((a, b) => (Number(b?.durationMs) || 0) - (Number(a?.durationMs) || 0))
        .slice(0, 10),
    };
  } finally {
    await renderer.dispose?.();
  }
}

/**
 * @param {Object} args
 * @param {Array<*>} args.allPages
 * @param {Object} args.viewerContext
 * @param {Object=} args.config
 * @param {function(Object): void=} args.onProgress
 * @param {AbortSignal=} args.signal
 * @returns {Promise<Object>}
 */
export async function runRenderDecodeBenchmark(args) {
  const benchmarkCfg = normalizeRenderBenchmarkConfig(args?.config || {});
  if (!benchmarkCfg.enabled) throw new Error('Render/decode benchmark is disabled by configuration.');
  const viewerContext = args?.viewerContext || {};
  if (typeof viewerContext.readSourceBlob !== 'function') {
    throw new Error('Render/decode benchmark requires access to the current source blob store.');
  }

  const selectedPages = selectBenchmarkPages(args?.allPages || [], benchmarkCfg.pageLimit);
  if (!selectedPages.length) throw new Error('No loaded source pages were available for render/decode benchmark.');

  const scenarioPlan = createScenarios(benchmarkCfg);
  const scenarios = scenarioPlan.scenarios;
  const totalRuns = scenarios.length * benchmarkCfg.iterations;
  const runs = [];
  const baseRenderConfig = viewerContext.documentLoadingConfig?.render
    || getDocumentLoadingConfig().render
    || {};

  for (let iteration = 1; iteration <= benchmarkCfg.iterations; iteration += 1) {
    for (const scenario of scenarios) {
      throwIfAborted(args?.signal);
      args?.onProgress?.({
        phase: 'running',
        completedRuns: runs.length,
        totalRuns,
        scenarioLabel: scenario.scenarioLabel,
      });
      const result = await runScenario({
        pages: selectedPages,
        scenario,
        viewerContext,
        baseRenderConfig,
        completedRuns: runs.length,
        totalRuns,
        onProgress: args?.onProgress,
        signal: args?.signal,
      });
      runs.push({
        ...result,
        iteration,
      });
      await delay(benchmarkCfg.delayBetweenRunsMs, args?.signal);
    }
  }

  const best = runs
    .filter((run) => run.errorCount === 0)
    .slice()
    .sort((a, b) => a.durationMs - b.durationMs)[0] || null;

  const result = {
    schema: 'opendocviewer.render-decode-benchmark.v1',
    createdUtc: new Date().toISOString(),
    pageCount: selectedPages.length,
    sourcePageCount: Array.isArray(args?.allPages) ? args.allPages.length : 0,
    pageLimit: benchmarkCfg.pageLimit,
    iterations: benchmarkCfg.iterations,
    variants: benchmarkCfg.variants,
    workerCounts: benchmarkCfg.workerCounts,
    maxRuns: benchmarkCfg.maxRuns,
    testedVariants: Array.from(new Set(scenarios.map((scenario) => scenario.variant))),
    testedWorkerCounts: Array.from(new Set(scenarios.map((scenario) => scenario.workerCount))),
    testedScenarios: scenarios,
    scenarioCount: scenarios.length,
    totalScenarioCount: scenarioPlan.totalScenarioCount,
    scenarioLimitApplied: scenarios.length < scenarioPlan.totalScenarioCount,
    runs,
    best,
    diagnostics: collectSupportDiagnostics({
      latestPdfBenchmark: null,
      latestRenderDecodeBenchmark: null,
    }),
  };

  saveLatestRenderDecodeBenchmarkResult(result);
  logger.info('Render/decode benchmark completed', {
    pageCount: selectedPages.length,
    scenarioCount: scenarios.length,
    bestScenario: best?.scenarioLabel || null,
    bestDurationMs: best?.durationMs || null,
  });
  return result;
}
