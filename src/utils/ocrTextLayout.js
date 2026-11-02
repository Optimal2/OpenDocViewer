// File: src/utils/ocrTextLayout.js
/**
 * Geometry of the OCR text layer (components/OcrTextLayer.jsx): the recognised words grouped
 * into lines, where each line and word goes inside the page frame, and how the invisible text is
 * fitted to the recognised boxes.
 *
 * The layer is one text flow in reading order, not one positioned box per word. The browser's
 * own find (Ctrl+F) treats every block boundary as a line break, so a phrase can only be found
 * when its words are inline text of the same flow. The flow is a 1 px wide block that wraps at
 * ordinary spaces; the words of a line are joined with no-break spaces, so the only wrap
 * opportunities are the spaces between lines and every recognised line becomes one line box.
 * The flow starts at the first line's top and the lines stack naturally: each line box is as
 * tall as the distance to the next recognised line (the line element's line-height), so no line
 * is moved vertically. Moving a line with relative positioning would make the browser paint its
 * selection from the line's natural place to its moved place; a text-free spacer between the
 * lines would break find across them. Within a line each word is shifted onto its box with
 * relative positioning (which keeps it inline), and its width is fitted with letter-spacing (a
 * transform would need a block). Find treats a no-break space as a space, so "two words" typed
 * with a space match within a line and across a line break alike.
 */

/** Font used for the invisible words; width is fitted per word so the family only affects fallback estimates. */
export const OCR_LAYER_FONT_FAMILY = 'sans-serif';
/** Average advance per character relative to the font size, used when text cannot be measured. */
const FALLBACK_ADVANCE = 0.55;
/** The character that joins the words of a line without offering a wrap opportunity. */
export const OCR_WORD_JOINER = '\u00a0';
/**
 * Tightest letter-spacing, relative to the font size. A box narrower than its text (a
 * recognition error, or a very condensed font) would otherwise push glyph advances below zero.
 */
const MIN_LETTER_SPACING_EM = -0.4;

/** @type {(Intl.Segmenter|null)} */
const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/**
 * The number of typographic characters in `text`: letter-spacing is added after each grapheme
 * cluster, not after each code point (a letter and its combining accent are one).
 *
 * @param {string} text
 * @returns {number}
 */
export function countCharacters(text) {
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(text)].length;
  return Array.from(text).length;
}

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
  return Math.max(1, countCharacters(text) * fontSize * FALLBACK_ADVANCE);
}

/**
 * @typedef {Object} OcrWordPlacement
 * @property {string} text
 * @property {number} left  CSS px inside the unrotated frame.
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} fontSize  Equal to the box height.
 * @property {number} letterSpacing  CSS px added after every character so the text is as wide
 *   as the box (negative for a box narrower than the text, down to MIN_LETTER_SPACING_EM).
 * @property {number} shiftX  Relative offset from the word's natural position in the line flow
 *   to `left`.
 * @property {number} shiftY  Relative offset from the top of the line box the word is laid out
 *   in (the line's `stackedTop`) to `top`.
 * @property {number} gapShiftX  Relative offset of the no-break space before the word (the gap)
 *   from its natural position to the right edge of the previous word's box; 0 for the first
 *   word of a line, which has no gap.
 * @property {number} gapLetterSpacing  CSS px added to the no-break space before the word so
 *   that it is as wide as the gap between the two boxes (no width when the boxes touch).
 */

/**
 * @typedef {Object} OcrLinePlacement
 * @property {number} top  CSS px inside the unrotated frame (the highest word box of the line).
 * @property {number} height  The tallest word box of the line.
 * @property {number} fontSize  Equal to the height; sets the width of the joining no-break spaces.
 * @property {number} lineHeight  Height of the line's line box: the distance to the next line's
 *   top (at least the line's own height), or the line's height for the last line. The lines
 *   stack from the flow's top, so this is what places the next line.
 * @property {number} stackedTop  Where the line box lands by stacking: `top`, unless an earlier
 *   line box had to be taller than the distance to its successor (lines that overlap or are out
 *   of reading order); the words are shifted from here onto their boxes.
 * @property {Array<OcrWordPlacement>} words
 */

/**
 * @typedef {Object} OcrLayout
 * @property {number} top  Where the flow starts: the first line's top (0 without lines).
 * @property {Array<OcrLinePlacement>} lines
 */

/**
 * Place the words of an outcome inside an unrotated frame of `frameWidth` × `frameHeight` CSS px,
 * grouped into lines. Words without text or with an empty box are left out. A word whose box
 * starts below the vertical middle of the previous word's box begins a new line. A line that
 * starts above the previous one (words out of reading order), or closer to it than its height,
 * still gets a line box at least as tall as itself, so the line boxes after it land lower than
 * their lines; the words are shifted from the box they land in onto their own places.
 *
 * @param {Array<Object>} words  `{ text, bbox: { x0, y0, x1, y1 } }` in image pixels.
 * @param {number} imageWidth  Pixel width of the recognised image.
 * @param {number} imageHeight
 * @param {number} frameWidth  Width the image occupies on the stage (before zoom).
 * @param {number} frameHeight
 * @param {function(string, number): number=} measure  Default measureWordWidth.
 * @returns {OcrLayout}
 */
