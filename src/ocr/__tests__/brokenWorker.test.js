// File: src/ocr/__tests__/brokenWorker.test.js
// @vitest-environment jsdom
/**
 * A worker that breaks in the middle of a document costs one page, not the rest of it.
 *
 * The real queue (queue.js) on the real pool (enginePool.js) of real engines (engine.js); only
 * tesseract.js's worker is a fake. One worker "aborts" on a page: from then on it rejects every
 * recognition at once, as tesseract.js's worker does when its WebAssembly module has aborted.
 * Without the engine replacing such a worker the broken one, being free again at once while the
 * healthy ones are busy, takes almost every page that is left and fails it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createOcrEngine } from '../engine.js';
import { createOcrEnginePool } from '../enginePool.js';
import { OCR_PAGE_STATUS, createOcrQueue } from '../queue.js';
import { createOcrResultCache } from '../resultCache.js';
import { OCR_PAGE_DECISION } from '../classify.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

const ASSET_URLS = Object.freeze({
  workerPath: 'https://host.example/app/ocr/worker.min.js',
  corePath: 'https://host.example/app/ocr/tesseract-core-simd-lstm.wasm.js',
  langPath: 'https://host.example/app/ocr/tessdata',
});

const PAGES = 40;
/** The page whose recognition aborts the worker that has it. */
const FATAL_PAGE = 'page-7';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recognised(image) {
  return {
    data: {
      text: `${image}\n`,
      confidence: 90,
      blocks: [{ paragraphs: [{ lines: [{ words: [{ text: String(image), confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }] }] }] }],
    },
  };
}

/** Fake tesseract.js workers: a healthy one takes a few ms per page, an aborted one rejects at once. */
function makeWorkerFactory() {
  const workers = [];
  const createWorker = vi.fn(async () => {
    const worker = {
      aborted: false,
      recognize: vi.fn(async (image) => {
        if (worker.aborted) throw 'RuntimeError: Aborted(). Build with -sASSERTIONS for more info.';
        await wait(4);
        if (image === FATAL_PAGE) {
          worker.aborted = true;
          throw 'RuntimeError: Aborted(OOM)';
        }
        return recognised(image);
      }),
      terminate: vi.fn(async () => {}),
    };
    workers.push(worker);
    return worker;
  });
  return { createWorker, workers };
}

function candidates() {
  return Array.from({ length: PAGES }, (_, index) => {
    const page = { sourceKey: 'doc', pageIndex: index, fileExtension: 'png', status: 1, fullSizeStatus: 1 };
    return { key: makeOcrPageKey('doc', index), sourceKey: 'doc', pageIndex: index, viewerIndex: index, page };
  });
}

/** @returns {Promise<{ statuses: Array<string>, workers: Array<Object>, createWorker: Function, log: Object }>} */
async function runDocument({ poolSize }) {
  const { createWorker, workers } = makeWorkerFactory();
  const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
  const makeEngine = () => createOcrEngine({ languages: ['swe'], assetUrls: ASSET_URLS, createWorker, probeWebAssembly: () => {}, log });
  const engine = poolSize > 1 ? createOcrEnginePool({ size: poolSize, createEngine: makeEngine, log }) : makeEngine();
  const cache = createOcrResultCache({ limit: PAGES });
  let idle;
  const done = new Promise((resolve) => { idle = resolve; });
  const queue = createOcrQueue({
    engine,
    concurrency: poolSize,
    cache,
    probeTextLayer: async () => ({ usable: false }),
    getPageImage: async (entry) => ({ blob: `page-${entry.pageIndex + 1}`, width: 100, height: 100 }),
    classify: () => ({ decision: OCR_PAGE_DECISION.RECOGNIZE }),
    log,
    onIdle: () => idle(),
  });
  const plan = candidates();
  queue.setWindow(plan);
  await done;
  const snapshot = queue.getSnapshot();
  queue.dispose();
  return { statuses: plan.map((entry) => snapshot.pages[entry.key]?.status), workers, createWorker, log };
}

describe('a pool of one engine whose first page is rejected and whose replacement cannot start', () => {
  it('fails those two pages alone: the engine did start once, so OCR is not given up for the session', async () => {
    const healthy = () => ({ recognize: vi.fn(async (image) => recognised(image)), terminate: vi.fn(async () => {}) });
    const createWorker = vi.fn(async () => {
      const call = createWorker.mock.calls.length;
      // The first worker starts and rejects its page; its replacement cannot start (a model
      // that did not arrive); every worker after that is in order.
      if (call === 1) return { recognize: vi.fn(async () => { throw 'RuntimeError: Aborted(OOM)'; }), terminate: vi.fn(async () => {}) };
      if (call === 2) throw new Error('Network error while fetching https://host.example/app/ocr/tessdata/swe.traineddata.gz. Response code: 503');
      return healthy();
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
    const pool = createOcrEnginePool({
      size: 1,
      createEngine: () => createOcrEngine({ languages: ['swe'], assetUrls: ASSET_URLS, createWorker, probeWebAssembly: () => {}, log }),
      log,
    });
    const cache = createOcrResultCache({ limit: PAGES });
    let idle;
    const done = new Promise((resolve) => { idle = resolve; });
    const queue = createOcrQueue({
      engine: pool,
      concurrency: 1,
      cache,
      probeTextLayer: async () => ({ usable: false }),
      getPageImage: async (entry) => ({ blob: `page-${entry.pageIndex + 1}`, width: 100, height: 100 }),
      classify: () => ({ decision: OCR_PAGE_DECISION.RECOGNIZE }),
      log,
      onIdle: () => idle(),
    });
    const plan = candidates().slice(0, 5);
    queue.setWindow(plan);
    await done;
    const snapshot = queue.getSnapshot();
    queue.dispose();

    expect(plan.map((entry) => snapshot.pages[entry.key]?.status)).toEqual([
      OCR_PAGE_STATUS.FAILED, OCR_PAGE_STATUS.FAILED, OCR_PAGE_STATUS.DONE, OCR_PAGE_STATUS.DONE, OCR_PAGE_STATUS.DONE,
    ]);
    expect(snapshot.engineFailure).toBeNull();
    expect(pool.getFailure()).toBeNull();
  });
});

describe('a worker that breaks in the middle of a document', () => {
  it.each([[1], [3]])('costs the one page it broke on, with %i engine(s): every other page is recognised', async (poolSize) => {
    const { statuses, workers, createWorker, log } = await runDocument({ poolSize });

    const failed = statuses.map((status, index) => (status === OCR_PAGE_STATUS.FAILED ? index + 1 : 0)).filter(Boolean);
    expect(failed).toEqual([7]);
    expect(statuses.filter((status) => status === OCR_PAGE_STATUS.DONE)).toHaveLength(PAGES - 1);

    // The broken worker was terminated after its one rejection and never handed another page.
    const broken = workers.filter((worker) => worker.aborted);
    expect(broken).toHaveLength(1);
    expect(broken[0].terminate).toHaveBeenCalledTimes(1);
    expect(broken[0].recognize.mock.calls.at(-1)[0]).toBe(FATAL_PAGE);
    // One more worker than engines: the replacement.
    expect(createWorker).toHaveBeenCalledTimes(poolSize + 1);
    expect(log.warn).toHaveBeenCalledWith('OCR worker rejected a recognition and is replaced', { error: 'RuntimeError: Aborted(OOM)' });
  });
});
