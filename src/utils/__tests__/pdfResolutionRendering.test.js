import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('pdfjs-dist/legacy/build/pdf', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('../pageAssetWorkerPool.js', () => ({ createPageAssetWorkerPool: () => null }));
vi.mock('../pdfPageWorkerPool.js', () => ({ createPdfPageWorkerPool: () => null }));
import { PageAssetRenderer } from '../pageAssetRenderer.js';
import { getPdfResolutionInputs, registerPdfViewerWidth } from '../pdfResolutionRuntime.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf';
import { renderPDFInMainThread } from '../../components/DocumentLoader/mainThreadRenderer.js';

afterEach(() => vi.unstubAllGlobals());
const descriptor = { sourceKey: 'source', fileExtension: 'pdf', pageIndex: 0 };
function makeRenderer() {
  const renderer = new PageAssetRenderer({ tempStore: { getBlob: async () => new Blob(['pdf']) } });
  renderer.shouldTryPdfWorker = () => true;
  renderer.pdfWorkerPool = {
    renderAsset: vi.fn(async () => ({ blob: new Blob(), pdfResolution: { scale: 3 } })),
    getWorkerCount: () => 1,
    renderBatch: vi.fn(async () => ({ itemCount: 1, successCount: 1, errorCount: 0 })),
  };
  return renderer;
}

describe('PDF render input propagation', () => {
  it('uses measured content width, then innerWidth when the viewer is unavailable', () => {
    vi.stubGlobal('window', { innerWidth: 1920, devicePixelRatio: 2 });
    const unregister = registerPdfViewerWidth(() => 1500);
    expect(getPdfResolutionInputs({}).viewerWidthCss).toBe(1500);
    unregister();
    expect(getPdfResolutionInputs({})).toMatchObject({ viewerWidthCss: 1920, devicePixelRatio: 2 });
  });
  it('passes serializable resolution inputs to single and batch workers', async () => {
    vi.stubGlobal('window', { innerWidth: 1920, devicePixelRatio: 2 });
    const renderer = makeRenderer();
    const options = { variant: 'full', viewerWidthCss: 1500 };
    await renderer.renderPageAsset(descriptor, options);
    const payload = renderer.pdfWorkerPool.renderAsset.mock.calls[0][0];
    expect(payload.pdfResolutionInput).toMatchObject({ viewerWidthCss: 1500, devicePixelRatio: 2, config: { pdfResolution: { mode: 'auto' } } });
    expect(structuredClone(payload.pdfResolutionInput)).toEqual(payload.pdfResolutionInput);
    await renderer.renderPdfPageAssetBatch([descriptor], options);
    expect(renderer.pdfWorkerPool.renderBatch.mock.calls[0][0][0].payload.pdfResolutionInput).toEqual(payload.pdfResolutionInput);
  });
  it('uses the same effective scale and integer dimensions on the main thread', async () => {
    const renderer = makeRenderer();
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    renderer.getPdfDocument = async () => ({ getPage: async () => ({
      getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }), render, cleanup: vi.fn(),
    }) });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toBlob: (done) => done(new Blob()) }) });
    const result = await renderer.renderPdfPage(descriptor, { variant: 'full', viewerWidthCss: 1500, devicePixelRatio: 1 });
    expect(result.pdfResolution.scale).toBeCloseTo(3.1512605);
    expect(result.width).toBe(1875);
    expect(result.height).toBe(2654);
    expect(render.mock.calls[0][0].viewport.width).toBe(1875);
    const thumbnail = await renderer.renderPdfPage(descriptor, { variant: 'thumbnail', viewerWidthCss: 20000, devicePixelRatio: 4 });
    expect(thumbnail.pdfResolution).toBeNull();
    expect(thumbnail.width).toBeLessThanOrEqual(220);
    expect(thumbnail.height).toBeLessThanOrEqual(310);
  });
  it('applies auto resolution to the legacy main-thread loader instead of hardcoding 1.5', async () => {
    vi.stubGlobal('window', { innerWidth: 1500, devicePixelRatio: 1 });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toBlob: (done) => done(new Blob()) }) });
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
      render: () => ({ promise: Promise.resolve() }), cleanup: vi.fn(),
    }) }) });
    const insert = vi.fn();
    await renderPDFInMainThread({ arrayBuffer: new ArrayBuffer(8), index: 0, pageStartIndex: 0, pagesInvolved: 1, allPagesStartingIndex: 0 }, insert, true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].pdfResolution.scale).toBeCloseTo(3.1512605);
  });
});
