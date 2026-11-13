// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decodeJxl } from '../jxlDecode.js';
import { decode as decodePng } from 'fast-png';

vi.mock('jxl-oxide-wasm/module.wasm?url', async () => {
  const { readFileSync } = await import('node:fs');
  return { default: readFileSync(new URL('../../../node_modules/jxl-oxide-wasm/jxl_oxide_wasm_bg.wasm', import.meta.url)) };
});

describe('JPEG XL decoding', () => {
  it.each(['gradient', 'gradient16', 'reconstruction'])('decodes %s using WASM into PNG', async (name) => {
    const nativeDecode = vi.fn(() => { throw new Error('Native JXL decoding is forbidden'); });
    vi.stubGlobal('createImageBitmap', nativeDecode);
    try {
      const blob = new Blob([readFileSync(new URL(`../../../tests/fixtures/modern-images/${name}.jxl`, import.meta.url))]);
      const result = await decodeJxl(blob);
      expect(result).toMatchObject({ width: 32, height: 24, mimeType: 'image/png', imageMetadata: { sourceFormat: 'image/jxl', displayedFrame: 1 } });
      const png = new Uint8Array(await result.blob.arrayBuffer());
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png[24]).toBe(name === 'gradient16' ? 16 : 8);
      expect(result.imageMetadata.outputSha256).toBe(createHash('sha256').update(png).digest('hex'));
      expect(result.imageMetadata.sourceSha256).toBe(createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex'));
      if (name !== 'reconstruction') {
        const reference = decodePng(readFileSync(new URL(`../../../tests/fixtures/modern-images/${name}.png`, import.meta.url)));
        expect(decodePng(png).data).toEqual(reference.data);
      }
      expect(nativeDecode).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects forged and truncated sources', async () => {
    await expect(decodeJxl(new Blob(['not a jxl']))).rejects.toThrow();
    await expect(decodeJxl(new Blob([Uint8Array.of(255, 10, 0)]))).rejects.toThrow();
  });

  it('shows frame 1 and records that animation was reduced to one page', async () => {
    const result = await decodeJxl(new Blob([readFileSync(new URL('../../../tests/fixtures/modern-images/animated.jxl', import.meta.url))]));
    expect(result.imageMetadata).toMatchObject({ animated: true, frameCount: 2, displayedFrame: 1 });
    const reference = decodePng(readFileSync(new URL('../../../tests/fixtures/modern-images/gradient.png', import.meta.url)));
    expect(decodePng(new Uint8Array(await result.blob.arrayBuffer())).data).toEqual(reference.data);
  });
});
