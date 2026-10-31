/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

describe('pdf.js test warm-up', () => {
  it('setupFiles loads the exact module namespace used by signature tests', async () => {
    const warm = globalThis[Symbol.for('opendocviewer.test.pdfjs-warm')];
    expect(
      warm,
      'vite.config.js must keep tests/setup/pdfjs-warm.js in test.setupFiles'
    ).toBeDefined();

    // Identity, not elapsed time, makes removal of the warm-up deterministically
    // visible without introducing another load-dependent timing threshold.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(pdfjs).toBe(warm.module);
  });
});
