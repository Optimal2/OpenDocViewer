// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentLoader from '../DocumentLoader/DocumentLoader.js';
import { makeExplicitSource } from '../DocumentLoader/sources/explicitListSource.js';
import ViewerContext from '../../contexts/viewerContext.js';
import { createGatewaySignatureClient } from '../../utils/pdfSignatureGateway.js';

vi.mock('../DocumentLoader/documentLoaderUtils.js', () => ({
  getTotalPages: async () => 1, generateDocumentList: () => [], generateDemoList: () => [],
  fetchAndArrayBuffer: vi.fn(),
}));
vi.mock('../DocumentLoader/LoadPressureDialog.jsx', () => ({ default: () => null }));
vi.mock('../../logging/systemLogger.js', () => ({ default: { info() {}, warn() {}, error() {} } }));
const packUrl = 'https://example.test/gateway/source-pack/session-pack';
const signature = { fieldName: 'Approval', integrity: 'intact', trust: 'not-checked' };
let root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' });
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

function packResponse(indexes) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode('ODVSP1\n')];
  for (const fileIndex of indexes) {
    const payload = encoder.encode('%PDF-1.7\nsynthetic transport fixture');
    const header = encoder.encode(JSON.stringify({ fileIndex, payloadBytes: payload.length,
      ext: 'pdf', contentType: 'application/pdf' }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.length, true);
    parts.push(length, header, payload);
  }
  return { ok: true, body: new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.close();
  } }) };
}

it.each([[0], [1, 0], [undefined]])('G23 carries actual pack frame indexes through DocumentLoader: %j', async (...indexes) => {
  // Vitest expands each array row into arguments. Frame order deliberately differs from bundle order.
  const count = indexes.length;
  const bundle = { integration: { sourcePackUrl: packUrl, sourcePackFormat: 'odvsp1' }, documents: [{
    documentId: 'document', files: Array.from({ length: count }, (_, index) => ({
      id: `file-${index}`, url: `https://example.test/files/${index}.pdf`, ext: 'pdf',
    })),
  }] };
  const descriptors = [];
  const pages = [];
  const api = Object.fromEntries(['ensurePageAsset', 'setError', 'setWorkerCount', 'setLoadingRunActive',
    'setPlannedPageCount', 'patchPageAtIndex', 'addMessage', 'scheduleSourceWarmup', 'recordLoaderPhaseTiming']
    .map((key) => [key, vi.fn()]));
  Object.assign(api, {
    initializeDocumentSession: async () => {}, storeSourceBlob: async () => ({}),
    registerSourceDescriptor: (descriptor) => descriptors.push(descriptor),
    insertPagesAtIndex: (inserted) => pages.push(...inserted),
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(packResponse(indexes)).mockResolvedValue({
    ok: true, status: 200, json: async () => ({ signatures: [{ ...signature, trust: 'unknown',
      validationTime: '2026-10-01T12:00:00Z' }] }),
  }));
  await act(async () => { root.render(createElement(ViewerContext.Provider, { value: api },
    createElement(DocumentLoader, { sourceList: makeExplicitSource(bundle).items }))); });
  await vi.waitFor(() => expect(descriptors).toHaveLength(count));
  expect(api.setError.mock.calls.flat().filter(Boolean)).toEqual([]);
  expect(pages).toHaveLength(count);
  const client = createGatewaySignatureClient();
  // Check in reverse display order using only the descriptors registered by the real loader.
  for (const descriptor of [...descriptors].reverse()) {
    const report = await client.enrich({ signatures: [signature] }, descriptor.sourceUrl, descriptor.sourcePack);
    expect(report.signatures[0].trust).toBe(indexes[0] === undefined ? 'not-checked' : 'unknown');
  }
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([packUrl,
    ...(indexes[0] === undefined ? [] : Array.from({ length: count }, (_, index) =>
      `https://example.test/gateway/signatures/session-pack/${count - index - 1}`)),
  ]);
});
