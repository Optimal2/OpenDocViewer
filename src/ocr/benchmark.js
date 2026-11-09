// File: src/ocr/benchmark.js
/**
 * Opt-in OCR benchmark (`ocr.benchmark.enabled`): recognises a sample of the loaded document's
 * pages once per scenario and reports what each scenario cost, so a site can measure how many
 * workers (`ocr.workerCount`), which languages and what image resolution suit its clients
 * before setting them. Run from About -> Diagnostics, like the PDF and render/decode
 * benchmarks (utils/pdfBenchmark.js, utils/renderDecodeBenchmark.js); the result is kept in
 * localStorage and offered as a JSON download.
 *
 * Scenarios: one per worker count (`workerCounts`; 0 expands to every count from one up to the
 * client's cores minus one, bounded by MAX_OCR_WORKER_COUNT), with the configured languages at
 * the page image's own resolution; then, with one worker so they compare with the first
 * scenario, one per extra language variant (`single`: the first configured language alone)
 * and one per extra image scale (`imageScales` below 1 downscale the page image before
 * recognition). Every scenario runs on its own engine pool, terminated after it: the first
 * engine's start is timed on its own (`startupMs`, before the pages); with several workers the
 * other engines start during the first pages, so that cost is part of the run's time, as it is
 * for the viewer. The sampled pages are the same for every
 * scenario (evenly spaced over the loaded pages the queue would recognise). Besides time per
 * page the run records the recognised word count and mean confidence (a quality proxy for the
 * language and scale variants), how the main thread fared (event-loop lag samples and, where
 * the browser reports them, long tasks: the image preparation runs there), and the JS heap
 * where the browser exposes it. The WebAssembly memory of the workers is not visible from the
 * page; read it in the browser's task manager while the run is going.
 *
 * The viewer pauses its own OCR queue while the benchmark runs (a page already in flight
 * finishes), so the two do not compete for cores. Part of the lazy OCR chunk: nothing here is
 * imported while `ocr.enabled` is off, and the About dialog offers the run only while both
 * switches are on.
 */
import logger from '../logging/systemLogger.js';
import { DEFAULT_OCR_LANGUAGES, MAX_OCR_WORKER_COUNT, getOcrLanguages, getRuntimeConfig, resolveOcrWorkerPlan } from '../utils/runtimeConfig.js';
import { collectSupportDiagnostics, saveLatestOcrBenchmarkResult } from '../utils/supportDiagnostics.js';
import { OCR_PAGE_DECISION, classifyPageSource } from './classify.js';
import { partitionOcrLanguages } from './languages.js';
import { prepareOcrImage } from './prepareImage.js';
import { createConfiguredOcrEngine } from './setup.js';

export const OCR_BENCHMARK_SCHEMA = 'opendocviewer.ocr-benchmark.v1';

/** Defaults of `ocr.benchmark` beyond the switch. */
export const OCR_BENCHMARK_DEFAULTS = Object.freeze({
  pageLimit: 40,
  workerCounts: Object.freeze([0]),
  languageVariants: Object.freeze(['configured', 'single']),
  imageScales: Object.freeze([1, 0.75]),
  iterations: 1,
  sampleMode: 'evenly-spaced',
  pageTimeoutMs: 180000,
  delayBetweenRunsMs: 500,
});
const MAX_PAGE_LIMIT = 1000;
const MAX_ITERATIONS = 5;
const MAX_PAGE_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_MODES = Object.freeze(['first', 'evenly-spaced']);
const LANGUAGE_VARIANTS = Object.freeze(['configured', 'single']);
/** Period of the main-thread lag sampler (ms): short enough to see a stalled frame, cheap enough to leave the result alone. */
const LAG_SAMPLE_MS = 50;
/** A lag sample above this counts as a stall the user would notice. */
const LAG_STALL_MS = 100;

