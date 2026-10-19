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
  await worker.onmessage({ data: { type: 'renderPdfPageAsset', taskId: 3, payload: { ...payload, pdfResolutionInput: undefined, fullPageScale: 8 } } });
  const boosted = worker.postMessage.mock.calls.find(([value]) => value.taskId === 3)[0];
  expect(boosted).toMatchObject({ ok: true, width: 4760, height: 6736 });
  expect(boosted.pdfResolution.scale).toBe(8);
  await worker.onmessage({ data: { type: 'renderPdfPageAsset', taskId: 4, payload: { ...payload, pdfResolutionInput: undefined, fullPageScale: 'junk' } } });
  const invalid = worker.postMessage.mock.calls.find(([value]) => value.taskId === 4)[0];
  expect(invalid.pdfResolution.scale).toBe(2);
  await worker.onmessage({ data: { type: 'renderPdfPageAsset', taskId: 5, payload: { ...payload, pdfResolutionInput: undefined, fullPageScale: 20 } } });
  const bounded = worker.postMessage.mock.calls.find(([value]) => value.taskId === 5)[0];
  expect(bounded.pdfResolution.scale).toBeGreaterThan(6);
  expect(bounded.pdfResolution.scale).toBeLessThanOrEqual(12);
  expect(bounded.pdfResolution.pixels).toBeLessThanOrEqual(40e6);
});
