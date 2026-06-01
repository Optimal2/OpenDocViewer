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
import { createPdfPageWorkerPool } from './pdfPageWorkerPool.js';
import { getDocumentLoadingConfig, resolveRecommendedWorkerCount } from './documentLoadingConfig.js';
import { collectSupportDiagnostics, saveLatestRenderDecodeBenchmarkResult } from './supportDiagnostics.js';

const DEFAULT_PAGE_LIMIT = 120;
const DEFAULT_ITERATIONS = 1;
const DEFAULT_WORKER_COUNTS = Object.freeze([0, 1, 2, 3, 4, 6, 8]);
const DEFAULT_VARIANTS = Object.freeze(['full']);
const DEFAULT_PDF_TO_IMAGE_MODES = Object.freeze(['current']);
const DEFAULT_MAX_RUNS = 40;
const DEFAULT_DELAY_BETWEEN_RUNS_MS = 150;
const DEFAULT_SAMPLE_MODE = 'evenly-spaced';
const DEFAULT_TASK_TIMEOUT_MS = 90 * 1000;
const MAX_RENDER_BENCHMARK_WORKER_COUNT = 32;
const MAX_RENDER_BENCHMARK_MAIN_THREAD_CONCURRENCY = 32;
const MAX_RENDER_BENCHMARK_PAGE_LIMIT = 1000;
const MAX_RENDER_BENCHMARK_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const RENDER_VARIANTS = Object.freeze(['full', 'thumbnail']);
const PDF_TO_IMAGE_MODES = Object.freeze(['current', 'main-thread', 'worker']);
const SAMPLE_MODES = Object.freeze(['first', 'evenly-spaced']);
const DEFAULT_MAIN_THREAD_CONCURRENCIES = Object.freeze([1, 2, 3, 4, 5, 6, 8]);
const DEFAULT_MAIN_THREAD_CORE_MULTIPLIERS = Object.freeze([0.5, 0.75, 1]);
const DEFAULT_WORKER_CORE_MULTIPLIERS = Object.freeze([0.25, 0.5, 1]);
const DEFAULT_PDF_WORKER_PAGE_TARGETS = Object.freeze([50, 100, 200]);
const DEFAULT_PDF_WORKER_RENDERS_PER_WORKER = Object.freeze([1]);
const PDF_WORKER_BATCH_MODES = Object.freeze(['queue', 'partitioned']);

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
 * @param {Array<number>} fallback
 * @param {number} max
 * @returns {Array<number>}
 */
function normalizePositiveNumberList(value, fallback, max) {
  const raw = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(1, Math.min(max, Math.floor(Number(item) || 0)));
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : fallback.slice();
}

/**
 * @param {*} value
 * @param {Array<number>} fallback
 * @returns {Array<number>}
 */
function normalizeMultiplierList(value, fallback) {
  const raw = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(0, Math.min(4, Number(item) || 0));
    if (next <= 0) continue;
    const key = next.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out.length ? out : fallback.slice();
}

/**
 * @param {*} value
 * @returns {Array<number>}
 */
