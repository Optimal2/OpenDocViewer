// File: src/ocr/referencePage.js
/**
 * The reference page of the OCR boost control (boost.js): a small synthetic image, always the
 * same, that the control has an engine recognise to measure whether the engines still get the
 * cores they need. Two lines of plain text on white, drawn on a canvas once per session.
 *
 * Synthetic on purpose, rather than a page of the open document: no page image is kept alive
 * for the measurement, nothing of the document is involved in it, and the yardstick is the same
 * on every client and for every document, so the numbers the control logs can be compared. The
 * image is small (a few hundred pixels a side), so a probe costs an engine a fraction of a
 * second, and the recognition is CPU-bound like any other, which is what the measurement needs.
 *
 * Returns null where no canvas is available (a test runtime without one): the control is then
 * left out, and the cautious count applies throughout. Part of the lazy OCR chunk.
 */

/** Size of the reference image in CSS pixels; the canvas is drawn at this exact size. */
export const OCR_REFERENCE_PAGE_SIZE = Object.freeze({ width: 720, height: 240 });

/** The text of the reference page: letters, digits and a few Swedish characters, two lines. */
export const OCR_REFERENCE_PAGE_LINES = Object.freeze([
  'OpenDocViewer reference page 0123456789',
  'Måttstock för textigenkänning, rad två.',
]);

/**
 * Draw the reference page and encode it as a PNG blob.
 *
 * @param {Object=} options
 * @param {function(number, number): (Object|null)=} options.createCanvas  `(width, height)` to a
 *   canvas with `getContext('2d')` and `toBlob` or `convertToBlob`; default: a document canvas
 *   where there is a document, else an OffscreenCanvas, else null.
 * @returns {Promise<(Blob|null)>}  Null where no canvas can be made or encoded.
 */
export async function createOcrReferencePage({ createCanvas = defaultCreateCanvas } = {}) {
  const { width, height } = OCR_REFERENCE_PAGE_SIZE;
  let canvas = null;
  try {
    canvas = createCanvas(width, height);
  } catch {
    return null;
  }
  const context = canvas?.getContext?.('2d') ?? null;
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  context.font = '28px sans-serif';
  context.textBaseline = 'top';
  OCR_REFERENCE_PAGE_LINES.forEach((line, index) => {
    context.fillText(line, 40, 60 + index * 60);
  });
  try {
    if (typeof canvas.convertToBlob === 'function') return await canvas.convertToBlob({ type: 'image/png' });
    if (typeof canvas.toBlob === 'function') {
      return await new Promise((resolve) => { canvas.toBlob((blob) => resolve(blob || null), 'image/png'); });
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {(Object|null)}
 */
function defaultCreateCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  return null;
}
