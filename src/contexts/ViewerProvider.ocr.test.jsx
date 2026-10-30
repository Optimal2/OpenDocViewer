// @vitest-environment jsdom
// File: src/contexts/ViewerProvider.ocr.test.jsx
/**
 * The provider's OCR wiring at the switch: with the shipped configuration (no `ocr` section, or
 * `enabled` anything but the literal true) the OCR module src/ocr/index.js is never evaluated,
 * no Worker is constructed, `ocrPages` stays empty and no OCR element exists while a session is
 * initialised and pages are inserted; with `enabled: true` the module is imported exactly once,
 * the focus page is recognised from its rendered image, the outcome is exposed per page key, and
 * recognition pauses while a print flow holds page URLs. The module is replaced by a counting
 * mock that keeps the real cache, window and queue but a fake engine, so no tesseract.js runs.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useContext, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerProvider } from './ViewerProvider.jsx';
import ViewerContext from './viewerContext.js';
import { isOcrModuleRequested, resetOcrModuleForTests } from '../utils/ocrLoader.js';
import { makeOcrPageKey } from '../utils/ocrPageKey.js';

const ocrModule = vi.hoisted(() => ({ evaluations: 0, engines: [], recognitions: [] }));

vi.mock('../ocr/index.js', async () => {
  ocrModule.evaluations += 1;
  const { createOcrResultCache } = await import('../ocr/resultCache.js');
  const { planOcrWindow } = await import('../ocr/window.js');
  const { createOcrQueue } = await import('../ocr/queue.js');
  return {
    createOcrResultCache,
    planOcrWindow,
    createOcrQueue,
    createConfiguredOcrEngine: () => {
      const engine = {
        recognize: async (image) => {
          ocrModule.recognitions.push(image);
          return { text: 'Hej världen', confidence: 92, words: [{ text: 'Hej', confidence: 92, bbox: { x0: 1, y0: 2, x1: 30, y1: 20 } }] };
        },
        terminate: async () => {},
        getFailure: () => null,
      };
      ocrModule.engines.push(engine);
      return { engine, setup: { languages: ['swe', 'eng'], assetUrls: {}, warnings: [] } };
    },
    createPdfTextProber: () => ({
      probe: async () => ({ usable: false, verdict: 'empty' }),
      retainSources: async () => {},
      releaseAll: async () => {},
    }),
  };
});
vi.mock('../utils/sourceTempStore.js', () => ({ createSourceTempStore: () => ({
  ready: async () => {}, dispose: async () => {}, getStats: () => ({}), getArrayBuffer: async () => new ArrayBuffer(8),
}) }));
vi.mock('../utils/pageAssetStore.js', () => ({ createPageAssetStore: () => ({
  ready: async () => {}, dispose: async () => {}, getStats: () => ({}),
}) }));
vi.mock('../utils/pageAssetRenderer.js', () => ({ createPageAssetRenderer: () => ({
  updateConfig() {}, dispose: async () => {},
  resolvePdfPageResolution: () => new Promise(() => {}),
}) }));
vi.mock('../utils/pdfSignatureInspector.js', () => ({ getDocumentSignatures: vi.fn(async () => ({ signatures: [] })), disposePdfSignatureWorker: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options) => options?.defaultValue || key }) }));

const PAGE_URL = '/pages/scan-0.png';
const PAGE_KEY = makeOcrPageKey('scan', 0);

let root;
let container;
let workerConstructions;
let fetchedUrls;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // A fresh module registry per test, so the mocked src/ocr/index.js is evaluated (and counted)
  // again on the next dynamic import instead of being served from the registry.
  vi.resetModules();
  ocrModule.evaluations = 0;
  ocrModule.engines.length = 0;
  ocrModule.recognitions.length = 0;
  resetOcrModuleForTests();
  workerConstructions = [];
  fetchedUrls = [];
  vi.stubGlobal('Worker', class FakeWorker {
    constructor(url) { workerConstructions.push(String(url)); }
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    fetchedUrls.push(String(url));
    return { ok: true, status: 200, blob: async () => new Blob(['png'], { type: 'image/png' }) };
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

// The dynamic import of the (mocked) OCR module resolves on a macrotask, so settle on one.
const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
});

/**
 * Render the provider with one rendered PNG page. `focus` mirrors the viewer, which hands the
 * displayed page's index to the provider.
 */
