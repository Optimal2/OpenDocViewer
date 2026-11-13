// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentLoader from '../DocumentLoader/DocumentLoader.js';
import ViewerContext from '../../contexts/viewerContext.js';
import { fetchAndArrayBuffer } from '../DocumentLoader/documentLoaderUtils.js';

vi.mock('../DocumentLoader/documentLoaderUtils.js', () => ({
  getTotalPages: async () => 1, generateDocumentList: () => [], generateDemoList: () => [],
  fetchAndArrayBuffer: vi.fn(),
}));
vi.mock('../DocumentLoader/LoadPressureDialog.jsx', () => ({ default: () => null }));
vi.mock('../../logging/systemLogger.js', () => ({ default: { debug() {}, info() {}, warn() {}, error() {} } }));
let root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

const codestream = Uint8Array.of(255, 10, 0, 0);
const container = Uint8Array.of(0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10);
function avif(brand) {
  return Uint8Array.from([0, 0, 0, 24, ...new TextEncoder().encode(`ftyp${brand}`), 0, 0, 0, 0,
    ...new TextEncoder().encode('mif1avif')]);
}

it.each([
  ['jxl', codestream], ['jxl', container], ['avif', avif('avif')], ['avif', avif('avis')],
])('accepts signed %s input with generic MIME', async (ext, bytes) => {
  const descriptors = [];
  const api = Object.fromEntries(['ensurePageAsset', 'setError', 'setWorkerCount', 'setLoadingRunActive',
    'setPlannedPageCount', 'patchPageAtIndex', 'addMessage', 'scheduleSourceWarmup', 'recordLoaderPhaseTiming',
    'insertPagesAtIndex'].map((key) => [key, vi.fn()]));
  Object.assign(api, {
    initializeDocumentSession: async () => {}, storeSourceBlob: async () => ({}),
    registerSourceDescriptor: (descriptor) => descriptors.push(descriptor),
  });
  vi.mocked(fetchAndArrayBuffer).mockImplementation(async (_url, options) => {
    options.onResponse({ headers: new Headers({ 'Content-Type': 'application/octet-stream' }) });
    return bytes.buffer;
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
    headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
    blob: async () => new Blob([bytes]), arrayBuffer: async () => bytes.buffer,
  }));
  await act(async () => { root.render(createElement(ViewerContext.Provider, { value: api },
    createElement(DocumentLoader, { sourceList: [{ url: `/synthetic.${ext}`, ext }] }))); });
  await vi.waitFor(() => expect(descriptors).toHaveLength(1));
  expect(descriptors[0].fileExtension).toBe(ext);
  expect(api.setError.mock.calls.flat().filter(Boolean)).toEqual([]);
});
