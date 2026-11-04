// File: src/ocr/__tests__/pdfTextWords.test.js
/**
 * Word boxes from a PDF page's own text (src/ocr/pdfTextWords.js): items are placed in the
 * viewport the way pdf.js's text layer places them, cut into words at their spaces with the
 * width shared out by advance weight, rotated and vertical text gets no box, and the page text
 * keeps pdf.js's line ends.
 */
import { describe, expect, it } from 'vitest';
import { multiplyTransforms, PDF_TEXT_DEFAULT_ASCENT, PDF_TEXT_DEFAULT_DESCENT, pdfTextAdvanceWeight, pdfTextLayerWords } from '../pdfTextWords.js';
import { ocrReadingOrder } from '../../utils/ocrTextLayout.js';

/** Portrait A4 at scale 1: PDF y up becomes viewport y down. */
const PORTRAIT = [1, 0, 0, -1, 0, 841.89];
/** The same page rotated 90° clockwise at scale 2 (pdf.js: rotation 90 → [0, s, s, 0, 0, 0] shape). */
const ROTATED_90_SCALE_2 = [0, 2, 2, 0, 0, 0];

const item = (str, overrides = {}) => ({
  str, dir: 'ltr', transform: [12, 0, 0, 12, 60, 780], width: 100, height: 12, fontName: 'f1', hasEOL: false, ...overrides,
});
const STYLES = { f1: { ascent: 0.75, descent: -0.25, vertical: false } };

describe('multiplyTransforms', () => {
  it('is the matrix product pdf.js uses (Util.transform)', () => {
    const portrait = multiplyTransforms(PORTRAIT, [12, 0, 0, 12, 60, 780]);
    [12, 0, 0, -12, 60, 61.89].forEach((value, index) => expect(portrait[index]).toBeCloseTo(value));
    expect(multiplyTransforms(ROTATED_90_SCALE_2, [12, 0, 0, 12, 60, 780])).toEqual([0, 24, 24, 0, 1560, 120]);
  });
});

