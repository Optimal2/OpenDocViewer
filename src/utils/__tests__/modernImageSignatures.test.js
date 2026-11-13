import { describe, expect, it } from 'vitest';
import { hasJxlSignature, hasAvifSignature } from '../modernImageSignatures.js';

describe('modern image signatures', () => {
  it('accepts only complete JXL signatures', () => {
    expect(hasJxlSignature(Uint8Array.of(255, 10))).toBe(true);
    const signature = Uint8Array.of(0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10);
    expect(hasJxlSignature(signature)).toBe(true);
    for (let length = 0; length < 12; length += 1) expect(hasJxlSignature(signature.slice(0, length))).toBe(false);
    signature[11] = 0;
    expect(hasJxlSignature(signature)).toBe(false);
  });

  it('finds AVIF major and compatible brands, not minor versions or unrelated boxes', () => {
    const bytes = Uint8Array.of(0, 0, 0, 24, ...new TextEncoder().encode('ftypmif1'), 0, 0, 0, 0,
      ...new TextEncoder().encode('avifmif1'));
    expect(hasAvifSignature(bytes)).toBe(true);
    bytes[3] = 16;
    expect(hasAvifSignature(bytes)).toBe(false);
    bytes.set(new TextEncoder().encode('avis'), 8);
    expect(hasAvifSignature(bytes)).toBe(true);
    bytes.set(new TextEncoder().encode('avif'), 12);
    bytes.set(new TextEncoder().encode('mif1'), 8);
    expect(hasAvifSignature(bytes)).toBe(false);
    bytes.set(new TextEncoder().encode('junk'), 4);
    expect(hasAvifSignature(bytes)).toBe(false);
    expect(hasAvifSignature(bytes.slice(0, 12))).toBe(false);
  });
});
