// File: src/ocr/__tests__/referencePage.test.js
/**
 * The reference page: drawn once at its fixed size with the two fixed lines, encoded as PNG by
 * whichever blob method the canvas has, and null where no canvas can be made or drawn (jsdom's
 * canvas has no 2d context), so the boost control is left out there.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_REFERENCE_PAGE_LINES, OCR_REFERENCE_PAGE_SIZE, createOcrReferencePage } from '../referencePage.js';

function fakeCanvas({ blobMethod = 'convertToBlob', context = true } = {}) {
  const calls = { fillText: [], fillRect: [] };
  const canvas = {
    getContext: () => (context ? {
      fillStyle: '', font: '', textBaseline: '',
      fillRect: (...args) => calls.fillRect.push(args),
      fillText: (...args) => calls.fillText.push(args),
    } : null),
  };
  if (blobMethod === 'convertToBlob') canvas.convertToBlob = vi.fn(async ({ type }) => new Blob(['png'], { type }));
  if (blobMethod === 'toBlob') canvas.toBlob = vi.fn((callback, type) => callback(new Blob(['png'], { type })));
  return { canvas, calls };
}

describe('createOcrReferencePage', () => {
  it('draws the two fixed lines on a white canvas of the fixed size and encodes it as PNG', async () => {
    const { canvas, calls } = fakeCanvas();
    const createCanvas = vi.fn(() => canvas);
    const blob = await createOcrReferencePage({ createCanvas });
    expect(createCanvas).toHaveBeenCalledWith(OCR_REFERENCE_PAGE_SIZE.width, OCR_REFERENCE_PAGE_SIZE.height);
    expect(calls.fillRect).toEqual([[0, 0, 720, 240]]);
    expect(calls.fillText.map(([text]) => text)).toEqual([...OCR_REFERENCE_PAGE_LINES]);
    expect(OCR_REFERENCE_PAGE_LINES).toHaveLength(2);
    expect(blob.type).toBe('image/png');
    expect(canvas.convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
  });

  it('falls back to toBlob where the canvas has no convertToBlob', async () => {
    const { canvas } = fakeCanvas({ blobMethod: 'toBlob' });
    const blob = await createOcrReferencePage({ createCanvas: () => canvas });
    expect(blob.type).toBe('image/png');
    expect(canvas.toBlob).toHaveBeenCalledTimes(1);
  });

  it('is null where no canvas can be made, drawn or encoded', async () => {
    expect(await createOcrReferencePage({ createCanvas: () => null })).toBeNull();
    expect(await createOcrReferencePage({ createCanvas: () => { throw new Error('no canvas'); } })).toBeNull();
    expect(await createOcrReferencePage({ createCanvas: () => fakeCanvas({ context: false }).canvas })).toBeNull();
    expect(await createOcrReferencePage({ createCanvas: () => fakeCanvas({ blobMethod: 'none' }).canvas })).toBeNull();
    // jsdom's canvas has no 2d context: the default path yields null here.
    expect(await createOcrReferencePage()).toBeNull();
  });
});
