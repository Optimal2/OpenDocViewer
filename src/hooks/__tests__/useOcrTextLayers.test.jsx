// @vitest-environment jsdom
// File: src/hooks/__tests__/useOcrTextLayers.test.jsx
/**
 * useOcrTextLayers glues the OCR module to the viewer: nothing without the module; with it, one
 * engine and queue per session fed the window around the focus pages from the pages whose
 * render exists, outcomes exposed per page key, pages dropped with their document, no new work
 * while paused or before the first page is shown, and the worker released after a minute idle.
 * With `ocr.boost` on, the hook owns the boost's triggers: a pool is asked for, idleness, a
 * hidden tab and the open search engage the boost control while more pages are pending than the
 * cautious count, input ends it, and the cases without a boost (off, manual count, no room, no
 * reference page) listen to nothing. The module is the real cache/window/queue/boost control with
 * a fake engine and prober; page images come from a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useOcrTextLayers, { OCR_BOOST_POINTER_SLOP_PX, OCR_IDLE_SHUTDOWN_MS, createPointerTravelFilter } from '../useOcrTextLayers.js';
import { createOcrResultCache } from '../../ocr/resultCache.js';
import { createOcrQueue } from '../../ocr/queue.js';
import { planOcrWindow } from '../../ocr/window.js';
import { createOcrBoostController, planOcrBoostLevels } from '../../ocr/boost.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

vi.mock('../../logging/systemLogger.js', () => ({ default: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function makeEngine() {
  const pending = [];
  return {
    pending,
    recognize: vi.fn((image) => new Promise((resolve, reject) => { pending.push({ resolve, reject, image }); })),
    terminate: vi.fn(async () => {}),
    getFailure: () => null,
  };
}

/** A fake pool: the engine above with the shape the boost control resizes. */
function makePool() {
  const pool = makeEngine();
  pool.size = 1;
  pool.resize = vi.fn((size) => { pool.size = size; });
  return pool;
}

/** The pending recognitions of the reference page (the boost's probes) and of pages. */
const probesOf = (engine) => engine.pending.filter((entry) => entry.image?.type === 'image/ref');
const pagesOf = (engine) => engine.pending.filter((entry) => entry.image?.type !== 'image/ref');

function makeModule(engine, prober) {
  return {
    created: 0,
    createOptions: [],
    prepared: [],
    measured: null,
    // What createConfiguredOcrEngine reports as the setup (overridden by boost tests).
    workerCount: undefined,
    workerPlan: undefined,
    referencePage: new Blob(['reference'], { type: 'image/ref' }),
    createOcrResultCache,
    planOcrWindow,
    createOcrQueue,
    planOcrBoostLevels,
    createOcrBoostController,
    createOcrReferencePage() { return Promise.resolve(this.referencePage); },
    // The shared preparation worker (imagePreparer.test.js); the hook only ends it on unmount.
    disposeOcrImagePreparer: vi.fn(),
    // The language guess the hook wires in for the OCR languages (the real one is in
    // detectLanguage.test.js); here every finished page is Swedish.
    detectTextLanguage: (words, candidates) => ({ language: candidates.includes('sv') ? 'sv' : null, scores: {}, words: words.length }),
    // The real prepareOcrImage decodes and copies the image (prepareImage.test.js); here it
    // records what the hook hands it and answers with the measured size a test sets, else the
    // hook's fallback (the page entry).
    async prepareOcrImage(blob, options) {
      this.prepared.push({ type: blob.type, fallbackSize: options?.fallbackSize });
      const size = this.measured || options.fallbackSize;
      return { blob, width: size.width, height: size.height, rulingLinePixels: 0 };
    },
    createConfiguredOcrEngine(cfg, options = {}) {
      this.created += 1;
      this.createOptions.push(options);
      return { engine, setup: { languages: ['swe', 'eng'], assetUrls: {}, warnings: [], workerCount: this.workerCount, workerPlan: this.workerPlan }, workerCount: this.workerCount };
    },
    createPdfTextProber: () => prober,
  };
}

function makeProber() {
  return {
    probe: vi.fn(async () => ({ usable: false, verdict: 'empty' })),
    retainSources: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  };
}

function page(sourceKey, pageIndex, overrides = {}) {
  return { sourceKey, pageIndex, fileExtension: 'png', status: 1, fullSizeStatus: 1, fullSizeUrl: `/pages/${sourceKey}-${pageIndex}.png`, realWidth: 1240, realHeight: 1754, ...overrides };
}

