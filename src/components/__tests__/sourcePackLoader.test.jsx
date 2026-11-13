// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentLoader from '../DocumentLoader/DocumentLoader.js';
import { makeExplicitSource } from '../DocumentLoader/sources/explicitListSource.js';
import ViewerContext from '../../contexts/viewerContext.js';

vi.mock('../DocumentLoader/documentLoaderUtils.js', () => ({
  getTotalPages: async () => 1, generateDocumentList: () => [], generateDemoList: () => [],
  fetchAndArrayBuffer: vi.fn(),
}));
vi.mock('../DocumentLoader/LoadPressureDialog.jsx', () => ({ default: () => null }));
vi.mock('../../logging/systemLogger.js', () => ({ default: { info() {}, warn() {}, error() {} } }));
const packUrl = 'https://example.test/gateway/source-pack/session-pack';
let root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { href: 'https://example.test/gateway/viewer/' });
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

function packResponse(indexes, file = {}) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode('ODVSP1\n')];
  for (const fileIndex of indexes) {
    const payload = file.payload || encoder.encode('%PDF-1.7\nsynthetic transport fixture');
    const header = encoder.encode(JSON.stringify({ fileIndex, payloadBytes: payload.length,
      ext: file.ext || 'pdf', contentType: file.contentType || 'application/pdf' }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.length, true);
    parts.push(length, header, payload);
  }
  return { ok: true, body: new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.close();
  } }) };
}

it.each([[0], [1, 0], [undefined]])('loads ODVSP1 source packs through DocumentLoader: %j', async (...indexes) => {
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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(packResponse(indexes)));
  await act(async () => { root.render(createElement(ViewerContext.Provider, { value: api },
    createElement(DocumentLoader, { sourceList: makeExplicitSource(bundle).items }))); });
  await vi.waitFor(() => expect(descriptors).toHaveLength(count));
  expect(api.setError.mock.calls.flat().filter(Boolean)).toEqual([]);
  expect(pages).toHaveLength(count);
  expect(descriptors.map((descriptor) => descriptor.fileIndex)).toEqual(Array.from({ length: count }, (_, index) => index));
  expect(descriptors.map((descriptor) => descriptor.sourceUrl)).toEqual(
    Array.from({ length: count }, (_, index) => `https://example.test/files/${index}.pdf`),
  );
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([packUrl]);
});

it.each([
  ['jxl', Uint8Array.of(255, 10, 0, 0)],
  ['avif', Uint8Array.of(0, 0, 0, 24, ...new TextEncoder().encode('ftypmif1'), 0, 0, 0, 0,
    ...new TextEncoder().encode('mif1avif'))],
])('lets a trusted source pack %s signature win over a declared JPEG extension', async (ext, payload) => {
  const bundle = { integration: { sourcePackUrl: packUrl, sourcePackFormat: 'odvsp1' }, documents: [{
    documentId: 'document', files: [{ id: 'file-0', url: 'https://example.test/files/0.jpg', ext: 'jpg' }],
  }] };
  const descriptors = [];
  const api = Object.fromEntries(['ensurePageAsset', 'setError', 'setWorkerCount', 'setLoadingRunActive',
    'setPlannedPageCount', 'patchPageAtIndex', 'addMessage', 'scheduleSourceWarmup', 'recordLoaderPhaseTiming']
    .map((key) => [key, vi.fn()]));
  Object.assign(api, {
    initializeDocumentSession: async () => {}, storeSourceBlob: async () => ({}),
    registerSourceDescriptor: (descriptor) => descriptors.push(descriptor),
    insertPagesAtIndex: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(packResponse([0], {
    payload, ext: 'jpg', contentType: 'image/jpeg',
  })));

  await act(async () => { root.render(createElement(ViewerContext.Provider, { value: api },
    createElement(DocumentLoader, { sourceList: makeExplicitSource(bundle).items }))); });

  await vi.waitFor(() => expect(descriptors).toHaveLength(1));
  expect(descriptors[0].fileExtension).toBe(ext);
  expect(api.setError.mock.calls.flat().filter(Boolean)).toEqual([]);
});
