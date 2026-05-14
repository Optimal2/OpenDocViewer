// File: src/utils/pdfBenchmark.js
/**
 * Opt-in generated-PDF benchmark tooling.
 */

import logger from '../logging/systemLogger.js';
import { resolveRecommendedWorkerCount } from './documentLoadingConfig.js';
import { collectPrintablePdfSources, createPrintPdfBlob } from './printPdf.js';
import { planPdfWorkerBatches, resolveAutoPdfWorkerBatchSize } from './pdfWorkerDispatcher.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { collectSupportDiagnostics, saveLatestPdfBenchmarkResult } from './supportDiagnostics.js';

const DEFAULT_BATCH_SIZES = Object.freeze([0]);
const DEFAULT_BATCH_COUNTS = Object.freeze([2, 3, 4]);
const DEFAULT_WORKER_COUNTS = Object.freeze([0]);
const DEFAULT_IMAGE_LOAD_CONCURRENCIES = Object.freeze([0, 2, 3, 4]);
const DEFAULT_MERGE_MODES = Object.freeze(['auto']);
const DEFAULT_STRATEGIES = Object.freeze(['partial-merge', 'single-worker']);
const DEFAULT_PROFILE = 'focused';
const DEFAULT_PAGE_LIMIT = 80;
const DEFAULT_ITERATIONS = 1;
const DEFAULT_DELAY_BETWEEN_RUNS_MS = 150;
const DEFAULT_MAX_RUNS = 40;
const MAX_BENCHMARK_WORKER_COUNT = 32;
const MAX_BENCHMARK_BATCH_SIZE = 200;
const MAX_BENCHMARK_BATCH_COUNT = 8;
const MAX_BENCHMARK_IMAGE_LOAD_CONCURRENCY = 32;
const AUTO_NEIGHBOR_BATCH_FACTORS = Object.freeze([0.75, 1.25, 1.5]);
const BENCHMARK_STRATEGIES = Object.freeze(['partial-merge', 'single-worker', 'main-thread']);
const BENCHMARK_PROFILES = Object.freeze(['focused', 'matrix']);
const BENCHMARK_MERGE_MODES = Object.freeze(['auto']);
const TIMED_PROGRESS_PHASES = Object.freeze([
  'loading-library',
  'loading-images',
  'generating',
  'finalizing',
  'merging',
]);

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
 * @param {*} value
 * @returns {Array<number>}
 */
function normalizeBatchCounts(value) {
  const raw = Array.isArray(value) ? value : DEFAULT_BATCH_COUNTS;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(2, Math.min(MAX_BENCHMARK_BATCH_COUNT, Math.floor(Number(item) || 0)));
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.length ? out : DEFAULT_BATCH_COUNTS.slice();
}

/**
 * @param {*} value
 * @param {Array<number>} fallback
 * @param {number} max
 * @returns {Array<number>}
 */
function normalizeIntegerList(value, fallback, max) {
  const raw = Array.isArray(value) ? value : fallback;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const next = Math.max(0, Math.min(max, Math.floor(Number(item) || 0)));
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
function normalizeStrategies(value) {
  const raw = Array.isArray(value) ? value : DEFAULT_STRATEGIES;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const strategy = String(item || '').trim().toLowerCase();
    if (!BENCHMARK_STRATEGIES.includes(strategy) || seen.has(strategy)) continue;
    seen.add(strategy);
    out.push(strategy);
  }
  return out.length ? out : DEFAULT_STRATEGIES.slice();
}

/**
 * @param {*} value
 * @returns {Array<string>}
 */
function normalizeMergeModes(value) {
  const raw = Array.isArray(value) ? value : DEFAULT_MERGE_MODES;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const mode = String(item || '').trim().toLowerCase();
    if (!BENCHMARK_MERGE_MODES.includes(mode) || seen.has(mode)) continue;
    seen.add(mode);
    out.push(mode);
  }
  return out.length ? out : DEFAULT_MERGE_MODES.slice();
}

