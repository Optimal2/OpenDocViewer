// File: src/ocr/boostBenchmark.js
/**
 * Opt-in OCR *boost* benchmark (`ocr.boostBenchmark.enabled`): the same measurement as
 * benchmark.js, but above the worker counts the viewer itself will ever run.
 *
 * Why a second module. The viewer's automatic worker policy stops at
 * `ocr.workerPolicy.maxWorkerCount` (4) and runtimeConfig.js hard-caps any worker count at
 * MAX_OCR_WORKER_COUNT (8), which also bounds benchmark.js. On a 24-core client the ordinary
 * benchmark scaled almost linearly up to that cap (34 -> 202 pages/min from one to eight
 * workers) while the main thread's worst lag grew from 86 ms to 549 ms, so the ceiling, not the
 * hardware, ended the curve. To learn where the curve actually bends, this benchmark measures
 * 4, 8, 12, 16, 20, 24 workers (`workerCounts`, up to BOOST_MAX_WORKER_COUNT below). It is a
 * measuring instrument only: nothing here raises the cap for the live queue, and neither the
 * worker policy, the queue, the engine pool nor the ordinary benchmark is touched. The numbers
 * are what a future decision about those caps would be made from.
 *
 * Because createConfiguredOcrEngine (setup.js) clamps a requested worker count to
 * MAX_OCR_WORKER_COUNT and createOcrEnginePool (enginePool.js) starts its engines lazily, this
 * module builds its own pool from createOcrEngine (engine.js): every engine of a scenario is
 * created and started up front, in parallel, so `startupMs` is the wall time until all of them
 * are ready — at these counts the start is a cost of its own, not noise inside the first pages.
 * Each scenario gets a fresh pool and terminates every engine afterwards, also when the
 * scenario aborts or the run is cancelled.
 *
 * Guard rails, since a scenario here may ask for more workers than the client can hold:
 * - a worker count above the reported cores is SKIPPED, with the reason in the result;
 * - a worker count whose engines would need more than `memoryBudgetFraction` of the device
 *   memory (`memoryPerWorkerMiB` each; `navigator.deviceMemory`, else 4 GiB assumed) is SKIPPED
 *   the same way;
 * - a scenario whose engines cannot start, or whose page heap passes HEAP_ABORT_FRACTION of
 *   `performance.memory.jsHeapSizeLimit` between pages (Chromium only; elsewhere the check is
 *   absent and the result says so), is ABORTED with its error recorded, and the run goes on
 *   with the next count.
 *
 * Pausing the live OCR queue is the caller's job (About -> Diagnostics does it through
 * `viewerContext.setOcrBenchmarkActive`, exactly as for the ordinary benchmark); this module
 * never touches queue.js. It is its own lazy chunk, reached only through
 * `loadOcrBoostBenchmark()` in index.js, so clicking nothing costs nothing.
 */
import logger from '../logging/systemLogger.js';
import { getOcrLanguages, getRuntimeConfig, resolveOcrWorkerPlan } from '../utils/runtimeConfig.js';
import { collectSupportDiagnostics, saveLatestOcrBoostBenchmarkResult } from '../utils/supportDiagnostics.js';

/** @type {(Object|null)} Memoised result of loadOcrBoostDependencies(). */
let borrowedModules = null;

/**
 * The measuring helpers of benchmark.js (reused rather than reimplemented, so both benchmarks
 * report the same statistics the same way) and the engine pieces a scenario is built from, all
 * taken from the OCR entry point with `import()` instead of `import ... from`.
 *
 * Why not a plain static import, which would read better. scripts/verify-ocr-lazy-chunk.mjs
 * enforces two bundle rules at once: every chunk that mentions tesseract must BE the `ocr`
 * chunk, and no chunk may import the ocr chunk statically — only `import("...")` may reach it,
 * so the engine cannot arrive except through the gated loader in src/utils/ocrLoader.js. This
 * module lives in its own chunk (index.js reaches it dynamically, see `loadOcrBoostBenchmark`),
 * which leaves exactly one edge that breaks neither rule: a dynamic import of `./index.js`, the
 * ocr chunk's own entry. Importing the individual modules instead — statically or dynamically —
 * fails the build: statically it is a second, ungated door into the chunk; dynamically each one
 * becomes a split point of its own and tesseract lands in a chunk that is not the ocr chunk
 * (measured: `engine-<hash>.js mentions tesseract but is not an ocr chunk`).
 *
 * Nothing is paid for this at runtime. The caller already holds the ocr chunk — it is what
 * handed out `loadOcrBoostBenchmark` — so the import resolves from the module cache. The cycle
 * (index.js -> this module -> index.js) is dynamic on both legs and is entered only when the
 * benchmark runs, long after both modules have been evaluated.
 *
 * @returns {Promise<{ summarizeDurations: Function, startMainThreadLagSampler: Function,
 *   selectOcrBenchmarkPages: Function, resolveOcrBenchmarkLanguages: Function,
 *   createOcrEngine: Function, prepareOcrImage: Function, describeOcrSetup: Function }>}
 */
