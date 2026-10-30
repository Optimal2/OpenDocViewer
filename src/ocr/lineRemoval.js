// File: src/ocr/lineRemoval.js
/**
 * Ruling-line removal before recognition: the pre-processing step for ruled tables and forms.
 *
 * Tesseract reads the text of a ruled table badly however it is segmented: the cell borders are
 * taken for glyphs or for column separators and the table body comes out garbled or missing.
 * Painting the ruling lines white first restores the text. The method is deliberately simple
 * and runs on raw pixels, so it needs no canvas and no library and is fully testable in Node:
 *
 * 1. A pixel is "dark" when its luma is below 128 (a solid black or dark grey line; a light
 *    grey line is not dark, see below).
 * 2. A horizontal or vertical run of dark pixels is a ruling line when it is at least
 *    `minRunPx` long (0.2 inch at the page's resolution, far longer than a body-text glyph
 *    stroke and shorter than any table line; `rulingLineMinRunPx` derives it from the page's
 *    longer side, taking that side as an A4/Letter page height) AND thin for its length: its
 *    length is at least `minAspect` times its thinnest sampled thickness. The second condition
 *    keeps the stems and bars of large headline glyphs, which can be longer than 0.2 inch but
 *    are many pixels thick, while a table line of any weight is thin against its length.
 * 3. Every line pixel is painted white together with its neighbours within `dilatePx` pixels,
 *    so the anti-aliased edges of the line go too. Glyph strokes that cross a line (the stem of
 *    a "p" through an underline) lose at most that small band, which Tesseract tolerates.
 *
 * Known limits, stated rather than tuned around until a real document has been tried: a light
 * grey line (luma 128 or above) and a dotted or dashed line (runs shorter than `minRunPx`) are
 * not removed and the page is recognised as it is; a page without lines passes through with
 * zero pixels painted, so the step costs it nothing but the scan.
 *
 * Only the pixels are modified: the caller owns the copy (prepareImage.js makes one from the
 * page image and releases it after recognition; the displayed page and the print path never see
 * this). The work is a generator that yields after every `bandRows` rows of each pass, so the
 * caller can hand control back to the event loop between bands (an A4 page at 300 dpi is about
 * 8.7 million pixels; the whole pass takes a few hundred milliseconds that would otherwise
 * block the UI in one piece). Part of the lazy OCR chunk.
 */

/** Dark pixels below this luma (0..255) count as ink. */
export const RULING_LINE_DARK_LUMA = 128;
/** Minimum run length as a share of the page's longer side: 0.2 inch on an 11.7 inch (A4) side. */
export const RULING_LINE_MIN_RUN_SHARE = 0.2 / 11.7;
/** Floor for the minimum run length, so a tiny image never takes glyph strokes for lines. */
export const RULING_LINE_MIN_RUN_FLOOR_PX = 16;
/** A run is a line only when its length is at least this many times its thinnest thickness. */
export const RULING_LINE_MIN_ASPECT = 10;
/** Pixels painted white around every line pixel. */
export const RULING_LINE_DILATE_PX = 2;
/** Rows between two yields of the generator. */
export const RULING_LINE_BAND_ROWS = 256;
/** Positions along a run at which its thickness is sampled. */
const THICKNESS_SAMPLES = 5;

/**
 * The minimum run length (px) for a page of the given size.
 *
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
export function rulingLineMinRunPx(width, height) {
  const longer = Math.max(0, Number(width) || 0, Number(height) || 0);
  return Math.max(RULING_LINE_MIN_RUN_FLOOR_PX, Math.round(longer * RULING_LINE_MIN_RUN_SHARE));
}

/**
 * @typedef {Object} RulingLineRemovalOptions
 * @property {number=} minRunPx  Override of rulingLineMinRunPx(width, height).
 * @property {number=} minAspect  Default RULING_LINE_MIN_ASPECT.
 * @property {number=} dilatePx  Default RULING_LINE_DILATE_PX.
 * @property {number=} bandRows  Default RULING_LINE_BAND_ROWS.
 */

/**
 * Thinnest thickness of a horizontal run (dark rows through it) sampled along its length.
 *
 * @param {Uint8Array} mask  Bit 1 set on dark pixels.
 * @param {number} w
 * @param {number} h
 * @param {number} y  Row of the run.
 * @param {number} x0  First column (inclusive).
 * @param {number} length
 * @param {number} limit  Stop counting at this thickness (anything thicker is not a line anyway).
 * @returns {number}
 */
function thinnestHorizontal(mask, w, h, y, x0, length, limit) {
  let thinnest = Infinity;
  for (let sample = 0; sample < THICKNESS_SAMPLES; sample += 1) {
    const x = x0 + Math.floor(((sample + 0.5) * length) / THICKNESS_SAMPLES);
    let thickness = 1;
    for (let k = y - 1; k >= 0 && thickness < limit && (mask[k * w + x] & 1); k -= 1) thickness += 1;
    for (let k = y + 1; k < h && thickness < limit && (mask[k * w + x] & 1); k += 1) thickness += 1;
    if (thickness < thinnest) thinnest = thickness;
  }
  return thinnest;
}

/**
 * Thinnest thickness of a vertical run (dark columns through it) sampled along its length.
 *
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} x  Column of the run.
 * @param {number} y0  First row (inclusive).
 * @param {number} length
 * @param {number} limit
 * @returns {number}
 */
