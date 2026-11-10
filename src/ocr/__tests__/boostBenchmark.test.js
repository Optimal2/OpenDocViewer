// File: src/ocr/__tests__/boostBenchmark.test.js
// @vitest-environment jsdom
/**
 * The OCR boost benchmark: the configuration is bounded with its defaults and its own ceiling of
 * 32 workers, a worker count the client cannot hold is skipped with its reason, a scenario whose
 * engines cannot start or whose heap passes the limit is aborted and recorded, the derived
 * seconds-per-100-pages and whole-document figures follow the measured throughput, and every
 * engine of a scenario is terminated after it — also when the run is cancelled.
 *
 * Engines, images, the lag sampler and the heap reading are fakes; nothing is recognised here.
 * The last test is the guard that matters most: importing this module must leave the viewer's own
 * MAX_OCR_WORKER_COUNT at 8, since the boost ceiling is a bound on the measurement only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOST_ABORT_REASON,
  BOOST_MAX_WORKER_COUNT,
  BOOST_SKIP_REASON,
  OCR_BOOST_BENCHMARK_DEFAULTS,
  OCR_BOOST_BENCHMARK_SCHEMA,
  describeOcrBoostCapacity,
  judgeOcrBoostScenario,
  normalizeOcrBoostBenchmarkConfig,
  readJsHeap,
  runOcrBoostBenchmark,
} from '../boostBenchmark.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const enabled = (boostBenchmark = {}) => ({
  ocr: { enabled: true, languages: ['swe', 'eng'], boostBenchmark: { enabled: true, ...boostBenchmark } },
});

/** A heap reading the run can be driven with; `fraction` is of the limit. */
const heap = (fraction, supported = true) => () => (supported
  ? { supported: true, usedMiB: Math.round(4096 * fraction), limitMiB: 4096, usedFraction: fraction }
  : { supported: false, usedMiB: 0, limitMiB: 0, usedFraction: 0 });

const lagSampler = () => ({ stop: () => ({ samples: 0, hiddenSamples: 0, lagMeanMs: 0, lagMaxMs: 0, stalls: 0, longTasks: 0, longTaskMs: 0 }) });
const diagnostics = () => ({ schema: 'opendocviewer.support-diagnostics.v1' });

describe('normalizeOcrBoostBenchmarkConfig', () => {
  it('is off without the literal true and carries the documented defaults', () => {
    expect(normalizeOcrBoostBenchmarkConfig({})).toEqual({ enabled: false, ...OCR_BOOST_BENCHMARK_DEFAULTS, workerCounts: [4, 8, 12, 16, 20, 24] });
    expect(OCR_BOOST_BENCHMARK_DEFAULTS.workerCounts).toEqual([4, 8, 12, 16, 20, 24]);
    expect(OCR_BOOST_BENCHMARK_DEFAULTS.pageLimit).toBe(120);
    expect(OCR_BOOST_BENCHMARK_DEFAULTS.memoryBudgetFraction).toBe(0.5);
    expect(OCR_BOOST_BENCHMARK_DEFAULTS.memoryPerWorkerMiB).toBe(130);
    expect(OCR_BOOST_BENCHMARK_DEFAULTS.sampleMode).toBe('evenly-spaced');
    expect(normalizeOcrBoostBenchmarkConfig({ ocr: { boostBenchmark: { enabled: 'true' } } }).enabled).toBe(false);
    expect(normalizeOcrBoostBenchmarkConfig(enabled()).enabled).toBe(true);
  });

  it('clamps the worker counts to 1..32, dedupes and sorts them', () => {
    expect(BOOST_MAX_WORKER_COUNT).toBe(32);
    expect(normalizeOcrBoostBenchmarkConfig(enabled({ workerCounts: [24, 4, 4, 33, 0, -2, 'x', null, 32] })).workerCounts).toEqual([4, 24, 32]);
    // Nothing usable left falls back to the default list, as normalizeOcrBenchmarkConfig does.
    expect(normalizeOcrBoostBenchmarkConfig(enabled({ workerCounts: [0, 99, 'x'] })).workerCounts).toEqual([4, 8, 12, 16, 20, 24]);
    expect(normalizeOcrBoostBenchmarkConfig(enabled({ workerCounts: 'many' })).workerCounts).toEqual([4, 8, 12, 16, 20, 24]);
    expect(normalizeOcrBoostBenchmarkConfig(enabled({ workerCounts: [16.7] })).workerCounts).toEqual([16]);
  });

  it('bounds every other value and rejects a non-numeric one to its default', () => {
    expect(normalizeOcrBoostBenchmarkConfig(enabled({
      pageLimit: 9000, sampleMode: 'FIRST', memoryBudgetFraction: 5, memoryPerWorkerMiB: 0, pageTimeoutMs: 1, delayBetweenRunsMs: -5,
    }))).toMatchObject({ pageLimit: 1000, sampleMode: 'first', memoryBudgetFraction: 1, memoryPerWorkerMiB: 1, pageTimeoutMs: 1000, delayBetweenRunsMs: 0 });
    expect(normalizeOcrBoostBenchmarkConfig(enabled({
      pageLimit: 'lots', sampleMode: 'random', memoryBudgetFraction: 'half', memoryPerWorkerMiB: 'big', pageTimeoutMs: {}, delayBetweenRunsMs: 'none',
    }))).toMatchObject({
      pageLimit: 120, sampleMode: 'evenly-spaced', memoryBudgetFraction: 0.5, memoryPerWorkerMiB: 130, pageTimeoutMs: 180000, delayBetweenRunsMs: 500,
    });
  });
});