export async function loadOcrBoostDependencies() {
  if (!borrowedModules) {
    const ocr = await import('./index.js');
    borrowedModules = {
      summarizeDurations: ocr.summarizeDurations,
      startMainThreadLagSampler: ocr.startMainThreadLagSampler,
      selectOcrBenchmarkPages: ocr.selectOcrBenchmarkPages,
      resolveOcrBenchmarkLanguages: ocr.resolveOcrBenchmarkLanguages,
      createOcrEngine: ocr.createOcrEngine,
      prepareOcrImage: ocr.prepareOcrImage,
      describeOcrSetup: ocr.describeOcrSetup,
    };
  }
  return borrowedModules;
}

export const OCR_BOOST_BENCHMARK_SCHEMA = 'opendocviewer.ocr-boost-benchmark.v1';

/**
 * Most workers a boost scenario may ask for. Local to this module on purpose: it is a bound on
 * the measurement, not a new limit for the viewer, and MAX_OCR_WORKER_COUNT in runtimeConfig.js
 * (8) stays what the live queue is allowed. 32 covers the widest client in sight (a 24-core
 * workstation plus headroom) and keeps a mistyped site file from asking for hundreds of workers.
 */
export const BOOST_MAX_WORKER_COUNT = 32;

/** Defaults of `ocr.boostBenchmark` beyond the switch. */
export const OCR_BOOST_BENCHMARK_DEFAULTS = Object.freeze({
  workerCounts: Object.freeze([4, 8, 12, 16, 20, 24]),
  pageLimit: 120,
  sampleMode: 'evenly-spaced',
  // Half the device memory, against a quarter for the live policy: this run is the only thing
  // the client is doing, and the point is to reach the counts the policy would never allow.
  memoryBudgetFraction: 0.5,
  // The measured renderer growth per engine holding two language models (see the measurement
  // note at OCR_WORKER_POLICY_DEFAULTS in runtimeConfig.js: steps of 127, 173 and 87 MiB).
  memoryPerWorkerMiB: 130,
  pageTimeoutMs: 180000,
  delayBetweenRunsMs: 500,
});

const MAX_PAGE_LIMIT = 1000;
const MAX_PAGE_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_MODES = Object.freeze(['first', 'evenly-spaced']);
/** Device memory assumed for a browser that does not report it (Firefox, Safari), in GiB. */
const ASSUMED_DEVICE_MEMORY_GIB = 4;
/** A used JS heap above this share of `jsHeapSizeLimit` ends the scenario before the page heap does. */
const HEAP_ABORT_FRACTION = 0.9;

/** Reasons a scenario did not run; kept in the result so the gap in the curve is explained. */
export const BOOST_SKIP_REASON = Object.freeze({
  CORES: 'cores',
  MEMORY: 'memory',
});

/** Reasons a scenario stopped part-way. */
export const BOOST_ABORT_REASON = Object.freeze({
  ENGINE_START: 'engine-start',
  HEAP: 'heap',
});

