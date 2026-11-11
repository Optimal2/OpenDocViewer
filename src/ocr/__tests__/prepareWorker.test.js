// File: src/ocr/__tests__/prepareWorker.test.js
/**
 * The preparation worker in a window-less scope: a request is answered by id with the clean copy
 * and the core's log lines; a page without lines comes back as the original; a scope without a
 * decoder answers `unsupported` (the main thread takes over); an image that cannot be decoded
 * answers with the error (the page fails, as it always did); other messages are ignored.
 */
import { afterEach, expect, it, vi } from 'vitest';

// The worker must use the synchronous removal (nothing waits on its thread): the asynchronous
// one is made to fail loudly, and the synchronous one is counted.
vi.mock('../lineRemoval.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    removeRulingLines: vi.fn(actual.removeRulingLines),
    removeRulingLinesAsync: vi.fn(() => { throw new Error('the worker must not use the yielding removal'); }),
  };
});

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const WIDTH = 120;
const HEIGHT = 40;

/** A white page, with a 90 px black ruling line when asked for. */
function pixels(line) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  if (line) {
    for (let x = 10; x < 100; x += 1) {
      const offset = (20 * WIDTH + x) * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
    }
  }
  return data;
}

/** A scope with a decoder and an OffscreenCanvas whose pixels are the page described. */
function stubScope({ line, decodeError = null }) {
  const scope = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('createImageBitmap', async (blob) => {
    if (decodeError) throw decodeError;
    return { width: WIDTH, height: HEIGHT, source: blob, close() {} };
  });
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width, height) { this.width = width; this.height = height; }

    getContext() {
      let imageData = null;
      return {
        drawImage() {},
        getImageData: () => { imageData = { data: pixels(line), width: WIDTH, height: HEIGHT }; return imageData; },
        putImageData() {},
      };
    }

    async convertToBlob({ type }) { return new Blob(['cleaned'], { type }); }
  });
  return scope;
}

it('answers a request by id with the line-free copy and the core\'s log lines', async () => {
  const scope = stubScope({ line: true });
  await import('../prepareWorker.js');
  const blob = new Blob(['scan'], { type: 'image/png' });
  await scope.onmessage({ data: { type: 'prepare', id: 7, blob, removeRulingLines: true, fallbackSize: null, maxPixels: undefined } });
  expect(scope.postMessage).toHaveBeenCalledTimes(1);
  const reply = scope.postMessage.mock.calls[0][0];
  expect(reply).toMatchObject({ type: 'prepared', id: 7, ok: true, width: WIDTH, height: HEIGHT, rulingLinePixels: 90 });
  expect(reply.blob).not.toBe(blob);
  expect(await reply.blob.text()).toBe('cleaned');
  expect(reply.log).toEqual([{ level: 'debug', message: 'OCR ruling lines removed from a page copy', details: { width: WIDTH, height: HEIGHT, rulingLinePixels: 90 } }]);
  const lineRemoval = await import('../lineRemoval.js');
  expect(lineRemoval.removeRulingLines).toHaveBeenCalledTimes(1);
  expect(lineRemoval.removeRulingLinesAsync).not.toHaveBeenCalled();
});

it('answers unsupported, never silence, when the scope\'s canvas constructor itself throws', async () => {
  const scope = stubScope({ line: true });
  vi.stubGlobal('OffscreenCanvas', class { constructor() { throw new Error('no canvas here'); } });
  await import('../prepareWorker.js');
  await scope.onmessage({ data: { type: 'prepare', id: 5, blob: new Blob(['scan']), removeRulingLines: true } });
  expect(scope.postMessage.mock.calls[0][0]).toEqual({ type: 'prepared', id: 5, ok: false, unsupported: true });
});

it('returns the original image for a page without lines, and only measures when the removal is off', async () => {
  const scope = stubScope({ line: false });
  await import('../prepareWorker.js');
  const blob = new Blob(['scan'], { type: 'image/png' });
  await scope.onmessage({ data: { type: 'prepare', id: 1, blob, removeRulingLines: true } });
  await scope.onmessage({ data: { type: 'prepare', id: 2, blob: new Blob(['lined']), removeRulingLines: false } });
  const [plain, off] = scope.postMessage.mock.calls.map(([value]) => value);
  expect(plain).toMatchObject({ id: 1, ok: true, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
  expect(plain.blob).toBe(blob);
  expect(off).toMatchObject({ id: 2, ok: true, rulingLinePixels: 0, log: [] });
});

it('answers unsupported where the scope has no decoder, so the main thread takes over', async () => {
  const scope = stubScope({ line: true });
  vi.stubGlobal('createImageBitmap', undefined);
  await import('../prepareWorker.js');
  await scope.onmessage({ data: { type: 'prepare', id: 3, blob: new Blob(['scan']), removeRulingLines: true } });
  expect(scope.postMessage.mock.calls[0][0]).toEqual({ type: 'prepared', id: 3, ok: false, unsupported: true });
});

it('answers with the error when the image cannot be decoded, and ignores other messages', async () => {
  const scope = stubScope({ line: true, decodeError: new Error('not an image') });
  await import('../prepareWorker.js');
  await scope.onmessage({ data: { type: 'something-else', id: 9 } });
  await scope.onmessage({ data: null });
  expect(scope.postMessage).not.toHaveBeenCalled();
  await scope.onmessage({ data: { type: 'prepare', id: 4, blob: new Blob(['junk']), removeRulingLines: true } });
  expect(scope.postMessage.mock.calls[0][0]).toMatchObject({ type: 'prepared', id: 4, ok: false, error: 'not an image' });
});