describe('describeOcrBoostCapacity and judgeOcrBoostScenario', () => {
  const config = normalizeOcrBoostBenchmarkConfig(enabled());

  it('takes the reported device memory, or assumes 4 GiB when the browser is silent', () => {
    expect(describeOcrBoostCapacity({ cores: 24, deviceMemoryGiB: 8, config })).toMatchObject({
      cores: 24, coresReported: true, deviceMemoryGiB: 8, deviceMemoryReported: true, memoryBudgetMiB: 4096, maxWorkersByMemory: 31,
    });
    // No navigator.deviceMemory (Firefox, Safari): 4 GiB assumed, half of it the budget, which
    // holds 2048 / 130 = 15 engines.
    expect(describeOcrBoostCapacity({ cores: 24, deviceMemoryGiB: 0, config })).toMatchObject({
      deviceMemoryGiB: 4, deviceMemoryReported: false, memoryBudgetMiB: 2048, maxWorkersByMemory: 15,
    });
    expect(describeOcrBoostCapacity({ cores: 0, deviceMemoryGiB: 8, config })).toMatchObject({ cores: 0, coresReported: false });
  });

  it('skips a count above the cores, and a count the memory budget cannot hold', () => {
    const wide = describeOcrBoostCapacity({ cores: 24, deviceMemoryGiB: 64, config });
    expect(judgeOcrBoostScenario(24, wide, config)).toMatchObject({ skipped: false, skipReason: null });
    expect(judgeOcrBoostScenario(25, wide, config)).toMatchObject({ skipped: true, skipReason: BOOST_SKIP_REASON.CORES });
    expect(judgeOcrBoostScenario(25, wide, config).skipDetail).toMatch(/24 logical cores/);

    // 8 cores: 12 workers are already more than the cores, so that rule speaks first.
    const narrow = describeOcrBoostCapacity({ cores: 8, deviceMemoryGiB: 8, config });
    expect(judgeOcrBoostScenario(8, narrow, config).skipped).toBe(false);
    expect(judgeOcrBoostScenario(12, narrow, config).skipReason).toBe(BOOST_SKIP_REASON.CORES);

    // Plenty of cores, little memory: 24 x 130 MiB = 3120 MiB against a 2048 MiB budget.
    const assumedMemory = describeOcrBoostCapacity({ cores: 32, deviceMemoryGiB: 0, config });
    expect(judgeOcrBoostScenario(15, assumedMemory, config).skipped).toBe(false);
    expect(judgeOcrBoostScenario(24, assumedMemory, config)).toMatchObject({ skipped: true, skipReason: BOOST_SKIP_REASON.MEMORY });
    expect(judgeOcrBoostScenario(24, assumedMemory, config).skipDetail).toMatch(/3120 MiB.*2048 MiB.*assumed/);
  });

  it('leaves the core rule out when the browser does not report its cores, keeping the memory rule', () => {
    const unknown = describeOcrBoostCapacity({ cores: 0, deviceMemoryGiB: 64, config });
    expect(judgeOcrBoostScenario(24, unknown, config).skipped).toBe(false);
    const unknownAndSmall = describeOcrBoostCapacity({ cores: 0, deviceMemoryGiB: 0, config });
    expect(judgeOcrBoostScenario(24, unknownAndSmall, config).skipReason).toBe(BOOST_SKIP_REASON.MEMORY);
  });
});

