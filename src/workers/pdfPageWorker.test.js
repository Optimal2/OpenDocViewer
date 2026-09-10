import { afterEach, expect, it, vi } from 'vitest';
const render = vi.hoisted(() => vi.fn(() => ({ promise: Promise.resolve() })));
vi.mock('pdfjs-dist/legacy/build/pdf', () => ({
  GlobalWorkerOptions: {},
  VerbosityLevel: { ERRORS: 0 },
  version: 'test',
  getDocument: () => ({ promise: Promise.resolve({ getPage: async () => ({
    getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
    render, cleanup: () => {},
  }) }) }),
}));
afterEach(() => vi.unstubAllGlobals());

it('renders single and batch requests in a window-less worker with the shared policy', async () => {
  const worker = { postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return {}; }
    async convertToBlob() { return new Blob(['raster']); }
  });
  await import('./pdfPageWorker.js');
  const payload = {
    sourceBlob: new Blob(['pdf']), sourceKey: 'source', pageIndex: 0, variant: 'full',
    pdfResolutionInput: { viewerWidthCss: 1500, devicePixelRatio: 1, config: {}, memoryTier: 'unknown' },
  };
  await worker.onmessage({ data: { type: 'renderPdfPageAsset', taskId: 1, payload } });
  const single = worker.postMessage.mock.calls.find(([value]) => value.taskId === 1)[0];
  expect(single).toMatchObject({ ok: true, width: 2480, height: 3509 });
  expect(single.pdfResolution.scale).toBeCloseTo(300 / 72);
  await worker.onmessage({ data: { type: 'renderPdfPageAssetBatch', taskId: 2, payload: { items: [{ itemId: 0, payload }] } } });
  const batch = worker.postMessage.mock.calls.find(([value]) => value.type === 'renderPdfPageAssetBatchItem')[0];
  expect(batch).toMatchObject({ ok: true, width: single.width, height: single.height, pdfResolution: single.pdfResolution });
  expect(render).toHaveBeenCalledTimes(2);
});
