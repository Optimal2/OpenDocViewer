// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useContext } from 'react';
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

it('G10 provider passes the registered source URL, never the viewer file index', async () => {
  vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' });
  const signature = { fieldName: 'Approval', integrity: 'intact', trust: 'not-checked' };
  getDocumentSignatures.mockResolvedValue({ signatures: [signature] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    signatures: [{ ...signature, trust: 'invalid', trustReason: 'Certificate revoked', validationTime: '2026-10-01T12:00:00Z' }],
  }) }));
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  await act(async () => {
    api.registerSourceDescriptor({ sourceKey: 'signed', fileExtension: 'pdf', fileIndex: 0,
      sourceUrl: 'https://example.test/gateway/source/session-one/17' });
    api.insertPagesAtIndex([{ sourceKey: 'signed', fileExtension: 'pdf', pageIndex: 0,
      fullSizeStatus: 1, fullSizeUrl: 'blob:ready' }], 0);
  });
  expect(fetch).toHaveBeenCalledWith('https://example.test/gateway/signatures/session-one/17', expect.any(Object));
  expect(api.signatureReports.signed.signatures[0].trust).toBe('invalid');
});

it('G21 source-pack identity survives display reordering and is checked once per document', async () => {
  vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' });
  const signature = { fieldName: 'Approval', integrity: 'intact', trust: 'not-checked' };
  getDocumentSignatures.mockResolvedValue({ signatures: [signature] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    signatures: [{ ...signature, trust: 'unknown', trustReason: 'timestamp-responder-not-trusted',
      validationTime: '2026-10-01T12:00:00Z' }],
  }) }));
  let api;
  function Consumer() { api = useContext(ViewerContext); return null; }
  await act(async () => { root.render(createElement(ViewerProvider, null, createElement(Consumer))); });
  await act(async () => { await api.initializeDocumentSession(); });
  const page = (sourceKey) => ({ sourceKey, fileExtension: 'pdf', pageIndex: 0,
    fullSizeStatus: 1, fullSizeUrl: 'blob:ready' });
  await act(async () => {
    ['first', 'second'].forEach((sourceKey, fileIndex) => api.registerSourceDescriptor({
      sourceKey, fileExtension: 'pdf', fileIndex: 99 - fileIndex,
      sourceUrl: `https://example.test/files/${sourceKey}.pdf`,
      sourcePack: { url: 'https://example.test/gateway/source-pack/session-pack', fileIndex },
    }));
    api.insertPagesAtIndex([page('second'), page('first'), page('second')], 0);
  });
  await act(async () => { api.patchPageAtIndex(0, { thumbnailStatus: 1 }); });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://example.test/gateway/signatures/session-pack/1',
    'https://example.test/gateway/signatures/session-pack/0',
  ]);
  expect(storage.read.mock.calls.map(([key]) => key)).toEqual(['second', 'first']);
  for (const key of ['first', 'second']) expect(api.signatureReports[key].signatures[0]).toMatchObject({
    integrity: 'intact', trust: 'unknown', trustReason: 'timestamp-responder-not-trusted',
  });
});