describe('readJsHeap', () => {
  it('reports unsupported where the browser has no performance.memory', () => {
    expect(readJsHeap()).toEqual({ supported: false, usedMiB: 0, limitMiB: 0, usedFraction: 0 });
  });

  it('reports the used share of the limit where it does', () => {
    // jsdom has no performance.memory at all (it is a Chromium extension), so it is defined here
    // rather than spied on, and removed again afterwards.
    Object.defineProperty(globalThis.performance, 'memory', {
      configurable: true,
      get: () => ({ usedJSHeapSize: 1048576 * 900, jsHeapSizeLimit: 1048576 * 1000 }),
    });
    try {
      expect(readJsHeap()).toEqual({ supported: true, usedMiB: 900, limitMiB: 1000, usedFraction: 0.9 });
    } finally {
      delete globalThis.performance.memory;
    }
  });
});

describe('runOcrBoostBenchmark', () => {
  /**
   * One fake engine per requested engine, so a scenario of 12 workers creates 12 of them.
   *
   * @param {Object} options
   * @returns {{ created: Array<Object>, createEngine: Function }}
   */
  function makeEngineFactory({ msPerPage = 10, failStart = false, startMs = 10 } = {}) {
    const created = [];
    const createEngine = vi.fn((cfg, { workerCount, engineIndex }) => {
      const engine = {
        workerCount,
        engineIndex,
        started: 0,
        recognized: [],
        terminated: 0,
        ensureStarted: vi.fn(async () => {
          if (failStart) throw new Error('OCR engine could not start (csp)');
          engine.started += 1;
          await new Promise((resolve) => setTimeout(resolve, startMs));
        }),
        recognize: vi.fn(async (blob) => {
          engine.recognized.push(blob);
          await new Promise((resolve) => setTimeout(resolve, msPerPage));
          return { text: 'Hej världen', confidence: 90, words: [{ text: 'Hej' }, { text: 'världen' }] };
        }),
        terminate: vi.fn(async () => { engine.terminated += 1; }),
      };
      created.push(engine);
      return { engine };
    });
    return { created, createEngine };
  }

  const pages = Array.from({ length: 8 }, (_, index) => ({ sourceKey: 'doc', pageIndex: index, fileExtension: 'png', status: 1, fullSizeStatus: index < 2 ? 1 : 0 }));
  const baseInject = { prepareImage: async (blob) => ({ blob, width: 1000, height: 1400 }), fetchBlob: async (url) => new Blob([url]), lagSampler, diagnostics, readHeap: heap(0.1) };

  it('refuses to run while the switch is off, without a page provider or without a loaded page', async () => {
    await expect(runOcrBoostBenchmark({ config: { ocr: { enabled: true } }, allPages: pages, ensurePageAsset: async () => 'u' })).rejects.toThrow(/disabled/);
    await expect(runOcrBoostBenchmark({ config: enabled(), allPages: pages })).rejects.toThrow(/page image provider/);
    await expect(runOcrBoostBenchmark({ config: enabled(), allPages: [], ensurePageAsset: async () => 'u', inject: { cores: 24 } })).rejects.toThrow(/No loaded page/);
  });

  it('measures each count on its own pool of that many engines, terminates them all, and derives the operator figures', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory({ msPerPage: 100 });
    const ensurePageAsset = vi.fn(async (index) => `/pages/${index}.png`);
    const releasePageAsset = vi.fn();
    const save = vi.fn();
    const progress = [];
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [2, 4], pageLimit: 4, delayBetweenRunsMs: 500 }),
      allPages: pages,
      ensurePageAsset,
      releasePageAsset,
      onProgress: (event) => progress.push(event),
      inject: { ...baseInject, createEngine, cores: 24, deviceMemoryGiB: 8, save },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    // Two scenarios: six engines in all (two, then four), every one started and terminated once.
    expect(created).toHaveLength(6);
    expect(created.every((engine) => engine.started === 1 && engine.terminated === 1)).toBe(true);
    expect(createEngine.mock.calls.map(([, options]) => options.workerCount)).toEqual([2, 2, 4, 4, 4, 4]);
    expect(createEngine.mock.calls.map(([, options]) => options.engineIndex)).toEqual([0, 1, 0, 1, 2, 3]);
    // The configured languages reach every engine.
    expect(createEngine.mock.calls.every(([cfg]) => cfg.ocr.languages.join() === 'swe,eng')).toBe(true);

    expect(result.schema).toBe(OCR_BOOST_BENCHMARK_SCHEMA);
    expect(result.boostMaxWorkerCount).toBe(32);
    expect(result.hardwareConcurrency).toBe(24);
    expect(result.deviceMemoryGiB).toBe(8);
    expect(result.deviceMemoryAssumed).toBe(false);
    expect(result.languages).toEqual(['swe', 'eng']);
    expect(result.configuredLanguages).toEqual(['swe', 'eng']);
    expect(result.pageCount).toBe(4);
    expect(result.sourcePageCount).toBe(8);
    expect(result.workerCounts).toEqual([2, 4]);
    expect(result.skippedCounts).toEqual([]);
    // The viewer's own policy for this document, read-only and unchanged by the boost run.
    expect(result.automaticPlan).toMatchObject({ automatic: true, workerCount: 4, inputs: { pageCount: 8, languageCount: 2 } });
    expect(result.automaticPlan.policy.maxWorkerCount).toBe(4);

    const [two, four] = result.runs;
    expect(two).toMatchObject({ label: 'boost-workers-2', workerCount: 2, skipped: false, aborted: false, abortReason: null, startupError: null, pageCount: 4, recognizedPages: 4, errorCount: 0, words: 8, meanConfidence: 90, enginesCreated: 2, enginesTerminated: 2, deadLanes: 0 });
    // Four pages of 100 ms: two workers take about 200 ms, four about 100 ms.
    expect(two.durationMs).toBeGreaterThanOrEqual(200);
    expect(four.durationMs).toBeLessThan(two.durationMs);
    expect(four.pagesPerMinute).toBeGreaterThan(two.pagesPerMinute);
    // All engines start in parallel, so the wall time is about one start, not workerCount starts.
    expect(four.startupMs).toBeGreaterThanOrEqual(10);
    expect(four.startupMs).toBeLessThan(40);
    expect(four.engineStartupMs.count).toBe(4);
    expect(Date.parse(four.startedUtc)).toBeGreaterThanOrEqual(Date.parse(two.endedUtc));

    // The derived figures follow the measured throughput, to one decimal.
    for (const entry of [two, four]) {
      expect(entry.msPerPage).toBeGreaterThan(0);
      expect(entry.secondsPer100Pages).toBeCloseTo(Math.round(((entry.msPerPage * 100) / 1000) * 10) / 10, 5);
      expect(entry.wholeDocumentSeconds).toBeCloseTo(Math.round(((entry.msPerPage * 8) / 1000) * 10) / 10, 5);
      expect(entry.jsHeapMiB).toMatchObject({ before: 410, after: 410, limit: 4096, supported: true });
      expect(entry.recognizeMs.count).toBe(4);
      expect(entry.pages).toHaveLength(4);
    }
    expect(two.pages[0]).toMatchObject({ viewerIndex: 0, words: 2, confidence: 90, chars: 10, width: 1000, height: 1400, error: null });
    // Each page says which engine recognised it, so an uneven lane is visible.
    expect(new Set(two.pages.map((entry) => entry.engineIndex))).toEqual(new Set([0, 1]));

    expect(result.best.workerCount).toBe(4);
    expect(result.baseline.workerCount).toBe(2);
    expect(save).toHaveBeenCalledWith(result);

    // Four of eight pages, evenly spaced: 0, 2, 5, 7. Only the ones not rendered before the run
    // (fullSizeStatus 0, so everything from page 2 on) are released again.
    expect(result.sampledViewerIndexes).toEqual([0, 2, 5, 7]);
    expect(new Set(releasePageAsset.mock.calls.map(([index]) => index))).toEqual(new Set([2, 5, 7]));
    expect(ensurePageAsset).toHaveBeenCalledWith(0, 'full');

    expect(progress[0]).toEqual({ phase: 'running', completedRuns: 0, totalRuns: 2, scenarioLabel: 'boost-workers-2', workerCount: 2, completedPages: 0, pageCount: 4 });
    expect(progress.some((event) => event.workerCount === 4 && event.completedPages === 4)).toBe(true);
  });

  it('skips the counts this client cannot hold, says why, and runs no engine for them', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory();
    const progress = [];
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [4, 8, 12, 24], pageLimit: 2, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      onProgress: (event) => progress.push(event),
      // Eight cores, and no reported device memory: 4 GiB assumed, a 2048 MiB budget, 15 engines.
      inject: { ...baseInject, createEngine, cores: 8, deviceMemoryGiB: 0 },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.deviceMemoryAssumed).toBe(true);
    expect(result.deviceMemoryGiB).toBe(4);
    expect(result.memoryBudgetMiB).toBe(2048);
    expect(result.runs.map((entry) => [entry.workerCount, entry.skipped, entry.skipReason])).toEqual([
      [4, false, null], [8, false, null], [12, true, BOOST_SKIP_REASON.CORES], [24, true, BOOST_SKIP_REASON.CORES],
    ]);
    expect(result.skippedCounts.map((entry) => entry.workerCount)).toEqual([12, 24]);
    expect(result.skippedCounts[0].skipDetail).toMatch(/8 logical cores/);
    // Twelve engines were never created: that is the whole point of the skip.
    expect(created).toHaveLength(12);
    expect(createEngine.mock.calls.every(([, options]) => options.workerCount <= 8)).toBe(true);
    expect(progress.filter((event) => event.skipped === true).map((event) => event.workerCount)).toEqual([12, 24]);
    // Two pages are fewer than either count's workers, so both scenarios take one page's time:
    // on a tie the lower count wins, which is the answer an operator wants anyway.
    expect(result.runs[0].msPerPage).toBe(result.runs[1].msPerPage);
    expect(result.best.workerCount).toBe(4);
  });

  it('skips on the memory budget when the cores would allow the count', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory();
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [4, 24], pageLimit: 2, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      // 32 cores but 4 GiB: 24 x 130 MiB = 3120 MiB over the 2048 MiB budget.
      inject: { ...baseInject, createEngine, cores: 32, deviceMemoryGiB: 4 },
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.runs.map((entry) => entry.skipReason)).toEqual([null, BOOST_SKIP_REASON.MEMORY]);
    expect(result.skippedCounts[0].skipDetail).toMatch(/3120 MiB/);
  });

  it('aborts a scenario whose engines cannot start, terminates them, and goes on with the next count', async () => {
    vi.useFakeTimers();
    const failing = makeEngineFactory({ failStart: true });
    const working = makeEngineFactory({ msPerPage: 10 });
    let scenario = 0;
    const createEngine = vi.fn((cfg, options) => {
      // The first scenario's engines fail to start, the second one's work.
      if (options.workerCount === 2) return failing.createEngine(cfg, options);
      scenario += 1;
      return working.createEngine(cfg, options);
    });
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [2, 4], pageLimit: 3, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      inject: { ...baseInject, createEngine, cores: 24, deviceMemoryGiB: 16 },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.runs[0]).toMatchObject({
      workerCount: 2, aborted: true, abortReason: BOOST_ABORT_REASON.ENGINE_START, recognizedPages: 0, errorCount: 3, durationMs: 0, msPerPage: 0, secondsPer100Pages: 0, wholeDocumentSeconds: 0, enginesTerminated: 2,
    });
    expect(result.runs[0].startupError).toMatch(/csp/);
    // Even a scenario that never recognised a page leaves no engine behind.
    expect(failing.created.every((engine) => engine.terminated === 1)).toBe(true);
    expect(result.runs[1]).toMatchObject({ workerCount: 4, aborted: false, recognizedPages: 3, errorCount: 0 });
    expect(scenario).toBe(4);
    expect(result.best.workerCount).toBe(4);
    expect(result.baseline.workerCount).toBe(4);
  });

  it('aborts a scenario whose JS heap passes 90 % of the limit between pages', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory({ msPerPage: 10 });
    let recognised = 0;
    const readHeap = () => {
      // Climbs past the limit once a couple of pages have gone through the first scenario.
      const fraction = recognised >= 2 ? 0.95 : 0.2;
      return { supported: true, usedMiB: Math.round(4096 * fraction), limitMiB: 4096, usedFraction: fraction };
    };
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [1], pageLimit: 6, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      inject: {
        ...baseInject,
        readHeap,
        cores: 24,
        deviceMemoryGiB: 16,
        createEngine: (cfg, options) => {
          const made = createEngine(cfg, options);
          const inner = made.engine.recognize;
          made.engine.recognize = async (blob) => { const out = await inner(blob); recognised += 1; return out; };
          return made;
        },
      },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.heapCheckAvailable).toBe(true);
    expect(result.heapAbortFraction).toBe(0.9);
    const [only] = result.runs;
    expect(only).toMatchObject({ aborted: true, abortReason: BOOST_ABORT_REASON.HEAP, pageCount: 6, enginesTerminated: 1 });
    expect(only.abortError).toMatch(/95 % of the 4096 MiB limit/);
    expect(only.heapAtAbort).toMatchObject({ usedFraction: 0.95, limitMiB: 4096 });
    // It stopped at a page boundary: some pages were measured, the rest count as errors.
    expect(only.recognizedPages).toBeGreaterThan(0);
    expect(only.recognizedPages).toBeLessThan(6);
    expect(only.recognizedPages + only.errorCount).toBe(6);
    expect(created.every((engine) => engine.terminated === 1)).toBe(true);
    // An aborted scenario is not offered as the best result.
    expect(result.best).toBeNull();
  });

  it('records that the heap could not be checked where the browser has no performance.memory', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory({ msPerPage: 10 });
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [2], pageLimit: 2, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      inject: { ...baseInject, createEngine, readHeap: heap(0, false), cores: 24, deviceMemoryGiB: 16 },
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.heapCheckAvailable).toBe(false);
    expect(result.jsHeapLimitMiB).toBe(0);
    expect(result.runs[0]).toMatchObject({ aborted: false, abortReason: null });
    expect(result.runs[0].jsHeapMiB).toMatchObject({ supported: false });
  });

  it('records a page whose image cannot be read and keeps the others', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory({ msPerPage: 10 });
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [1], pageLimit: 3, sampleMode: 'first', delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => (index === 1 ? null : `/pages/${index}.png`),
      inject: { ...baseInject, createEngine, cores: 24, deviceMemoryGiB: 16 },
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.sampledViewerIndexes).toEqual([0, 1, 2]);
    expect(result.runs[0]).toMatchObject({ recognizedPages: 2, errorCount: 1, aborted: false });
    expect(result.runs[0].pages.find((entry) => entry.viewerIndex === 1).error).toMatch(/unavailable/);
    // A scenario with a failed page is not offered as the best result either.
    expect(result.best).toBeNull();
  });

  it('terminates the lane whose page passes the timeout, counts it dead, and lets the other lane finish the rest', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory({ msPerPage: 10 });
    // Engine 0 of the scenario hangs on the page it is handed: a recognition that never settles,
    // which is what a wedged tesseract.js worker looks like from here. A single engine cannot
    // abort one recognition, so the page timeout has to take the engine with it.
    const withOneHangingEngine = vi.fn((cfg, options) => {
      const made = createEngine(cfg, options);
      if (options.engineIndex === 0) made.engine.recognize = vi.fn(() => new Promise(() => {}));
      return made;
    });
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [2], pageLimit: 4, pageTimeoutMs: 1000, delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      inject: { ...baseInject, createEngine: withOneHangingEngine, cores: 24, deviceMemoryGiB: 16 },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    const [only] = result.runs;
    // One bad worker costs its page, not the scenario: the run is not aborted, and the sample is
    // still fully accounted for.
    expect(only).toMatchObject({
      workerCount: 2, skipped: false, aborted: false, abortReason: null, startupError: null,
      pageCount: 4, recognizedPages: 3, errorCount: 1, deadLanes: 1, enginesCreated: 2, enginesTerminated: 2,
    });
    expect(only.recognizedPages + only.errorCount).toBe(only.pageCount);

    // The timed-out page is the one the dead lane held, and it says which engine lost it.
    const failed = only.pages.filter((entry) => entry.error !== null);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ viewerIndex: 0, engineIndex: 0 });
    expect(failed[0].error).toMatch(/recognition exceeded 1000 ms/);
    // The dead lane pulled exactly one page and then stopped; the surviving lane took the rest.
    expect(created[0].recognize).toHaveBeenCalledTimes(1);
    expect(only.pages.filter((entry) => entry.error === null).every((entry) => entry.engineIndex === 1)).toBe(true);
    expect(only.recognizeMs.count).toBe(3);

    // The hung engine is stopped by the timeout handler and again by the pool teardown; engine.js's
    // terminate() is idempotent (the second call finds no worker pending and returns), so asking
    // twice is the safe order here. The working engine is stopped once.
    expect(created[0].terminated).toBe(2);
    expect(created[1].terminated).toBe(1);
    // A scenario that lost a page is not offered as the best result.
    expect(result.best).toBeNull();
  });

  it('terminates every engine of the scenario in flight when the run is cancelled', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory({ msPerPage: 10 });
    const controller = new AbortController();
    const run = runOcrBoostBenchmark({
      config: enabled({ workerCounts: [3, 4], pageLimit: 4, delayBetweenRunsMs: 1000 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      signal: controller.signal,
      onProgress: (event) => { if (event.completedRuns === 0 && event.completedPages === 4) controller.abort(); },
      inject: { ...baseInject, createEngine, cores: 24, deviceMemoryGiB: 16 },
    });
    const settled = run.catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    // Only the first scenario's three engines were made, and all three were terminated.
    expect(created).toHaveLength(3);
    expect(created.every((engine) => engine.terminated === 1)).toBe(true);
  });
});

