// File: src/ocr/__tests__/benchmark.test.js
// @vitest-environment jsdom
/**
 * The OCR benchmark: the configuration is bounded with its defaults, worker counts expand from
 * the cores, scenarios follow the plan (counts, then the single language and the scales with one
 * worker), pages are sampled from the loaded eligible ones, and a run measures every scenario
 * on its own engine (started and terminated inside), pauses between runs, saves the result and
 * reports progress. Engines, images and the lag sampler are fakes; nothing is recognised here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCR_BENCHMARK_DEFAULTS,
  OCR_BENCHMARK_SCHEMA,
  expandOcrBenchmarkWorkerCounts,
  normalizeOcrBenchmarkConfig,
  planOcrBenchmarkScenarios,
  runOcrBenchmark,
  selectOcrBenchmarkPages,
  startMainThreadLagSampler,
  summarizeDurations,
} from '../benchmark.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const enabled = (benchmark = {}) => ({ ocr: { enabled: true, languages: ['swe', 'eng'], benchmark: { enabled: true, ...benchmark } } });

describe('normalizeOcrBenchmarkConfig', () => {
  it('is off without the literal true and carries the documented defaults', () => {
    expect(normalizeOcrBenchmarkConfig({})).toEqual({ enabled: false, ...OCR_BENCHMARK_DEFAULTS, workerCounts: [0], languageVariants: ['configured', 'single'], imageScales: [1, 0.75] });
    expect(normalizeOcrBenchmarkConfig({ ocr: { benchmark: { enabled: 'true' } } }).enabled).toBe(false);
    expect(normalizeOcrBenchmarkConfig(enabled()).enabled).toBe(true);
  });

  it('bounds every value and falls back to the default for an unusable list', () => {
    const cfg = normalizeOcrBenchmarkConfig(enabled({
      pageLimit: 5000, workerCounts: [3, 3, 99, -1, 'x', 0], languageVariants: ['Single', 'nope'], imageScales: [2, 0.5, 0.5, 0, 'a'],
      iterations: 0, sampleMode: 'FIRST', pageTimeoutMs: 1, delayBetweenRunsMs: -5,
    }));
    expect(cfg).toMatchObject({
      pageLimit: 1000, workerCounts: [3, 0], languageVariants: ['single'], imageScales: [0.5], iterations: 1, sampleMode: 'first', pageTimeoutMs: 1000, delayBetweenRunsMs: 0,
    });
    expect(normalizeOcrBenchmarkConfig(enabled({ workerCounts: ['x'], languageVariants: [], imageScales: [3] }))).toMatchObject({
      workerCounts: [0], languageVariants: ['configured', 'single'], imageScales: [1, 0.75],
    });
  });
});

describe('expandOcrBenchmarkWorkerCounts', () => {
  it('expands 0 to one up to the cores minus one, keeps explicit counts, sorts and dedupes', () => {
    expect(expandOcrBenchmarkWorkerCounts([0], 4)).toEqual([1, 2, 3]);
    expect(expandOcrBenchmarkWorkerCounts([0], 24)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(expandOcrBenchmarkWorkerCounts([0], 0)).toEqual([1]);
    expect(expandOcrBenchmarkWorkerCounts([0], 2)).toEqual([1]);
    expect(expandOcrBenchmarkWorkerCounts([4, 2, 2], 4)).toEqual([2, 4]);
    expect(expandOcrBenchmarkWorkerCounts([0, 6], 4)).toEqual([1, 2, 3, 6]);
    expect(expandOcrBenchmarkWorkerCounts([], 8)).toEqual([1]);
  });
});

describe('planOcrBenchmarkScenarios', () => {
  it('runs the counts with the configured languages, then the single language and the scales with one worker', () => {
    const plan = planOcrBenchmarkScenarios(normalizeOcrBenchmarkConfig(enabled()), { cores: 4, languages: ['swe', 'eng'] });
    expect(plan.map((scenario) => scenario.label)).toEqual(['workers-1', 'workers-2', 'workers-3', 'lang-swe', 'scale-0.75']);
    expect(plan[1]).toEqual({ label: 'workers-2', kind: 'workers', workerCount: 2, languages: ['swe', 'eng'], imageScale: 1 });
    expect(plan[3]).toEqual({ label: 'lang-swe', kind: 'language', workerCount: 1, languages: ['swe'], imageScale: 1 });
    expect(plan[4]).toEqual({ label: 'scale-0.75', kind: 'scale', workerCount: 1, languages: ['swe', 'eng'], imageScale: 0.75 });
  });

  it('skips the single-language run with one language, and the scale runs without a scale below one', () => {
    const plan = planOcrBenchmarkScenarios(normalizeOcrBenchmarkConfig(enabled({ imageScales: [1], workerCounts: [2] })), { cores: 8, languages: ['eng'] });
    expect(plan.map((scenario) => scenario.label)).toEqual(['workers-2']);
  });
});

describe('selectOcrBenchmarkPages', () => {
  const page = (index, overrides = {}) => ({ sourceKey: 'doc', pageIndex: index, fileExtension: 'png', status: 1, ...overrides });

  it('takes loaded pages the queue would recognise, evenly spaced up to the limit', () => {
    const pages = Array.from({ length: 10 }, (_, index) => page(index));
    pages[3] = page(3, { status: 0 });
    pages[5] = page(5, { fileExtension: 'txt' });
    const picked = selectOcrBenchmarkPages(pages, 4);
    // Eight eligible pages (not 3 and 5): the first, the last and two in between.
    expect(picked.map((entry) => entry.viewerIndex)).toEqual([0, 2, 7, 9]);
    expect(selectOcrBenchmarkPages(pages, 4, 'first').map((entry) => entry.viewerIndex)).toEqual([0, 1, 2, 4]);
    expect(selectOcrBenchmarkPages(pages, 100)).toHaveLength(8);
    expect(selectOcrBenchmarkPages([], 4)).toEqual([]);
    expect(selectOcrBenchmarkPages(pages, 1).map((entry) => entry.viewerIndex)).toEqual([0]);
  });
});

describe('summarizeDurations', () => {
  it('gives count, mean, median, p90 and max, rounded', () => {
    expect(summarizeDurations([])).toEqual({ count: 0, mean: 0, median: 0, p90: 0, max: 0 });
    expect(summarizeDurations([30, 10, 20])).toEqual({ count: 3, mean: 20, median: 20, p90: 30, max: 30 });
    expect(summarizeDurations([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ count: 10, mean: 6, median: 5, p90: 9, max: 10 });
  });
});

describe('startMainThreadLagSampler', () => {
  it('reports how late the ticks came and counts stalls above 100 ms', () => {
    let clock = 0;
    let tick = null;
    const sampler = startMainThreadLagSampler({
      setInterval: (fn) => { tick = fn; return 1; },
      clearInterval: vi.fn(),
      now: () => clock,
    });
    clock = 50; tick();      // on time
    clock = 100; tick();     // on time
    clock = 300; tick();     // 150 ms late: a stall
    clock = 360; tick();     // 10 ms late
    expect(sampler.stop()).toEqual({ samples: 4, lagMeanMs: 40, lagMaxMs: 150, stalls: 1, longTasks: 0, longTaskMs: 0 });
  });
});

describe('runOcrBenchmark', () => {
  /** An engine whose recognitions take `msPerPage` of fake time each. */
  function makeEngineFactory({ msPerPage = 100, failStart = false } = {}) {
    const created = [];
    const createEngine = vi.fn((cfg, { workerCount }) => {
      const engine = {
        languages: cfg.ocr.languages,
        workerCount,
        started: 0,
        recognized: [],
        terminated: 0,
        ensureStarted: vi.fn(async () => {
          if (failStart) throw new Error('OCR engine could not start (csp)');
          engine.started += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
        recognize: vi.fn(async (blob, control) => {
          control.abort = vi.fn();
          engine.recognized.push(blob);
          await new Promise((resolve) => setTimeout(resolve, msPerPage));
          return { text: 'Hej världen', confidence: 90, words: [{ text: 'Hej' }, { text: 'världen' }] };
        }),
        terminate: vi.fn(async () => { engine.terminated += 1; }),
      };
      created.push(engine);
      return { engine, setup: {}, workerCount };
    });
    return { created, createEngine };
  }

  const pages = Array.from({ length: 6 }, (_, index) => ({ sourceKey: 'doc', pageIndex: index, fileExtension: 'png', status: 1, fullSizeStatus: index < 2 ? 1 : 0 }));
  const lagSampler = () => ({ stop: () => ({ samples: 0, lagMeanMs: 0, lagMaxMs: 0, stalls: 0, longTasks: 0, longTaskMs: 0 }) });

  it('refuses to run while the switch is off or without a page provider', async () => {
    await expect(runOcrBenchmark({ config: { ocr: { enabled: true } }, allPages: pages, ensurePageAsset: async () => 'u' })).rejects.toThrow(/disabled/);
    await expect(runOcrBenchmark({ config: enabled(), allPages: pages })).rejects.toThrow(/page image provider/);
    await expect(runOcrBenchmark({ config: enabled(), allPages: [], ensurePageAsset: async () => 'u', inject: { cores: 2 } })).rejects.toThrow(/No loaded page/);
  });

  it('measures every scenario on its own engine, releases renders made for it, reports progress and saves the result', async () => {
    vi.useFakeTimers();
    const { created, createEngine } = makeEngineFactory({ msPerPage: 100 });
    const ensurePageAsset = vi.fn(async (index) => `/pages/${index}.png`);
    const releasePageAsset = vi.fn();
    const fetchBlob = vi.fn(async (url) => new Blob([url], { type: 'image/png' }));
    const prepareImage = vi.fn(async (blob) => ({ blob, width: 1000, height: 1400, rulingLinePixels: 0 }));
    const save = vi.fn();
    const progress = [];
    const run = runOcrBenchmark({
      config: enabled({ pageLimit: 4, workerCounts: [1, 2], imageScales: [1], delayBetweenRunsMs: 500 }),
      allPages: pages,
      ensurePageAsset,
      releasePageAsset,
      onProgress: (event) => progress.push(event),
      inject: { createEngine, prepareImage, fetchBlob, cores: 4, lagSampler, save },
    });
    await vi.runAllTimersAsync();
    const result = await run;

    // Three scenarios: two worker counts and the single language (Swedish alone), one engine each.
    expect(createEngine.mock.calls.map(([cfg, options]) => [cfg.ocr.languages, options.workerCount])).toEqual([[['swe', 'eng'], 1], [['swe', 'eng'], 2], [['swe'], 1]]);
    expect(created.every((engine) => engine.started === 1 && engine.terminated === 1)).toBe(true);
    expect(created.map((engine) => engine.recognized.length)).toEqual([4, 4, 4]);

    expect(result.schema).toBe(OCR_BENCHMARK_SCHEMA);
    expect(result.hardwareConcurrency).toBe(4);
    expect(result.languages).toEqual(['swe', 'eng']);
    expect(result.pageCount).toBe(4);
    expect(result.sourcePageCount).toBe(6);
    expect(result.sampledViewerIndexes).toEqual([0, 2, 3, 5]);
    expect(result.scenarios.map((scenario) => scenario.label)).toEqual(['workers-1', 'workers-2', 'lang-swe']);
    expect(result.runs).toHaveLength(3);
    const [one, two, single] = result.runs;
    expect(one).toMatchObject({ label: 'workers-1', workerCount: 1, pageCount: 4, recognizedPages: 4, errorCount: 0, startupError: null, words: 8, meanConfidence: 90, iteration: 1 });
    expect(one.startupMs).toBeGreaterThanOrEqual(10);
    // Four pages of 100 ms: one worker takes about 400 ms, two workers about 200 ms.
    expect(one.durationMs).toBeGreaterThanOrEqual(400);
    expect(one.msPerPage).toBeGreaterThanOrEqual(100);
    expect(two.durationMs).toBeLessThan(one.durationMs);
    expect(two.recognizeMs.median).toBeGreaterThanOrEqual(100);
    expect(single.languages).toEqual(['swe']);
    expect(one.pages).toHaveLength(4);
    expect(one.pages[0]).toMatchObject({ viewerIndex: 0, words: 2, confidence: 90, chars: 10, width: 1000, height: 1400, error: null });
    expect(result.best.label).toBe('workers-2');
    expect(result.baseline.label).toBe('workers-1');
    expect(save).toHaveBeenCalledWith(result);

    // Pages 0 and 2... only the pages not rendered before (fullSizeStatus 0) are released again.
    const released = new Set(releasePageAsset.mock.calls.map(([index]) => index));
    expect(released).toEqual(new Set([2, 3, 5]));
    expect(ensurePageAsset).toHaveBeenCalledWith(0, 'full');

    expect(progress[0]).toEqual({ phase: 'running', completedRuns: 0, totalRuns: 3, scenarioLabel: 'workers-1', completedPages: 0, pageCount: 4 });
    expect(progress.some((event) => event.scenarioLabel === 'workers-1' && event.completedPages === 4)).toBe(true);
    expect(progress[progress.length - 1]).toMatchObject({ completedRuns: 2, scenarioLabel: 'lang-swe', completedPages: 4 });
  });

  it('records a scenario whose engine cannot start as failed and goes on with the next', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory({ failStart: true });
    const run = runOcrBenchmark({
      config: enabled({ pageLimit: 2, workerCounts: [1], languageVariants: ['configured'], imageScales: [1], delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      inject: { createEngine, prepareImage: async (blob) => ({ blob, width: 1, height: 1 }), fetchBlob: async () => new Blob(['x']), cores: 2, lagSampler, save: () => {} },
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ recognizedPages: 0, errorCount: 2, startupError: expect.stringMatching(/csp/), durationMs: 0, msPerPage: 0 });
    expect(result.best).toBeNull();
    expect(result.baseline).toBeNull();
  });

  it('records a page whose image cannot be read and keeps the others', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory({ msPerPage: 10 });
    const run = runOcrBenchmark({
      config: enabled({ pageLimit: 3, workerCounts: [1], languageVariants: ['configured'], imageScales: [1], delayBetweenRunsMs: 0 }),
      allPages: pages,
      ensurePageAsset: async (index) => (index === 3 ? null : `/pages/${index}.png`),
      inject: { createEngine, prepareImage: async (blob) => ({ blob, width: 1, height: 1 }), fetchBlob: async () => new Blob(['x']), cores: 2, lagSampler, save: () => {} },
    });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.sampledViewerIndexes).toEqual([0, 3, 5]);
    expect(result.runs[0]).toMatchObject({ recognizedPages: 2, errorCount: 1 });
    expect(result.runs[0].pages.find((entry) => entry.viewerIndex === 3).error).toMatch(/unavailable/);
    expect(result.best).toBeNull();
  });

  it('stops at the next scenario when cancelled', async () => {
    vi.useFakeTimers();
    const { createEngine } = makeEngineFactory({ msPerPage: 10 });
    const controller = new AbortController();
    const run = runOcrBenchmark({
      config: enabled({ pageLimit: 2, workerCounts: [1, 2], languageVariants: ['configured'], imageScales: [1], delayBetweenRunsMs: 1000 }),
      allPages: pages,
      ensurePageAsset: async (index) => `/pages/${index}.png`,
      signal: controller.signal,
      onProgress: (event) => { if (event.completedRuns === 0 && event.completedPages === 2) controller.abort(); },
      inject: { createEngine, prepareImage: async (blob) => ({ blob, width: 1, height: 1 }), fetchBlob: async () => new Blob(['x']), cores: 4, lagSampler, save: () => {} },
    });
    const settled = run.catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(createEngine).toHaveBeenCalledTimes(1);
  });
});
