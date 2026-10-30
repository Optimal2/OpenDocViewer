// File: src/ocr/prepareImage.js
/**
 * Turns the viewer's rendered page image into the image the OCR engine receives: measures it
 * and, when `ocr.removeRulingLines` is on (the default), removes the ruling lines of tables and
 * forms on a private copy (lineRemoval.js).
 *
 * The copy is the point: the page the user sees and the print path keep their own image, which
 * is never touched. The copy exists only for the duration of this call and is released
 * stepwise, because the decoded pixels of a page are large (an A4 page at 300 dpi is about
 * 8.7 million pixels: 35 MB as a bitmap, the same again as canvas and as ImageData, plus the
 * one-byte mask of lineRemoval.js, so about 110 MB at the peak):
 *
 *   blob (compressed) → ImageBitmap → canvas → ImageData → cleaned PNG blob
 *
 * The bitmap is closed as soon as it has been drawn, the canvas is emptied (size 0 × 0, which
 * frees its backing store) as soon as the cleaned PNG exists or the step turns out unnecessary,
 * and the ImageData is dropped on return. A page above `maxPixels` (20 million, about A3 at
 * 300 dpi or A4 at 460 dpi) is not copied at all and is recognised as it is, so the peak stays
 * bounded whatever the source's resolution. A page without ruling lines returns the original
 * blob untouched, so nothing is re-encoded for it. The step is best effort: a browser without
 * a decoder or a canvas recognises the page as it is (a debug line, no warning), and a failure
 * midway (a canvas that refuses its pixels, an exception in the removal or the encoding) is
 * logged once as a warning and the original image goes to the engine. Only a page image that
 * cannot be decoded at all fails the page, as it did before this step existed, because a size
 * guessed from the page entry would place the text layer wrongly. Without a decoder
 * (`createImageBitmap`) the size falls back to what the caller knows about the page.
 *
 * Part of the lazy OCR chunk.
 */
import logger from '../logging/systemLogger.js';
import { isOcrLineRemovalEnabled } from '../utils/runtimeConfig.js';
import { removeRulingLinesAsync } from './lineRemoval.js';

/** The cleaned copy is encoded losslessly: a JPEG round trip would add its own artefacts. */
const CLEANED_IMAGE_TYPE = 'image/png';
/** Pages with more pixels than this are recognised as they are (no copy): bounds the peak memory. */
export const OCR_LINE_REMOVAL_MAX_PIXELS = 20000000;

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
 * @param {{ width: number, height: number }=} options.fallbackSize  Used when the browser has no decoder.
 * @param {number=} options.maxPixels  Default OCR_LINE_REMOVAL_MAX_PIXELS.
 * @param {function(Blob): Promise<(ImageBitmap|null)>=} options.decode  Injectable for tests.
 * @param {function(number, number): (Object|null)=} options.createCanvas  Injectable for tests.
 * @param {function(Object): Promise<number>=} options.removeLines  Injectable for tests (default removeRulingLinesAsync).
 * @param {Object=} options.log  Logger with `warn` and `debug`.
 * @returns {Promise<PreparedOcrImage>}  Rejects only when the image cannot be decoded.
 */
export async function prepareOcrImage(blob, {
  removeRulingLines = isOcrLineRemovalEnabled(),
  fallbackSize = null,
  maxPixels = OCR_LINE_REMOVAL_MAX_PIXELS,
  decode = defaultDecode,
  createCanvas = defaultCreateCanvas,
  removeLines = removeRulingLinesAsync,
  log = logger,
} = {}) {
  // A decoding error propagates: the page fails, as it did before this step existed.
  let bitmap = await decode(blob);
  if (!bitmap) {
    log.debug?.('OCR image preparation skipped: no image decoder in this browser');
    return {
      blob,
      width: Math.max(0, Number(fallbackSize?.width) || 0),
      height: Math.max(0, Number(fallbackSize?.height) || 0),
      rulingLinePixels: 0,
    };
  }
  const width = Math.max(0, Number(bitmap.width) || 0);
  const height = Math.max(0, Number(bitmap.height) || 0);
  const measured = { blob, width, height, rulingLinePixels: 0 };
  let canvas = null;
  try {
    if (!removeRulingLines || !width || !height) return measured;
    if (width * height > maxPixels) {
      log.debug?.('OCR ruling-line removal skipped: page larger than the pixel bound', { width, height, maxPixels });
      return measured;
    }
    canvas = createCanvas(width, height);
    const context = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!context || typeof context.getImageData !== 'function') {
      log.debug?.('OCR ruling-line removal skipped: no 2D canvas in this browser');
      return measured;
    }
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
    log.warn?.('OCR ruling-line removal failed; recognising the page image as it is', { error: String(error?.message || error) });
    return measured;
  } finally {
    bitmap?.close?.();
    releaseCanvas(canvas);
  }
}
