// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('returns the original AVIF blob for a full-page asset without an 8-bit PNG roundtrip', async () => {
  const worker = { postMessage: vi.fn() };
  const bitmap = { width: 320, height: 200, close: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('OffscreenCanvas', class {
    constructor() { throw new Error('Full AVIF display must not allocate a canvas'); }
  });
  await import('./imageWorker.js');

  const sourceBlob = new Blob(['avif payload'], { type: 'image/avif' });
  await worker.onmessage({ data: {
    type: 'renderPageAsset',
    taskId: 7,
    payload: { sourceBlob, fileExtension: 'avif', variant: 'full' },
  } });

  const result = worker.postMessage.mock.calls[0][0];
  expect(result).toMatchObject({
    type: 'renderPageAssetResult', taskId: 7, ok: true,
    width: 320, height: 200, mimeType: 'image/avif',
    imageMetadata: { sourceFormat: 'image/avif' },
  });
  expect(result.blob).toBe(sourceBlob);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
