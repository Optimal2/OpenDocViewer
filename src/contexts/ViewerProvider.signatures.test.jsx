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