/**
 * @typedef {Object} OcrBoostBenchmarkConfig
 * @property {boolean} enabled
 * @property {Array<number>} workerCounts  1..BOOST_MAX_WORKER_COUNT, deduped and ascending.
 * @property {number} pageLimit
 * @property {string} sampleMode  'evenly-spaced' or 'first'.
 * @property {number} memoryBudgetFraction  Share of the device memory the engines may take.
 * @property {number} memoryPerWorkerMiB  What one engine is taken to cost.
 * @property {number} pageTimeoutMs
 * @property {number} delayBetweenRunsMs
 */

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function integerIn(value, fallback, min, max) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function fractionIn(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * Read `ocr.boostBenchmark` with every value bounded, as normalizeOcrBenchmarkConfig does for
 * `ocr.benchmark`: a non-numeric or out-of-range entry is dropped, and a list left with nothing
 * usable falls back to its default. Worker counts are clamped to 1..BOOST_MAX_WORKER_COUNT,
 * deduped and sorted, so the result reads as a curve from the lowest count up.
 *
 * @param {Object=} cfg  Runtime config (defaults to the viewer's).
 * @returns {OcrBoostBenchmarkConfig}
 */
export function normalizeOcrBoostBenchmarkConfig(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.boostBenchmark && typeof cfg.ocr.boostBenchmark === 'object' ? cfg.ocr.boostBenchmark : {};
  const counts = [];
  for (const item of Array.isArray(raw.workerCounts) ? raw.workerCounts : OCR_BOOST_BENCHMARK_DEFAULTS.workerCounts) {
    const count = Math.floor(Number(item));
    if (!Number.isFinite(count) || count < 1 || count > BOOST_MAX_WORKER_COUNT || counts.includes(count)) continue;
    counts.push(count);
  }
  counts.sort((a, b) => a - b);
  const sampleMode = String(raw.sampleMode || '').trim().toLowerCase();
  return {
    enabled: raw.enabled === true,
    workerCounts: counts.length ? counts : [...OCR_BOOST_BENCHMARK_DEFAULTS.workerCounts],
    pageLimit: integerIn(raw.pageLimit, OCR_BOOST_BENCHMARK_DEFAULTS.pageLimit, 1, MAX_PAGE_LIMIT),
    sampleMode: SAMPLE_MODES.includes(sampleMode) ? sampleMode : OCR_BOOST_BENCHMARK_DEFAULTS.sampleMode,
    memoryBudgetFraction: fractionIn(raw.memoryBudgetFraction, OCR_BOOST_BENCHMARK_DEFAULTS.memoryBudgetFraction, 0.05, 1),
    memoryPerWorkerMiB: fractionIn(raw.memoryPerWorkerMiB, OCR_BOOST_BENCHMARK_DEFAULTS.memoryPerWorkerMiB, 1, 65536),
    pageTimeoutMs: integerIn(raw.pageTimeoutMs, OCR_BOOST_BENCHMARK_DEFAULTS.pageTimeoutMs, 1000, MAX_PAGE_TIMEOUT_MS),
    delayBetweenRunsMs: integerIn(raw.delayBetweenRunsMs, OCR_BOOST_BENCHMARK_DEFAULTS.delayBetweenRunsMs, 0, 60000),
  };
}

/**
 * @typedef {Object} OcrBoostCapacity
 * @property {number} cores  Reported logical cores; 0 when the browser does not say.
 * @property {boolean} coresReported
 * @property {number} deviceMemoryGiB  Reported device memory, else ASSUMED_DEVICE_MEMORY_GIB.
 * @property {boolean} deviceMemoryReported
 * @property {number} memoryBudgetMiB  What the engines of one scenario may take together.
 * @property {number} maxWorkersByMemory  Workers that budget holds.
 */

/**
 * What this client can hold, as the skip rules read it.
 *
 * @param {Object} args
 * @param {number} args.cores
 * @param {number} args.deviceMemoryGiB  0 when the browser does not report it.
 * @param {OcrBoostBenchmarkConfig} args.config
 * @returns {OcrBoostCapacity}
 */
export function describeOcrBoostCapacity({ cores, deviceMemoryGiB, config }) {
  const reportedCores = Math.max(0, Math.floor(Number(cores) || 0));
  const reportedMemory = Math.max(0, Number(deviceMemoryGiB) || 0);
  const memoryGiB = reportedMemory > 0 ? reportedMemory : ASSUMED_DEVICE_MEMORY_GIB;
  const memoryBudgetMiB = memoryGiB * 1024 * config.memoryBudgetFraction;
  return {
    cores: reportedCores,
    coresReported: reportedCores > 0,
    deviceMemoryGiB: memoryGiB,
    deviceMemoryReported: reportedMemory > 0,
    memoryBudgetMiB: Math.round(memoryBudgetMiB),
    maxWorkersByMemory: Math.max(0, Math.floor(memoryBudgetMiB / config.memoryPerWorkerMiB)),
  };
}

/**
 * Whether a worker count may run on this client, and why not when it may not. A browser that
 * does not report its cores leaves the core rule out (it cannot be read, and skipping every
 * count would measure nothing); the memory rule still applies, on the assumed memory.
 *
 * `skipDetail` is the English sentence for the JSON; `skipFacts` carries the same numbers as
 * fields, so a UI can build its own localized sentence instead of showing either the English
 * text or the bare enum. Both are additive: `skipped`/`skipReason` keep their old meaning.
 *
 * @param {number} workerCount
 * @param {OcrBoostCapacity} capacity
 * @param {OcrBoostBenchmarkConfig} config
 * @returns {{ skipped: boolean, skipReason: (string|null), skipDetail: (string|null), skipFacts: (Object|null) }}
 */
export function judgeOcrBoostScenario(workerCount, capacity, config) {
  if (capacity.coresReported && workerCount > capacity.cores) {
    return {
      skipped: true,
      skipReason: BOOST_SKIP_REASON.CORES,
      skipDetail: `${workerCount} workers exceed the ${capacity.cores} logical cores this client reports`,
      skipFacts: { workerCount, cores: capacity.cores },
    };
  }
  const neededMiB = workerCount * config.memoryPerWorkerMiB;
  if (neededMiB > capacity.memoryBudgetMiB) {
    const assumed = capacity.deviceMemoryReported ? '' : ' (assumed; the browser does not report device memory)';
    return {
      skipped: true,
      skipReason: BOOST_SKIP_REASON.MEMORY,
      skipDetail: `${workerCount} workers need about ${Math.round(neededMiB)} MiB, above the ${capacity.memoryBudgetMiB} MiB budget `
        + `(${config.memoryBudgetFraction} of ${capacity.deviceMemoryGiB} GiB${assumed})`,
      skipFacts: {
        workerCount,
        neededMiB: Math.round(neededMiB),
        budgetMiB: capacity.memoryBudgetMiB,
        deviceMemoryGiB: capacity.deviceMemoryGiB,
        deviceMemoryAssumed: !capacity.deviceMemoryReported,
      },
    };
  }
  return { skipped: false, skipReason: null, skipDetail: null, skipFacts: null };
}

/**
 * The page's JS heap where the browser exposes it (`performance.memory`, Chromium only).
 *
 * @returns {{ supported: boolean, usedMiB: number, limitMiB: number, usedFraction: number }}
 */
export function readJsHeap() {
  const memory = globalThis.performance?.memory;
  const used = Number(memory?.usedJSHeapSize) || 0;
  const limit = Number(memory?.jsHeapSizeLimit) || 0;
  if (!(used > 0) || !(limit > 0)) return { supported: false, usedMiB: 0, limitMiB: 0, usedFraction: 0 };
  return {
    supported: true,
    usedMiB: Math.round(used / 1048576),
    limitMiB: Math.round(limit / 1048576),
    usedFraction: Math.round((used / limit) * 1000) / 1000,
  };
}

/**
 * @param {Promise<*>} promise
 * @param {number} ms
 * @param {string} what
 * @param {function(): void=} onTimeout
 * @returns {Promise<*>}
 */
function withTimeout(promise, ms, what, onTimeout) {
  let timer;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* best effort */ }
      reject(new Error(`OCR boost benchmark ${what} exceeded ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

function abortError() {
  const error = new Error('OCR boost benchmark was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/**
 * @param {number} ms
 * @param {AbortSignal=} signal
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * A pool of OCR engines for one boost scenario: every engine created and started up front, in
 * parallel, one lane of the page loop per engine. Unlike createOcrEnginePool (enginePool.js)
 * nothing is lazy here, because the start of this many engines is part of what is measured, and
 * nothing is clamped to MAX_OCR_WORKER_COUNT, because the counts above it are the point.
 *
 * A lane whose engine had to be terminated mid-run (a recognition that passed the timeout
 * leaves a hung worker) is marked dead and stops pulling pages; the remaining pages are taken
 * by the lanes that still work, so one bad worker costs pages, not the scenario.
 *
 * Construction itself can fail: `createEngine` is the factory of a live engine, and engine
 * number k may throw where the first k-1 were made. Nothing is thrown onwards for that — the
 * engines already created are terminated at once, no lane is handed out, and the pool reports
 * the failure from `startAll` as the engine-start error it is, so the scenario is recorded as
 * aborted and the run goes on with the next worker count instead of dying with a leak behind it.
 *
 * @param {Object} args
 * @param {number} args.size  Engines to create and start.
 * @param {function(number): Object} args.createEngine  Makes engine number `index` (0-based).
 * @returns {{ lanes: Array<{ index: number, engine: Object, dead: boolean }>, creationError: (string|null), enginesCreated: number, startAll: function(number): Promise<{ startupMs: number, perEngineMs: Array<number>, error: (string|null) }>, terminateAll: function(): Promise<number> }}
 */
export function createBoostEnginePool({ size, createEngine }) {
  if (typeof createEngine !== 'function') throw new Error('OCR boost benchmark needs an engine factory');
  const count = Math.max(1, Math.min(BOOST_MAX_WORKER_COUNT, Math.floor(Number(size)) || 1));
  const lanes = [];
  let creationError = null;
  for (let index = 0; index < count; index += 1) {
    try {
      lanes.push({ index, engine: createEngine(index), dead: false });
    } catch (reason) {
      creationError = `OCR boost benchmark engine ${index + 1} of ${count} could not be created: ${String(reason?.message || reason)}`;
      break;
    }
  }
  if (creationError) {
    // The engines of a pool that never came together must not outlive it: stop them now, and
    // keep the promise so terminateAll() can be awaited exactly as on the working path.
    const created = lanes.length;
    const cleanup = Promise.all(lanes.map(async (lane) => {
      // Best effort, and a terminate() that throws synchronously must not escape either: the
      // engine that could not be made is the failure being reported, not this one.
      try { await lane.engine.terminate(); } catch { /* nothing better to do here */ }
    }));
    // No lane is offered, so neither the page loop nor startAll can touch a terminated engine.
    lanes.length = 0;
    return {
      lanes,
      creationError,
      enginesCreated: created,
      async startAll() {
        await cleanup;
        return { startupMs: 0, perEngineMs: [], error: creationError };
      },
      async terminateAll() {
        await cleanup;
        return created;
      },
    };
  }
  return {
    lanes,
    creationError: null,
    enginesCreated: count,
    /**
     * Start every engine at once and time it. The wall time until the last one is ready is the
     * scenario's `startupMs`; the per-engine times show whether they serialised on the network
     * or the CPU. One engine failing fails the start: the scenario cannot be measured then.
     */
    async startAll(timeoutMs) {
      const startedAt = performance.now();
      const perEngineMs = new Array(count).fill(0);
      let error = null;
      try {
        await withTimeout(Promise.all(lanes.map(async (lane) => {
          const engineStart = performance.now();
          await lane.engine.ensureStarted();
          perEngineMs[lane.index] = Math.round(performance.now() - engineStart);
        })), timeoutMs, 'engine start');
      } catch (reason) {
        error = String(reason?.message || reason);
      }
      return { startupMs: Math.round(performance.now() - startedAt), perEngineMs, error };
    },
    /** Stop every engine; returns how many were asked to stop. Never rejects. */
    async terminateAll() {
      await Promise.all(lanes.map((lane) => Promise.resolve(lane.engine.terminate()).catch(() => {})));
      return lanes.length;
    },
  };
}

/**
 * Run `worker` over `items`, one lane per engine, each lane pulling the next item from a shared
 * cursor. `shouldStop` is asked before every item, so a scenario-level stop (a heap over the
 * limit) ends every lane at a page boundary.
 *
 * @template T
 * @param {Array<T>} items
 * @param {Array<{ dead: boolean }>} lanes
 * @param {function(T, Object): Promise<void>} worker
 * @param {function(): boolean} shouldStop
 * @returns {Promise<void>}
 */
async function runInLanes(items, lanes, worker, shouldStop) {
  let next = 0;
  await Promise.all(lanes.map(async (lane) => {
    while (next < items.length) {
      if (lane.dead || shouldStop()) return;
      const index = next;
      next += 1;
      await worker(items[index], lane);
    }
  }));
}

/**
 * Recognise the sampled pages once on a fresh pool of `scenario.workerCount` engines and
 * measure it.
 *
 * @param {Object} args
 * @param {{ label: string, workerCount: number, languages: Array<string> }} args.scenario
 * @param {Array<{ viewerIndex: number, page: Object }>} args.pages
 * @param {Object} args.cfg
 * @param {function(number): Promise<Blob>} args.loadPageImage
 * @param {function(Blob, Object): Promise<Object>} args.prepareImage
 * @param {function(Object, Object): { engine: Object }} args.createEngine  `(cfg, { workerCount, engineIndex })`.
 * @param {number} args.pageTimeoutMs
 * @param {number} args.sourcePageCount  Pages of the loaded document, for `wholeDocumentSeconds`.
 * @param {Object} args.helpers  loadOcrBoostDependencies()'s result.
 * @param {AbortSignal=} args.signal
 * @param {function(Object): void=} args.onPage
 * @param {function(): Object=} args.lagSampler
 * @param {function(): Object=} args.readHeap
 * @returns {Promise<Object>}
 */
async function runBoostScenario({
  scenario, pages, cfg, loadPageImage, prepareImage, createEngine, pageTimeoutMs, sourcePageCount,
  helpers, signal, onPage, lagSampler = helpers.startMainThreadLagSampler, readHeap = readJsHeap,
}) {
  const { summarizeDurations } = helpers;
  const scenarioCfg = { ...cfg, ocr: { ...(cfg?.ocr || {}), languages: scenario.languages } };
  const pool = createBoostEnginePool({
    size: scenario.workerCount,
    createEngine: (engineIndex) => createEngine(scenarioCfg, { workerCount: scenario.workerCount, engineIndex }).engine,
  });
  const heapBefore = readHeap();
  const sampler = lagSampler();
  const results = [];
  const startedUtc = new Date().toISOString();
  // Assigned before anything reads them (the first two from the pool's start, the last two in
  // the finally), so they carry no initial value: a dead initialiser is a lint error here.
  /** @type {number} */
  let startupMs;
  /** @type {Object} */
  let engineStartupMs;
  /** @type {number} */
  let terminatedEngines;
  /** @type {Object} Filled in the finally, so an abort stops the sampler too. */
  let mainThread;
  // These do keep their initial value: a scenario whose engines never started reports no
  // duration and no abort detail beyond the start-up error.
  let durationMs = 0;
  let startupError = null;
  let abortReason = null;
  let abortDetail = null;
  let heapAtAbort = null;
  try {
    const start = await pool.startAll(pageTimeoutMs);
    startupMs = start.startupMs;
    engineStartupMs = summarizeDurations(start.perEngineMs);
    if (start.error) {
      startupError = start.error;
      abortReason = BOOST_ABORT_REASON.ENGINE_START;
      abortDetail = start.error;
    } else {
      const loopStart = performance.now();
      const shouldStop = () => abortReason !== null;
      await runInLanes(pages, pool.lanes, async (entry, lane) => {
        throwIfAborted(signal);
        const record = { viewerIndex: entry.viewerIndex, engineIndex: lane.index, imageMs: 0, prepareMs: 0, recognizeMs: 0, words: 0, confidence: 0, chars: 0, width: 0, height: 0, error: null };
        const pageStart = performance.now();
        try {
          const blob = await withTimeout(loadPageImage(entry.viewerIndex), pageTimeoutMs, 'page image');
          const prepareStart = performance.now();
          record.imageMs = Math.round(prepareStart - pageStart);
          // The page image as the viewer renders it: a boost scenario never downscales, so a
          // worker count is compared against the others at one resolution only.
          const prepared = await withTimeout(prepareImage(blob, {}), pageTimeoutMs, 'image preparation');
          record.width = prepared.width;
          record.height = prepared.height;
          record.prepareMs = Math.round(performance.now() - prepareStart);
          const recognizeStart = performance.now();
          // A single engine cannot abort one recognition, so a page over the timeout takes its
          // engine with it and the lane stops; the other lanes carry the rest of the pages.
          const result = await withTimeout(engineRecognize(lane, prepared.blob), pageTimeoutMs, 'recognition', () => {
            lane.dead = true;
            Promise.resolve(lane.engine.terminate()).catch(() => {});
          });
          record.recognizeMs = Math.round(performance.now() - recognizeStart);
          record.words = Array.isArray(result?.words) ? result.words.length : 0;
          record.confidence = Math.round(Number(result?.confidence) || 0);
          record.chars = String(result?.text || '').replace(/\s+/g, '').length;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          record.error = String(error?.message || error);
        }
        results.push(record);
        // Between pages, not during one: a heap this close to the limit would otherwise be an
        // "Out of memory" tab, and the measurement would be lost with it.
        const heap = readHeap();
        if (heap.supported && heap.usedFraction > HEAP_ABORT_FRACTION) {
          abortReason = BOOST_ABORT_REASON.HEAP;
          abortDetail = `JS heap at ${Math.round(heap.usedFraction * 100)} % of the ${heap.limitMiB} MiB limit after ${results.length} pages; `
            + `${scenario.workerCount} workers do not fit on this client`;
          heapAtAbort = heap;
        }
        onPage?.({ completedPages: results.length, pageCount: pages.length });
      }, shouldStop);
      durationMs = Math.round(performance.now() - loopStart);
    }
  } finally {
    // Also on an abort or a cancellation: no engine of this scenario may outlive it, and the
    // sampler's timer must not keep ticking into the next one.
    mainThread = sampler.stop();
    terminatedEngines = await pool.terminateAll();
  }
  const heapAfter = readHeap();
  const done = results.filter((record) => !record.error);
  // Pages never reached (a failed start, an abort, every lane dead) count as errors too, so
  // `recognizedPages + errorCount` always covers the sample.
  const errorCount = pages.length - done.length;
  const recognized = done.length;
  const confidenceSum = done.reduce((total, record) => total + record.confidence, 0);
  const msPerPage = recognized > 0 ? Math.round(durationMs / recognized) : 0;
  return {
    label: scenario.label,
    workerCount: scenario.workerCount,
    skipped: false,
    skipReason: null,
    skipDetail: null,
    skipFacts: null,
    languages: scenario.languages,
    pageCount: pages.length,
    recognizedPages: recognized,
    errorCount,
    startupError,
    aborted: abortReason !== null,
    abortReason,
    abortError: abortDetail,
    heapAtAbort,
    deadLanes: pool.lanes.filter((lane) => lane.dead).length,
    enginesCreated: pool.enginesCreated,
    enginesTerminated: terminatedEngines,
    startedUtc,
    endedUtc: new Date().toISOString(),
    // Wall time until every engine of the scenario was ready, and how the single starts spread.
    startupMs,
    engineStartupMs,
    durationMs,
    msPerPage,
    pagesPerMinute: durationMs > 0 ? Math.round(((recognized * 60000) / durationMs) * 10) / 10 : 0,
    // What the operator compares counts by: the two numbers a site actually feels. Both from the
    // measured throughput (`msPerPage`), to one decimal; `wholeDocumentSeconds` extrapolates it
    // over the loaded document's own page count, which is usually far above the sample.
    secondsPer100Pages: msPerPage > 0 ? Math.round(((msPerPage * 100) / 1000) * 10) / 10 : 0,
    wholeDocumentSeconds: msPerPage > 0 && sourcePageCount > 0 ? Math.round(((msPerPage * sourcePageCount) / 1000) * 10) / 10 : 0,
    recognizeMs: summarizeDurations(done.map((record) => record.recognizeMs)),
    imageMs: summarizeDurations(done.map((record) => record.imageMs)),
    prepareMs: summarizeDurations(done.map((record) => record.prepareMs)),
    words: done.reduce((total, record) => total + record.words, 0),
    chars: done.reduce((total, record) => total + record.chars, 0),
    meanConfidence: recognized > 0 ? Math.round(confidenceSum / recognized) : 0,
    mainThread,
    jsHeapMiB: { before: heapBefore.usedMiB, after: heapAfter.usedMiB, limit: heapAfter.limitMiB || heapBefore.limitMiB, supported: heapBefore.supported || heapAfter.supported },
    pages: results,
  };
}

/**
 * Recognise on a lane's engine. A pooled engine takes a control object; a single engine
 * (engine.js) takes the image alone, which is what a lane holds.
 *
 * @param {{ engine: Object }} lane
 * @param {*} image
 * @returns {Promise<Object>}
 */
function engineRecognize(lane, image) {
  return lane.engine.recognize(image);
}

/**
 * Run the OCR boost benchmark over the loaded document: one scenario per configured worker
 * count, each on its own pool of that many engines, with the counts this client cannot hold
 * skipped and stated. Same options as runOcrBenchmark (benchmark.js), so the About dialog can
 * drive either with the same code. The result is returned, not saved: what to do with it is the
 * caller's choice (`inject.save` for a caller that wants both).
 *
 * @param {Object} args
 * @param {Object=} args.config  Runtime config (defaults to the viewer's); must have the switch on.
 * @param {Array<Object>} args.allPages  The viewer's pages.
 * @param {function(number, string): Promise<(string|null)>} args.ensurePageAsset  `(viewerIndex, 'full')` to the page image URL.
 * @param {(function(number, string): void|null)=} args.releasePageAsset  Drop a render made only
 *   for the benchmark, as runOcrBenchmark does.
 * @param {function(Object): void=} args.onProgress  `{ phase, completedRuns, totalRuns, scenarioLabel,
 *   completedPages, pageCount, workerCount }`, plus `skipped`, `skipReason` (the enum),
 *   `skipDetail` (the English sentence) and `skipFacts` (the same numbers as fields, for a
 *   caller that builds its own localized sentence) for a skipped count.
 * @param {AbortSignal=} args.signal
 * @param {Object=} args.inject  Test seams: `createEngine` (`(cfg, { workerCount, engineIndex })`
 *   -> `{ engine }`; default one createOcrEngine per engine from describeOcrSetup), `prepareImage`,
 *   `fetchBlob`, `cores`, `deviceMemoryGiB`, `lagSampler`, `readHeap`, `diagnostics`, `save`,
 *   `helpers` (loadOcrBoostDependencies()'s result, to keep the engine module out of a test).
 * @returns {Promise<Object>} The result.
 */
export async function runOcrBoostBenchmark({ config, allPages, ensurePageAsset, releasePageAsset = null, onProgress, signal, inject = {} }) {
  const cfg = config || getRuntimeConfig();
  const benchmark = normalizeOcrBoostBenchmarkConfig(cfg);
  if (!benchmark.enabled) throw new Error('OCR boost benchmark is disabled by configuration.');
  if (typeof ensurePageAsset !== 'function') throw new Error('OCR boost benchmark needs the page image provider.');
  const helpers = inject.helpers || await loadOcrBoostDependencies();
  const { resolveOcrBenchmarkLanguages, selectOcrBenchmarkPages } = helpers;
  const pages = selectOcrBenchmarkPages(allPages, benchmark.pageLimit, benchmark.sampleMode);
  if (!pages.length) throw new Error('No loaded page is available for the OCR boost benchmark.');

  const cores = Math.max(0, Math.floor(Number(inject.cores ?? globalThis.navigator?.hardwareConcurrency) || 0));
  const reportedDeviceMemoryGiB = Number(inject.deviceMemoryGiB ?? globalThis.navigator?.deviceMemory) || 0;
  const capacity = describeOcrBoostCapacity({ cores, deviceMemoryGiB: reportedDeviceMemoryGiB, config: benchmark });
  const configuredLanguages = getOcrLanguages(cfg);
  const languages = resolveOcrBenchmarkLanguages(cfg);
  const sourcePageCount = Array.isArray(allPages) ? allPages.length : 0;
  // What the viewer's own policy would pick for this document on this client, read-only, so the
  // curve shows where the automatic choice sits among the measured counts.
  const automaticPlan = resolveOcrWorkerPlan(cfg, { cores, deviceMemoryGiB: reportedDeviceMemoryGiB, pageCount: sourcePageCount, languageCount: languages.length });
  const readHeap = inject.readHeap || readJsHeap;
  const heapProbe = readHeap();

  // The engines are built here rather than through createConfiguredOcrEngine, which clamps the
  // worker count to MAX_OCR_WORKER_COUNT. The setup (languages, asset URLs) is read once: it is
  // the same for every scenario, and describeOcrSetup logs its configuration warnings per call.
  let sharedSetup = null;
  const createEngine = inject.createEngine || ((scenarioCfg) => {
    if (!sharedSetup) sharedSetup = helpers.describeOcrSetup(scenarioCfg);
    return { engine: helpers.createOcrEngine({ languages: sharedSetup.languages, assetUrls: sharedSetup.assetUrls }) };
  });
  const prepareImage = inject.prepareImage || ((blob, options) => helpers.prepareOcrImage(blob, options));
  const fetchBlob = inject.fetchBlob || (async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Page image could not be read (${response.status})`);
    return response.blob();
  });
  const loadPageImage = async (viewerIndex) => {
    const page = allPages[viewerIndex];
    const renderedBefore = Number(page?.fullSizeStatus) === 1;
    const url = await ensurePageAsset(viewerIndex, 'full');
    if (!url) throw new Error('Page image is unavailable');
    const blob = await fetchBlob(url);
    if (!renderedBefore) {
      try { releasePageAsset?.(viewerIndex, url); } catch { /* the viewer keeps it */ }
    }
    return blob;
  };

  const scenarios = benchmark.workerCounts.map((workerCount) => ({
    label: `boost-workers-${workerCount}`,
    workerCount,
    languages,
    ...judgeOcrBoostScenario(workerCount, capacity, benchmark),
  }));
  const totalRuns = scenarios.length;
  const runs = [];
  for (const scenario of scenarios) {
    throwIfAborted(signal);
    const progress = (extra = {}) => onProgress?.({
      phase: 'running',
      completedRuns: runs.length,
      totalRuns,
      scenarioLabel: scenario.label,
      workerCount: scenario.workerCount,
      completedPages: 0,
      pageCount: pages.length,
      ...extra,
    });
    if (scenario.skipped) {
      // The enum alone would leave a caller with "memory" to show; the sentence and the numbers
      // travel with it, so a UI can say which numbers made the count impossible, in its language.
      progress({
        skipped: true,
        skipReason: scenario.skipReason,
        skipDetail: scenario.skipDetail,
        skipFacts: scenario.skipFacts,
      });
      runs.push({
        label: scenario.label,
        workerCount: scenario.workerCount,
        skipped: true,
        skipReason: scenario.skipReason,
        skipDetail: scenario.skipDetail,
        skipFacts: scenario.skipFacts,
        languages,
        pageCount: 0,
        recognizedPages: 0,
      });
      continue;
    }
    progress();
    const run = await runBoostScenario({
      scenario, pages, cfg, loadPageImage, prepareImage, createEngine, helpers,
      pageTimeoutMs: benchmark.pageTimeoutMs, sourcePageCount, signal, onPage: progress,
      lagSampler: inject.lagSampler, readHeap,
    });
    runs.push(run);
    await delay(benchmark.delayBetweenRunsMs, signal);
  }

  const measured = runs.filter((run) => !run.skipped && !run.aborted && run.errorCount === 0 && run.recognizedPages > 0);
  const best = [...measured].sort((a, b) => a.msPerPage - b.msPerPage)[0] || null;
  const baseline = measured[0] || null;
  const result = {
    schema: OCR_BOOST_BENCHMARK_SCHEMA,
    createdUtc: new Date().toISOString(),
    // The ceiling of this measurement, and the live cap it deliberately does not change.
    boostMaxWorkerCount: BOOST_MAX_WORKER_COUNT,
    hardwareConcurrency: capacity.cores,
    coresReported: capacity.coresReported,
    deviceMemoryGiB: capacity.deviceMemoryGiB,
    deviceMemoryReported: capacity.deviceMemoryReported,
    deviceMemoryAssumed: !capacity.deviceMemoryReported,
    memoryBudgetFraction: benchmark.memoryBudgetFraction,
    memoryPerWorkerMiB: benchmark.memoryPerWorkerMiB,
    memoryBudgetMiB: capacity.memoryBudgetMiB,
    maxWorkersByMemory: capacity.maxWorkersByMemory,
    // The heap check is Chromium-only; elsewhere a scenario can only be stopped by its engines.
    heapCheckAvailable: heapProbe.supported,
    heapAbortFraction: HEAP_ABORT_FRACTION,
    jsHeapLimitMiB: heapProbe.limitMiB,
    languages,
    configuredLanguages,
    automaticPlan: {
      workerCount: automaticPlan.workerCount,
      automatic: automaticPlan.automatic,
      caps: automaticPlan.caps,
      inputs: automaticPlan.inputs,
      policy: automaticPlan.policy,
    },
    pageCount: pages.length,
    sourcePageCount,
    sampledViewerIndexes: pages.map((entry) => entry.viewerIndex),
    pageLimit: benchmark.pageLimit,
    sampleMode: benchmark.sampleMode,
    workerCounts: benchmark.workerCounts,
    pageTimeoutMs: benchmark.pageTimeoutMs,
    delayBetweenRunsMs: benchmark.delayBetweenRunsMs,
    scenarios: scenarios.map(({ label, workerCount, skipped, skipReason, skipDetail, skipFacts }) => ({ label, workerCount, skipped, skipReason, skipDetail, skipFacts })),
    runs,
    skippedCounts: scenarios.filter((scenario) => scenario.skipped).map((scenario) => ({ workerCount: scenario.workerCount, skipReason: scenario.skipReason, skipDetail: scenario.skipDetail, skipFacts: scenario.skipFacts })),
    best: best ? { label: best.label, workerCount: best.workerCount, msPerPage: best.msPerPage, pagesPerMinute: best.pagesPerMinute, secondsPer100Pages: best.secondsPer100Pages, wholeDocumentSeconds: best.wholeDocumentSeconds } : null,
    baseline: baseline ? { label: baseline.label, workerCount: baseline.workerCount, msPerPage: baseline.msPerPage, pagesPerMinute: baseline.pagesPerMinute } : null,
    diagnostics: (inject.diagnostics || collectSupportDiagnostics)({ latestPdfBenchmark: null, latestRenderDecodeBenchmark: null, latestOcrBenchmark: null }),
  };
  // Kept for the About dialog, which reads it back with loadLatestOcrBoostBenchmarkResult() when
  // it reopens and offers it as a JSON download, exactly as the ordinary benchmark is kept.
  (inject.save || saveLatestOcrBoostBenchmarkResult)(result);
  logger.info('OCR boost benchmark completed', {
    pageCount: pages.length,
    scenarioCount: scenarios.length,
    skippedCount: result.skippedCounts.length,
    bestScenario: best?.label || null,
    bestPagesPerMinute: best?.pagesPerMinute ?? null,
  });
  return result;
}