/**
 * @param {*} value
 * @returns {'focused'|'matrix'}
 */
function normalizeProfile(value) {
  const profile = String(value || DEFAULT_PROFILE).trim().toLowerCase();
  return BENCHMARK_PROFILES.includes(profile) ? profile : DEFAULT_PROFILE;
}

/**
 * Keep a batch-size list ordered and unique.
 * @param {Array<number>} target
 * @param {Set<number>} seen
 * @param {number} value
 * @returns {void}
 */
function addBatchSizeCandidate(target, seen, value) {
  const next = Math.max(0, Math.min(MAX_BENCHMARK_BATCH_SIZE, Math.floor(Number(value) || 0)));
  if (seen.has(next)) return;
  seen.add(next);
  target.push(next);
}

/**
 * Resolve the PDF worker count with the same policy as generated-PDF output.
 * @param {Object=} pdfCfg
 * @returns {{workerCount:number, desiredWorkerCount:number, partialMergeEnabled:boolean}}
 */
function resolveBenchmarkWorkerPolicy(pdfCfg = {}) {
  const partialMergeEnabled = pdfCfg.partialMergeEnabled !== false;
  const desiredWorkerCount = resolveRecommendedWorkerCount(Math.max(0, Number(pdfCfg.workerCount) || 0), 'auto');
  const workerCount = Math.max(1, Math.min(partialMergeEnabled ? MAX_BENCHMARK_WORKER_COUNT : 1, desiredWorkerCount));
  return { workerCount, desiredWorkerCount, partialMergeEnabled };
}

/**
 * Describe the actual batch plan for one benchmark run.
 * @param {number} pageCount
 * @param {Object=} pdfCfg
 * @param {number=} requestedBatchSize
 * @returns {{workerCount:number, desiredWorkerCount:number, partialMergeEnabled:boolean, requestedBatchSize:number, resolvedBatchSize:number, batchCount:number}}
 */
function describeBenchmarkBatchPlan(pageCount, pdfCfg = {}, requestedBatchSize = 0) {
  const safePageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  const workerPolicy = resolveBenchmarkWorkerPolicy(pdfCfg);
  const requested = Math.max(0, Math.floor(Number(requestedBatchSize) || 0));
  const resolvedBatchSize = workerPolicy.partialMergeEnabled
    ? requested || resolveAutoPdfWorkerBatchSize(safePageCount, workerPolicy.workerCount)
    : safePageCount;
  const batches = planPdfWorkerBatches(
    safePageCount,
    workerPolicy.workerCount,
    resolvedBatchSize,
    workerPolicy.partialMergeEnabled
  );
  return {
    ...workerPolicy,
    workerCount: Math.max(1, Math.min(workerPolicy.workerCount, Math.max(1, batches.length))),
    requestedBatchSize: requested,
    resolvedBatchSize,
    batchCount: batches.length,
  };
}

/**
 * @param {Object} scenario
 * @returns {string}
 */
function createScenarioLabel(scenario) {
  const workerText = scenario.workerCount === 0 ? 'auto' : String(scenario.workerCount);
  const batchText = scenario.batchSize === 0 ? 'auto' : String(scenario.batchSize);
  const imageText = scenario.imageLoadConcurrency === 0 ? 'auto' : String(scenario.imageLoadConcurrency);
  if (scenario.strategy === 'main-thread') return `main/i${imageText}`;
  if (scenario.strategy === 'single-worker') return `single-worker/i${imageText}`;
  return `partial/w${workerText}/b${batchText}/i${imageText}/m${scenario.mergeMode || 'auto'}`;
}

/**
 * @param {Object} scenario
 * @returns {string}
 */
function createScenarioKey(scenario) {
  return [
    scenario.strategy,
    scenario.workerCount,
    scenario.batchSize,
    scenario.imageLoadConcurrency,
    scenario.mergeMode || 'auto',
  ].join('|');
}

/**
 * @param {Array<Object>} target
 * @param {Set<string>} seen
 * @param {Object} scenario
 * @returns {void}
 */
