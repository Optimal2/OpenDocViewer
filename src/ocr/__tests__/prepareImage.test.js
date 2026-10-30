// File: src/ocr/__tests__/prepareImage.test.js
/**
 * prepareOcrImage with injected decoder and canvas: it measures the image, runs the ruling-line
 * removal on a copy and hands the engine a new PNG only when something was painted, returns the
 * original image untouched otherwise, releases the bitmap right after drawing and the canvas on
 * every path, follows the configuration switch, and degrades to the original image (never a
 * failed page) when the browser cannot decode, has no canvas or refuses to give pixels back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_LINE_REMOVAL_MAX_PIXELS, prepareOcrImage } from '../prepareImage.js';

const config = vi.hoisted(() => ({ removeRulingLines: true }));
vi.mock('../../utils/runtimeConfig.js', () => ({ isOcrLineRemovalEnabled: () => config.removeRulingLines }));
vi.mock('../../logging/systemLogger.js', () => ({ default: { warn: vi.fn(), debug: vi.fn() } }));

const WIDTH = 120;
const HEIGHT = 40;

/** A white page, with a 90 px black ruling line when asked for. */
function pixels({ line }) {
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

/** Records the steps of a run: decoder, canvas, context and encoder. */
function harness({ line = true, width = WIDTH, height = HEIGHT, getImageDataError = null, canvas = true, toBlobOnly = false, encodeError = null } = {}) {
  const events = [];
  const bitmap = { width, height, close: vi.fn(() => events.push('bitmap closed')) };
  let imageData = null;
  const fakeCanvas = {
    width,
    height,
    getContext: vi.fn((kind, options) => {
      events.push(`getContext ${kind} willReadFrequently=${options?.willReadFrequently}`);
      return {
        drawImage: vi.fn((source) => events.push(source === bitmap ? 'drawImage bitmap' : 'drawImage ?')),
        getImageData: vi.fn(() => {
          events.push('getImageData');
          if (getImageDataError) throw getImageDataError;
          imageData = { data: pixels({ line }), width, height };
          return imageData;
        }),
        putImageData: vi.fn((data) => events.push(data === imageData ? 'putImageData same' : 'putImageData ?')),
      };
    }),
    convertToBlob: vi.fn(async ({ type }) => {
      events.push(`convertToBlob ${type}`);
      if (encodeError) throw encodeError;
      return new Blob(['cleaned'], { type });
    }),
    toBlob: vi.fn((callback, type) => {
      events.push(`toBlob ${type}`);
      callback(encodeError ? null : new Blob(['cleaned'], { type }));
    }),
  };
  if (toBlobOnly) delete fakeCanvas.convertToBlob;
  return {
    events,
    bitmap,
    canvas: fakeCanvas,
    decode: vi.fn(async () => { events.push('decode'); return bitmap; }),
    createCanvas: vi.fn((w, h) => { events.push(`createCanvas ${w}x${h}`); return canvas ? fakeCanvas : null; }),
    log: { warn: vi.fn(), debug: vi.fn() },
  };
}

const original = new Blob(['scan'], { type: 'image/png' });

beforeEach(() => { config.removeRulingLines = true; });

describe('prepareOcrImage', () => {
  it('hands the engine a line-free PNG copy, closes the bitmap after drawing and empties the canvas', async () => {
    const h = harness({ line: true });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared.blob).not.toBe(original);
    expect(prepared.blob.type).toBe('image/png');
    expect(await prepared.blob.text()).toBe('cleaned');
    expect(prepared).toMatchObject({ width: WIDTH, height: HEIGHT });
    expect(prepared.rulingLinePixels).toBe(90);
    expect(h.events).toEqual([
      'decode',
      `createCanvas ${WIDTH}x${HEIGHT}`,
      'getContext 2d willReadFrequently=true',
      'drawImage bitmap',
      'bitmap closed',
      'getImageData',
      'putImageData same',
      'convertToBlob image/png',
    ]);
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.canvas.width).toBe(0);
    expect(h.canvas.height).toBe(0);
    expect(h.log.warn).not.toHaveBeenCalled();
    expect(h.log.debug).toHaveBeenCalledWith('OCR ruling lines removed from a page copy', { width: WIDTH, height: HEIGHT, rulingLinePixels: 90 });
  });

  it('returns the original image untouched for a page without ruling lines, and still releases the copy', async () => {
    const h = harness({ line: false });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared).toEqual({ blob: original, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
    expect(h.events).not.toContain('putImageData same');
    expect(h.events.some((event) => event.startsWith('convertToBlob'))).toBe(false);
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.canvas.width).toBe(0);
  });

  it('only measures when the configuration turns the removal off, and never creates a canvas', async () => {
    config.removeRulingLines = false;
    const h = harness({ line: true });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared).toEqual({ blob: original, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
    expect(h.createCanvas).not.toHaveBeenCalled();
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    const explicit = await prepareOcrImage(original, { removeRulingLines: true, decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(explicit.rulingLinePixels).toBe(90);
  });

  it('falls back to the caller\'s size and the original image where the browser has no decoder, with a debug line only', async () => {
    const createCanvas = vi.fn();
    const log = { warn: vi.fn(), debug: vi.fn() };
    const prepared = await prepareOcrImage(original, { decode: async () => null, createCanvas, fallbackSize: { width: 220, height: 311 }, log });
    expect(prepared).toEqual({ blob: original, width: 220, height: 311, rulingLinePixels: 0 });
    expect(createCanvas).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledTimes(1);
    const unknown = await prepareOcrImage(original, { decode: async () => null, createCanvas });
    expect(unknown).toEqual({ blob: original, width: 0, height: 0, rulingLinePixels: 0 });
  });

  it('keeps the measured size and the original image without a canvas, with a debug line only', async () => {
    const h = harness({ canvas: false });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared).toEqual({ blob: original, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.log.warn).not.toHaveBeenCalled();
    expect(h.log.debug).toHaveBeenCalledTimes(1);
  });

  it('does not copy a page above the pixel bound, so the peak memory stays bounded', async () => {
    const h = harness({ line: true, width: 5000, height: 4001 }); // 20 000 001 px, one over the default
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared).toEqual({ blob: original, width: 5000, height: 4001, rulingLinePixels: 0 });
    expect(h.createCanvas).not.toHaveBeenCalled();
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.log.debug.mock.calls[0][1]).toEqual({ width: 5000, height: 4001, maxPixels: OCR_LINE_REMOVAL_MAX_PIXELS });
    expect(OCR_LINE_REMOVAL_MAX_PIXELS).toBe(20000000);
    // An explicit bound is honoured; the real removal still runs on the fake 120 × 40 pixels.
    const small = harness({ line: true });
    const bounded = await prepareOcrImage(original, { decode: small.decode, createCanvas: small.createCanvas, maxPixels: WIDTH * HEIGHT - 1, log: small.log });
    expect(bounded.rulingLinePixels).toBe(0);
    expect(small.createCanvas).not.toHaveBeenCalled();
  });

  it('encodes through canvas.toBlob where convertToBlob does not exist', async () => {
    const h = harness({ line: true, toBlobOnly: true });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared.rulingLinePixels).toBe(90);
    expect(await prepared.blob.text()).toBe('cleaned');
    expect(h.events).toContain('toBlob image/png');
    expect(h.canvas.width).toBe(0);
  });

  it.each([
    ['the removal throws', { line: true }, { removeLines: async () => { throw new Error('removal broke'); } }, 'removal broke'],
    ['convertToBlob throws', { line: true, encodeError: new Error('encode broke') }, {}, 'encode broke'],
    ['toBlob gives null', { line: true, toBlobOnly: true, encodeError: new Error('x') }, {}, 'canvas.toBlob returned null'],
  ])('recognises the page as it is, with one warning, when %s', async (_label, harnessOptions, extra, message) => {
    const h = harness(harnessOptions);
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log, ...extra });
    expect(prepared).toEqual({ blob: original, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn.mock.calls[0][1]).toEqual({ error: message });
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.canvas.width).toBe(0);
  });

  it('recognises the page as it is, with one warning, when the canvas refuses to give pixels back', async () => {
    const h = harness({ getImageDataError: new DOMException('tainted', 'SecurityError') });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, log: h.log });
    expect(prepared).toEqual({ blob: original, width: WIDTH, height: HEIGHT, rulingLinePixels: 0 });
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn.mock.calls[0][1]).toEqual({ error: 'tainted' });
    expect(h.bitmap.close).toHaveBeenCalledTimes(1);
    expect(h.canvas.width).toBe(0);
  });

  it('fails the page when the image cannot be decoded, as the hook did before (a guessed size would misplace the layer)', async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    const createCanvas = vi.fn();
    await expect(prepareOcrImage(original, { decode: async () => { throw new Error('bad png'); }, createCanvas, fallbackSize: { width: 10, height: 20 }, log }))
      .rejects.toThrow('bad png');
    expect(createCanvas).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('uses an injected remover and reports what it painted', async () => {
    const h = harness({ line: false });
    const removeLines = vi.fn(async (imageData) => { imageData.data[0] = 0; return 7; });
    const prepared = await prepareOcrImage(original, { decode: h.decode, createCanvas: h.createCanvas, removeLines, log: h.log });
    expect(removeLines).toHaveBeenCalledTimes(1);
    expect(prepared.rulingLinePixels).toBe(7);
    expect(prepared.blob).not.toBe(original);
  });
});