function normalizeMainThreadConcurrencies(value) {
  return normalizePositiveNumberList(
    value,
    DEFAULT_MAIN_THREAD_CONCURRENCIES,
    MAX_RENDER_BENCHMARK_MAIN_THREAD_CONCURRENCY
  );
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
 * @param {*} value
 * @returns {Array<'current'|'main-thread'|'worker'>}
 */
function normalizePdfToImageModes(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (value.trim().toLowerCase() === 'compare' ? ['main-thread', 'worker'] : [value])
      : DEFAULT_PDF_TO_IMAGE_MODES;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const normalized = String(item || '').trim().toLowerCase().replace(/_/g, '-');
    const next = normalized === 'main' || normalized === 'mainthread'
      ? 'main-thread'
      : normalized === 'workers' || normalized === 'offscreen-worker'
        ? 'worker'
        : normalized;
    if (!PDF_TO_IMAGE_MODES.includes(next) || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : DEFAULT_PDF_TO_IMAGE_MODES.slice();
}

/**
 * @param {*} value
 * @returns {'queue'|'partitioned'}
 */
function normalizePdfWorkerBatchMode(value) {
  const text = String(value || 'queue').trim().toLowerCase();
  return PDF_WORKER_BATCH_MODES.includes(text) ? text : 'queue';
}

/**
 * @param {*} value
 * @returns {'first'|'evenly-spaced'}
 */
function normalizeSampleMode(value) {
  const text = String(value || DEFAULT_SAMPLE_MODE).trim().toLowerCase();
  return SAMPLE_MODES.includes(text) ? text : DEFAULT_SAMPLE_MODE;
}

/**
 * @returns {number}
 */
function getHardwareConcurrency() {
  try {
    return Math.max(1, Math.floor(Number(globalThis.navigator?.hardwareConcurrency) || 2));
  } catch {
    return 2;
  }
}

/**
 * @param {Array<number>} values
 * @param {Array<number>} additions
 * @param {number} max
 * @returns {Array<number>}
 */
function mergePositiveCounts(values, additions, max) {
  const out = [];
  const seen = new Set();
  for (const item of [...(values || []), ...(additions || [])]) {
    const next = Math.max(1, Math.min(max, Math.floor(Number(item) || 0)));
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/**
 * @param {number} baseCount
 * @param {Array<number>} multipliers
 * @param {number} max
 * @returns {Array<number>}
 */
function deriveCountsFromMultipliers(baseCount, multipliers, max) {
  const base = Math.max(1, Math.floor(Number(baseCount) || 1));
  return (Array.isArray(multipliers) ? multipliers : [])
    .map((multiplier) => Math.max(1, Math.round(base * (Number(multiplier) || 0))))
    .filter((value) => value > 0 && value <= max);
}

/**
 * @param {number} pageCount
 * @param {Array<number>} targets
 * @param {number} max
 * @returns {Array<number>}
 */
function deriveWorkerCountsFromPageTargets(pageCount, targets, max) {
  const pages = Math.max(1, Math.floor(Number(pageCount) || 1));
  return (Array.isArray(targets) ? targets : [])
    .map((target) => Math.ceil(pages / Math.max(1, Number(target) || 1)))
    .filter((value) => value > 0 && value <= max);
}

/**
 * @param {Object=} config
 * @returns {{enabled:boolean,pageLimit:number,iterations:number,workerCounts:Array<number>,includeAutoWorkerCount:boolean,mainThreadConcurrencies:Array<number>,mainThreadCoreMultipliers:Array<number>,workerCoreMultipliers:Array<number>,pdfWorkerPageTargets:Array<number>,pdfWorkerBatchMode:string,pdfWorkerRendersPerWorker:Array<number>,variants:Array<string>,pdfToImageModes:Array<string>,sampleMode:string,maxRuns:number,delayBetweenRunsMs:number,taskTimeoutMs:number}}
 */
function normalizeRenderBenchmarkConfig(config = {}) {
  const cfg = config?.documentLoading?.renderBenchmark || {};
  return {
    enabled: cfg.enabled === true,
    pageLimit: normalizeInteger(cfg.pageLimit, DEFAULT_PAGE_LIMIT, 1, MAX_RENDER_BENCHMARK_PAGE_LIMIT),
    iterations: normalizeInteger(cfg.iterations, DEFAULT_ITERATIONS, 1, 10),
    workerCounts: normalizeWorkerCounts(cfg.workerCounts),
    includeAutoWorkerCount: cfg.includeAutoWorkerCount !== false,
    mainThreadConcurrencies: normalizeMainThreadConcurrencies(
      cfg.mainThreadConcurrencies || cfg.mainThreadConcurrency || cfg.mainThreadCounts
    ),
    mainThreadCoreMultipliers: normalizeMultiplierList(
      cfg.mainThreadCoreMultipliers,
      DEFAULT_MAIN_THREAD_CORE_MULTIPLIERS
    ),
    workerCoreMultipliers: normalizeMultiplierList(cfg.workerCoreMultipliers, DEFAULT_WORKER_CORE_MULTIPLIERS),
    pdfWorkerPageTargets: normalizePositiveNumberList(
      cfg.pdfWorkerPageTargets || cfg.pdfWorkerPagesPerWorker,
      DEFAULT_PDF_WORKER_PAGE_TARGETS,
      MAX_RENDER_BENCHMARK_PAGE_LIMIT
    ),
    pdfWorkerBatchMode: normalizePdfWorkerBatchMode(cfg.pdfWorkerBatchMode || cfg.pdfWorkerBenchmarkMode),
    pdfWorkerRendersPerWorker: normalizePositiveNumberList(
      cfg.pdfWorkerRendersPerWorker || cfg.pdfWorkerConcurrentRendersPerWorker,
      DEFAULT_PDF_WORKER_RENDERS_PER_WORKER,
      8
    ),
    variants: normalizeVariants(cfg.variants),
    pdfToImageModes: normalizePdfToImageModes(cfg.pdfToImageModes || cfg.pdfToImageMode),
    sampleMode: normalizeSampleMode(cfg.sampleMode),
    maxRuns: normalizeInteger(cfg.maxRuns, DEFAULT_MAX_RUNS, 1, 200),
    delayBetweenRunsMs: normalizeInteger(cfg.delayBetweenRunsMs, DEFAULT_DELAY_BETWEEN_RUNS_MS, 0, 10000),
    taskTimeoutMs: normalizeInteger(cfg.taskTimeoutMs, DEFAULT_TASK_TIMEOUT_MS, 5000, MAX_RENDER_BENCHMARK_TASK_TIMEOUT_MS),
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
 * @param {string=} message
 * @returns {Error}
 */
function createAbortError(message = 'Render/decode benchmark was cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
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
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    timeoutId = globalThis.setTimeout(() => {
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
  throw createAbortError();
}

/**
 * @param {string} message
 * @returns {Error}
 */
function createTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

/**
 * @template T
 * @param {Promise<T>} operation
 * @param {number} timeoutMs
 * @param {AbortSignal=} signal
 * @param {string=} label
 * @returns {Promise<T>}
 */
function withTimeout(operation, timeoutMs, signal, label = 'operation') {
  const duration = Math.max(0, Number(timeoutMs) || 0);
  if (duration <= 0) return operation;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;
    const cleanup = () => {
      if (timeoutId) globalThis.clearTimeout?.(timeoutId);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => {
      settle(reject, createAbortError());
    };

    timeoutId = globalThis.setTimeout?.(() => {
      settle(reject, createTimeoutError(`Render/decode benchmark timed out while rendering ${label}.`));
    }, duration);
    signal?.addEventListener?.('abort', onAbort, { once: true });

    operation.then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error)
    );
  });
}

/**
 * @param {Array<*>} pages
 * @param {number} limit
 * @param {'first'|'evenly-spaced'} sampleMode
 * @returns {Array<Object>}
 */
function selectBenchmarkPages(pages, limit, sampleMode) {
  const max = Math.max(1, Number(limit) || DEFAULT_PAGE_LIMIT);
  const source = Array.isArray(pages) ? pages : [];
  const candidates = [];
  for (let index = 0; index < source.length; index += 1) {
    const page = source[index] || null;
    const sourceKey = String(page?.sourceKey || '').trim();
    const fileExtension = String(page?.fileExtension || '').trim().toLowerCase();
    if (!page || page.status === -1 || !sourceKey || !fileExtension) continue;
    candidates.push({
      originalPageIndex: index,
      sourceKey,
      fileExtension,
      fileIndex: Number.isFinite(page.fileIndex) ? Number(page.fileIndex) : 0,
      pageIndex: Math.max(0, Number(page.pageIndex) || 0),
      sourceSizeBytes: Math.max(0, Number(page.sourceSizeBytes) || 0),
    });
  }
  if (candidates.length <= max || sampleMode === 'first') return candidates.slice(0, max);

  const selected = [];
  const used = new Set();
  const denominator = Math.max(1, max - 1);
  for (let slot = 0; slot < max; slot += 1) {
    const index = Math.round((slot * (candidates.length - 1)) / denominator);
    if (used.has(index)) continue;
    used.add(index);
    selected.push(candidates[index]);
  }
  for (let index = 0; selected.length < max && index < candidates.length; index += 1) {
    if (used.has(index)) continue;
    used.add(index);
    selected.push(candidates[index]);
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
    mainThreadConcurrency: Math.max(
      0,
      Math.min(MAX_RENDER_BENCHMARK_MAIN_THREAD_CONCURRENCY, Math.floor(Number(scenario?.mainThreadConcurrency) || 0))
    ),
    pdfToImageMode: PDF_TO_IMAGE_MODES.includes(String(scenario?.pdfToImageMode || '').toLowerCase())
      ? String(scenario.pdfToImageMode).toLowerCase()
      : 'current',
    pdfWorkerBatchMode: normalizePdfWorkerBatchMode(scenario?.pdfWorkerBatchMode),
    pdfWorkerRendersPerWorker: Math.max(1, Math.min(8, Math.floor(Number(scenario?.pdfWorkerRendersPerWorker) || 1))),
  };
  const key = `${normalized.variant}|${normalized.workerCount}|${normalized.mainThreadConcurrency}|${normalized.pdfToImageMode}|${normalized.pdfWorkerBatchMode}|${normalized.pdfWorkerRendersPerWorker}`;
  if (seen.has(key)) return;
  seen.add(key);
  const workerLabel = normalized.workerCount === 0 ? 'auto' : String(normalized.workerCount);
  const mainThreadLabel = normalized.mainThreadConcurrency > 0
    ? `mt${normalized.mainThreadConcurrency}`
    : 'mt-current';
  const pdfLabel = normalized.pdfToImageMode === 'current' ? 'pdf-current' : `pdf-${normalized.pdfToImageMode}`;
  const isMainThreadConcurrencyScenario = normalized.pdfToImageMode === 'main-thread'
    || (normalized.pdfToImageMode === 'current' && normalized.mainThreadConcurrency > 0);
  const workerBatchLabel = normalized.pdfWorkerBatchMode === 'partitioned'
    ? `w${workerLabel}-rpw${normalized.pdfWorkerRendersPerWorker}`
    : `w${workerLabel}`;
  const concurrencyLabel = isMainThreadConcurrencyScenario ? mainThreadLabel : workerBatchLabel;
  scenarios.push({
    ...normalized,
    scenarioLabel: `${normalized.variant}/${pdfLabel}/${concurrencyLabel}`,
  });
}

/**
 * @param {Object} benchmarkCfg
 * @param {Object=} options
 * @param {string=} options.activePdfToImageMode
 * @param {number=} options.pageCount
 * @param {number=} options.hardwareConcurrency
 * @param {number=} options.recommendedWorkerCount
 * @returns {{scenarios:Array<Object>, totalScenarioCount:number, mainThreadConcurrencies:Array<number>, workerCounts:Array<number>}}
 */
function createScenarios(benchmarkCfg, options = {}) {
  const scenarios = [];
  const seen = new Set();
  const activePdfMode = String(options.activePdfToImageMode || 'main-thread').toLowerCase() === 'worker'
    ? 'worker'
    : 'main-thread';
  const hardwareConcurrency = Math.max(1, Number(options.hardwareConcurrency) || getHardwareConcurrency());
  const recommendedWorkerCount = Math.max(
    1,
    Math.min(MAX_RENDER_BENCHMARK_WORKER_COUNT, Number(options.recommendedWorkerCount) || 1)
  );
  const mainThreadConcurrencies = mergePositiveCounts(
    benchmarkCfg.mainThreadConcurrencies,
    deriveCountsFromMultipliers(
      hardwareConcurrency,
      benchmarkCfg.mainThreadCoreMultipliers,
      MAX_RENDER_BENCHMARK_MAIN_THREAD_CONCURRENCY
    ),
    MAX_RENDER_BENCHMARK_MAIN_THREAD_CONCURRENCY
  );
  const workerCounts = (benchmarkCfg.includeAutoWorkerCount ? [0] : []).concat(mergePositiveCounts(
    benchmarkCfg.workerCounts.filter((count) => Number(count) > 0),
    [
      ...deriveCountsFromMultipliers(
        recommendedWorkerCount,
        benchmarkCfg.workerCoreMultipliers,
        MAX_RENDER_BENCHMARK_WORKER_COUNT
      ),
      ...deriveWorkerCountsFromPageTargets(
        options.pageCount,
        benchmarkCfg.pdfWorkerPageTargets,
        recommendedWorkerCount
      ),
    ],
    MAX_RENDER_BENCHMARK_WORKER_COUNT
  ));
  const pdfWorkerRendersPerWorker = benchmarkCfg.pdfWorkerBatchMode === 'partitioned'
    ? benchmarkCfg.pdfWorkerRendersPerWorker
    : [1];

  for (const variant of benchmarkCfg.variants) {
    for (const pdfToImageMode of benchmarkCfg.pdfToImageModes) {
      const variesMainThreadConcurrency = pdfToImageMode === 'main-thread'
        || (pdfToImageMode === 'current' && activePdfMode === 'main-thread');
      if (variesMainThreadConcurrency) {
        for (const mainThreadConcurrency of mainThreadConcurrencies) {
          addScenario(scenarios, seen, { variant, workerCount: 0, mainThreadConcurrency, pdfToImageMode });
        }
      } else {
        for (const workerCount of workerCounts) {
          for (const rendersPerWorker of pdfWorkerRendersPerWorker) {
            addScenario(scenarios, seen, {
              variant,
              workerCount,
              mainThreadConcurrency: 0,
              pdfToImageMode,
              pdfWorkerBatchMode: benchmarkCfg.pdfWorkerBatchMode,
              pdfWorkerRendersPerWorker: rendersPerWorker,
            });
          }
        }
      }
    }
  }
  return {
    scenarios: scenarios.slice(0, benchmarkCfg.maxRuns),
    totalScenarioCount: scenarios.length,
    mainThreadConcurrencies,
    workerCounts,
    pdfWorkerRendersPerWorker,
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
      minMs: null,
      maxMs: 0,
      avgMs: 0,
    };
    const duration = Math.max(0, Number(result?.durationMs) || 0);
    current.count += 1;
    current.totalMs += duration;
    current.outputBytes += Math.max(0, Number(result?.outputBytes) || 0);
    if (result?.ok) current.successCount += 1;
    else current.errorCount += 1;
    current.minMs = current.minMs === null ? duration : Math.min(current.minMs, duration);
    current.maxMs = Math.max(current.maxMs, duration);
    current.avgMs = current.count ? Math.round(current.totalMs / current.count) : 0;
    byExtension[ext] = current;
  }
  return byExtension;
}

function summarizeTaskResults(taskResults) {
  const list = Array.isArray(taskResults) ? taskResults : [];
  const successCount = list.filter((result) => result?.ok).length;
  const errorCount = list.length - successCount;
  const timeoutCount = list.filter((result) => result?.timedOut).length;
  const outputBytes = list.reduce((sum, result) => sum + Math.max(0, Number(result?.outputBytes) || 0), 0);
  const successfulDurations = list
    .filter((result) => result?.ok)
    .map((result) => Math.max(0, Number(result.durationMs) || 0));
  const successfulDurationStats = successfulDurations.reduce((stats, duration) => ({
    count: stats.count + 1,
    totalMs: stats.totalMs + duration,
    minMs: stats.minMs === null ? duration : Math.min(stats.minMs, duration),
    maxMs: Math.max(stats.maxMs, duration),
  }), {
    count: 0,
    totalMs: 0,
    minMs: null,
    maxMs: 0,
  });

  return {
    successCount,
    errorCount,
    timeoutCount,
    outputBytes,
    byExtension: summarizeByExtension(list),
    taskSummary: {
      count: list.length,
      successCount,
      errorCount,
      minMs: successfulDurationStats.count ? successfulDurationStats.minMs : 0,
      maxMs: successfulDurationStats.count ? successfulDurationStats.maxMs : 0,
      avgMs: successfulDurationStats.count
        ? Math.round(successfulDurationStats.totalMs / successfulDurationStats.count)
        : 0,
    },
    slowestTasks: list
      .filter(Boolean)
      .sort((a, b) => (Number(b?.durationMs) || 0) - (Number(a?.durationMs) || 0))
      .slice(0, 10),
  };
}

function partitionContiguous(items, partitionCount) {
  const list = Array.isArray(items) ? items : [];
  const count = Math.max(1, Math.min(list.length || 1, Math.floor(Number(partitionCount) || 1)));
  const partitions = [];
  for (let partitionIndex = 0; partitionIndex < count; partitionIndex += 1) {
    const start = Math.floor((partitionIndex * list.length) / count);
    const end = Math.floor(((partitionIndex + 1) * list.length) / count);
    partitions.push(list.slice(start, end));
  }
  return partitions.filter((partition) => partition.length > 0);
}

/**
 * @param {Object} args
 * @param {number} args.pageCount
 * @param {boolean} args.hasPdfPages
 * @param {string} args.backend
 * @param {string} args.pdfToImageMode
 * @param {number} args.resolvedWorkerCount
 * @param {number} args.pdfWorkerMaxCount
 * @param {Object} args.renderConfig
 * @returns {number}
 */
function resolveScenarioConcurrency(args) {
  const pageCount = Math.max(1, Number(args.pageCount) || 1);
  const resolvedWorkerCount = Math.max(0, Number(args.resolvedWorkerCount) || 0);

  if (args.hasPdfPages && (args.backend === 'main-only' || args.pdfToImageMode !== 'worker')) {
    const mainThreadLimit = Math.max(1, Number(args.renderConfig?.maxConcurrentMainThreadRenders) || 1);
    return Math.min(pageCount, mainThreadLimit);
  }

  if (args.hasPdfPages && args.pdfToImageMode === 'worker') {
    const pdfWorkerLimit = Math.max(1, Number(args.pdfWorkerMaxCount) || 1);
    const workerLimit = resolvedWorkerCount > 0 ? resolvedWorkerCount : pdfWorkerLimit;
    return Math.min(pageCount, workerLimit, pdfWorkerLimit);
  }

  const assetLimit = resolvedWorkerCount > 0
    ? resolvedWorkerCount
    : Math.max(1, Number(args.renderConfig?.maxConcurrentAssetRenders) || 1);
  return Math.min(pageCount, assetLimit);
}

async function runPartitionedPdfWorkerScenario(args) {
  const scenario = args.scenario;
  const requestedWorkerCount = Math.max(0, Number(scenario.workerCount) || 0);
  const resolvedWorkerCount = requestedWorkerCount > 0
    ? requestedWorkerCount
    : resolveRecommendedWorkerCount(0, 'auto');
  const renderConfig = {
    ...(args.baseRenderConfig || {}),
    workerCount: resolvedWorkerCount,
    pdfToImageMode: 'worker',
  };
  const pdfWorkerMaxCount = Math.max(1, Number(renderConfig.pdfWorkerMaxCount) || 6);
  const pdfWorkerCount = Math.max(1, Math.min(resolvedWorkerCount || pdfWorkerMaxCount, pdfWorkerMaxCount));
  const rendersPerWorker = Math.max(1, Math.min(8, Math.floor(Number(scenario.pdfWorkerRendersPerWorker) || 1)));
  const pool = createPdfPageWorkerPool({
    enabled: true,
    workerCount: pdfWorkerCount,
    taskTimeoutMs: Math.min(
      MAX_RENDER_BENCHMARK_TASK_TIMEOUT_MS,
      Math.max(5000, Number(args.taskTimeoutMs) || DEFAULT_TASK_TIMEOUT_MS)
    ),
  });
  const startedAt = performance.now();
  const taskResults = new Array(args.pages.length);
  const sourceBlobCache = new Map();
  let completed = 0;

  const reportPageProgress = () => {
    args.onProgress?.({
      phase: 'running',
      completedRuns: args.completedRuns,
      totalRuns: args.totalRuns,
      scenarioLabel: scenario.scenarioLabel,
      renderedPages: completed,
      pageCount: args.pages.length,
    });
  };

  const getSourceBlob = async (sourceKey) => {
    const key = String(sourceKey || '');
    if (!sourceBlobCache.has(key)) {
      const blob = await args.viewerContext.readSourceBlob?.(key);
      sourceBlobCache.set(key, blob || null);
    }
    return sourceBlobCache.get(key);
  };

  try {
    if (!pool.canRender()) {
      throw pool.createUnavailableError?.('No compatible PDF page worker is available')
        || new Error('No compatible PDF page worker is available');
    }

    const batchItems = [];
    for (let index = 0; index < args.pages.length; index += 1) {
      throwIfAborted(args.signal);
      const page = args.pages[index];
      const sourceBlob = await getSourceBlob(page.sourceKey);
      batchItems.push({
        itemId: index,
        payload: {
          sourceBlob,
          sourceKey: String(page?.sourceKey || ''),
          pageIndex: Math.max(0, Number(page?.pageIndex) || 0),
          variant: scenario.variant,
          thumbnailMaxWidth: renderConfig.thumbnailMaxWidth,
          thumbnailMaxHeight: renderConfig.thumbnailMaxHeight,
          fullPageScale: Number(renderConfig.fullPageScale) || 2.0,
          maxOpenPdfDocuments: Number(renderConfig.maxOpenPdfDocuments) || 16,
        },
      });
    }

    const recordItemResult = (result) => {
      const itemId = Math.max(0, Number(result?.itemId) || 0);
      const page = args.pages[itemId] || {};
      if (result?.ok) {
        taskResults[itemId] = {
          ok: true,
          taskIndex: itemId,
          originalPageIndex: page.originalPageIndex,
          fileExtension: page.fileExtension,
          durationMs: Math.max(0, Math.round(Number(result.durationMs) || 0)),
          outputBytes: Math.max(0, Number(result?.blob?.size) || 0),
          width: Math.max(0, Number(result?.width) || 0),
          height: Math.max(0, Number(result?.height) || 0),
          mimeType: String(result?.mimeType || result?.blob?.type || ''),
        };
      } else {
        taskResults[itemId] = {
          ok: false,
          taskIndex: itemId,
          originalPageIndex: page.originalPageIndex,
          fileExtension: page.fileExtension,
          durationMs: Math.max(0, Math.round(Number(result.durationMs) || 0)),
          error: String(result?.error || 'PDF worker batch item failed'),
          timedOut: false,
        };
      }
      completed += 1;
      reportPageProgress();
    };

    const partitions = partitionContiguous(batchItems, pdfWorkerCount);
    await Promise.all(partitions.map(async (partition) => {
      try {
        await pool.renderBatch(partition, {
          concurrency: rendersPerWorker,
          onItemResult: recordItemResult,
        });
      } catch (error) {
        for (const item of partition) {
          const itemId = Math.max(0, Number(item?.itemId) || 0);
          if (taskResults[itemId]) continue;
          const page = args.pages[itemId] || {};
          taskResults[itemId] = {
            ok: false,
            taskIndex: itemId,
            originalPageIndex: page.originalPageIndex,
            fileExtension: page.fileExtension,
            durationMs: 0,
            error: String(error?.message || error || 'PDF worker batch failed'),
            timedOut: String(error?.name || '') === 'TimeoutError',
          };
          completed += 1;
          reportPageProgress();
        }
      }
    }));

    for (let index = 0; index < taskResults.length; index += 1) {
      if (taskResults[index]) continue;
      const page = args.pages[index] || {};
      taskResults[index] = {
        ok: false,
        taskIndex: index,
        originalPageIndex: page.originalPageIndex,
        fileExtension: page.fileExtension,
        durationMs: 0,
        error: 'PDF worker batch did not return a result for this page.',
      };
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const summary = summarizeTaskResults(taskResults);
    return {
      scenarioLabel: scenario.scenarioLabel,
      variant: scenario.variant,
      pdfToImageModeSetting: scenario.pdfToImageMode,
      pdfToImageMode: 'worker',
      workerCountSetting: scenario.workerCount,
      mainThreadConcurrencySetting: scenario.mainThreadConcurrency,
      pdfWorkerBatchMode: scenario.pdfWorkerBatchMode,
      pdfWorkerRendersPerWorker: rendersPerWorker,
      workerCount: resolvedWorkerCount,
      mainThreadConcurrency: Math.max(1, Number(renderConfig.maxConcurrentMainThreadRenders) || 1),
      pdfWorkerMaxCount,
      concurrency: pdfWorkerCount * rendersPerWorker,
      durationMs,
      pageCount: args.pages.length,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      timeoutCount: summary.timeoutCount,
      outputBytes: summary.outputBytes,
      byExtension: summary.byExtension,
      rendererStats: {
        workerAssetCount: 0,
        workerFallbackCount: 0,
        pdfWorkerCount: summary.successCount,
        pdfWorkerFallbackCount: summary.errorCount,
        pdfWorkerFallbackReasons: {},
        pdfWorkerFallbackSamples: [],
        mainPdfCount: 0,
        mainTiffCount: 0,
        mainImageCount: 0,
        activeWorkerCount: pool.getWorkerCount(),
        activePdfWorkerCount: pool.getWorkerCount(),
        activePageAssetWorkerCount: 0,
      },
      taskSummary: summary.taskSummary,
      slowestTasks: summary.slowestTasks,
    };
  } finally {
    await pool.dispose?.();
  }
}

/**
 * @param {Object} args
 * @param {Array<Object>} args.pages
 * @param {Object} args.scenario
 * @param {Object} args.viewerContext
 * @param {Object} args.baseRenderConfig
 * @param {number} args.taskTimeoutMs
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
  const basePdfToImageMode = String(args.baseRenderConfig?.pdfToImageMode || 'main-thread').toLowerCase();
  const pdfToImageMode = scenario.pdfToImageMode === 'current'
    ? basePdfToImageMode
    : String(scenario.pdfToImageMode || 'main-thread').toLowerCase();
  const renderConfig = {
    ...(args.baseRenderConfig || {}),
    workerCount: resolvedWorkerCount,
    pdfToImageMode,
  };
  if (scenario.mainThreadConcurrency > 0) {
    renderConfig.maxConcurrentMainThreadRenders = scenario.mainThreadConcurrency;
  }
  const pdfWorkerMaxCount = Math.max(1, Number(renderConfig.pdfWorkerMaxCount) || 6);
  renderConfig.pdfWorkerTaskTimeoutMs = Math.min(
    Math.max(5000, Number(args.taskTimeoutMs) || DEFAULT_TASK_TIMEOUT_MS),
    Math.max(5000, Number(renderConfig.pdfWorkerTaskTimeoutMs) || Number(args.taskTimeoutMs) || DEFAULT_TASK_TIMEOUT_MS)
  );
  const tempStore = {
    getBlob: (sourceKey) => args.viewerContext.readSourceBlob?.(sourceKey),
    getArrayBuffer: async (sourceKey) => {
      const direct = await args.viewerContext.readSourceArrayBuffer?.(sourceKey);
      if (direct) return direct;
      const blob = await args.viewerContext.readSourceBlob?.(sourceKey);
      return blob ? blob.arrayBuffer() : null;
    },
  };
  const hasPdfPages = args.pages.some((page) => String(page?.fileExtension || '').toLowerCase() === 'pdf');
  const allPagesArePdf = args.pages.every((page) => String(page?.fileExtension || '').toLowerCase() === 'pdf');
  const backend = String(renderConfig.backend || 'hybrid-by-format').toLowerCase();
  if (
    scenario.pdfWorkerBatchMode === 'partitioned'
    && pdfToImageMode === 'worker'
    && backend !== 'main-only'
    && hasPdfPages
    && allPagesArePdf
  ) {
    return runPartitionedPdfWorkerScenario({
      ...args,
      baseRenderConfig: renderConfig,
    });
  }

  const renderer = createPageAssetRenderer({ tempStore, config: renderConfig });
  const concurrency = resolveScenarioConcurrency({
    pageCount: args.pages.length,
    hasPdfPages,
    backend,
    pdfToImageMode,
    resolvedWorkerCount,
    pdfWorkerMaxCount,
    renderConfig,
  });
  const startedAt = performance.now();
  let completed = 0;
  let timeoutCount = 0;

  const reportPageProgress = () => {
    args.onProgress?.({
      phase: 'running',
      completedRuns: args.completedRuns,
      totalRuns: args.totalRuns,
      scenarioLabel: scenario.scenarioLabel,
      renderedPages: completed,
      pageCount: args.pages.length,
    });
  };

  try {
    const taskResults = await runLimited(args.pages, concurrency, async (page, taskIndex) => {
      throwIfAborted(args.signal);
      const taskStart = performance.now();
      try {
        const label = `${scenario.scenarioLabel} page ${page.originalPageIndex + 1}`;
        const rendered = await withTimeout(
          renderer.renderPageAsset(page, {
            variant: scenario.variant,
            thumbnailMaxWidth: renderConfig.thumbnailMaxWidth,
            thumbnailMaxHeight: renderConfig.thumbnailMaxHeight,
          }),
          args.taskTimeoutMs,
          args.signal,
          label
        );
        const durationMs = Math.round(performance.now() - taskStart);
        completed += 1;
        reportPageProgress();
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
        if (String(error?.name || '') === 'TimeoutError') timeoutCount += 1;
        reportPageProgress();
        return {
          ok: false,
          taskIndex,
          originalPageIndex: page.originalPageIndex,
          fileExtension: page.fileExtension,
          durationMs,
          timedOut: String(error?.name || '') === 'TimeoutError',
          error: String(error?.message || error),
        };
      }
    }, args.signal);

    const durationMs = Math.round(performance.now() - startedAt);
    const rendererStats = typeof renderer.getStats === 'function' ? renderer.getStats() : {};
    const summary = summarizeTaskResults(taskResults);

    return {
      scenarioLabel: scenario.scenarioLabel,
      variant: scenario.variant,
      pdfToImageModeSetting: scenario.pdfToImageMode,
      pdfToImageMode,
      workerCountSetting: scenario.workerCount,
      mainThreadConcurrencySetting: scenario.mainThreadConcurrency,
      workerCount: resolvedWorkerCount,
      mainThreadConcurrency: Math.max(1, Number(renderConfig.maxConcurrentMainThreadRenders) || 1),
      pdfWorkerMaxCount,
      concurrency,
      durationMs,
      pageCount: args.pages.length,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      timeoutCount,
      outputBytes: summary.outputBytes,
      byExtension: summary.byExtension,
      rendererStats,
      taskSummary: summary.taskSummary,
      slowestTasks: summary.slowestTasks,
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

  const selectedPages = selectBenchmarkPages(args?.allPages || [], benchmarkCfg.pageLimit, benchmarkCfg.sampleMode);
  if (!selectedPages.length) throw new Error('No loaded source pages were available for render/decode benchmark.');

  const baseRenderConfig = viewerContext.documentLoadingConfig?.render
    || getDocumentLoadingConfig().render
    || {};
  const basePdfToImageMode = String(baseRenderConfig?.pdfToImageMode || 'main-thread').toLowerCase() === 'worker'
    ? 'worker'
    : 'main-thread';
  const hardwareConcurrency = getHardwareConcurrency();
  const recommendedWorkerCount = resolveRecommendedWorkerCount(0, 'auto');
  const scenarioPlan = createScenarios(benchmarkCfg, {
    activePdfToImageMode: basePdfToImageMode,
    pageCount: selectedPages.length,
    hardwareConcurrency,
    recommendedWorkerCount,
  });
  const scenarios = scenarioPlan.scenarios;
  const totalRuns = scenarios.length * benchmarkCfg.iterations;
  const runs = [];

  for (let iteration = 1; iteration <= benchmarkCfg.iterations; iteration += 1) {
    for (const scenario of scenarios) {
      throwIfAborted(args?.signal);
      args?.onProgress?.({
        phase: 'running',
        completedRuns: runs.length,
        totalRuns,
        scenarioLabel: scenario.scenarioLabel,
        renderedPages: 0,
        pageCount: selectedPages.length,
      });
      const result = await runScenario({
        pages: selectedPages,
        scenario,
        viewerContext,
        baseRenderConfig,
        taskTimeoutMs: benchmarkCfg.taskTimeoutMs,
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
    .sort((a, b) => a.durationMs - b.durationMs)[0] || null;

  const result = {
    schema: 'opendocviewer.render-decode-benchmark.v1',
    createdUtc: new Date().toISOString(),
    pageCount: selectedPages.length,
    sourcePageCount: Array.isArray(args?.allPages) ? args.allPages.length : 0,
    pageLimit: benchmarkCfg.pageLimit,
    iterations: benchmarkCfg.iterations,
    sampleMode: benchmarkCfg.sampleMode,
    activePdfToImageMode: basePdfToImageMode,
    hardwareConcurrency,
    recommendedWorkerCount,
    variants: benchmarkCfg.variants,
    pdfToImageModes: benchmarkCfg.pdfToImageModes,
    workerCounts: benchmarkCfg.workerCounts,
    includeAutoWorkerCount: benchmarkCfg.includeAutoWorkerCount,
    mainThreadConcurrencies: benchmarkCfg.mainThreadConcurrencies,
    focusedWorkerCounts: scenarioPlan.workerCounts,
    focusedMainThreadConcurrencies: scenarioPlan.mainThreadConcurrencies,
    mainThreadCoreMultipliers: benchmarkCfg.mainThreadCoreMultipliers,
    workerCoreMultipliers: benchmarkCfg.workerCoreMultipliers,
    pdfWorkerPageTargets: benchmarkCfg.pdfWorkerPageTargets,
    pdfWorkerBatchMode: benchmarkCfg.pdfWorkerBatchMode,
    pdfWorkerRendersPerWorker: benchmarkCfg.pdfWorkerRendersPerWorker,
    focusedPdfWorkerRendersPerWorker: scenarioPlan.pdfWorkerRendersPerWorker,
    taskTimeoutMs: benchmarkCfg.taskTimeoutMs,
    maxRuns: benchmarkCfg.maxRuns,
    testedVariants: Array.from(new Set(scenarios.map((scenario) => scenario.variant))),
    testedPdfToImageModes: Array.from(new Set(scenarios.map((scenario) => scenario.pdfToImageMode))),
    testedWorkerCounts: Array.from(new Set(scenarios.map((scenario) => scenario.workerCount))),
    testedMainThreadConcurrencies: Array.from(
      new Set(scenarios.map((scenario) => scenario.mainThreadConcurrency).filter((value) => value > 0))
    ),
    testedPdfWorkerBatchModes: Array.from(new Set(scenarios.map((scenario) => scenario.pdfWorkerBatchMode))),
    testedPdfWorkerRendersPerWorker: Array.from(
      new Set(scenarios.map((scenario) => scenario.pdfWorkerRendersPerWorker).filter((value) => value > 0))
    ),
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