function addScenario(target, seen, scenario) {
  const normalized = {
    strategy: String(scenario.strategy || 'partial-merge'),
    workerCount: Math.max(0, Math.floor(Number(scenario.workerCount) || 0)),
    batchSize: Math.max(0, Math.floor(Number(scenario.batchSize) || 0)),
    imageLoadConcurrency: Math.max(0, Math.floor(Number(scenario.imageLoadConcurrency) || 0)),
    mergeMode: BENCHMARK_MERGE_MODES.includes(String(scenario.mergeMode || '').toLowerCase())
      ? String(scenario.mergeMode).toLowerCase()
      : 'auto',
  };
  const key = createScenarioKey(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ ...normalized, scenarioLabel: createScenarioLabel(normalized) });
}

/**
 * @param {Object} benchmarkCfg
 * @param {number} pageCount
 * @param {Object=} basePdfCfg
 * @returns {{scenarios:Array<Object>, totalScenarioCount:number}}
 */
function createMatrixBenchmarkScenarios(benchmarkCfg, pageCount, basePdfCfg = {}) {
  const scenarios = [];
  const seen = new Set();

  for (const strategy of benchmarkCfg.strategies) {
    if (strategy === 'main-thread') {
      benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
        addScenario(scenarios, seen, {
          strategy,
          workerCount: 0,
          batchSize: 0,
          imageLoadConcurrency,
        });
      });
      continue;
    }

    if (strategy === 'single-worker') {
      benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
        addScenario(scenarios, seen, {
          strategy,
          workerCount: 1,
          batchSize: 0,
          imageLoadConcurrency,
        });
      });
      continue;
    }

    for (const workerCount of benchmarkCfg.workerCounts) {
      const batchSizes = expandBenchmarkBatchSizes(
        benchmarkCfg.batchSizes,
        pageCount,
        { ...basePdfCfg, workerCount, partialMergeEnabled: true }
      );
      for (const batchSize of batchSizes) {
        benchmarkCfg.mergeModes.forEach((mergeMode) => {
          benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
            addScenario(scenarios, seen, {
              strategy,
              workerCount,
              batchSize,
              imageLoadConcurrency,
              mergeMode,
            });
          });
        });
      }
    }
  }

  return {
    scenarios: scenarios.slice(0, benchmarkCfg.maxRuns),
    totalScenarioCount: scenarios.length,
  };
}

/**
 * Create a compact benchmark matrix that answers the important tuning questions without
 * spending most of the run on combinations that are already known to be poor:
 * - single worker vs balanced 2/3/4 partial PDFs
 * - image load/decode concurrency around the likely sweet spot
 * - fixed batch sizes around the current auto plan
 * @param {Object} benchmarkCfg
 * @param {number} pageCount
 * @returns {{scenarios:Array<Object>, totalScenarioCount:number}}
 */