const result = (text) => ({ text, confidence: 90, words: [] });
const flush = () => act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); });

let root;
let container;
let latest;
let fetchCalls;

function Harness(props) {
  latest = useOcrTextLayers(props);
  return null;
}

async function render(props) {
  await act(async () => { root.render(createElement(Harness, props)); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, blob: async () => new Blob([String(url)], { type: 'image/png' }) };
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const baseProps = (overrides = {}) => ({
  ocrModule: null,
  allPages: [],
  focusPageIndexes: [],
  ready: true,
  paused: false,
  readSourceArrayBuffer: async () => new ArrayBuffer(8),
  ensurePageAsset: vi.fn(async (index) => `/pages/doc-${index}.png`),
  ...overrides,
});

describe('useOcrTextLayers', () => {
  it('holds an empty map and creates nothing without the module', async () => {
    const props = baseProps({ allPages: [page('doc', 0)], focusPageIndexes: [0] });
    await render(props);
    expect(latest).toEqual({ ocrPages: {}, ocrEngineFailure: null, ocrBoost: null });
    expect(props.ensurePageAsset).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it('recognises the focus page and its window from the rendered page images, exposing outcomes per key', async () => {
    const engine = makeEngine();
    const prober = makeProber();
    const ocrModule = makeModule(engine, prober);
    const allPages = [page('doc', 0), page('doc', 1), page('doc', 2), page('doc', 3), page('doc', 4)];
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [1] });
    await render(props);
    await flush();

    expect(ocrModule.created).toBe(1);
    expect(props.ensurePageAsset).toHaveBeenCalledWith(1, 'full');
    expect(fetchCalls).toEqual(['/pages/doc-1.png']);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(engine.recognize.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toEqual({ status: 'recognizing' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 2)]).toEqual({ status: 'queued' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 4)]).toBeUndefined();

    engine.pending[0].resolve(result('sida två'));
    await flush();
    // The guess ran with the OCR languages (swe, eng → sv, en) and tagged the page.
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toMatchObject({ status: 'done', text: 'sida två', imageWidth: 1240, imageHeight: 1754, language: 'sv' });
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(fetchCalls[1]).toBe('/pages/doc-2.png');

    for (const [index, text] of [[1, 'sida tre'], [2, 'sida fyra'], [3, 'sida ett']]) {
      engine.pending[index].resolve(result(text));
      await flush();
    }
    expect(Object.values(latest.ocrPages).map((entry) => entry.text).sort()).toEqual(['sida ett', 'sida fyra', 'sida tre', 'sida två']);
    expect(engine.recognize).toHaveBeenCalledTimes(4);
  });

  it('runs as many pages at a time as the configured engine reports workers for', async () => {
    const engine = makeEngine();
    engine.size = 2;
    const ocrModule = makeModule(engine, makeProber());
    ocrModule.createConfiguredOcrEngine = function createPool() {
      this.created += 1;
      return { engine, setup: { languages: ['swe', 'eng'], assetUrls: {}, warnings: [], workerCount: 2 }, workerCount: 2 };
    };
    const allPages = [page('doc', 0), page('doc', 1), page('doc', 2), page('doc', 3)];
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [0] });
    await render(props);
    await flush();

    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(fetchCalls).toEqual(['/pages/doc-0.png', '/pages/doc-1.png']);
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toEqual({ status: 'recognizing' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toEqual({ status: 'recognizing' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 2)]).toEqual({ status: 'queued' });

    engine.pending[0].resolve(result('första'));
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(3);
    expect(latest.ocrPages[makeOcrPageKey('doc', 2)]).toEqual({ status: 'recognizing' });
  });

  it('keeps only as many pages in flight as the pending pages warrant, through the module\'s resolveOcrConcurrency', async () => {
    const engine = makeEngine();
    engine.size = 4;
    const ocrModule = makeModule(engine, makeProber());
    const setup = { languages: ['swe', 'eng'], assetUrls: {}, warnings: [], workerCount: 4 };
    ocrModule.createConfiguredOcrEngine = function createPool() {
      this.created += 1;
      return { engine, setup, workerCount: 4 };
    };
    // The real one (setup.js) plans one worker per two pending pages, never above the pool.
    const asked = [];
    ocrModule.resolveOcrConcurrency = (pending, givenSetup) => {
      asked.push([pending, givenSetup]);
      return Math.max(1, Math.min(givenSetup.workerCount, Math.ceil(pending / 2)));
    };
    const allPages = [page('doc', 0), page('doc', 1), page('doc', 2), page('doc', 3), page('doc', 4), page('doc', 5)];
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [0] });
    await render(props);
    await flush();

    // The window of page 0 holds pages 0, 1 and 2 (nothing behind it): three pending -> two in flight.
    expect(asked[0]).toEqual([3, setup]);
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(latest.ocrPages[makeOcrPageKey('doc', 2)]).toEqual({ status: 'queued' });

    engine.pending[0].resolve(result('ett'));
    engine.pending[1].resolve(result('två'));
    await flush();
    engine.pending[2].resolve(result('tre'));
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(3);

    // Moving on one page leaves one new page in the window (page 3): one pending -> one in flight.
    await render({ ...props, focusPageIndexes: [1] });
    await flush();
    expect(asked[asked.length - 1]).toEqual([1, setup]);
    expect(engine.recognize).toHaveBeenCalledTimes(4);
    expect(fetchCalls[3]).toBe('/pages/doc-3.png');
  });

  it('raises the concurrency together with the new window, so no page of the old window starts on the way', async () => {
    const engine = makeEngine();
    engine.size = 2;
    const ocrModule = makeModule(engine, makeProber());
    const setup = { languages: ['swe', 'eng'], assetUrls: {}, warnings: [], workerCount: 2 };
    ocrModule.createConfiguredOcrEngine = function createPool() {
      this.created += 1;
      return { engine, setup, workerCount: 2 };
    };
    ocrModule.resolveOcrConcurrency = (pending, givenSetup) => Math.max(1, Math.min(givenSetup.workerCount, Math.ceil(pending / 2)));
    const allPages = Array.from({ length: 10 }, (_, index) => page('doc', index));
    // The last page: its window is pages 9 and 8 (nothing ahead), two pending -> one in flight.
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [9] });
    await render(props);
    await flush();
    expect(fetchCalls).toEqual(['/pages/doc-9.png']);
    expect(latest.ocrPages[makeOcrPageKey('doc', 8)]).toEqual({ status: 'queued' });

    // A jump to page 3: four pending -> two in flight. The second slot must go to the new
    // window (page 3), never to page 8 of the old one, which is no longer planned.
    await render({ ...props, focusPageIndexes: [3] });
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(fetchCalls).toEqual(['/pages/doc-9.png', '/pages/doc-3.png']);
    expect(latest.ocrPages[makeOcrPageKey('doc', 8)]).toBeUndefined();
    expect(latest.ocrPages[makeOcrPageKey('doc', 4)]).toEqual({ status: 'queued' });
  });

  it('hands the fetched image to prepareOcrImage with the page entry as size fallback and keeps the measured size', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    ocrModule.measured = { width: 2480, height: 3508 };
    // The page entry carries thumbnail-sized dimensions (a thumbnail commit overwrote them).
    const props = baseProps({ ocrModule, allPages: [page('doc', 0, { realWidth: 220, realHeight: 311 })], focusPageIndexes: [0] });
    await render(props);
    await flush();
    engine.pending[0].resolve(result('mätt'));
    await flush();
    expect(ocrModule.prepared).toEqual([{ type: 'image/png', fallbackSize: { width: 220, height: 311 } }]);
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toMatchObject({ status: 'done', imageWidth: 2480, imageHeight: 3508, rulingLinePixels: 0 });
  });

  it('waits for a page to be rendered before queuing it', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    const unrendered = page('doc', 0, { fullSizeStatus: 0, fullSizeUrl: '' });
    const props = baseProps({ ocrModule, allPages: [unrendered], focusPageIndexes: [0] });
    await render(props);
    await flush();
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(latest.ocrPages).toEqual({});

    await render({ ...props, allPages: [page('doc', 0)] });
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
  });

  it('starts nothing while the viewer loads the document, not even the shown page; everything follows when the load is done', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    // What the real module does: fewer pages in flight for fewer pending pages.
    ocrModule.resolveOcrConcurrency = vi.fn((pending) => Math.max(1, Math.min(8, Math.ceil(pending / 2))));
    ocrModule.workerCount = 8;
    const allPages = Array.from({ length: 12 }, (_, index) => page('doc', index));
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [0], wholeDocument: true, loading: true });
    await render(props);
    await flush();
    // Loading: the pages are planned and wait; no image is fetched, no engine is asked.
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(props.ensurePageAsset).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
    expect(Object.values(latest.ocrPages).every((entry) => entry.status === 'queued')).toBe(true);
    expect(Object.keys(latest.ocrPages)).toHaveLength(12);

    // The load is done: the queue takes over with the engines the whole document warrants.
    await render({ ...props, loading: false });
    await flush();
    expect(engine.pending).toHaveLength(6);

    // A new load pauses again: the pages in flight finish, nothing new starts.
    await render({ ...props, loading: true });
    await act(async () => { engine.pending[0].resolve(result('page')); });
    await flush();
    expect(engine.pending).toHaveLength(6);
    await render({ ...props, loading: false });
    await flush();
    expect(engine.pending).toHaveLength(7);
  });

  it('with the whole document asked for, queues the loaded pages beyond the window after it, rendered on demand', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    // Pages 0-3 rendered (the window around page 0 is 0, 1, 2); pages 4-5 loaded but not
    // rendered; page 6 still loading.
    const allPages = [
      page('doc', 0), page('doc', 1), page('doc', 2), page('doc', 3),
      page('doc', 4, { fullSizeStatus: 0, fullSizeUrl: '' }), page('doc', 5, { fullSizeStatus: 0, fullSizeUrl: '' }),
      page('doc', 6, { status: 0, fullSizeStatus: 0, fullSizeUrl: '' }),
    ];
    const ensurePageAsset = vi.fn(async (index) => `/pages/doc-${index}.png`);
    const releasePageAsset = vi.fn();
    // The outcome cache is bounded by the page count once the whole document is planned.
    let cache = null;
    ocrModule.createOcrResultCache = (options) => { cache = createOcrResultCache(options); cache.setLimit = vi.fn(cache.setLimit); return cache; };
    await render(baseProps({ ocrModule, allPages, focusPageIndexes: [0], ensurePageAsset, releasePageAsset, wholeDocument: true }));
    await flush();
    expect(cache.setLimit).toHaveBeenCalledWith(allPages.length);
    // One page at a time: the window first (0, 1, 2), then the rest in order (3, 4, 5); the
    // unrendered pages are asked for through ensurePageAsset like any other, the loading page
    // never. Pages beyond the window are queued from the start, so the search can say so.
    expect(latest.ocrPages[makeOcrPageKey('doc', 5)]).toEqual({ status: 'queued' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 6)]).toBeUndefined();
    for (let step = 0; step < 6; step += 1) {
      expect(engine.recognize).toHaveBeenCalledTimes(step + 1);
      engine.pending[step].resolve(result(`sida ${step}`));
      await flush();
    }
    expect(engine.recognize).toHaveBeenCalledTimes(6);
    expect(ensurePageAsset.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Object.values(latest.ocrPages).filter((entry) => entry.status === 'done')).toHaveLength(6);
    // Only the pages rendered for OCR (beyond the window and unrendered before) were released
    // again, once their bytes were read; the window's and the already rendered page 3 never.
    expect(releasePageAsset.mock.calls).toEqual([[4, '/pages/doc-4.png'], [5, '/pages/doc-5.png']]);

    // Off (the default), the window alone: nothing beyond it is even queued.
    const engine2 = makeEngine();
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render(baseProps({ ocrModule: makeModule(engine2, makeProber()), allPages, focusPageIndexes: [0], wholeDocument: false }));
    await flush();
    expect(Object.keys(latest.ocrPages).sort()).toEqual([0, 1, 2].map((index) => makeOcrPageKey('doc', index)).sort());
  });

  it('drops the queued neighbours when the focus moves and lets the page in flight finish', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    const allPages = Array.from({ length: 30 }, (_, index) => page('doc', index));
    const props = baseProps({ ocrModule, allPages, focusPageIndexes: [0] });
    await render(props);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);

    await render({ ...props, focusPageIndexes: [20] });
    await flush();
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toBeUndefined();
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toEqual({ status: 'recognizing' });
    expect(latest.ocrPages[makeOcrPageKey('doc', 20)]).toEqual({ status: 'queued' });

    engine.pending[0].resolve(result('noll'));
    await flush();
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)].text).toBe('noll');
    expect(fetchCalls).toEqual(['/pages/doc-0.png', '/pages/doc-20.png']);
  });

  it('forgets a document that left the viewer, terminating the engine for its page in flight', async () => {
    const engine = makeEngine();
    const prober = makeProber();
    const ocrModule = makeModule(engine, prober);
    const props = baseProps({ ocrModule, allPages: [page('old', 0)], focusPageIndexes: [0] });
    await render(props);
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);

    await render({ ...props, allPages: [page('new', 0)], ensurePageAsset: async () => '/pages/new-0.png' });
    await flush();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(prober.retainSources).toHaveBeenLastCalledWith(new Set(['new']));
    expect(latest.ocrPages[makeOcrPageKey('old', 0)]).toBeUndefined();
    engine.pending[0].resolve(result('old'));
    await flush();
    expect(latest.ocrPages[makeOcrPageKey('old', 0)]).toBeUndefined();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(ocrModule.created).toBe(1);
  });

  it('starts nothing while paused or before the first page is shown', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    const props = baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0], ready: false });
    await render(props);
    await flush();
    expect(engine.recognize).not.toHaveBeenCalled();

    await render({ ...props, ready: true, paused: true });
    await flush();
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(latest.ocrPages[makeOcrPageKey('doc', 0)]).toEqual({ status: 'queued' });

    await render({ ...props, ready: true, paused: false });
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(1);
  });

  it('releases the worker and the probed documents after a minute idle and restarts on demand', async () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    const prober = makeProber();
    const ocrModule = makeModule(engine, prober);
    const props = baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0] });
    await render(props);
    await flush();
    engine.pending[0].resolve(result('x'));
    await flush();
    expect(engine.terminate).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(OCR_IDLE_SHUTDOWN_MS - 1); });
    expect(engine.terminate).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(prober.releaseAll).toHaveBeenCalledTimes(1);

    // A new page restarts the same engine (terminate only released the worker).
    await render({ ...props, allPages: [page('doc', 0), page('doc', 1)], focusPageIndexes: [1] });
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(ocrModule.created).toBe(1);
  });

  it('does not release the worker while a page is in flight when the idle timer fires', async () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    const props = baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0] });
    await render(props);
    await flush();
    engine.pending[0].resolve(result('x'));
    await flush();
    await render({ ...props, allPages: [page('doc', 0), page('doc', 1)] });
    await flush();
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(OCR_IDLE_SHUTDOWN_MS * 2); });
    expect(engine.terminate).not.toHaveBeenCalled();
  });

  it('disposes the queue and ends the preparation worker on unmount', async () => {
    const engine = makeEngine();
    const prober = makeProber();
    const ocrModule = makeModule(engine, prober);
    await render(baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0] }));
    await flush();
    expect(ocrModule.disposeOcrImagePreparer).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(prober.releaseAll).toHaveBeenCalled();
    expect(ocrModule.disposeOcrImagePreparer).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });
});

