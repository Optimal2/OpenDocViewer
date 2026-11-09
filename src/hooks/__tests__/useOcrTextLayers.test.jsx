// @vitest-environment jsdom
// File: src/hooks/__tests__/useOcrTextLayers.test.jsx
/**
 * useOcrTextLayers glues the OCR module to the viewer: nothing without the module; with it, one
 * engine and queue per session fed the window around the focus pages from the pages whose
 * render exists, outcomes exposed per page key, pages dropped with their document, no new work
 * while paused or before the first page is shown, and the worker released after a minute idle.
 * The module is the real cache/window/queue with a fake engine and prober; page images come
 * from a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useOcrTextLayers, { OCR_IDLE_SHUTDOWN_MS } from '../useOcrTextLayers.js';
import { createOcrResultCache } from '../../ocr/resultCache.js';
import { createOcrQueue } from '../../ocr/queue.js';
import { planOcrWindow } from '../../ocr/window.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

vi.mock('../../logging/systemLogger.js', () => ({ default: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function makeEngine() {
  const pending = [];
  return {
    pending,
    recognize: vi.fn(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); })),
    terminate: vi.fn(async () => {}),
    getFailure: () => null,
  };
}

function makeModule(engine, prober) {
  return {
    created: 0,
    prepared: [],
    measured: null,
    createOcrResultCache,
    planOcrWindow,
    createOcrQueue,
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
    createConfiguredOcrEngine() {
      this.created += 1;
      return { engine, setup: { languages: ['swe', 'eng'], assetUrls: {}, warnings: [] } };
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
    expect(latest).toEqual({ ocrPages: {}, ocrEngineFailure: null });
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

  it('disposes the queue on unmount', async () => {
    const engine = makeEngine();
    const prober = makeProber();
    const ocrModule = makeModule(engine, prober);
    await render(baseProps({ ocrModule, allPages: [page('doc', 0)], focusPageIndexes: [0] }));
    await flush();
    await act(async () => { root.unmount(); });
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    expect(prober.releaseAll).toHaveBeenCalled();
    root = createRoot(container);
  });
});
