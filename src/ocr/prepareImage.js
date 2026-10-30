// File: src/ocr/prepareImage.js
/**
 * Turns the viewer's rendered page image into the image the OCR engine receives: measures it
 * and, when `ocr.removeRulingLines` is on (the default), removes the ruling lines of tables and
 * forms on a private copy (lineRemoval.js).
 *
 * The copy is the point: the page the user sees and the print path keep their own image, which
 * is never touched. The copy exists only for the duration of this call and is released
 * stepwise, because an A4 page at 300 dpi is about 35 MB as decoded pixels:
 *
 *   blob (compressed) → ImageBitmap → canvas → ImageData → cleaned PNG blob
 *
 * The bitmap is closed as soon as it has been drawn, the canvas is emptied (size 0 × 0, which
 * frees its backing store) as soon as the cleaned PNG exists or the step turns out unnecessary,
 * and the ImageData is dropped on return. A page without ruling lines returns the original blob
 * untouched, so nothing is re-encoded for it. The whole step is best effort: any failure (no
 * decoder, no canvas, a canvas that cannot give pixels back, an exception) is logged once and
 * the original image goes to the engine, so OCR of the page proceeds either way. Without a
 * decoder (`createImageBitmap`) the size falls back to what the caller knows about the page.
 *
 * Part of the lazy OCR chunk.
 */
import logger from '../logging/systemLogger.js';
import { isOcrLineRemovalEnabled } from '../utils/runtimeConfig.js';
import { removeRulingLinesAsync } from './lineRemoval.js';

/** The cleaned copy is encoded losslessly: a JPEG round trip would add its own artefacts. */
const CLEANED_IMAGE_TYPE = 'image/png';

/** @param {Blob} blob @returns {Promise<(ImageBitmap|null)>} null when the browser cannot decode. */
async function defaultDecode(blob) {
  if (typeof createImageBitmap !== 'function') return null;
  return createImageBitmap(blob);
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {(OffscreenCanvas|HTMLCanvasElement|null)}
 */
function defaultCreateCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** Free the canvas backing store. */
function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // A canvas that refuses to resize still goes out of scope on return.
  }
}

/**
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function encodeCanvas(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: CLEANED_IMAGE_TYPE });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, CLEANED_IMAGE_TYPE);
  });
}

/**
 * @typedef {Object} PreparedOcrImage
 * @property {Blob} blob  The image for the engine: the original, or the line-free copy.
 * @property {number} width  Pixel size of the image (0 when unknown).
 * @property {number} height
 * @property {number} rulingLinePixels  Pixels painted white by the line removal (0 when none ran).
 */

/**
 * @param {Blob} blob  The rendered page image.
 * @param {Object=} options
 * @param {boolean=} options.removeRulingLines  Default from the runtime configuration.
 * @param {{ width: number, height: number }=} options.fallbackSize  Used when the image cannot be decoded.
 * @param {function(Blob): Promise<(ImageBitmap|null)>=} options.decode  Injectable for tests.
 * @param {function(number, number): (Object|null)=} options.createCanvas  Injectable for tests.
 * @param {function(Object): Promise<number>=} options.removeLines  Injectable for tests (default removeRulingLinesAsync).
 * @param {Object=} options.log  Logger with `warn` and `debug`.
 * @returns {Promise<PreparedOcrImage>}
 */
export async function prepareOcrImage(blob, {
  removeRulingLines = isOcrLineRemovalEnabled(),
  fallbackSize = null,
  decode = defaultDecode,
  createCanvas = defaultCreateCanvas,
  removeLines = removeRulingLinesAsync,
  log = logger,
} = {}) {
  const fallback = {
    blob,
    width: Math.max(0, Number(fallbackSize?.width) || 0),
    height: Math.max(0, Number(fallbackSize?.height) || 0),
    rulingLinePixels: 0,
  };
  let bitmap = null;
  let canvas = null;
  let { width, height } = fallback;
  try {
    bitmap = await decode(blob);
    if (!bitmap) return fallback;
    width = Math.max(0, Number(bitmap.width) || 0);
    height = Math.max(0, Number(bitmap.height) || 0);
    const measured = { blob, width, height, rulingLinePixels: 0 };
    if (!removeRulingLines || !width || !height) return measured;

    canvas = createCanvas(width, height);
    const context = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!context || typeof context.getImageData !== 'function') return measured;
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    bitmap = null;

    const imageData = context.getImageData(0, 0, width, height);
    const rulingLinePixels = await removeLines(imageData);
    if (!(rulingLinePixels > 0)) return measured;
    context.putImageData(imageData, 0, 0);
    const cleaned = await encodeCanvas(canvas);
    log.debug?.('OCR ruling lines removed from a page copy', { width, height, rulingLinePixels });
    return { blob: cleaned, width, height, rulingLinePixels };
  } catch (error) {
    log.warn?.('OCR image preparation failed; recognising the page image as it is', { error: String(error?.message || error) });
    return { blob, width, height, rulingLinePixels: 0 };
  } finally {
    bitmap?.close?.();
    releaseCanvas(canvas);
  }
}