export function layoutOcrLines(words, imageWidth, imageHeight, frameWidth, frameHeight, measure = measureWordWidth) {
  const sx = imageWidth > 0 ? frameWidth / imageWidth : 0;
  const sy = imageHeight > 0 ? frameHeight / imageHeight : 0;
  if (!(sx > 0) || !(sy > 0)) return { top: 0, lines: [] };

  /** @type {Array<Array<{ text: string, left: number, top: number, width: number, height: number }>>} */
  const groups = [];
  let previous = null;
  for (const word of Array.isArray(words) ? words : []) {
    const text = String(word?.text ?? '');
    const box = word?.bbox;
    if (!text || !box) continue;
    const width = (Number(box.x1) - Number(box.x0)) * sx;
    const height = (Number(box.y1) - Number(box.y0)) * sy;
    if (!(width > 0) || !(height > 0)) continue;
    const placed = { text, left: Number(box.x0) * sx, top: Number(box.y0) * sy, width, height };
    if (!previous || placed.top > previous.top + previous.height / 2) groups.push([]);
    groups[groups.length - 1].push(placed);
    previous = placed;
  }

  const lines = groups.map((group) => {
    const top = Math.min(...group.map((word) => word.top));
    const height = Math.max(...group.map((word) => word.height));
    const joinerWidth = measure(OCR_WORD_JOINER, height);
    let naturalLeft = 0;
    const placedWords = group.map((word, index) => {
      const fontSize = word.height;
      const characters = countCharacters(word.text);
      const measured = measure(word.text, fontSize);
      const textWidth = measured > 0 ? measured : word.width;
      const spacing = (word.width - textWidth) / Math.max(1, characters);
      const letterSpacing = Math.max(MIN_LETTER_SPACING_EM * fontSize, spacing);
      let gapShiftX = 0;
      let gapLetterSpacing = 0;
      if (index > 0) {
        // The joining no-break space is shifted into the gap between the two boxes and made as
        // wide as the gap (none when the boxes touch or overlap), so that find and selection
        // paint it where a space reads, not at its natural place in the flow.
        const previousWord = group[index - 1];
        const gapLeft = previousWord.left + previousWord.width;
        const gapWidth = Math.max(0, word.left - gapLeft);
        gapLetterSpacing = gapWidth - joinerWidth;
        gapShiftX = gapLeft - naturalLeft;
        naturalLeft += gapWidth;
      }
      const shiftX = word.left - naturalLeft;
      // The word advances by its measured width plus the spacing after every character.
      naturalLeft += textWidth + letterSpacing * characters;
      return { ...word, fontSize, letterSpacing, shiftX, shiftY: 0, gapShiftX, gapLetterSpacing };
    });
    return { top, height, fontSize: height, lineHeight: height, stackedTop: top, words: placedWords };
  });
  for (let index = 0; index < lines.length - 1; index += 1) {
    lines[index].lineHeight = Math.max(lines[index].height, lines[index + 1].top - lines[index].top);
  }
  // Where each line box lands when the boxes stack from the first line's top; equal to the
  // line's top unless an earlier line box had to be taller than the distance to its successor.
  // Every word is shifted from there onto its own box.
  let stackedTop = lines.length > 0 ? lines[0].top : 0;
  for (const line of lines) {
    line.stackedTop = stackedTop;
    for (const word of line.words) word.shiftY = word.top - stackedTop;
    stackedTop += line.lineHeight;
  }
  return { top: lines.length > 0 ? lines[0].top : 0, lines };
}

/**
 * Whether a selection lies within OCR text layers only (one or several pages), so that its text
 * can be read line by line and a copy of it replaced.
 *
 * @param {(Selection|null|undefined)} selection
 * @returns {boolean}
 */
export function isOcrLayerSelection(selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  let range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    return false;
  }
  const inLayer = (node) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return !!element?.closest?.('.ocr-text-layer');
  };
  return inLayer(range.startContainer) && inLayer(range.endContainer);
}

/**
 * The plain text of a selection inside the layer as it reads on the page: the words of a line
 * separated by spaces (the DOM joins them with no-break spaces) and the lines by newlines (the
 * DOM separates them with the wrapping spaces). A selection that does not reach across a line
 * element is returned as the selection's own text.
 *
 * @param {Selection} selection
 * @returns {string}
 */
export function ocrSelectionText(selection) {
  const own = String(selection?.toString?.() ?? '');
  if (!own || !selection || selection.rangeCount === 0) return own.replace(/\u00a0/g, ' ');
  let fragment;
  try {
    fragment = selection.getRangeAt(0).cloneContents();
  } catch {
    return own.replace(/\u00a0/g, ' ');
  }
  const lines = [...fragment.querySelectorAll('.ocr-text-layer-line')];
  if (lines.length === 0) return own.replace(/\u00a0/g, ' ');
  return lines
    .map((line) => line.textContent.replace(/\u00a0/g, ' ').trim())
    .filter((text) => text.length > 0)
    .join('\n');
}
