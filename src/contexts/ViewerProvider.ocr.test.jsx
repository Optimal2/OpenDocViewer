// @vitest-environment jsdom
// File: src/contexts/ViewerProvider.ocr.test.jsx
/**
 * The provider's OCR wiring at the switch: with the shipped configuration (no `ocr` section, or
 * `enabled` anything but the literal true) the OCR module src/ocr/index.js is never evaluated,
 * no Worker is constructed and no OCR element exists while a session is initialised and pages
 * are inserted; with `enabled: true` the module is imported exactly once. The module is replaced
 * by a counting mock, so no tesseract.js code runs here.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerProvider } from './ViewerProvider.jsx';
import ViewerContext from './viewerContext.js';
import { resetOcrModuleForTests } from '../utils/ocrLoader.js';

const ocrModule = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock('../ocr/index.js', () => {
  ocrModule.evaluations += 1;
  return { createConfiguredOcrEngine: () => { throw new Error('not used in this test'); } };
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

let root;
let container;
let workerConstructions;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ocrModule.evaluations = 0;
  resetOcrModuleForTests();
  workerConstructions = [];
  vi.stubGlobal('Worker', class FakeWorker {
    constructor(url) { workerConstructions.push(String(url)); }
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

async function renderProviderWithOnePage() {
  let api;
  function Consumer() {
    api = useContext(ViewerContext);
    return createElement('div', { className: 'consumer' });
  }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  await act(async () => {
    api.insertPagesAtIndex([{ sourceKey: 'scan', fileExtension: 'png', pageIndex: 0, fullSizeStatus: 1, fullSizeUrl: 'blob:ready' }], 0);
  });
  await act(async () => { api.patchPageAtIndex(0, { thumbnailStatus: 1 }); });
  return api;
}

it('never evaluates the OCR module, starts no worker and adds no OCR element with the shipped configuration', async () => {
  await renderProviderWithOnePage();
  expect(ocrModule.evaluations).toBe(0);
  expect(workerConstructions.filter((url) => /ocr|tesseract|blob:/i.test(url))).toEqual([]);
  expect(container.querySelector('[data-odv-ocr], .ocr-text-layer')).toBeNull();
});

it.each([
  ['enabled false', { ocr: { enabled: false } }],
  ['the string "true"', { ocr: { enabled: 'true', languages: ['swe'] } }],
  ['the number 1', { ocr: { enabled: 1 } }],
])('keeps the module out when a site file sets %s', async (_label, config) => {
  vi.stubGlobal('__ODV_CONFIG__', config);
  await renderProviderWithOnePage();
  expect(ocrModule.evaluations).toBe(0);
  expect(workerConstructions.filter((url) => /ocr|tesseract|blob:/i.test(url))).toEqual([]);
});

it('imports the OCR module exactly once when enabled is the literal true', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { ocr: { enabled: true } });
  await renderProviderWithOnePage();
  await act(async () => {});
  expect(ocrModule.evaluations).toBe(1);
  // The module is imported, nothing more: recognition and the text layer come later.
  expect(workerConstructions.filter((url) => /ocr|tesseract|blob:/i.test(url))).toEqual([]);
  expect(container.querySelector('[data-odv-ocr], .ocr-text-layer')).toBeNull();
});
