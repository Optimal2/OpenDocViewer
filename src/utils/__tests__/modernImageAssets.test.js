// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { PageAssetStore } from '../pageAssetStore.js';
import { PageAssetRenderer } from '../pageAssetRenderer.js';
import { isRasterImageExtension } from '../documentLoadingConfig.js';

vi.mock('pdfjs-dist/legacy/build/pdf', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../pageAssetWorkerPool.js', () => ({ createPageAssetWorkerPool: () => null }));
vi.mock('../pdfPageWorkerPool.js', () => ({ createPdfPageWorkerPool: () => null }));
vi.mock('jxl-oxide-wasm/module.wasm?url', async () => {
  const { readFileSync } = await import('node:fs');
  return { default: readFileSync(new URL('../../../node_modules/jxl-oxide-wasm/jxl_oxide_wasm_bg.wasm', import.meta.url)) };
});
afterEach(() => vi.unstubAllGlobals());

it('uses the same decoder after a worker capability failure, preserving provenance in storage records', async () => {
  const source = new Blob([readFileSync(new URL('../../../tests/fixtures/modern-images/gradient16.jxl', import.meta.url))]);
  const renderer = new PageAssetRenderer({ tempStore: { getBlob: async () => source }, config: { backend: 'main-only' } });
  renderer.shouldTryWorker = () => true;
  const error = Object.assign(new Error('Worker unavailable'), { fallbackMainThread: true });
  renderer.workerPool = { renderAsset: vi.fn().mockRejectedValue(error) };
  vi.stubGlobal('createImageBitmap', vi.fn(() => { throw new Error('Native decode forbidden'); }));
  const asset = await renderer.renderPageAsset({ sourceKey: 'jxl', fileExtension: 'jxl' }, { variant: 'full' });
  expect(asset.mimeType).toBe('image/png');
  expect(renderer.workerPool.renderAsset).toHaveBeenCalledOnce();
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(isRasterImageExtension('jxl')).toBe(true);
  const store = new PageAssetStore({ mode: 'memory', protection: 'none' });
  await store.putAsset({ ...asset, assetKey: 'test', sourceKey: 'jxl', pageIndex: 0, variant: 'full' });
  const stored = await store.getAsset('test');
  expect(stored.meta.imageMetadata).toEqual(asset.imageMetadata);
  const record = await store.makeIndexedDbRecord(stored.meta, stored.blob);
  expect(store.recordToMeta(record).imageMetadata).toEqual(asset.imageMetadata);
  expect(asset.imageMetadata).toMatchObject({ displayedFrame: 1, frameCount: 1, animated: false });
});