function createFocusedBenchmarkScenarios(benchmarkCfg, pageCount) {
  const scenarios = [];
  const seen = new Set();
  const safePageCount = Math.max(1, Math.floor(Number(pageCount) || 1));
  const includeStrategy = (name) => benchmarkCfg.strategies.includes(name);

  if (includeStrategy('main-thread')) {
    addScenario(scenarios, seen, {
      strategy: 'main-thread',
      workerCount: 0,
      batchSize: 0,
      imageLoadConcurrency: 0,
    });
  }

  if (includeStrategy('single-worker')) {
    benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
      addScenario(scenarios, seen, {
        strategy: 'single-worker',
        workerCount: 1,
        batchSize: 0,
        imageLoadConcurrency,
      });
    });
  }

  if (includeStrategy('partial-merge')) {
    // Current runtime auto, tested across image-load concurrency values.
    benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
      addScenario(scenarios, seen, {
        strategy: 'partial-merge',
        workerCount: 0,
        batchSize: 0,
        imageLoadConcurrency,
        mergeMode: 'auto',
      });
    });

    benchmarkCfg.batchCounts.forEach((batchCount) => {
      const workerCount = Math.max(1, Math.min(MAX_BENCHMARK_WORKER_COUNT, batchCount));
      const batchSize = Math.max(1, Math.ceil(safePageCount / batchCount));

      // Compare image-load/decode concurrency while leaving merge behavior on auto.
      benchmarkCfg.imageLoadConcurrencies.forEach((imageLoadConcurrency) => {
        addScenario(scenarios, seen, {
          strategy: 'partial-merge',
          workerCount,
          batchSize,
          imageLoadConcurrency,
          mergeMode: 'auto',
        });
      });

      addScenario(scenarios, seen, {
        strategy: 'partial-merge',
        workerCount,
        batchSize,
        imageLoadConcurrency: 0,
        mergeMode: 'auto',
      });
    });

    benchmarkCfg.batchSizes
      .filter((batchSize) => batchSize > 0)
      .forEach((batchSize) => {
        addScenario(scenarios, seen, {
          strategy: 'partial-merge',
          workerCount: 0,
          batchSize,
          imageLoadConcurrency: 0,
          mergeMode: 'auto',
        });
      });
  }

  return {
    scenarios: scenarios.slice(0, benchmarkCfg.maxRuns),
    totalScenarioCount: scenarios.length,
  };
}

/**
 * @param {Object} benchmarkCfg
 * @param {number} pageCount
 * @param {Object=} basePdfCfg
 * @returns {{scenarios:Array<Object>, totalScenarioCount:number}}
 */
function createBenchmarkScenarios(benchmarkCfg, pageCount, basePdfCfg = {}) {
  if (benchmarkCfg.profile === 'matrix') {
    return createMatrixBenchmarkScenarios(benchmarkCfg, pageCount, basePdfCfg);
  }
  return createFocusedBenchmarkScenarios(benchmarkCfg, pageCount);
}

/**
 * @param {Object=} basePdfCfg
 * @param {Object} scenario
 * @returns {Object}
 */
function createScenarioPdfConfig(basePdfCfg = {}, scenario) {
  if (scenario.strategy === 'main-thread') {
    return {
      ...basePdfCfg,
      workerEnabled: false,
      workerPageThreshold: 1,
      imageLoadConcurrency: scenario.imageLoadConcurrency,
    };
  }

  if (scenario.strategy === 'single-worker') {
    return {
      ...basePdfCfg,
      workerEnabled: true,
      workerPageThreshold: 1,
      partialMergeEnabled: false,
      workerCount: 1,
      workerBatchSize: 0,
      imageLoadConcurrency: scenario.imageLoadConcurrency,
      mergeMode: 'auto',
    };
  }

  return {
    ...basePdfCfg,
    workerEnabled: true,
    workerPageThreshold: 1,
    partialMergeEnabled: true,
    workerCount: scenario.workerCount,
    workerBatchSize: scenario.batchSize,
    imageLoadConcurrency: scenario.imageLoadConcurrency,
    mergeMode: scenario.mergeMode || 'auto',
  };
}

/**
 * @param {number} pageCount
 * @param {Object} pdfCfg
 * @param {Object} scenario
 * @returns {Object}
 */
function describeScenarioPlan(pageCount, pdfCfg, scenario) {
  if (scenario.strategy === 'main-thread') {
    return {
      strategy: scenario.strategy,
      workerEnabled: false,
      workerCount: 0,
      desiredWorkerCount: 0,
      partialMergeEnabled: false,
      requestedBatchSize: 0,
      resolvedBatchSize: Math.max(0, Math.floor(Number(pageCount) || 0)),
      batchCount: 1,
      imageLoadConcurrency: scenario.imageLoadConcurrency,
      mergeMode: 'auto',
    };
  }

  return {
    strategy: scenario.strategy,
    workerEnabled: true,
    imageLoadConcurrency: scenario.imageLoadConcurrency,
    mergeMode: scenario.mergeMode || 'auto',
    ...describeBenchmarkBatchPlan(pageCount, pdfCfg, scenario.batchSize),
  };
}