describe('the live worker cap', () => {
  it('is left at 8 by importing the boost module: the 32 ceiling bounds the measurement only', async () => {
    const runtimeConfig = await import('../../utils/runtimeConfig.js');
    const boost = await import('../boostBenchmark.js');
    expect(runtimeConfig.MAX_OCR_WORKER_COUNT).toBe(8);
    expect(boost.BOOST_MAX_WORKER_COUNT).toBe(32);
    // The viewer's own policy still stops at four workers, whatever the boost run measures.
    expect(runtimeConfig.OCR_WORKER_POLICY_DEFAULTS.maxWorkerCount).toBe(4);
    expect(runtimeConfig.resolveOcrWorkerPlan({}, { cores: 24, deviceMemoryGiB: 64, pageCount: 500, languageCount: 2 }).workerCount).toBe(4);
  });

  it('keeps the boost module out of the OCR entry point, so it stays its own chunk', async () => {
    const index = await import('../index.js');
    expect(typeof index.loadOcrBoostBenchmark).toBe('function');
    expect(index.runOcrBoostBenchmark).toBeUndefined();
    expect(index.OCR_BOOST_BENCHMARK_SCHEMA).toBeUndefined();
    const loaded = await index.loadOcrBoostBenchmark();
    expect(loaded.OCR_BOOST_BENCHMARK_SCHEMA).toBe(OCR_BOOST_BENCHMARK_SCHEMA);
  });
});
