// File: src/ocr/__tests__/benchmarkRegression.test.js
// @vitest-environment jsdom
/**
 * The ordinary OCR benchmark is unchanged by the boost benchmark.
 *
 * The opt-in *boost* benchmark (src/ocr/boostBenchmark.js) measures worker counts above the
 * viewer's own cap. It is a second module precisely so that nothing it does can reach the live
 * OCR path: the worker policy, the queue, the engine pool, setup.js and the ordinary benchmark
 * must behave exactly as they did before it existed. This file is that guard, written as literal
 * expected values rather than as a comparison against today's code, so a later edit to
 * benchmark.js or to the worker-policy defaults fails here instead of silently changing what a
 * site measures.
 *
 * Where the literals come from. They were produced by RUNNING normalizeOcrBenchmarkConfig and
 * expandOcrBenchmarkWorkerCounts from `50edbfc:src/ocr/benchmark.js` -- the campaign base commit,
 * before the boost benchmark was added -- over the input matrix below, not by recording today's
 * output. (`git rev-parse 50edbfc:src/ocr/benchmark.js` and `HEAD:src/ocr/benchmark.js` both give
 * blob 422daf568393c5aa3975eadb0afc5763399e04ff, so the module is byte-identical too; the
 * literals are the behavioural half of the same proof and survive a future edit of the file.)
 *
 * The `ocr.workerPolicy` defaults and MAX_OCR_WORKER_COUNT are asserted against their 50edbfc
 * values for the same reason: the boost module's own ceiling is BOOST_MAX_WORKER_COUNT (32) and
 * may never leak into the viewer's cap of 8.
 */
import { describe, expect, it } from 'vitest';
import {
  OCR_BENCHMARK_DEFAULTS,
  OCR_BENCHMARK_SCHEMA,
  expandOcrBenchmarkWorkerCounts,
  normalizeOcrBenchmarkConfig,
} from '../benchmark.js';
import { MAX_OCR_WORKER_COUNT, OCR_WORKER_POLICY_DEFAULTS } from '../../utils/runtimeConfig.js';

/** What `normalizeOcrBenchmarkConfig` returns for a configuration that sets nothing, at 50edbfc. */
const BASE_DEFAULT_RESULT = Object.freeze({
  enabled: false,
  pageLimit: 40,
  workerCounts: [0],
  languageVariants: ['configured', 'single'],
  imageScales: [1, 0.75],
  iterations: 1,
  sampleMode: 'evenly-spaced',
  pageTimeoutMs: 180000,
  delayBetweenRunsMs: 500,
});

/** `[name, input config, exact expected result]`, every expected value from 50edbfc. */
const NORMALIZE_CASES = [
  ['an empty object', {}, BASE_DEFAULT_RESULT],
  ['ocr without a benchmark key', { ocr: { enabled: true } }, BASE_DEFAULT_RESULT],
  ['a benchmark key that is not an object', { ocr: { benchmark: 'yes' } }, BASE_DEFAULT_RESULT],
  ['the switch as a string, not the literal true', { ocr: { benchmark: { enabled: 'true' } } }, BASE_DEFAULT_RESULT],
  ['the switch on and nothing else', { ocr: { benchmark: { enabled: true } } }, { ...BASE_DEFAULT_RESULT, enabled: true }],
  [
    // 9 and 16 are above MAX_OCR_WORKER_COUNT and dropped; 'x' and -1 are not usable; 2.7 floors
    // to 2; null reads as 0, which is already there. The order of the configured list is kept --
    // this list is NOT sorted, unlike the boost benchmark's.
    'explicit worker counts including values above the cap and garbage',
    { ocr: { benchmark: { enabled: true, workerCounts: [0, 1, 4, 8, 9, 16, 'x', -1, 2.7, null] } } },
    { ...BASE_DEFAULT_RESULT, enabled: true, workerCounts: [0, 1, 4, 8, 2] },
  ],
  [
    'every value non-numeric or otherwise unusable',
    { ocr: { benchmark: { enabled: true, pageLimit: 'lots', iterations: 'many', imageScales: 'all', languageVariants: 'both', sampleMode: 'RANDOM', pageTimeoutMs: {}, delayBetweenRunsMs: 'none' } } },
    { ...BASE_DEFAULT_RESULT, enabled: true },
  ],
  [
    // 1.5 and 0 are outside (0, 1]; 0.5 repeats; 0.123 rounds to two decimals. Variants are
    // lower-cased, deduped and keep the configured order, with the unknown one dropped.
    'every value above its maximum',
    { ocr: { benchmark: { enabled: true, pageLimit: 9000, iterations: 99, pageTimeoutMs: 99999999, delayBetweenRunsMs: 999999, imageScales: [1.5, 0.5, 0.5, 0.123, 0], languageVariants: ['SINGLE', 'configured', 'single', 'nope'] } } },
    { ...BASE_DEFAULT_RESULT, enabled: true, pageLimit: 1000, iterations: 5, pageTimeoutMs: 600000, delayBetweenRunsMs: 60000, imageScales: [0.5, 0.12], languageVariants: ['single', 'configured'] },
  ],
  [
    'every value below its minimum, with an empty worker-count list',
    { ocr: { benchmark: { enabled: true, pageLimit: 0, iterations: 0, pageTimeoutMs: 1, delayBetweenRunsMs: -5, workerCounts: [] } } },
    { ...BASE_DEFAULT_RESULT, enabled: true, pageLimit: 1, pageTimeoutMs: 1000, delayBetweenRunsMs: 0 },
  ],
  ["sampleMode 'first'", { ocr: { benchmark: { enabled: true, sampleMode: 'first' } } }, { ...BASE_DEFAULT_RESULT, enabled: true, sampleMode: 'first' }],
  ["sampleMode ' FIRST ', trimmed and lower-cased", { ocr: { benchmark: { enabled: true, sampleMode: ' FIRST ' } } }, { ...BASE_DEFAULT_RESULT, enabled: true, sampleMode: 'first' }],
  ["sampleMode 'Evenly-Spaced'", { ocr: { benchmark: { enabled: true, sampleMode: 'Evenly-Spaced' } } }, { ...BASE_DEFAULT_RESULT, enabled: true, sampleMode: 'evenly-spaced' }],
  ["sampleMode 'random', which is not a mode", { ocr: { benchmark: { enabled: true, sampleMode: 'random' } } }, { ...BASE_DEFAULT_RESULT, enabled: true }],
  ["sampleMode '' (absent in effect)", { ocr: { benchmark: { enabled: true, sampleMode: '' } } }, { ...BASE_DEFAULT_RESULT, enabled: true }],
];