/**
 * @typedef {Object} OcrBenchmarkConfig
 * @property {boolean} enabled
 * @property {number} pageLimit
 * @property {Array<number>} workerCounts  0 means "one up to the automatic maximum for this client".
 * @property {Array<string>} languageVariants  'configured' and/or 'single'.
 * @property {Array<number>} imageScales  Factors in (0, 1]; 1 is the page image as it is.
 * @property {number} iterations
 * @property {string} sampleMode  'evenly-spaced' or 'first'.
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
 * Read `ocr.benchmark` with every value bounded; an unusable list falls back to its default.
 *
 * @param {Object=} cfg  Runtime config (defaults to the viewer's).
 * @returns {OcrBenchmarkConfig}
 */
export function normalizeOcrBenchmarkConfig(cfg = getRuntimeConfig()) {
  const raw = cfg?.ocr?.benchmark && typeof cfg.ocr.benchmark === 'object' ? cfg.ocr.benchmark : {};
  const counts = [];
  for (const item of Array.isArray(raw.workerCounts) ? raw.workerCounts : OCR_BENCHMARK_DEFAULTS.workerCounts) {
    const count = Math.floor(Number(item));
    if (!Number.isFinite(count) || count < 0 || count > MAX_OCR_WORKER_COUNT || counts.includes(count)) continue;
    counts.push(count);
  }
  const variants = [];
  for (const item of Array.isArray(raw.languageVariants) ? raw.languageVariants : OCR_BENCHMARK_DEFAULTS.languageVariants) {
    const variant = String(item || '').trim().toLowerCase();
    if (LANGUAGE_VARIANTS.includes(variant) && !variants.includes(variant)) variants.push(variant);
  }
  const scales = [];
  for (const item of Array.isArray(raw.imageScales) ? raw.imageScales : OCR_BENCHMARK_DEFAULTS.imageScales) {
    const scale = Number(item);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) continue;
    const rounded = Math.round(scale * 100) / 100;
    if (!scales.includes(rounded)) scales.push(rounded);
  }
  const sampleMode = String(raw.sampleMode || '').trim().toLowerCase();
  return {
    enabled: raw.enabled === true,
    pageLimit: integerIn(raw.pageLimit, OCR_BENCHMARK_DEFAULTS.pageLimit, 1, MAX_PAGE_LIMIT),
    workerCounts: counts.length ? counts : [...OCR_BENCHMARK_DEFAULTS.workerCounts],
    languageVariants: variants.length ? variants : [...OCR_BENCHMARK_DEFAULTS.languageVariants],
    imageScales: scales.length ? scales : [...OCR_BENCHMARK_DEFAULTS.imageScales],
    iterations: integerIn(raw.iterations, OCR_BENCHMARK_DEFAULTS.iterations, 1, MAX_ITERATIONS),
    sampleMode: SAMPLE_MODES.includes(sampleMode) ? sampleMode : OCR_BENCHMARK_DEFAULTS.sampleMode,
    pageTimeoutMs: integerIn(raw.pageTimeoutMs, OCR_BENCHMARK_DEFAULTS.pageTimeoutMs, 1000, MAX_PAGE_TIMEOUT_MS),
    delayBetweenRunsMs: integerIn(raw.delayBetweenRunsMs, OCR_BENCHMARK_DEFAULTS.delayBetweenRunsMs, 0, 60000),
  };
}

/**
 * The worker counts a configured list stands for on this client: explicit counts as they are,
 * 0 as every count from one up to the cores minus one (bounded by MAX_OCR_WORKER_COUNT, at
 * least one), sorted and without repeats.
 *
 * @param {Array<number>} workerCounts
 * @param {number} cores  `navigator.hardwareConcurrency`; 0 or unknown gives one worker.
 * @returns {Array<number>}
 */
export function expandOcrBenchmarkWorkerCounts(workerCounts, cores) {
  const out = new Set();
  const reported = Math.max(0, Math.floor(Number(cores) || 0));
  for (const count of Array.isArray(workerCounts) ? workerCounts : []) {
    if (count === 0) {
      const top = Math.max(1, Math.min(MAX_OCR_WORKER_COUNT, reported - 1));
      for (let n = 1; n <= top; n += 1) out.add(n);
    } else if (Number.isInteger(count) && count >= 1 && count <= MAX_OCR_WORKER_COUNT) {
      out.add(count);
    }
  }
  if (out.size === 0) out.add(1);
  return [...out].sort((a, b) => a - b);
}