describe('useOcrTextLayers boost', () => {
  const BOOST = Object.freeze({ enabled: true, idleAfterMs: 1000, maxWorkerCount: 32, slowdownFraction: 0.25, triggers: { idle: true, hidden: true, search: true } });
  const sixPages = () => [0, 1, 2, 3, 4, 5].map((index) => page('doc', index));

  /** A module whose configured engine is a pool of one, automatic, with memory for many. */
  function boostModule(pool) {
    const ocrModule = makeModule(pool, makeProber());
    ocrModule.workerCount = 1;
    ocrModule.workerPlan = { automatic: true, caps: { cores: 3, memory: 63, pages: null, max: 8 } };
    return ocrModule;
  }

  const listenersAdded = () => window.addEventListener.mock.calls.filter(([type]) => type === 'pointerdown').length;

  beforeEach(() => {
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with the boost off asks for no pool, listens to nothing and exposes no boost state', async () => {
    const engine = makeEngine();
    const ocrModule = makeModule(engine, makeProber());
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: null, hardwareThreads: 4 }));
    await flush();
    expect(ocrModule.createOptions).toEqual([{}]);
    expect(listenersAdded()).toBe(0);
    expect(latest.ocrBoost).toBeNull();
  });

  it('with the boost on asks for a pool, engages after the idle time while pages wait, and input brings the cautious count back', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    expect(ocrModule.createOptions).toEqual([{ pool: true }]);
    expect(listenersAdded()).toBe(1);
    // Cautious 1 on four threads with room for 4: the climb is 2, 3, 4.
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', level: 1, cautious: 1, levels: [2, 3, 4] });
    // One page in flight at the cautious count, no probe yet.
    expect(pagesOf(pool)).toHaveLength(1);
    expect(probesOf(pool)).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(999); });
    expect(probesOf(pool)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    // Idle: the baseline probe runs at the cautious count.
    expect(latest.ocrBoost.state).toBe('rising');
    expect(probesOf(pool)).toHaveLength(1);
    expect(pool.resize).not.toHaveBeenCalled();
    await act(async () => { probesOf(pool)[0].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); });
    await flush();
    // Level 2 applied: the pool grows and a second page starts; the next probe is under way.
    expect(pool.resize).toHaveBeenLastCalledWith(2);
    expect(latest.ocrBoost).toMatchObject({ state: 'rising', level: 2 });
    expect(pagesOf(pool)).toHaveLength(2);
    expect(probesOf(pool)).toHaveLength(2);
    await act(async () => { probesOf(pool)[1].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1100 }); });
    await flush();
    expect(pool.resize).toHaveBeenLastCalledWith(3);
    expect(pagesOf(pool)).toHaveLength(3);

    // Input: back to the cautious count at once; the probe of level 3 answers into the void.
    await act(async () => { window.dispatchEvent(new Event('pointerdown')); });
    expect(pool.resize).toHaveBeenLastCalledWith(1);
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', level: 1, settledLevel: null });
    await act(async () => { probesOf(pool)[2].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1150 }); });
    await flush();
    expect(pool.resize).toHaveBeenLastCalledWith(1);
    expect(latest.ocrBoost.state).toBe('cautious');
    // The pages in flight were not cut short: three are still running, none rejected.
    expect(pagesOf(pool)).toHaveLength(3);
    expect(pool.terminate).not.toHaveBeenCalled();
  });

  it('settles where the reference page slows, and remembers the level across the next idle period', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    await act(async () => { probesOf(pool)[0].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); });
    await flush();
    await act(async () => { probesOf(pool)[1].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); }); // 2: fine
    await flush();
    await act(async () => { probesOf(pool)[2].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1400 }); }); // 3: 40 % slower
    await flush();
    expect(pool.resize.mock.calls.map(([size]) => size)).toEqual([2, 3, 2]);
    expect(latest.ocrBoost).toMatchObject({ state: 'boosted', level: 2, settledLevel: 2 });

    await act(async () => { window.dispatchEvent(new Event('keydown')); });
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', level: 1, settledLevel: 2 });
    pool.resize.mockClear();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    await act(async () => { probesOf(pool)[3].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); });
    await flush();
    // Straight to the remembered level, confirmed with one probe.
    expect(pool.resize.mock.calls.map(([size]) => size)).toEqual([2]);
    await act(async () => { probesOf(pool)[4].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1050 }); });
    await flush();
    expect(latest.ocrBoost).toMatchObject({ state: 'boosted', level: 2, settledLevel: 2 });
    expect(probesOf(pool)).toHaveLength(5);
  });

  it('engages at once when the tab is hidden and when the search over the whole document opens, and ends when the search closes', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    const props = baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 });
    await render(props);
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    // Hidden: no waiting for the idle time.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(probesOf(pool)).toHaveLength(1);
    expect(latest.ocrBoost.state).toBe('rising');
    visibility.mockReturnValue('visible');
    await act(async () => { window.dispatchEvent(new Event('wheel')); });
    expect(latest.ocrBoost.state).toBe('cautious');

    // The search opens with a term over the whole document: a way in of its own.
    await render({ ...props, searchOpen: true });
    await flush();
    expect(latest.ocrBoost.state).toBe('rising');
    expect(probesOf(pool)).toHaveLength(2);
    // The search closes: the boosted state ends with it.
    await render({ ...props, searchOpen: false });
    expect(latest.ocrBoost.state).toBe('cautious');
    visibility.mockRestore();
  });

  it('does not take a pointer resting on the page for input: jitter neither restarts the idle clock nor ends the boost, travel does both', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    const move = (x, y) => act(async () => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y })); });
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    // The pointer comes to rest on the page, then jitters by a pixel or two (and is reported
    // without travel at all) for the whole idle time: the clock runs out as if nothing happened.
    await move(300, 300);
    for (const [dx, dy] of [[1, 0], [0, 0], [-2, 1], [1, -1], [0, 0], [2, 2], [-1, -2], [0, 1], [1, 0]]) {
      await act(async () => { vi.advanceTimersByTime(100); });
      await move(300 + dx, 300 + dy);
    }
    expect(probesOf(pool)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    expect(latest.ocrBoost.state).toBe('rising');
    expect(probesOf(pool)).toHaveLength(1);
    await act(async () => { probesOf(pool)[0].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); });
    await flush();
    expect(pool.resize).toHaveBeenLastCalledWith(2);
    // More jitter while boosted: still boosted.
    await move(301, 299);
    await move(300, 300);
    expect(latest.ocrBoost).toMatchObject({ state: 'rising', level: 2 });
    expect(pool.resize).toHaveBeenLastCalledWith(2);
    // The pointer is moved on purpose: the cautious count is back at once.
    await move(300 + OCR_BOOST_POINTER_SLOP_PX, 300);
    expect(pool.resize).toHaveBeenLastCalledWith(1);
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', level: 1, endedBy: 'input' });
    // And the idle clock started again from that move: nothing after 999 ms, the boost after 1000.
    const probes = probesOf(pool).length;
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(probesOf(pool)).toHaveLength(probes);
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(probesOf(pool)).toHaveLength(probes + 1);
  });

  it('counts pointer travel from where the pointer last rested, and a move without a position as travel', () => {
    expect(OCR_BOOST_POINTER_SLOP_PX).toBe(8);
    const travelled = createPointerTravelFilter(8);
    // The first move only says where the pointer is.
    expect(travelled({ clientX: 100, clientY: 100 })).toBe(false);
    expect(travelled({ clientX: 105, clientY: 105 })).toBe(false); // 7.1 px away
    expect(travelled({ clientX: 100, clientY: 100 })).toBe(false);
    // Slow drift is travel once it has gone far enough from the resting place, which then moves.
    expect(travelled({ clientX: 104, clientY: 100 })).toBe(false);
    expect(travelled({ clientX: 108, clientY: 100 })).toBe(true);
    expect(travelled({ clientX: 104, clientY: 100 })).toBe(false);
    expect(travelled({ clientX: 100, clientY: 100 })).toBe(true);
    // The pointer left the window and comes back somewhere else: travel at once.
    expect(travelled({ clientX: 600, clientY: 20 })).toBe(true);
    // No position to judge by: counted.
    expect(travelled({})).toBe(true);
    expect(travelled(undefined)).toBe(true);
    // A threshold of nothing counts every move after the first.
    const any = createPointerTravelFilter(0);
    expect(any({ clientX: 1, clientY: 1 })).toBe(false);
    expect(any({ clientX: 1, clientY: 1 })).toBe(true);
  });

  it('restarts the idle clock when pages arrive after it ran out, so a document that loads while the user does nothing still boosts', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    // One page at first: the clock runs out with nothing to boost for.
    const props = baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 });
    await render(props);
    await flush();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    // The rest of the document arrives, still without input: the clock starts again and the
    // boost engages one idle period later.
    await render({ ...props, allPages: sixPages() });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(pool)).toHaveLength(1);
    expect(latest.ocrBoost.state).toBe('rising');
  });

  it('does not engage while fewer pages are pending than the cautious count can take, or while paused', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    ocrModule.workerCount = 3;
    // Three pages for a cautious count of three: nothing to boost for.
    const props = baseProps({ ocrModule, allPages: [page('doc', 0), page('doc', 1), page('doc', 2)], focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 8 });
    await render(props);
    await flush();
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', levels: [4, 6, 8] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    expect(latest.ocrBoost.state).toBe('cautious');

    // Six pages, but paused: still nothing.
    const paused = makePool();
    const pausedModule = boostModule(paused);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render(baseProps({ ocrModule: pausedModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4, paused: true }));
    await flush();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(paused)).toHaveLength(0);
    expect(latest.ocrBoost.state).toBe('cautious');
  });

  it('stays out while the viewer is loading the document, engages one idle period after the load, and ends when a load starts', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    const props = baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4, loading: true });
    await render(props);
    await flush();
    // Loading: the idle clock runs out, pages wait, the search is even open, and nothing starts.
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    await render({ ...props, searchOpen: true });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    expect(latest.ocrBoost.state).toBe('cautious');
    // Nor for a hidden tab while loading.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await render({ ...props, searchOpen: false });

    // The load is done: one idle period later the boost engages.
    await render({ ...props, loading: false });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(pool)).toHaveLength(1);
    await act(async () => { probesOf(pool)[0].resolve({ text: '', confidence: 0, words: [], recognizeMs: 1000 }); });
    await flush();
    expect(pool.resize).toHaveBeenLastCalledWith(2);
    expect(latest.ocrBoost).toMatchObject({ state: 'rising', level: 2 });

    // Another document starts loading: the cautious count is back at once, and ending the
    // boost starts no page on the way (two were in flight; they finish, no third begins).
    const inFlight = pagesOf(pool).length;
    await render({ ...props, loading: true });
    expect(pool.resize).toHaveBeenLastCalledWith(1);
    expect(latest.ocrBoost).toMatchObject({ state: 'cautious', level: 1, endedBy: 'loading' });
    await act(async () => { pagesOf(pool)[0].resolve(result('first')); });
    await flush();
    expect(pagesOf(pool)).toHaveLength(inFlight);
    visibility.mockRestore();
  });

  it('does not engage once the work is done, even when the idle clock fires afterwards', async () => {
    vi.useFakeTimers();
    const pool = makePool();
    const ocrModule = boostModule(pool);
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    // The six pages are recognised one after another at the cautious count, before the clock fires.
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { pagesOf(pool)[index].resolve(result(`page ${index}`)); });
      await flush();
    }
    expect(Object.values(latest.ocrPages).filter((entry) => entry.status === 'done')).toHaveLength(6);
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(probesOf(pool)).toHaveLength(0);
    expect(latest.ocrBoost.state).toBe('cautious');
  });

  it('leaves the boost out, listening to nothing, for a manual worker count, no room above the cautious count, or no reference page', async () => {
    const manual = boostModule(makePool());
    manual.workerPlan = { automatic: false, caps: null };
    await render(baseProps({ ocrModule: manual, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    expect(manual.createOptions).toEqual([{ pool: true }]);
    expect(latest.ocrBoost).toBeNull();
    expect(listenersAdded()).toBe(0);

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    const cramped = boostModule(makePool());
    // Two threads and a cautious count of one, but the memory budget allows one engine only.
    cramped.workerPlan = { automatic: true, caps: { cores: 1, memory: 1, pages: null, max: 8 } };
    await render(baseProps({ ocrModule: cramped, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 2 }));
    await flush();
    expect(latest.ocrBoost).toBeNull();
    expect(listenersAdded()).toBe(0);

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    const blind = boostModule(makePool());
    blind.referencePage = null;
    await render(baseProps({ ocrModule: blind, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    expect(latest.ocrBoost).toBeNull();
    expect(listenersAdded()).toBe(0);
  });

  it('reads the boost configuration from the runtime config once, so re-renders do not restart the runtime', async () => {
    vi.stubGlobal('__ODV_CONFIG__', undefined);
    window.__ODV_CONFIG__ = { ocr: { enabled: true, boost: { enabled: true, idleAfterMs: 1000 } } };
    try {
      const pool = makePool();
      const ocrModule = boostModule(pool);
      // No `boost` prop: the hook reads window.__ODV_CONFIG__ itself.
      const props = baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, hardwareThreads: 4 });
      await render(props);
      await flush();
      expect(latest.ocrBoost).toMatchObject({ state: 'cautious', levels: [2, 3, 4] });
      // Several renders with new prop objects: one runtime, one set of listeners.
      await render({ ...props, focusPageIndexes: [1] });
      await render({ ...props, focusPageIndexes: [2] });
      await flush();
      expect(ocrModule.created).toBe(1);
      expect(listenersAdded()).toBe(1);
      expect(latest.ocrBoost).toMatchObject({ state: 'cautious', levels: [2, 3, 4] });
    } finally {
      delete window.__ODV_CONFIG__;
    }
  });

  it('removes its listeners, ends the boost and clears the state on unmount', async () => {
    const pool = makePool();
    const ocrModule = boostModule(pool);
    await render(baseProps({ ocrModule, allPages: sixPages(), focusPageIndexes: [0], wholeDocument: true, boost: BOOST, hardwareThreads: 4 }));
    await flush();
    expect(listenersAdded()).toBe(1);
    await act(async () => { root.unmount(); });
    expect(window.removeEventListener.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
    root = createRoot(container);
  });
});
