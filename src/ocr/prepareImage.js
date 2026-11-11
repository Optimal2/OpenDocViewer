// File: src/ocr/prepareImage.js
/**
 * Turns the viewer's rendered page image into the image the OCR engine receives: measures it
 * and, when `ocr.removeRulingLines` is on (the default), removes the ruling lines of tables and
 * forms on a private copy. The work itself is prepareImageCore.js; this entry resolves the
 * configuration on the main thread and hands the image to the preparation worker through
 * imagePreparer.js (one shared worker, main-thread fallback). A caller that injects any of the
 * core's seams (`decode`, `createCanvas`, `removeLines`), or passes `preparer: null`, runs the
 * core on the main thread directly: that is how prepareImage.test.js exercises the steps.
 *
 * Part of the lazy OCR chunk.
 */
import logger from '../logging/systemLogger.js';
import { isOcrLineRemovalEnabled } from '../utils/runtimeConfig.js';
import { getOcrImagePreparer } from './imagePreparer.js';
import { OCR_LINE_REMOVAL_MAX_PIXELS, prepareOcrImageCore } from './prepareImageCore.js';

export { OCR_LINE_REMOVAL_MAX_PIXELS };

/**
 * @param {Blob} blob  The rendered page image.
 * @param {Object=} options
 * @param {boolean=} options.removeRulingLines  Default from the runtime configuration.
 * @param {{ width: number, height: number }=} options.fallbackSize  Used when the browser has no decoder.
 * @param {number=} options.maxPixels  Default OCR_LINE_REMOVAL_MAX_PIXELS.
 * @param {(Object|null)=} options.preparer  An OcrImagePreparer (imagePreparer.js); default the shared
 *   one (getOcrImagePreparer); `null` runs the core on the main thread.
 * @param {function(Blob): Promise<(ImageBitmap|null)>=} options.decode  Test seam (main thread).
 * @param {function(number, number): (Object|null)=} options.createCanvas  Test seam (main thread).
 * @param {function(Object): Promise<number>=} options.removeLines  Test seam (main thread).
 * @param {Object=} options.log  Logger with `warn` and `debug` for the main-thread path.
 * @returns {Promise<Object>}  A PreparedOcrImage (prepareImageCore.js). Rejects only when the image cannot be decoded.
 */
export async function prepareOcrImage(blob, {
  removeRulingLines = isOcrLineRemovalEnabled(),
  fallbackSize = null,
  maxPixels = OCR_LINE_REMOVAL_MAX_PIXELS,
  preparer,
  decode,
  createCanvas,
  removeLines,
  log = logger,
} = {}) {
  const request = { removeRulingLines: removeRulingLines === true, fallbackSize, maxPixels };
  if (preparer === null || decode || createCanvas || removeLines) {
    return prepareOcrImageCore(blob, { ...request, decode, createCanvas, removeLines, log });
  }
  return (preparer || getOcrImagePreparer()).prepare(blob, request);
}