/**
 * The languages the engine will load for a configuration: the configured codes (form checked
 * by getOcrLanguages) less the ones with no model, as setup.js resolves them, and the default
 * when none is left. The scenarios are planned from these, not from the raw configuration, so
 * `lang-<code>` names a model that exists and the result's `languages` is what ran.
 *
 * @param {Object=} cfg
 * @returns {Array<string>}
 */
export function resolveOcrBenchmarkLanguages(cfg = getRuntimeConfig()) {
  const { known } = partitionOcrLanguages(getOcrLanguages(cfg));
  return known.length ? known : [...DEFAULT_OCR_LANGUAGES];
}

/**
 * @typedef {Object} OcrBenchmarkScenario
 * @property {string} label  e.g. `workers-2`, `lang-swe`, `scale-0.75`.
 * @property {string} kind  'workers', 'language' or 'scale'.
 * @property {number} workerCount
 * @property {Array<string>} languages
 * @property {number} imageScale
 */

/**
 * The scenarios a configuration stands for: the worker counts with the languages the engine
 * loads and the full image, then (with one worker) the single-language variant when more than
 * one language is loaded, then each image scale below one. When a variant is planned,
 * `workers-1` is always among the scenarios (added when the counts leave it out), since the
 * variants are read against it.
 *
 * @param {OcrBenchmarkConfig} config
 * @param {Object} context
 * @param {number} context.cores
 * @param {Array<string>} context.languages  The languages the engine loads (resolveOcrBenchmarkLanguages).
 * @returns {Array<OcrBenchmarkScenario>}
 */
export function planOcrBenchmarkScenarios(config, { cores, languages }) {
  const loaded = Array.isArray(languages) && languages.length ? [...languages] : [...DEFAULT_OCR_LANGUAGES];
  const counts = expandOcrBenchmarkWorkerCounts(config.workerCounts, cores);
  const variants = [];
  if (config.languageVariants.includes('single') && loaded.length > 1) {
    variants.push({ label: `lang-${loaded[0]}`, kind: 'language', workerCount: 1, languages: [loaded[0]], imageScale: 1 });
  }
  for (const scale of config.imageScales) {
    if (scale >= 1) continue;
    variants.push({ label: `scale-${scale}`, kind: 'scale', workerCount: 1, languages: loaded, imageScale: scale });
  }
  if (variants.length && !counts.includes(1)) counts.unshift(1);
  const scenarios = counts.map((workerCount) => ({ label: `workers-${workerCount}`, kind: 'workers', workerCount, languages: loaded, imageScale: 1 }));
  return [...scenarios, ...variants];
}

/**
 * The pages to recognise: loaded pages the OCR queue would recognise (not skipped by
 * classifyPageSource), sampled evenly over the document (or the first ones), at most
 * `pageLimit`.
 *
 * @param {Array<Object>} allPages
 * @param {number} pageLimit
 * @param {string} sampleMode
 * @param {function(Object): Object=} classify  Default classifyPageSource.
 * @returns {Array<{ viewerIndex: number, page: Object }>}
 */