/**
 * Expand configured benchmark sizes with values near the current auto plan.
 *
 * When `0` is present, it means "test runtime auto". The benchmark also tests a
 * few neighboring concrete batch sizes so the JSON can show whether auto is near
 * the local client sweet spot instead of only saying "auto was fastest".
 * @param {Array<number>} configured
 * @param {number} pageCount
 * @param {Object=} pdfCfg
 * @returns {Array<number>}
 */
function expandBenchmarkBatchSizes(configured, pageCount, pdfCfg = {}) {
  const out = [];
  const seen = new Set();
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_BATCH_SIZES;
  source.forEach((value) => addBatchSizeCandidate(out, seen, value));

  if (!seen.has(0)) return out;

  const autoPlan = describeBenchmarkBatchPlan(pageCount, pdfCfg, 0);
  AUTO_NEIGHBOR_BATCH_FACTORS.forEach((factor) => {
    addBatchSizeCandidate(out, seen, Math.round(autoPlan.resolvedBatchSize * factor));
  });
  return out;
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundMilliseconds(value) {
  return Math.round(Math.max(0, Number(value) || 0));
}

/**
 * @param {*} value
 * @returns {number|null}
 */
function finiteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * @param {string} phase
 * @returns {string}
 */
function normalizeTimingPhase(phase) {
  const text = String(phase || 'unknown');
  return text === 'generating-page' ? 'generating' : text;
}

/**
 * @returns {Object<string, number>}
 */
function createEmptyPhaseDurations() {
  return Object.fromEntries(TIMED_PROGRESS_PHASES.map((phase) => [phase, 0]));
}

/**
 * @param {Object<string, {firstMs:number,lastMs:number,eventCount:number}>} spans
 * @param {string} phase
 * @param {number} atMs
 * @returns {void}
 */
function recordPhaseSpan(spans, phase, atMs) {
  const key = normalizeTimingPhase(phase);
  if (!spans[key]) spans[key] = { firstMs: atMs, lastMs: atMs, eventCount: 0 };
  spans[key].firstMs = Math.min(spans[key].firstMs, atMs);
  spans[key].lastMs = Math.max(spans[key].lastMs, atMs);
  spans[key].eventCount += 1;
}

/**
 * @param {Object<string, number>} target
 * @param {string} phase
 * @param {number} durationMs
 * @returns {void}
 */
function addPhaseDuration(target, phase, durationMs) {
  const key = normalizeTimingPhase(phase);
  if (!TIMED_PROGRESS_PHASES.includes(key)) return;
  target[key] = (target[key] || 0) + Math.max(0, Number(durationMs) || 0);
}

/**
 * Convert progress markers into phase durations by measuring time between phase
 * transitions. This is an approximation, but it is stable enough to reveal whether
 * a run spends most time loading images, generating pages, finalizing PDFs, or merging.
 * @param {Array<Object>} events
 * @param {number} endMs
 * @returns {Object<string, number>}
 */
function calculateTransitionPhaseDurations(events, endMs) {
  const sorted = (Array.isArray(events) ? events : [])
    .filter((event) => Number.isFinite(event?.atMs))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);
  const durations = createEmptyPhaseDurations();
  if (!sorted.length) return durations;

  let currentPhase = normalizeTimingPhase(sorted[0].phase);
  let phaseStartMs = sorted[0].atMs;
  for (let index = 1; index < sorted.length; index += 1) {
    const event = sorted[index];
    const nextPhase = normalizeTimingPhase(event.phase);
    if (nextPhase === currentPhase) continue;
    addPhaseDuration(durations, currentPhase, event.atMs - phaseStartMs);
    currentPhase = nextPhase;
    phaseStartMs = event.atMs;
  }

  addPhaseDuration(durations, currentPhase, Math.max(0, Number(endMs) || 0) - phaseStartMs);
  return Object.fromEntries(Object.entries(durations).map(([phase, value]) => [phase, roundMilliseconds(value)]));
}