describe('pdfTextLayerWords', () => {
  it('places an item one ascent above its baseline, one descent below, and cuts it into words sharing its width', () => {
    const { words, text } = pdfTextLayerWords({ items: [item('Hej du')], styles: STYLES, viewportTransform: PORTRAIT });
    expect(text).toBe('Hej du');
    expect(words.map((word) => word.text)).toEqual(['Hej', 'du']);
    // Baseline 780 from the bottom is 61.89 from the top; ascent 0.75 and descent -0.25 of 12 pt.
    expect(words[0].bbox.y0).toBeCloseTo(61.89 - 9);
    expect(words[0].bbox.y1).toBeCloseTo(61.89 + 3);
    expect(words[1].bbox.y0).toBeCloseTo(61.89 - 9);
    // Weights: H 1, e 0.8, j 0.45, space 0.5, d 0.8, u 0.8 = 4.35 over 100 units.
    const unit = 100 / 4.35;
    expect(words[0].bbox.x0).toBeCloseTo(60);
    expect(words[0].bbox.x1).toBeCloseTo(60 + 2.25 * unit);
    expect(words[1].bbox.x0).toBeCloseTo(60 + 2.75 * unit);
    expect(words[1].bbox.x1).toBeCloseTo(160);
    expect(words[0].confidence).toBe(100);
  });

  it('uses pdf.js fallback metrics for a font without them and scales with a rotated viewport', () => {
    expect(PDF_TEXT_DEFAULT_ASCENT).toBe(0.8);
    expect(PDF_TEXT_DEFAULT_DESCENT).toBe(-0.2);
    // A page stored with /Rotate 90 draws its text turned in user space so that it reads
    // upright on the turned page; in the rotated viewport the baseline origin lands at
    // (1560, 120), the font is 24 px tall and the item's 100 units of width become 200 px (the
    // viewport's scale).
    const turned = item('Ord', { fontName: 'unknown', transform: [0, 12, -12, 0, 60, 780] });
    const { words } = pdfTextLayerWords({ items: [turned], styles: STYLES, viewportTransform: ROTATED_90_SCALE_2 });
    expect(words).toHaveLength(1);
    expect(words[0].bbox.x0).toBeCloseTo(1560);
    expect(words[0].bbox.x1).toBeCloseTo(1760);
    expect(words[0].bbox.y0).toBeCloseTo(120 - 0.8 * 24);
    expect(words[0].bbox.y1).toBeCloseTo(120 + 0.2 * 24);
  });

  it('leaves out rotated, vertical, empty and unplaceable items but keeps their text', () => {
    const items = [
      item('Upprätt'),
      item('Lodrätt', { transform: [0, 12, -12, 0, 500, 100] }),
      item('Vertikal', { fontName: 'v' }),
      item('   '),
      item('Utan', { transform: null }),
      item('Noll', { width: 0 }),
    ];
    const { words, text } = pdfTextLayerWords({ items, styles: { ...STYLES, v: { vertical: true } }, viewportTransform: PORTRAIT });
    expect(words.map((word) => word.text)).toEqual(['Upprätt']);
    expect(text).toBe('Upprätt Lodrätt Vertikal Utan Noll');
  });

  it('breaks the page text where pdf.js marks the end of a line and tolerates missing input', () => {
    const items = [item('Rad ett', { hasEOL: true }), item('Rad två', { transform: [12, 0, 0, 12, 60, 760], hasEOL: true }), item('x', { str: '' })];
    expect(pdfTextLayerWords({ items, styles: STYLES, viewportTransform: PORTRAIT }).text).toBe('Rad ett\nRad två');
    expect(pdfTextLayerWords({ items, styles: STYLES, viewportTransform: null })).toEqual({ words: [], text: 'Rad ett\nRad två' });
    expect(pdfTextLayerWords({ items: null, styles: null, viewportTransform: PORTRAIT })).toEqual({ words: [], text: '' });
  });

  it('joins an item that starts where the previous one ended on the same baseline into one word', () => {
    // pdf.js cuts "hitta rätt sida," before the comma: two items that touch (no space on
    // either side of the seam) read as one word, in the words and in the page text; an item
    // that starts a real gap further on is a word of its own.
    const items = [
      item('hitta rätt sida', { width: 90 }),
      item(',', { transform: [12, 0, 0, 12, 150, 780], width: 3 }),
      item('och', { transform: [12, 0, 0, 12, 158, 780], width: 20, hasEOL: true }),
      item('(', { transform: [12, 0, 0, 12, 60, 760], width: 4, hasEOL: false }),
      item('Egen storlek)', { transform: [12, 0, 0, 12, 64, 760], width: 80, hasEOL: true }),
    ];
    const { words, text } = pdfTextLayerWords({ items, styles: STYLES, viewportTransform: PORTRAIT });
    expect(words.map((word) => word.text)).toEqual(['hitta', 'rätt', 'sida,', 'och', '(Egen', 'storlek)']);
    expect(text).toBe('hitta rätt sida, och\n(Egen storlek)');
    const comma = words[2];
    expect(comma.bbox.x1).toBeCloseTo(153);
    expect(words[3].bbox.x0).toBeCloseTo(158);
    expect(words[4].bbox.x0).toBeCloseTo(60);
    expect(words[4].bbox.x1).toBeGreaterThan(64);
  });

  it('does not join across a space, a baseline change or a right-to-left item', () => {
    const items = [
      item('slut ', { width: 30 }),
      item('på', { transform: [12, 0, 0, 12, 90, 780], width: 12 }),
      // 2 pt after "på" (more than 0.12 of the 12 pt font height): a gap, not a seam.
      item('x', { transform: [12, 0, 0, 12, 104, 780], width: 6 }),
      // Starts inside "x" but 5 pt above its baseline (a superscript): a word of its own.
      item('2', { transform: [8, 0, 0, 8, 108, 785], width: 4 }),
      // Touching right-to-left items never continue a word, on either side of the seam.
      item('אב', { transform: [12, 0, 0, 12, 112, 785], width: 20, dir: 'rtl' }),
      item('גד', { transform: [12, 0, 0, 12, 132, 785], width: 20, dir: 'rtl' }),
      item('ef', { transform: [12, 0, 0, 12, 152, 785], width: 12 }),
    ];
    const { words, text } = pdfTextLayerWords({ items, styles: STYLES, viewportTransform: PORTRAIT });
    expect(words.map((word) => word.text)).toEqual(['slut', 'på', 'x', '2', 'אב', 'גד', 'ef']);
    expect(text).toBe('slut på x 2 אב גד ef');
  });

  it('mirrors the boxes of a right-to-left item and keeps its logical order', () => {
    // "אב גד": the first logical word is drawn at the right end of the item's width.
    const { words, text } = pdfTextLayerWords({ items: [item('אב גד', { dir: 'rtl' })], styles: STYLES, viewportTransform: PORTRAIT });
    expect(words.map((word) => word.text)).toEqual(['אב', 'גד']);
    expect(text).toBe('אב גד');
    expect(words[0].bbox.x1).toBeCloseTo(160);
    expect(words[0].bbox.x0).toBeGreaterThan(words[1].bbox.x1);
    expect(words[1].bbox.x0).toBeCloseTo(60);
  });

  it('keeps the order the PDF draws the words in, column by column, and leaves the line grouping to the layout', () => {
    // Two columns drawn column-wise share baselines: the words stay column by column, so a
    // phrase down a column is found; a footer drawn first comes first.
    const items = [
      item('Sidfot', { transform: [8, 0, 0, 8, 60, 30], hasEOL: true }),
      item('alfa beta', { transform: [12, 0, 0, 12, 60, 780], hasEOL: true }),
      item('gamma delta', { transform: [12, 0, 0, 12, 60, 760], hasEOL: true }),
      item('ett två', { transform: [12, 0, 0, 12, 320, 780], hasEOL: true }),
      item('tre fyra', { transform: [12, 0, 0, 12, 320, 760], hasEOL: true }),
    ];
    const { words, text } = pdfTextLayerWords({ items, styles: STYLES, viewportTransform: PORTRAIT });
    expect(words.map((word) => word.text)).toEqual(['Sidfot', 'alfa', 'beta', 'gamma', 'delta', 'ett', 'två', 'tre', 'fyra']);
    expect(text).toBe('Sidfot\nalfa beta\ngamma delta\nett två\ntre fyra');
    // The layout's grouping (utils/ocrTextLayout.js) starts a new line at every jump up or
    // down, so the footer is a line of its own and the columns keep their lines.
    expect(ocrReadingOrder(words).map((line) => line.map((word) => word.text))).toEqual([
      ['Sidfot'], ['alfa', 'beta'], ['gamma', 'delta'], ['ett', 'två'], ['tre', 'fyra'],
    ]);
  });

  it('weighs narrow, wide, capital and other glyphs apart', () => {
    expect(pdfTextAdvanceWeight('i')).toBeLessThan(pdfTextAdvanceWeight('a'));
    expect(pdfTextAdvanceWeight('a')).toBeLessThan(pdfTextAdvanceWeight('A'));
    expect(pdfTextAdvanceWeight('A')).toBeLessThan(pdfTextAdvanceWeight('m'));
    expect(pdfTextAdvanceWeight(' ')).toBe(0.5);
    expect(pdfTextAdvanceWeight('Å')).toBe(1);
    expect(pdfTextAdvanceWeight('å')).toBe(0.8);
  });
});