function thinnestVertical(mask, w, x, y0, length, limit) {
  let thinnest = Infinity;
  for (let sample = 0; sample < THICKNESS_SAMPLES; sample += 1) {
    const y = y0 + Math.floor(((sample + 0.5) * length) / THICKNESS_SAMPLES);
    const rowStart = y * w;
    let thickness = 1;
    for (let k = x - 1; k >= 0 && thickness < limit && (mask[rowStart + k] & 1); k -= 1) thickness += 1;
    for (let k = x + 1; k < w && thickness < limit && (mask[rowStart + k] & 1); k += 1) thickness += 1;
    if (thickness < thinnest) thinnest = thickness;
  }
  return thinnest;
}

/**
 * Remove the ruling lines of an RGBA image in place, as a generator: each `next()` processes one
 * band of rows and the final value is the number of pixels painted white (0 when the page has no
 * lines, in which case the pixels are untouched).
 *
 * @param {Uint8ClampedArray} pixels  RGBA, row-major, `width * height * 4` bytes; modified in place.
 * @param {number} width
 * @param {number} height
 * @param {RulingLineRemovalOptions=} options
 * @returns {Generator<void, number, void>}
 */
export function* rulingLineRemovalSteps(pixels, width, height, options = {}) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  if (!w || !h || !pixels || pixels.length < w * h * 4) return 0;
  const minRun = Math.max(2, Math.floor(Number(options.minRunPx) || rulingLineMinRunPx(w, h)));
  const minAspect = Math.max(1, Number(options.minAspect) || RULING_LINE_MIN_ASPECT);
  const dilate = Math.max(0, Math.floor(Number(options.dilatePx ?? RULING_LINE_DILATE_PX)));
  const bandRows = Math.max(1, Math.floor(Number(options.bandRows) || RULING_LINE_BAND_ROWS));
  const bandEnds = (y) => (y + 1) % bandRows === 0 && y + 1 < h;
  // A run of this length counts as a line only up to this thickness.
  const thicknessLimit = (length) => Math.floor(length / minAspect);

  // Bit 1: dark pixel. Bit 2: part of a ruling line. One byte per pixel.
  const mask = new Uint8Array(w * h);

  // Pass 1: darkness.
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * w;
    for (let x = 0; x < w; x += 1) {
      const offset = (rowStart + x) * 4;
      const luma = (pixels[offset] * 77 + pixels[offset + 1] * 151 + pixels[offset + 2] * 28) >> 8;
      if (luma < RULING_LINE_DARK_LUMA) mask[rowStart + x] = 1;
    }
    if (bandEnds(y)) yield;
  }

  // Pass 2: horizontal runs per row and vertical runs per column (row-major, so the column
  // state is a counter per column), each judged by length and thinnest thickness.
  const columnRun = new Int32Array(w);
  const markVertical = (x, yEnd, length) => {
    if (length < minRun) return;
    const limit = thicknessLimit(length);
    if (limit < 1 || thinnestVertical(mask, w, x, yEnd - length, length, limit + 1) > limit) return;
    for (let k = yEnd - length; k < yEnd; k += 1) mask[k * w + x] |= 2;
  };
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * w;
    let run = 0;
    for (let x = 0; x <= w; x += 1) {
      const dark = x < w ? mask[rowStart + x] & 1 : 0;
      if (dark) {
        run += 1;
        columnRun[x] += 1;
        continue;
      }
      if (run >= minRun) {
        const limit = thicknessLimit(run);
        if (limit >= 1 && thinnestHorizontal(mask, w, h, y, x - run, run, limit + 1) <= limit) {
          for (let k = x - run; k < x; k += 1) mask[rowStart + k] |= 2;
        }
      }
      run = 0;
      if (x < w) {
        markVertical(x, y, columnRun[x]);
        columnRun[x] = 0;
      }
    }
    if (bandEnds(y)) yield;
  }
  // Vertical runs that reach the bottom edge.
  for (let x = 0; x < w; x += 1) markVertical(x, h, columnRun[x]);

  // Pass 3: paint the line pixels and their surroundings white.
  let painted = 0;
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * w;
    for (let x = 0; x < w; x += 1) {
      if (!(mask[rowStart + x] & 2)) continue;
      const y0 = Math.max(0, y - dilate);
      const y1 = Math.min(h - 1, y + dilate);
      const x0 = Math.max(0, x - dilate);
      const x1 = Math.min(w - 1, x + dilate);
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          const offset = (yy * w + xx) * 4;
          if (pixels[offset] !== 255 || pixels[offset + 1] !== 255 || pixels[offset + 2] !== 255) {
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            painted += 1;
          }
        }
      }
    }
    if (bandEnds(y)) yield;
  }
  return painted;
}

/**
 * Remove the ruling lines of an ImageData-like object in place, synchronously.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @param {RulingLineRemovalOptions=} options
 * @returns {number}  Pixels painted white.
 */
export function removeRulingLines(imageData, options = {}) {
  const steps = rulingLineRemovalSteps(imageData?.data, imageData?.width, imageData?.height, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Hand control back to the event loop once (a macrotask, so rendering and input get a turn). */
const yieldToEventLoop = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Remove the ruling lines of an ImageData-like object in place, yielding to the event loop
 * between bands of rows.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @param {RulingLineRemovalOptions=} options
 * @param {function(): Promise<void>=} yieldFn  Default: a zero-delay timeout.
 * @returns {Promise<number>}  Pixels painted white.
 */
export async function removeRulingLinesAsync(imageData, options = {}, yieldFn = yieldToEventLoop) {
  const steps = rulingLineRemovalSteps(imageData?.data, imageData?.width, imageData?.height, options);
  let step = steps.next();
  while (!step.done) {
    await yieldFn();
    step = steps.next();
  }
  return step.value;
}