/**
 * @param {Array<Object>} events
 * @param {string} keyName
 * @returns {Map<string, Array<Object>>}
 */
function groupEventsByNumericKey(events, keyName) {
  const groups = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const value = finiteNumberOrNull(event?.[keyName]);
    if (value === null) return;
    const key = String(Math.floor(value));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  return groups;
}

/**
 * @param {Array<Object>} batches
 * @returns {{count:number,minMs:number,maxMs:number,avgMs:number}}
 */
function summarizeTaskDurations(batches) {
  if (!batches.length) return { count: 0, minMs: 0, maxMs: 0, avgMs: 0 };
  const durations = batches.map((batch) => Math.max(0, Number(batch.durationMs) || 0));
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    count: batches.length,
    minMs: roundMilliseconds(Math.min(...durations)),
    maxMs: roundMilliseconds(Math.max(...durations)),
    avgMs: roundMilliseconds(total / batches.length),
  };
}

/**
 * @param {Object<string, {firstMs:number,lastMs:number,eventCount:number}>} spans
 * @returns {Object<string, {firstMs:number,lastMs:number,spanMs:number,eventCount:number}>}
 */
function finalizePhaseSpans(spans) {
  return Object.fromEntries(Object.entries(spans).map(([phase, span]) => [
    phase,
    {
      firstMs: roundMilliseconds(span.firstMs),
      lastMs: roundMilliseconds(span.lastMs),
      spanMs: roundMilliseconds(span.lastMs - span.firstMs),
      eventCount: span.eventCount,
    },
  ]));
}

/**
 * @param {Object<string, number>} target
 * @param {Object<string, number>} source
 * @returns {void}
 */
function addPhaseDurations(target, source) {
  Object.entries(source || {}).forEach(([phase, value]) => {
    target[phase] = (target[phase] || 0) + Math.max(0, Number(value) || 0);
  });
}

/**
 * @param {Array<Object>} events
 * @param {number} durationMs
 * @returns {Object}
 */
function summarizeBenchmarkTiming(events, durationMs) {
  const records = Array.isArray(events) ? events : [];
  const phaseSpans = {};
  records.forEach((event) => recordPhaseSpan(phaseSpans, event.phase, event.atMs));

  const batchSummaries = [];
  const batchPhaseTaskMs = createEmptyPhaseDurations();
  for (const [batchIndex, batchEvents] of groupEventsByNumericKey(records, 'batchIndex')) {
    const sorted = batchEvents.slice().sort((a, b) => a.atMs - b.atMs);
    const first = sorted[0] || {};
    const last = sorted[sorted.length - 1] || first;
    const phaseDurations = calculateTransitionPhaseDurations(sorted, last.atMs);
    addPhaseDurations(batchPhaseTaskMs, phaseDurations);
    batchSummaries.push({
      batchIndex: Number(batchIndex),
      startPage: Number.isFinite(first.batchStartPageIndex) ? first.batchStartPageIndex + 1 : null,
      pageCount: finiteNumberOrNull(first.batchPageCount),
      durationMs: roundMilliseconds((last.atMs || 0) - (first.atMs || 0)),
      phaseDurationsMs: phaseDurations,
      eventCount: sorted.length,
    });
  }

  const mergeSummaries = [];
  const mergePhaseTaskMs = createEmptyPhaseDurations();
  const mergeEvents = records.filter((event) => normalizeTimingPhase(event.phase) === 'merging');
  for (const [taskIndex, taskEvents] of groupEventsByNumericKey(mergeEvents, 'globalMergeTaskIndex')) {
    const sorted = taskEvents.slice().sort((a, b) => a.atMs - b.atMs);
    const first = sorted[0] || {};
    const last = sorted[sorted.length - 1] || first;
    const duration = roundMilliseconds((last.atMs || 0) - (first.atMs || 0));
    addPhaseDuration(mergePhaseTaskMs, 'merging', duration);
    mergeSummaries.push({
      taskIndex: Number(taskIndex),
      roundIndex: finiteNumberOrNull(first.roundIndex),
      pairIndex: finiteNumberOrNull(first.pairIndex),
      durationMs: duration,
      eventCount: sorted.length,
    });
  }

  return {
    totalMs: roundMilliseconds(durationMs),
    eventCount: records.length,
    phaseSpans: finalizePhaseSpans(phaseSpans),
    batchPhaseTaskMs: Object.fromEntries(Object.entries(batchPhaseTaskMs).map(([phase, value]) => [phase, roundMilliseconds(value)])),
    mergePhaseTaskMs: Object.fromEntries(Object.entries(mergePhaseTaskMs).map(([phase, value]) => [phase, roundMilliseconds(value)])),
    batchSummary: summarizeTaskDurations(batchSummaries),
    mergeSummary: summarizeTaskDurations(mergeSummaries),
    slowestBatches: batchSummaries
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 8),
    slowestMergeTasks: mergeSummaries
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 8),
  };
}

