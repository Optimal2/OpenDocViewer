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
    createOcrResultCache,
    planOcrWindow,
    createOcrQueue,
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
    expect(latest.ocrPages[makeOcrPageKey('doc', 1)]).toMatchObject({ status: 'done', text: 'sida två', imageWidth: 1240, imageHeight: 1754 });
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(fetchCalls[1]).toBe('/pages/doc-2.png');

    for (const [index, text] of [[1, 'sida tre'], [2, 'sida fyra'], [3, 'sida ett']]) {
      engine.pending[index].resolve(result(text));
      await flush();
    }
    expect(Object.values(latest.ocrPages).map((entry) => entry.text).sort()).toEqual(['sida ett', 'sida fyra', 'sida tre', 'sida två']);
    expect(engine.recognize).toHaveBeenCalledTimes(4);
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
