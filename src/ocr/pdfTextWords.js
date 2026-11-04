// File: src/ocr/pdfTextWords.js
/**
 * Word boxes from a PDF page's own text layer, in the shape the recognised words have, so that a
 * page with real text gets the same text layer, search and read-aloud as a recognised page
 * (components/OcrTextLayer.jsx, utils/ocrSearch.js) without the engine ever running for it.
 *
 * pdf.js hands out the page text as items: a string, its advance width in user space and a
 * transform that places its baseline origin in user space. The same arithmetic pdf.js's own text
 * layer uses places an item in a viewport: the transform is multiplied with the viewport's, the
 * font height is the length of the transform's vertical axis, and the item's top lies one font
 * ascent above the baseline (the font's own ascent when the font reports one, else pdf.js's
 * fallback of 0.8). The boxes here are in the units of the viewport the caller passes; the probe
 * passes the page's base viewport (scale 1, the page's own rotation), so a box is in PDF points
 * of the page as the viewer renders it, and the text layer scales it onto the page image like a
 * recognised word's pixel box.
 *
 * An item is often a whole line, so it is cut into words at its spaces, and the item's width is
 * shared out over its characters by a rough advance weight (narrow glyphs count less, wide ones
 * more). The boxes of a proportional font are therefore approximate, by a few characters' worth
 * of drift at most on a long line, which the layer's per-word letter-spacing and the search
 * marks tolerate. pdf.js also cuts a line into several items where the font or the spacing
 * changes, often right before a punctuation mark ("sida" and "," as two items that touch); an
 * item that starts on the previous item's baseline where that item ended, with no space on
 * either side of the seam, continues the previous word, so the words and the page text read as
 * the page does (two items with no space between them but a gap narrower than that are joined
 * too; pdf.js itself writes a space where a gap reads as one). A right-to-left item
 * (`dir: 'rtl'`) keeps pdf.js's logical order in the text and gets its boxes mirrored, so the
 * first logical word takes the rightmost box; several right-to-left items on one line stay in
 * the order they were drawn, and a left-to-right run inside a right-to-left item is mirrored
 * with it. The words are returned in the order the PDF draws them, which is the reading order
 * of nearly every PDF, column by column where there are columns; utils/ocrTextLayout.js groups
 * them into lines by their boxes, starting a new line wherever the next word lies above or
 * below the current one (a footer drawn before the body becomes its own line). Only upright
 * text gets boxes: an item whose baseline is rotated in the viewport (a stamp along the margin),
 * or set in a vertical font, is left out of the layer but kept in the page text. Part of the
 * lazy OCR chunk.
 */

/** pdf.js's own fallbacks for a font without metrics (TextLayer: ascent 0.8, descent -0.2). */
export const PDF_TEXT_DEFAULT_ASCENT = 0.8;
export const PDF_TEXT_DEFAULT_DESCENT = -0.2;

/** Baselines turned by more than this (radians) from the viewport's x axis get no boxes. */
const UPRIGHT_TOLERANCE = 0.02;
/**
 * An item continues the previous one's word when it starts within this share of the font
 * height after the previous item's end (pdf.js writes a space into the string, or a separate
 * space item, where the gap is wide enough to read as one) and within this share of the font
 * height of its baseline.
 */
const SEAM_GAP_EM = 0.12;
const SEAM_BASELINE_EM = 0.25;

