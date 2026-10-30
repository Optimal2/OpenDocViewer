// File: src/utils/ocrTextLayout.js
/**
 * Geometry of the OCR text layer (components/OcrTextLayer.jsx): where each recognised word goes
 * inside the page frame and how wide its invisible text must be scaled to cover its box.
 */

/** Font used for the invisible words; width is fitted per word so the family only affects fallback estimates. */
export const OCR_LAYER_FONT_FAMILY = 'sans-serif';
/** Average advance per character relative to the font size, used when text cannot be measured. */
const FALLBACK_ADVANCE = 0.55;

/** @type {(CanvasRenderingContext2D|null|undefined)} */
let measureContext;

/**
 * Width of `text` at `fontSize` px, measured with a canvas context when one exists (jsdom and
 * print have none, then an estimate keeps the layout consistent).
 *
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
export function measureWordWidth(text, fontSize) {
  if (measureContext === undefined) {
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      measureContext = canvas?.getContext?.('2d') || null;
    } catch {
      measureContext = null;
    }
  }
  if (measureContext) {
    try {
      measureContext.font = `${fontSize}px ${OCR_LAYER_FONT_FAMILY}`;
      const width = measureContext.measureText(text).width;
      if (Number.isFinite(width) && width > 0) return width;
    } catch {
      // Fall through to the estimate.
    }
  }
  return Math.max(1, text.length * fontSize * FALLBACK_ADVANCE);
}

/**
 * @typedef {Object} OcrWordPlacement
 * @property {string} text
 * @property {number} left  CSS px inside the unrotated frame.
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} fontSize  Equal to the box height.
 * @property {number} textWidth  Measured (unscaled) width of the text; the span's layout width.
 * @property {number} scaleX  Horizontal scale that makes the measured text as wide as the box.
 * @property {string} separator  What follows the word in the DOM text: a space, a newline when
 *   the next word starts a new line, or nothing after the last word. It keeps selection, copy
 *   and find seeing "two words" and "two lines" instead of one run of letters.
 */

/**
 * Place the words of an outcome inside an unrotated frame of `frameWidth` × `frameHeight` CSS px.
 * Words without text or with an empty box are left out. A word whose box starts below the
 * vertical middle of the previous word's box begins a new line.
 *
 * @param {Array<Object>} words  `{ text, bbox: { x0, y0, x1, y1 } }` in image pixels.
 * @param {number} imageWidth  Pixel width of the recognised image.
 * @param {number} imageHeight
 * @param {number} frameWidth  Width the image occupies on the stage (before zoom).
 * @param {number} frameHeight
 * @param {function(string, number): number=} measure  Default measureWordWidth.
 * @returns {Array<OcrWordPlacement>}
 */
export function layoutOcrWords(words, imageWidth, imageHeight, frameWidth, frameHeight, measure = measureWordWidth) {
  const sx = imageWidth > 0 ? frameWidth / imageWidth : 0;
  const sy = imageHeight > 0 ? frameHeight / imageHeight : 0;
  if (!(sx > 0) || !(sy > 0)) return [];
  const placed = [];
  for (const word of Array.isArray(words) ? words : []) {
    const text = String(word?.text ?? '');
    const box = word?.bbox;
    if (!text || !box) continue;
    const width = (Number(box.x1) - Number(box.x0)) * sx;
    const height = (Number(box.y1) - Number(box.y0)) * sy;
    if (!(width > 0) || !(height > 0)) continue;
    const fontSize = height;
    const measured = measure(text, fontSize);
    const top = Number(box.y0) * sy;
    const previous = placed[placed.length - 1];
    if (previous) previous.separator = top > previous.top + previous.height / 2 ? '\n' : ' ';
    placed.push({
      text,
      left: Number(box.x0) * sx,
      top,
      width,
      height,
      fontSize,
      // The span is laid out at the text's own width and then scaled horizontally, so the
      // scaled box is exactly the word box (width × scaleX = box width).
      textWidth: measured > 0 ? measured : width,
      scaleX: measured > 0 ? width / measured : 1,
      separator: '',
    });
  }
  return placed;
}
