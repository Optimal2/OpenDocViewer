// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useContext } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot } from 'react-dom/client';
import { ViewerProvider } from './ViewerProvider.jsx';
import ViewerContext from './viewerContext.js';
import SignatureStatusBadge from '../components/SignatureStatusBadge.jsx';
import { disposePdfSignatureWorker, getDocumentSignatures } from '../utils/pdfSignatureInspector.js';

const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../utils/sourceTempStore.js', () => ({ createSourceTempStore: () => ({
  ready: async () => {}, dispose: async () => {}, getStats: () => ({}), getArrayBuffer: storage.read,
}) }));
vi.mock('../utils/pageAssetStore.js', () => ({ createPageAssetStore: () => ({
  ready: async () => {}, dispose: async () => {}, getStats: () => ({}),
}) }));
vi.mock('../utils/pageAssetRenderer.js', () => ({ createPageAssetRenderer: () => ({
  updateConfig() {}, dispose: async () => {},
  // A page that is still loading never resolves here, so it stays pending for the tests below.
  resolvePdfPageResolution: () => new Promise(() => {}),
}) }));
vi.mock('../utils/pdfSignatureInspector.js', () => ({ getDocumentSignatures: vi.fn(), disposePdfSignatureWorker: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options) => options?.defaultValue || key }) }));

let root;
let container;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  storage.read.mockImplementation(async () => new ArrayBuffer(8));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it('F5 provider publishes signed and unsigned reports to badges across page loading and disposes on unmount', async () => {
  let api;
  let resolveSigned;
  getDocumentSignatures.mockImplementationOnce(() => new Promise((resolve) => { resolveSigned = resolve; }))
    .mockResolvedValue({ signatures: [] });
  function Consumer() {
    api = useContext(ViewerContext);
    return createElement('div', null, ['signed', 'unsigned'].map((key) => createElement('div', { key, 'data-source': key },
      createElement(SignatureStatusBadge, { report: api.signatureReports[key], onOpen: () => {} }))));
  }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  const page = (sourceKey) => ({ sourceKey, fileExtension: 'pdf', pageIndex: 0, fullSizeStatus: 1, fullSizeUrl: 'blob:ready' });
  await act(async () => { api.insertPagesAtIndex([page('signed'), page('unsigned')], 0); });
  expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
  expect(container.querySelector('button')).toBeNull();
  await act(async () => { api.patchPageAtIndex(0, { thumbnailStatus: 1 }); });
  await act(async () => { resolveSigned({ signatures: [{ integrity: 'intact' }] }); });
  expect(container.querySelector('[data-source="signed"] .odv-signature-badge')).not.toBeNull();
  expect(container.querySelector('[data-source="unsigned"] .odv-signature-badge')).toBeNull();
  expect(api.signatureReports.signed?.signatures).toHaveLength(1);
  expect(api.signatureReports.unsigned?.signatures).toHaveLength(0);
  expect(storage.read.mock.calls.map(([key]) => key)).toEqual(['signed', 'unsigned']);
  expect(disposePdfSignatureWorker).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); });
  expect(disposePdfSignatureWorker).toHaveBeenCalledTimes(1);
});

it('pdfSignatures.enabled:false never hands bytes to the inspector', async () => {
  vi.stubGlobal('__ODV_CONFIG__', { pdfSignatures: { enabled: false } });
  getDocumentSignatures.mockResolvedValue({ signatures: [{ integrity: 'intact' }] });
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  const page = { sourceKey: 'signed', fileExtension: 'pdf', pageIndex: 0, fullSizeStatus: 1, fullSizeUrl: 'blob:ready' };
  await act(async () => { api.insertPagesAtIndex([page], 0); });
  await act(async () => { api.patchPageAtIndex(0, { thumbnailStatus: 1 }); });
  expect(getDocumentSignatures).not.toHaveBeenCalled();
  expect(storage.read).not.toHaveBeenCalled();
  expect(api.signatureReports).toEqual({});
});