/**
 * `[configured list, cores, exact expected expansion]` at 50edbfc. 0 means "one up to the cores
 * minus one, bounded by MAX_OCR_WORKER_COUNT"; explicit counts pass through; a count above the
 * cap is dropped, and nothing usable left gives `[1]`.
 */
const EXPAND_CASES = [
  [[0], 0, [1]],
  [[0], 1, [1]],
  [[0], 2, [1]],
  [[0], 4, [1, 2, 3]],
  [[0], 8, [1, 2, 3, 4, 5, 6, 7]],
  [[0], 12, [1, 2, 3, 4, 5, 6, 7, 8]],
  [[0], 24, [1, 2, 3, 4, 5, 6, 7, 8]],
  [[0], 'x', [1]],
  [[0, 8], 0, [1, 8]],
  [[0, 8], 4, [1, 2, 3, 8]],
  [[0, 8], 8, [1, 2, 3, 4, 5, 6, 7, 8]],
  [[0, 8], 24, [1, 2, 3, 4, 5, 6, 7, 8]],
  // 16 is above the cap and is dropped whatever the client reports.
  [[4, 16], 0, [4]],
  [[4, 16], 8, [4]],
  [[4, 16], 24, [4]],
  // Nothing inside the cap: one worker, not an empty list.
  [[9, 10], 24, [1]],
  [[1, 1, 2], 24, [1, 2]],
  [[], 24, [1]],
  ['nope', 24, [1]],
  [null, 24, [1]],
];

describe('the ordinary OCR benchmark is unchanged by the boost benchmark (base commit 50edbfc)', () => {
  it('keeps its schema name and its documented defaults', () => {
    expect(OCR_BENCHMARK_SCHEMA).toBe('opendocviewer.ocr-benchmark.v1');
    expect({
      ...OCR_BENCHMARK_DEFAULTS,
      workerCounts: [...OCR_BENCHMARK_DEFAULTS.workerCounts],
      languageVariants: [...OCR_BENCHMARK_DEFAULTS.languageVariants],
      imageScales: [...OCR_BENCHMARK_DEFAULTS.imageScales],
    }).toEqual({
      pageLimit: 40,
      workerCounts: [0],
      languageVariants: ['configured', 'single'],
      imageScales: [1, 0.75],
      iterations: 1,
      sampleMode: 'evenly-spaced',
      pageTimeoutMs: 180000,
      delayBetweenRunsMs: 500,
    });
  });

  it.each(NORMALIZE_CASES)('normalizeOcrBenchmarkConfig with %s is exactly what 50edbfc returned', (_name, input, expected) => {
    expect(normalizeOcrBenchmarkConfig(input)).toEqual(expected);
  });

  it.each(EXPAND_CASES)('expandOcrBenchmarkWorkerCounts(%j, %j) is exactly what 50edbfc returned', (counts, cores, expected) => {
    expect(expandOcrBenchmarkWorkerCounts(counts, cores)).toEqual(expected);
  });
});

describe('the live OCR worker cap and policy are unchanged by the boost benchmark', () => {
  it('leaves MAX_OCR_WORKER_COUNT at 8, so no boost count can reach the live queue', () => {
    expect(MAX_OCR_WORKER_COUNT).toBe(8);
  });

  it('leaves the ocr.workerPolicy defaults at their 50edbfc values', () => {
    expect({ ...OCR_WORKER_POLICY_DEFAULTS }).toEqual({
      reservedCores: 1,
      maxWorkerCount: 4,
      pagesPerWorker: 2,
      memoryPerWorkerMiB: 110,
      memoryPerLanguageMiB: 20,
      memoryBudgetFraction: 0.25,
      assumedDeviceMemoryGiB: 4,
    });
  });
});