const NARROW_GLYPHS = /[-iljtfIr.,;:'`|!()[\]{}]/u;
const WIDE_GLYPHS = /[mwMW@%]/u;
const UPPER_OR_DIGIT = /[\p{Lu}\p{N}]/u;
const WHITESPACE = /\s/u;

/**
 * Rough advance of a character relative to a typical lowercase letter, used to share an item's
 * width among its characters.
 *
 * @param {string} character
 * @returns {number}
 */
export function pdfTextAdvanceWeight(character) {
  if (WHITESPACE.test(character)) return 0.5;
  if (NARROW_GLYPHS.test(character)) return 0.45;
  if (WIDE_GLYPHS.test(character)) return 1.4;
  if (UPPER_OR_DIGIT.test(character)) return 1.0;
  return 0.8;
}

/**
 * pdf.js `Util.transform`: the product of two affine matrices [a, b, c, d, e, f].
 *
 * @param {Array<number>} m1
 * @param {Array<number>} m2
 * @returns {Array<number>}
 */
export function multiplyTransforms(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const isMatrix = (value) => Array.isArray(value) && value.length === 6 && value.every((entry) => Number.isFinite(entry));

/**
 * Where an upright item lies in the viewport, or null when it gets no box.
 *
 * @param {Object} item
 * @param {(Object|null)} style
 * @param {Array<number>} viewport
 * @param {number} scale
 * @returns {({ left:number, width:number, baseline:number, fontHeight:number, y0:number, y1:number }|null)}
 */
function placeItem(item, style, viewport, scale) {
  if (!isMatrix(item?.transform) || style?.vertical) return null;
  const tx = multiplyTransforms(viewport, item.transform);
  if (Math.abs(Math.atan2(tx[1], tx[0])) > UPRIGHT_TOLERANCE) return null;
  const fontHeight = Math.hypot(tx[2], tx[3]);
  const width = (Number(item.width) || 0) * scale;
  if (!(fontHeight > 0) || !(width > 0)) return null;
  const ascent = Number(style?.ascent) > 0 && Number(style.ascent) <= 1.5 ? Number(style.ascent) : PDF_TEXT_DEFAULT_ASCENT;
  const descent = Number(style?.descent) < 0 && Number(style.descent) >= -1 ? Number(style.descent) : PDF_TEXT_DEFAULT_DESCENT;
  return { left: tx[4], width, baseline: tx[5], fontHeight, y0: tx[5] - ascent * fontHeight, y1: tx[5] - descent * fontHeight };
}

/**
 * @param {Object} params
 * @param {Array<Object>} params.items  pdf.js text items (`str`, `dir`, `transform`, `width`, `fontName`, `hasEOL`).
 * @param {Object=} params.styles  pdf.js text styles by font name (`ascent`, `descent`, `vertical`).
 * @param {Array<number>} params.viewportTransform  The viewport's matrix (`viewport.transform`).
 * @returns {{ words: Array<{ text:string, confidence:number, bbox:{ x0:number, y0:number, x1:number, y1:number } }>, text: string }}
 *   The words with boxes in viewport units, in the order the PDF draws them, and the page text
 *   (a newline where pdf.js marks the end of a line, no space across a seam inside a word).
 */
export function pdfTextLayerWords({ items, styles, viewportTransform }) {
  const viewport = isMatrix(viewportTransform) ? viewportTransform : null;
  // The viewport's scale: the length of its x axis (a rotated viewport keeps the length).
  const scale = viewport ? Math.hypot(viewport[0], viewport[1]) : 0;

  /** @type {Array<{ text:string, x0:number, y0:number, x1:number, y1:number }>} */
  const placed = [];
  let text = '';
  /** The last placed item's end, for the seam test. */
  let previous = null;
  /** The word under construction, which the next item may continue. */
  let pending = null;

  const flush = () => {
    if (pending) placed.push(pending);
    pending = null;
  };
  const separate = () => {
    if (text && !text.endsWith('\n') && !text.endsWith(' ')) text += ' ';
  };

  for (const item of Array.isArray(items) ? items : []) {
    const str = String(item?.str ?? '');
    const place = viewport && str.trim() ? placeItem(item, styles && item.fontName ? styles[item.fontName] : null, viewport, scale) : null;
    if (!place) {
      // No box: the text is kept (an item of pure spaces, rotated or vertical text), and it
      // never continues a word.
      flush();
      previous = null;
      if (str.trim()) {
        separate();
        text += str.trim();
      }
      if (item?.hasEOL && text && !text.endsWith('\n')) text += '\n';
      continue;
    }

    const rtl = String(item.dir || '').toLowerCase() === 'rtl';
    const seam = !!previous && !!pending && !rtl && !previous.rtl
      && Math.abs(place.baseline - previous.baseline) <= SEAM_BASELINE_EM * place.fontHeight
      && place.left - previous.x1 <= SEAM_GAP_EM * place.fontHeight
      && place.left - previous.x1 >= -0.5 * place.fontHeight
      && !WHITESPACE.test(str[0]);
    if (!seam) {
      flush();
      separate();
    }
    text += str;

    const characters = Array.from(str);
    const weights = characters.map(pdfTextAdvanceWeight);
    const unit = place.width / weights.reduce((sum, weight) => sum + weight, 0);
    // A right-to-left item reads from its right edge: the first logical word takes the rightmost box.
    const boxX = (start, end) => (rtl
      ? { x0: place.left + place.width - end, x1: place.left + place.width - start }
      : { x0: place.left + start, x1: place.left + end });
    let advance = 0;
    let wordStart = -1;
    let wordText = '';
    let first = true;
    const endWord = (end) => {
      if (wordStart < 0) return;
      const { x0, x1 } = boxX(wordStart, end);
      if (first && seam && pending) {
        // The seam: the word goes on from the previous item ("sida" + "," reads "sida,").
        pending.text += wordText;
        pending.x1 = x1;
        pending.y0 = Math.min(pending.y0, place.y0);
        pending.y1 = Math.max(pending.y1, place.y1);
      } else {
        flush();
        pending = { text: wordText, x0, y0: place.y0, x1, y1: place.y1 };
      }
      first = false;
      wordStart = -1;
      wordText = '';
    };
    characters.forEach((character, index) => {
      if (WHITESPACE.test(character)) {
        endWord(advance);
        first = false;
      } else {
        if (wordStart < 0) wordStart = advance;
        wordText += character;
      }
      advance += weights[index] * unit;
    });
    endWord(advance);
    // A word the item ends with may go on in the next item; one ending in a space may not.
    if (WHITESPACE.test(characters[characters.length - 1])) flush();

    if (item.hasEOL) {
      flush();
      previous = null;
      if (!text.endsWith('\n')) text += '\n';
    } else {
      previous = { x1: place.left + place.width, baseline: place.baseline, rtl };
    }
  }
  flush();

  const words = placed.map((word) => ({ text: word.text, confidence: 100, bbox: { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 } }));
  const pageText = text.replace(/[ \t]+/g, ' ').split('\n').map((line) => line.trim()).filter((line) => line).join('\n');
  return { words, text: pageText };
}