export function selectOcrBenchmarkPages(allPages, pageLimit, sampleMode = 'evenly-spaced', classify = classifyPageSource) {
  const eligible = [];
  (Array.isArray(allPages) ? allPages : []).forEach((page, viewerIndex) => {
    if (!page || Number(page.status) !== 1) return;
    if (classify(page).decision === OCR_PAGE_DECISION.SKIP) return;
    eligible.push({ viewerIndex, page });
  });
  const limit = Math.max(1, Math.floor(Number(pageLimit)) || 1);
  if (eligible.length <= limit) return eligible;
  if (sampleMode === 'first') return eligible.slice(0, limit);
  const picked = [];
  const seen = new Set();
  for (let step = 0; step < limit; step += 1) {
    const index = limit === 1 ? 0 : Math.round((step * (eligible.length - 1)) / (limit - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(eligible[index]);
  }
  return picked;
}

/**
 * Summary statistics of a list of durations.
 *
 * @param {Array<number>} values
 * @returns {{ count: number, mean: number, median: number, p90: number, max: number }}
 */
export function summarizeDurations(values) {
  const sorted = (Array.isArray(values) ? values : []).map((value) => Math.max(0, Number(value) || 0)).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, mean: 0, median: 0, p90: 0, max: 0 };
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    mean: Math.round(sum / sorted.length),
    median: Math.round(at(0.5)),
    p90: Math.round(at(0.9)),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

/**
 * Sample the main thread's event-loop lag while a scenario runs: a timer asked for every
 * LAG_SAMPLE_MS, and how late each tick came. A long task on the main thread (decoding a page
 * image, removing its ruling lines, the React commit of a hundred text layers) shows as a late
 * tick. Where the browser reports long tasks (`PerformanceObserver` with `longtask`), those are
 * counted too. A browser throttles timers in a hidden tab (to one tick a second, later a
 * minute), which would look like one stall after another: ticks taken while the document is
 * hidden are therefore counted apart (`hiddenSamples`) and left out of the lag figures, so a
 * run with hidden samples says that its lag figures cover only part of the run.
 *
 * @param {Object=} options  Injectable timers and visibility for tests.
 * @returns {{ stop: function(): { samples: number, hiddenSamples: number, lagMeanMs: number, lagMaxMs: number, stalls: number, longTasks: number, longTaskMs: number } }}
 */
export function startMainThreadLagSampler({ setInterval: schedule = globalThis.setInterval, clearInterval: cancel = globalThis.clearInterval, now = () => performance.now(), isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden' } = {}) {
  let samples = 0;
  let hiddenSamples = 0;
  let lagSum = 0;
  let lagMax = 0;
  let stalls = 0;
  let longTasks = 0;
  let longTaskMs = 0;
  let expected = now() + LAG_SAMPLE_MS;
  // True after a hidden tick: the first visible tick after it only re-anchors the clock, since
  // its lag would still hold the throttled interval it was scheduled across.
  let reanchor = false;
  const timer = schedule(() => {
    const current = now();
    const lag = Math.max(0, current - expected);
    expected = current + LAG_SAMPLE_MS;
    if (isHidden()) {
      // A throttled tick says nothing about the main thread.
      hiddenSamples += 1;
      reanchor = true;
      return;
    }
    if (reanchor) {
      reanchor = false;
      return;
    }
    samples += 1;
    lagSum += lag;
    if (lag > lagMax) lagMax = lag;
    if (lag > LAG_STALL_MS) stalls += 1;
  }, LAG_SAMPLE_MS);
  let observer = null;
  try {
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks += 1;
          longTaskMs += entry.duration;
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
    }
  } catch {
    observer = null;
  }
  return {
    stop() {
      cancel(timer);
      try { observer?.disconnect(); } catch { /* nothing to release */ }
      return {
        samples,
        hiddenSamples,
        lagMeanMs: samples ? Math.round(lagSum / samples) : 0,
        lagMaxMs: Math.round(lagMax),
        stalls,
        longTasks,
        longTaskMs: Math.round(longTaskMs),
      };
    },
  };
}

/** @returns {number} Used JS heap of the page in MiB where the browser exposes it, else 0. */
function usedHeapMiB() {
  const used = Number(globalThis.performance?.memory?.usedJSHeapSize) || 0;
  return used > 0 ? Math.round(used / 1048576) : 0;
}

/**
 * Downscale a page image for a `scale` scenario: decode, draw at the smaller size, encode as
 * PNG. Returns the input when the browser cannot (no decoder or canvas), with `scaled: false`.
 *
 * @param {Blob} blob
 * @param {number} scale
 * @returns {Promise<{ blob: Blob, width: number, height: number, scaled: boolean }>}
 */
export async function downscaleOcrImage(blob, scale) {
  if (!(scale > 0 && scale < 1) || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { blob, width: 0, height: 0, scaled: false };
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return { blob, width: bitmap.width, height: bitmap.height, scaled: false };
    context.drawImage(bitmap, 0, 0, width, height);
    const scaledBlob = await canvas.convertToBlob({ type: 'image/png' });
    canvas.width = 0;
    canvas.height = 0;
    return { blob: scaledBlob, width, height, scaled: true };
  } finally {
    bitmap.close?.();
  }
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
      reject(new Error(`OCR benchmark ${what} exceeded ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
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

function abortError() {
  const error = new Error('OCR benchmark was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight, in order of start.
 *
 * @template T
 * @param {Array<T>} items
 * @param {number} concurrency
 * @param {function(T, number): Promise<void>} worker
 * @returns {Promise<void>}
 */
async function runConcurrently(items, concurrency, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

/**
 * Recognise the sampled pages once on a fresh engine pool and measure it.
 *
 * @param {Object} args
 * @param {OcrBenchmarkScenario} args.scenario
 * @param {Array<{ viewerIndex: number, page: Object }>} args.pages
 * @param {Object} args.cfg
 * @param {function(number): Promise<Blob>} args.loadPageImage  The page's rendered image.
 * @param {function(Blob, Object): Promise<Object>} args.prepareImage
 * @param {function(Object, Object): { engine: Object }} args.createEngine
 * @param {number} args.pageTimeoutMs
 * @param {AbortSignal=} args.signal
 * @param {function(Object): void=} args.onPage  Called after each page with the running count.
 * @param {Object=} args.lagSampler  Injectable startMainThreadLagSampler.
 * @returns {Promise<Object>}
 */
async function runScenario({ scenario, pages, cfg, loadPageImage, prepareImage, createEngine, pageTimeoutMs, signal, onPage, lagSampler = startMainThreadLagSampler }) {
  const scenarioCfg = { ...cfg, ocr: { ...(cfg?.ocr || {}), languages: scenario.languages } };
  const { engine } = createEngine(scenarioCfg, { workerCount: scenario.workerCount });
  const heapBefore = usedHeapMiB();
  const sampler = lagSampler();
  const results = [];
  // Wall-clock bounds of the run, so a memory log kept outside the page (the browser's task
  // manager, the operating system) can be matched to the scenario.
  const startedUtc = new Date().toISOString();
  let startupMs;
  let durationMs = 0;
  let startupError = null;
  try {
    const startedAt = performance.now();
    try {
      await withTimeout(engine.ensureStarted(), pageTimeoutMs, 'engine start');
    } catch (error) {
      startupError = String(error?.message || error);
    }
    startupMs = Math.round(performance.now() - startedAt);
    if (!startupError) {
      const loopStart = performance.now();
      await runConcurrently(pages, scenario.workerCount, async (entry) => {
        throwIfAborted(signal);
        const record = { viewerIndex: entry.viewerIndex, imageMs: 0, prepareMs: 0, recognizeMs: 0, words: 0, confidence: 0, chars: 0, width: 0, height: 0, scaled: false, error: null };
        const pageStart = performance.now();
        try {
          // The page image as the viewer has it (rendered now when it was not), then the
          // preparation the queue does (measure, ruling lines) and, for a scale scenario, the
          // downscaling; each step bounded, so a hang fails the page and not the run.
          const blob = await withTimeout(loadPageImage(entry.viewerIndex), pageTimeoutMs, 'page image');
          const prepareStart = performance.now();
          record.imageMs = Math.round(prepareStart - pageStart);
          let prepared = await withTimeout(prepareImage(blob, {}), pageTimeoutMs, 'image preparation');
          if (scenario.imageScale < 1) {
            const scaled = await withTimeout(downscaleOcrImage(prepared.blob, scenario.imageScale), pageTimeoutMs, 'image downscaling');
            if (scaled.scaled) prepared = { ...prepared, blob: scaled.blob, width: scaled.width, height: scaled.height };
            record.scaled = scaled.scaled;
          }
          record.width = prepared.width;
          record.height = prepared.height;
          record.prepareMs = Math.round(performance.now() - prepareStart);
          const control = {};
          const recognizeStart = performance.now();
          const result = await withTimeout(engine.recognize(prepared.blob, control), pageTimeoutMs, 'recognition', () => control.abort?.());
          record.recognizeMs = Math.round(performance.now() - recognizeStart);
          record.words = Array.isArray(result?.words) ? result.words.length : 0;
          record.confidence = Math.round(Number(result?.confidence) || 0);
          record.chars = String(result?.text || '').replace(/\s+/g, '').length;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          record.error = String(error?.message || error);
        }
        results.push(record);
        onPage?.({ completedPages: results.length, pageCount: pages.length });
      });
      durationMs = Math.round(performance.now() - loopStart);
    }
  } finally {
    await Promise.resolve(engine.terminate()).catch(() => {});
  }
  const mainThread = sampler.stop();
  const heapAfter = usedHeapMiB();
  const done = results.filter((record) => !record.error);
  const errorCount = results.length - done.length + (startupError ? pages.length - results.length : 0);
  const recognized = done.length;
  const confidenceSum = done.reduce((total, record) => total + record.confidence, 0);
  return {
    label: scenario.label,
    kind: scenario.kind,
    workerCount: scenario.workerCount,
    languages: scenario.languages,
    imageScale: scenario.imageScale,
    pageCount: pages.length,
    recognizedPages: recognized,
    errorCount,
    startupError,
    startedUtc,
    endedUtc: new Date().toISOString(),
    startupMs,
    durationMs,
    // Throughput: wall time of the page loop (the extra workers' starts included) per recognised
    // page; the latency of one page is recognizeMs below.
    msPerPage: recognized > 0 ? Math.round(durationMs / recognized) : 0,
    pagesPerMinute: durationMs > 0 ? Math.round((recognized * 60000) / durationMs * 10) / 10 : 0,
    recognizeMs: summarizeDurations(done.map((record) => record.recognizeMs)),
    imageMs: summarizeDurations(done.map((record) => record.imageMs)),
    prepareMs: summarizeDurations(done.map((record) => record.prepareMs)),
    scaledPages: done.filter((record) => record.scaled).length,
    words: done.reduce((total, record) => total + record.words, 0),
    chars: done.reduce((total, record) => total + record.chars, 0),
    meanConfidence: recognized > 0 ? Math.round(confidenceSum / recognized) : 0,
    mainThread,
    jsHeapMiB: { before: heapBefore, after: heapAfter },
    pages: results,
  };
}

/**
 * Run the OCR benchmark over the loaded document and save the result.
 *
 * @param {Object} args
 * @param {Object=} args.config  Runtime config (defaults to the viewer's); must have the switch on.
 * @param {Array<Object>} args.allPages  The viewer's pages.
 * @param {function(number, string): Promise<(string|null)>} args.ensurePageAsset  `(viewerIndex, 'full')` to the page image URL.
 * @param {(function(number, string): void|null)=} args.releasePageAsset  Drop a render made only
 *   for the benchmark (a page not rendered when the run started). The caller may decline for a
 *   page the user is looking at meanwhile: the toolbar keeps the pages around the shown one.
 * @param {function(Object): void=} args.onProgress  `{ phase, completedRuns, totalRuns, scenarioLabel, completedPages, pageCount }`.
 * @param {AbortSignal=} args.signal
 * @param {Object=} args.inject  Test seams: `createEngine` (default createConfiguredOcrEngine),
 *   `prepareImage` (default prepareOcrImage), `fetchBlob`, `cores`, `deviceMemoryGiB`, `lagSampler`, `save`.
 * @returns {Promise<Object>} The result (also saved for the About dialog).
 */
export async function runOcrBenchmark({ config, allPages, ensurePageAsset, releasePageAsset = null, onProgress, signal, inject = {} }) {
  const cfg = config || getRuntimeConfig();
  const benchmark = normalizeOcrBenchmarkConfig(cfg);
  if (!benchmark.enabled) throw new Error('OCR benchmark is disabled by configuration.');
  if (typeof ensurePageAsset !== 'function') throw new Error('OCR benchmark needs the page image provider.');
  const pages = selectOcrBenchmarkPages(allPages, benchmark.pageLimit, benchmark.sampleMode);
  if (!pages.length) throw new Error('No loaded page is available for the OCR benchmark.');

  const cores = Math.max(0, Math.floor(Number(inject.cores ?? globalThis.navigator?.hardwareConcurrency) || 0));
  const deviceMemoryGiB = Number(inject.deviceMemoryGiB ?? globalThis.navigator?.deviceMemory) || 0;
  const configuredLanguages = getOcrLanguages(cfg);
  const languages = resolveOcrBenchmarkLanguages(cfg);
  const scenarios = planOcrBenchmarkScenarios(benchmark, { cores, languages });
  // What the viewer itself would run on this client for this document (the whole document
  // pending), so the result shows where the automatic choice sits among the measured counts.
  const sourcePageCount = Array.isArray(allPages) ? allPages.length : 0;
  const automaticPlan = resolveOcrWorkerPlan(cfg, { cores, deviceMemoryGiB, pageCount: sourcePageCount, languageCount: languages.length });
  const createEngine = inject.createEngine || ((scenarioCfg, options) => createConfiguredOcrEngine(scenarioCfg, options));
  const prepareImage = inject.prepareImage || ((blob, options) => prepareOcrImage(blob, options));
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
    // A page rendered only for the benchmark is dropped again once its bytes are in hand, as
    // the queue does for a whole-document page, so a long document does not pile up renders.
    if (!renderedBefore) {
      try { releasePageAsset?.(viewerIndex, url); } catch { /* the viewer keeps it */ }
    }
    return blob;
  };

  const totalRuns = scenarios.length * benchmark.iterations;
  const runs = [];
  for (let iteration = 1; iteration <= benchmark.iterations; iteration += 1) {
    for (const scenario of scenarios) {
      throwIfAborted(signal);
      const progress = (extra = {}) => onProgress?.({
        phase: 'running', completedRuns: runs.length, totalRuns, scenarioLabel: scenario.label, completedPages: 0, pageCount: pages.length, ...extra,
      });
      progress();
      const run = await runScenario({
        scenario, pages, cfg, loadPageImage, prepareImage, createEngine,
        pageTimeoutMs: benchmark.pageTimeoutMs, signal, onPage: progress, lagSampler: inject.lagSampler,
      });
      runs.push({ ...run, iteration });
      await delay(benchmark.delayBetweenRunsMs, signal);
    }
  }

  const best = runs
    .filter((run) => run.errorCount === 0 && run.recognizedPages > 0)
    .sort((a, b) => a.msPerPage - b.msPerPage)[0] || null;
  const baseline = runs.find((run) => run.kind === 'workers' && run.workerCount === 1 && run.errorCount === 0) || null;
  const result = {
    schema: OCR_BENCHMARK_SCHEMA,
    createdUtc: new Date().toISOString(),
    hardwareConcurrency: cores,
    deviceMemoryGiB,
    // The languages the engines loaded; `configuredLanguages` is the site file's list before
    // the codes without a model were dropped.
    languages,
    configuredLanguages,
    // The worker count the viewer would choose here, with the bounds that made it.
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
    iterations: benchmark.iterations,
    workerCounts: benchmark.workerCounts,
    languageVariants: benchmark.languageVariants,
    imageScales: benchmark.imageScales,
    pageTimeoutMs: benchmark.pageTimeoutMs,
    scenarios,
    runs,
    best: best ? { label: best.label, workerCount: best.workerCount, msPerPage: best.msPerPage, pagesPerMinute: best.pagesPerMinute } : null,
    baseline: baseline ? { label: baseline.label, msPerPage: baseline.msPerPage, pagesPerMinute: baseline.pagesPerMinute } : null,
    diagnostics: collectSupportDiagnostics({ latestPdfBenchmark: null, latestRenderDecodeBenchmark: null, latestOcrBenchmark: null }),
  };
  (inject.save || saveLatestOcrBenchmarkResult)(result);
  logger.info('OCR benchmark completed', {
    pageCount: pages.length,
    scenarioCount: scenarios.length,
    bestScenario: best?.label || null,
    bestMsPerPage: best?.msPerPage || null,
  });
  return result;
}