/**
 * @param {Object=} config
 * @returns {{enabled:boolean,profile:string,pageLimit:number,iterations:number,batchSizes:Array<number>,batchCounts:Array<number>,workerCounts:Array<number>,imageLoadConcurrencies:Array<number>,mergeModes:Array<string>,strategies:Array<string>,maxRuns:number,delayBetweenRunsMs:number}}
 */
function normalizeBenchmarkConfig(config = getRuntimeConfig()) {
  const cfg = config?.print?.pdf?.benchmark || {};
  return {
    enabled: cfg.enabled === true,
    profile: normalizeProfile(cfg.profile),
    pageLimit: normalizeInteger(cfg.pageLimit, DEFAULT_PAGE_LIMIT, 1, 10000),
    iterations: normalizeInteger(cfg.iterations, DEFAULT_ITERATIONS, 1, 10),
    batchSizes: normalizeBatchSizes(cfg.batchSizes),
    batchCounts: normalizeBatchCounts(cfg.batchCounts),
    workerCounts: normalizeIntegerList(cfg.workerCounts, DEFAULT_WORKER_COUNTS, MAX_BENCHMARK_WORKER_COUNT),
    imageLoadConcurrencies: normalizeIntegerList(
      cfg.imageLoadConcurrencies,
      DEFAULT_IMAGE_LOAD_CONCURRENCIES,
      MAX_BENCHMARK_IMAGE_LOAD_CONCURRENCY
    ),
    mergeModes: normalizeMergeModes(cfg.mergeModes),
    strategies: normalizeStrategies(cfg.strategies),
    maxRuns: normalizeInteger(cfg.maxRuns, DEFAULT_MAX_RUNS, 1, 500),
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
  const scenarioPlan = createBenchmarkScenarios(benchmarkCfg, selected.urls.length, basePdfCfg);
  const scenarios = scenarioPlan.scenarios;
  const runs = [];
  const totalRuns = scenarios.length * benchmarkCfg.iterations;
  let completedRuns = 0;

  for (const scenario of scenarios) {
    for (let iteration = 1; iteration <= benchmarkCfg.iterations; iteration += 1) {
      if (signal?.aborted) {
        const error = new Error('PDF benchmark was cancelled.');
        error.name = 'AbortError';
        throw error;
      }

      onProgress?.({
        phase: 'running',
        batchSize: scenario.batchSize,
        scenarioLabel: scenario.scenarioLabel,
        strategy: scenario.strategy,
        workerCount: scenario.workerCount,
        imageLoadConcurrency: scenario.imageLoadConcurrency,
        mergeMode: scenario.mergeMode,
        iteration,
        completedRuns,
        totalRuns,
      });

      const pdfCfg = createScenarioPdfConfig(basePdfCfg, scenario);
      const plan = describeScenarioPlan(selected.urls.length, pdfCfg, scenario);
      const started = performance.now();
      const progressEvents = [];
      const blob = await createPrintPdfBlob(selected.urls, {
        ...baseOptions,
        pageContexts: selected.pageContexts,
        pdfCfg,
        signal,
        onProgress: (event) => {
          progressEvents.push({
            atMs: performance.now() - started,
            phase: String(event?.phase || 'unknown'),
            current: finiteNumberOrNull(event?.current),
            total: finiteNumberOrNull(event?.total),
            page: finiteNumberOrNull(event?.page),
            localCurrent: finiteNumberOrNull(event?.localCurrent),
            localTotal: finiteNumberOrNull(event?.localTotal),
            batchIndex: finiteNumberOrNull(event?.batchIndex),
            batchCount: finiteNumberOrNull(event?.batchCount),
            batchStartPageIndex: finiteNumberOrNull(event?.batchStartPageIndex),
            batchPageCount: finiteNumberOrNull(event?.batchPageCount),
            mergeCurrent: finiteNumberOrNull(event?.mergeCurrent),
            mergeTotal: finiteNumberOrNull(event?.mergeTotal),
            roundIndex: finiteNumberOrNull(event?.roundIndex),
            pairIndex: finiteNumberOrNull(event?.pairIndex),
            globalMergeTaskIndex: finiteNumberOrNull(event?.globalMergeTaskIndex),
          });
        },
      });
      const durationMs = performance.now() - started;
      const timings = summarizeBenchmarkTiming(progressEvents, durationMs);
      runs.push({
        strategy: scenario.strategy,
        scenarioLabel: scenario.scenarioLabel,
        batchSize: scenario.batchSize,
        batchSizeLabel: scenario.batchSize === 0 ? 'auto' : String(scenario.batchSize),
        workerCountSetting: scenario.workerCount,
        imageLoadConcurrencySetting: scenario.imageLoadConcurrency,
        mergeModeSetting: scenario.mergeMode,
        iteration,
        durationMs: Math.round(durationMs),
        outputBytes: Math.max(0, Number(blob?.size) || 0),
        workerCount: plan.workerCount,
        desiredWorkerCount: plan.desiredWorkerCount,
        resolvedBatchSize: plan.resolvedBatchSize,
        batchCount: plan.batchCount,
        mergeMode: plan.mergeMode || scenario.mergeMode || 'auto',
        plan,
        timings,
      });
      completedRuns += 1;
      onProgress?.({
        phase: 'completed-run',
        batchSize: scenario.batchSize,
        scenarioLabel: scenario.scenarioLabel,
        strategy: scenario.strategy,
        workerCount: scenario.workerCount,
        imageLoadConcurrency: scenario.imageLoadConcurrency,
        mergeMode: scenario.mergeMode,
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
    profile: benchmarkCfg.profile,
    batchSizes: benchmarkCfg.batchSizes,
    batchCounts: benchmarkCfg.batchCounts,
    workerCounts: benchmarkCfg.workerCounts,
    imageLoadConcurrencies: benchmarkCfg.imageLoadConcurrencies,
    mergeModes: benchmarkCfg.mergeModes,
    strategies: benchmarkCfg.strategies,
    maxRuns: benchmarkCfg.maxRuns,
    testedBatchSizes: Array.from(new Set(scenarios.map((scenario) => scenario.batchSize))),
    testedWorkerCounts: Array.from(new Set(scenarios.map((scenario) => scenario.workerCount))),
    testedImageLoadConcurrencies: Array.from(new Set(scenarios.map((scenario) => scenario.imageLoadConcurrency))),
    testedMergeModes: Array.from(new Set(scenarios.map((scenario) => scenario.mergeMode || 'auto'))),
    testedStrategies: Array.from(new Set(scenarios.map((scenario) => scenario.strategy))),
    testedScenarios: scenarios,
    scenarioCount: scenarios.length,
    totalScenarioCount: scenarioPlan.totalScenarioCount,
    scenarioLimitApplied: scenarioPlan.totalScenarioCount > scenarios.length,
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