it("pdfSignatures.inspectAfter:'allPages' waits until no page is pending", async () => {
  vi.stubGlobal('__ODV_CONFIG__', { pdfSignatures: { inspectAfter: 'allPages' } });
  getDocumentSignatures.mockResolvedValue({ signatures: [] });
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  const ready = { sourceKey: 'a', fileExtension: 'pdf', pageIndex: 0, fullSizeStatus: 1, fullSizeUrl: 'blob:ready' };
  const pending = { sourceKey: 'a', fileExtension: 'pdf', pageIndex: 1, fullSizeStatus: 0, fullSizeUrl: 'blob:loading' };
  await act(async () => { api.insertPagesAtIndex([ready, pending], 0); });
  expect(getDocumentSignatures).not.toHaveBeenCalled();
  await act(async () => { api.patchPageAtIndex(1, { fullSizeStatus: 1, fullSizeUrl: 'blob:ready' }); });
  expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
});

it("pdfSignatures.inspectAfter:'allPages' starts after an aborted run planned with more pages than discovered", async () => {
  vi.stubGlobal('__ODV_CONFIG__', { pdfSignatures: { inspectAfter: 'allPages' } });
  getDocumentSignatures.mockResolvedValue({ signatures: [] });
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  await act(async () => { api.setLoadingRunActive(true); api.setPlannedPageCount(5); });
  const ready = (pageIndex) => ({ sourceKey: 'a', fileExtension: 'pdf', pageIndex, fullSizeStatus: 1, fullSizeUrl: 'blob:ready' });
  await act(async () => { api.insertPagesAtIndex([ready(0), ready(1)], 0); });
  expect(getDocumentSignatures).not.toHaveBeenCalled();
  // The run aborts after two of five planned pages: never "all pages ready", nothing pending.
  await act(async () => { api.setLoadingRunActive(false); });
  expect(api.pageLoadState).toMatchObject({ discoveredPages: 2, expectedPages: 5, pendingPages: 0, allPagesReady: false });
  expect(getDocumentSignatures).toHaveBeenCalledTimes(1);
});

it('never requests the removed signature endpoint for gateway-shaped, pack-shaped or standalone sources', async () => {
  const forbiddenPath = ['', 'signatures', ''].join('/');
  vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' });
  vi.stubGlobal('fetch', vi.fn());
  getDocumentSignatures.mockResolvedValue({ signatures: [{ fieldName: 'Approval', integrity: 'intact' }] });
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  const page = (sourceKey) => ({ sourceKey, fileExtension: 'pdf', pageIndex: 0,
    fullSizeStatus: 1, fullSizeUrl: 'blob:ready' });
  await act(async () => {
    api.registerSourceDescriptor({ sourceKey: 'gateway', fileExtension: 'pdf', fileIndex: 17,
      sourceUrl: 'https://example.test/gateway/source/session-one/17' });
    api.registerSourceDescriptor({ sourceKey: 'pack', fileExtension: 'pdf', fileIndex: 1,
      sourceUrl: 'https://example.test/gateway/source-pack/session-pack',
      sourcePack: { url: 'https://example.test/gateway/source-pack/session-pack', fileIndex: 1 } });
    api.registerSourceDescriptor({ sourceKey: 'plain', fileExtension: 'pdf', fileIndex: 0,
      sourceUrl: 'https://example.test/files/plain.pdf' });
    api.insertPagesAtIndex([page('gateway'), page('pack'), page('plain'), page('pack')], 0);
  });
  await act(async () => {
    await vi.waitFor(() => expect(Object.keys(api.signatureReports)).toHaveLength(3));
  });
  expect(storage.read.mock.calls.map(([key]) => key)).toEqual(['gateway', 'pack', 'plain']);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes(forbiddenPath))).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('static guard keeps the removed signature endpoint literal out of src', () => {
  const forbiddenPath = ['', 'signatures', ''].join('/');
  const sourceRoot = join(globalThis.process.cwd(), 'src');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else expect(readFileSync(path, 'utf8').includes(forbiddenPath), path).toBe(false);
    }
  };
  visit(sourceRoot);
});