async function renderProviderWithOnePage({ focus = null } = {}) {
  let api;
  function Consumer() {
    api = useContext(ViewerContext);
    const { setOcrFocusPageIndexes } = api;
    useEffect(() => {
      if (focus) setOcrFocusPageIndexes(focus);
    }, [setOcrFocusPageIndexes]);
    return createElement('div', { className: 'consumer' });
  }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  await act(async () => {
    api.insertPagesAtIndex([{
      sourceKey: 'scan', fileExtension: 'png', pageIndex: 0, status: 1, fullSizeStatus: 1, fullSizeUrl: PAGE_URL, realWidth: 1240, realHeight: 1754,
    }], 0);
  });
  await act(async () => { api.patchPageAtIndex(0, { thumbnailStatus: 1 }); });
  await flush();
  return () => api;
}

it('never evaluates the OCR module, starts no worker, fetches no page and adds no OCR element with the shipped configuration', async () => {
  const api = await renderProviderWithOnePage({ focus: [0] });
  expect(ocrModule.evaluations).toBe(0);
  expect(workerConstructions.filter((url) => /ocr|tesseract|blob:/i.test(url))).toEqual([]);
  expect(fetchedUrls).toEqual([]);
  expect(api().ocrPages).toEqual({});
  expect(api().ocrEngineFailure).toBeNull();
  expect(container.querySelector('[data-odv-ocr], .ocr-text-layer')).toBeNull();
});

it.each([
  ['enabled false', { ocr: { enabled: false } }],
  ['the string "true"', { ocr: { enabled: 'true', languages: ['swe'] } }],
  ['the number 1', { ocr: { enabled: 1 } }],
])('keeps the module out when a site file sets %s', async (_label, config) => {
  vi.stubGlobal('__ODV_CONFIG__', config);
  const api = await renderProviderWithOnePage({ focus: [0] });
  expect(ocrModule.evaluations).toBe(0);
  expect(workerConstructions.filter((url) => /ocr|tesseract|blob:/i.test(url))).toEqual([]);
  expect(fetchedUrls).toEqual([]);
  expect(api().ocrPages).toEqual({});
});

it('imports the module once and recognises the focus page from its rendered image when enabled is the literal true', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { ocr: { enabled: true } });
  const api = await renderProviderWithOnePage({ focus: [0] });
  await flush();
  expect(ocrModule.evaluations).toBe(1);
  expect(ocrModule.engines).toHaveLength(1);
  expect(fetchedUrls).toEqual([PAGE_URL]);
  expect(ocrModule.recognitions).toHaveLength(1);
  expect(ocrModule.recognitions[0]).toBeInstanceOf(Blob);
  expect(api().ocrPages[PAGE_KEY]).toMatchObject({ status: 'done', text: 'Hej världen', imageWidth: 1240, imageHeight: 1754 });
  expect(api().ocrPages[PAGE_KEY].words).toEqual([{ text: 'Hej', confidence: 92, bbox: { x0: 1, y0: 2, x1: 30, y1: 20 } }]);
  // No element yet: the text layer that shows these outcomes is the next version.
  expect(container.querySelector('[data-odv-ocr], .ocr-text-layer')).toBeNull();
});

it('does nothing until the viewer names a focus page', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { ocr: { enabled: true } });
  const api = await renderProviderWithOnePage();
  await flush();
  // vi.resetModules() does not re-evaluate a mocked module, so the import is observed here
  // through the loader instead of the evaluation counter.
  expect(isOcrModuleRequested()).toBe(true);
  expect(fetchedUrls).toEqual([]);
  expect(api().ocrPages).toEqual({});
  await act(async () => { api().setOcrFocusPageIndexes([0]); });
  await flush();
  expect(fetchedUrls).toEqual([PAGE_URL]);
  expect(api().ocrPages[PAGE_KEY].status).toBe('done');
});

it('pauses recognition while a print flow holds page URLs and resumes when they are released', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { ocr: { enabled: true } });
  const api = await renderProviderWithOnePage();
  await flush();
  let leased;
  await act(async () => { leased = await api().getPrintablePageUrls([0]); });
  expect(leased).toEqual([PAGE_URL]);
  await act(async () => { api().setOcrFocusPageIndexes([0]); });
  await flush();
  expect(fetchedUrls).toEqual([]);
  expect(api().ocrPages[PAGE_KEY]).toEqual({ status: 'queued' });

  await act(async () => { api().releasePrintablePageUrls(leased); });
  await flush();
  expect(fetchedUrls).toEqual([PAGE_URL]);
  expect(api().ocrPages[PAGE_KEY].status).toBe('done');
});

it('forgets the outcomes when the document session is disposed', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { ocr: { enabled: true } });
  const api = await renderProviderWithOnePage({ focus: [0] });
  await flush();
  expect(api().ocrPages[PAGE_KEY].status).toBe('done');
  await act(async () => { await api().disposeDocumentSession({ clearPages: true }); });
  await flush();
  expect(api().ocrPages).toEqual({});
});
