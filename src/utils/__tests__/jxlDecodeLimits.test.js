// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJxl } from '../jxlDecode.js';

const codec = vi.hoisted(() => ({
  width: 12000,
  height: 10000,
  render: vi.fn(),
  free: vi.fn(),
}));

vi.mock('jxl-oxide-wasm/module.wasm?url', () => ({ default: 'mock.wasm' }));
vi.mock('jxl-oxide-wasm', () => ({
  default: vi.fn(async () => {}),
  JxlImage: class {
    constructor() {
      this.loaded = true;
      this.numLoadedKeyframes = 1;
      this.animated = false;
    }
    feedBytes() {}
    tryInit() { return true; }
    get width() { return codec.width; }
    get height() { return codec.height; }
    render() {
      return codec.render.mockImplementation(() => ({
        encodeToPng: () => Uint8Array.of(1, 2, 3),
      }))();
    }
    free() { codec.free(); }
  },
}));

describe('JPEG XL decode bounds', () => {
  beforeEach(() => {
    codec.width = 12000;
    codec.height = 10000;
    codec.render.mockReset();
    codec.free.mockClear();
  });

  it('refuses an oversized image after reading its header without allocating a rendered frame', async () => {
    const outcome = decodeJxl(new Blob([Uint8Array.of(255, 10, 0)]));
    await expect(outcome).rejects.toMatchObject({
      name: 'JxlDimensionLimitError',
      code: 'JXL_DIMENSION_LIMIT_EXCEEDED',
    });
    await expect(outcome).rejects.toThrow(/100 megapixels/i);
    expect(codec.render).not.toHaveBeenCalled();
    expect(codec.free).toHaveBeenCalledOnce();
  });

  it('allows an image exactly at the 100 megapixel cap', async () => {
    codec.width = 10000;
    codec.height = 10000;
    const result = await decodeJxl(new Blob([Uint8Array.of(255, 10, 0)]));
    expect(result).toMatchObject({ width: 10000, height: 10000, mimeType: 'image/png' });
    expect(codec.render).toHaveBeenCalledOnce();
  });
});
