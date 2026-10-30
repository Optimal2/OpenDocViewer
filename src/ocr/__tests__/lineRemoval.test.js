// File: src/ocr/__tests__/lineRemoval.test.js
/**
 * The ruling-line removal on synthetic RGBA pages: long dark horizontal and vertical runs are
 * painted white with their two-pixel surroundings, glyph-length runs stay, a page without lines
 * is left byte for byte as it was, the stated limits (light grey, dotted) hold, the minimum run
 * length follows the page size, the generator yields per band and the async form gives the same
 * pixels as the sync form.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  RULING_LINE_BAND_ROWS,
  RULING_LINE_DILATE_PX,
  RULING_LINE_MIN_ASPECT,
  RULING_LINE_MIN_RUN_FLOOR_PX,
  createEventLoopYield,
  removeRulingLines,
  removeRulingLinesAsync,
  rulingLineMinRunPx,
  rulingLineRemovalSteps,
} from '../lineRemoval.js';

/** A white RGBA page. */
function whitePage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}

function paint(page, x, y, [r, g, b]) {
  const offset = (y * page.width + x) * 4;
  page.data[offset] = r;
  page.data[offset + 1] = g;
  page.data[offset + 2] = b;
}

function pixel(page, x, y) {
  const offset = (y * page.width + x) * 4;
  return [page.data[offset], page.data[offset + 1], page.data[offset + 2]];
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const LIGHT_GREY = [200, 200, 200];

function horizontalLine(page, y, x0, x1, colour = BLACK) {
  for (let x = x0; x <= x1; x += 1) paint(page, x, y, colour);
}

function verticalLine(page, x, y0, y1, colour = BLACK) {
  for (let y = y0; y <= y1; y += 1) paint(page, x, y, colour);
}

function countNonWhite(page) {
  let count = 0;
  for (let index = 0; index < page.data.length; index += 4) {
    if (page.data[index] !== 255 || page.data[index + 1] !== 255 || page.data[index + 2] !== 255) count += 1;
  }
  return count;
}

describe('rulingLineMinRunPx', () => {
  it('is 0.2 inch at the resolution implied by an A4 page height', () => {
    expect(rulingLineMinRunPx(2480, 3508)).toBe(60); // 300 dpi
    expect(rulingLineMinRunPx(1654, 2339)).toBe(40); // 200 dpi
    expect(rulingLineMinRunPx(3508, 2480)).toBe(60); // landscape: the longer side decides
  });

  it('never goes below the floor', () => {
    expect(rulingLineMinRunPx(100, 100)).toBe(RULING_LINE_MIN_RUN_FLOOR_PX);
    expect(rulingLineMinRunPx(0, 0)).toBe(RULING_LINE_MIN_RUN_FLOOR_PX);
    expect(rulingLineMinRunPx(NaN, undefined)).toBe(RULING_LINE_MIN_RUN_FLOOR_PX);
  });
});

describe('removeRulingLines', () => {
  it('paints a long horizontal line white together with two pixels around it', () => {
    const page = whitePage(120, 40);
    horizontalLine(page, 20, 10, 99); // 90 px, above the 16 px floor
    paint(page, 50, 18, BLACK); // ink two rows above the line: inside the dilation band
    paint(page, 50, 17, BLACK); // three rows above: outside it
    const painted = removeRulingLines(page);
    expect(pixel(page, 50, 20)).toEqual(WHITE);
    expect(pixel(page, 10, 20)).toEqual(WHITE);
    expect(pixel(page, 99, 20)).toEqual(WHITE);
    expect(pixel(page, 50, 18)).toEqual(WHITE);
    expect(pixel(page, 50, 17)).toEqual(BLACK);
    // The line itself plus the one ink pixel inside the band; white neighbours do not count.
    expect(painted).toBe(90 + 1);
    expect(countNonWhite(page)).toBe(1);
  });

  it('paints a long vertical line, including one that reaches the bottom edge', () => {
    const page = whitePage(40, 120);
    verticalLine(page, 20, 5, 60);
    verticalLine(page, 30, 80, 119); // touches the last row: flushed after the sweep
    const painted = removeRulingLines(page);
    expect(painted).toBe(56 + 40);
    expect(countNonWhite(page)).toBe(0);
  });

  it('removes a full table grid and keeps the text inside the cells', () => {
    const page = whitePage(200, 120);
    for (const y of [10, 50, 90]) horizontalLine(page, y, 10, 189);
    for (const x of [10, 100, 189]) verticalLine(page, x, 10, 90);
    // "Glyphs": short dark runs well inside a cell.
    horizontalLine(page, 30, 40, 48);
    verticalLine(page, 60, 25, 36);
    const painted = removeRulingLines(page);
    expect(painted).toBeGreaterThan(0);
    expect(pixel(page, 44, 30)).toEqual(BLACK);
    expect(pixel(page, 60, 30)).toEqual(BLACK);
    expect(countNonWhite(page)).toBe(9 + 12);
    for (const y of [10, 50, 90]) expect(pixel(page, 100, y)).toEqual(WHITE);
    for (const x of [10, 100, 189]) expect(pixel(page, x, 70)).toEqual(WHITE);
  });

  it('leaves a page without lines byte for byte as it was and reports zero', () => {
    const page = whitePage(80, 80);
    horizontalLine(page, 10, 5, 19); // 15 px: a glyph stroke, below the floor
    verticalLine(page, 40, 20, 34);
    for (let x = 0; x < 80; x += 3) paint(page, x, 60, BLACK); // dots
    const before = Uint8ClampedArray.from(page.data);
    expect(removeRulingLines(page)).toBe(0);
    expect(page.data).toEqual(before);
  });

  it('does not take a light grey line for a ruling line (stated limit)', () => {
    const page = whitePage(120, 40);
    horizontalLine(page, 20, 10, 99, LIGHT_GREY);
    expect(removeRulingLines(page)).toBe(0);
    expect(pixel(page, 50, 20)).toEqual(LIGHT_GREY);
  });

  it('does not take a dotted line for a ruling line (stated limit)', () => {
    const page = whitePage(120, 40);
    for (let x = 10; x < 100; x += 2) paint(page, x, 20, BLACK);
    expect(removeRulingLines(page)).toBe(0);
  });

  it('removes a dark grey line and a coloured dark line, judged by luma', () => {
    const page = whitePage(120, 60);
    horizontalLine(page, 20, 10, 99, [90, 90, 90]);
    horizontalLine(page, 40, 10, 99, [0, 0, 160]); // dark blue: luma (0·77 + 0·151 + 160·28) >> 8 = 17
    expect(removeRulingLines(page)).toBe(180);
    expect(countNonWhite(page)).toBe(0);
  });

  it('honours an explicit minimum run and dilation', () => {
    const page = whitePage(60, 20);
    horizontalLine(page, 10, 5, 14); // 10 px
    paint(page, 8, 7, BLACK); // 3 rows above
    expect(removeRulingLines(page, { minRunPx: 10, dilatePx: 3 })).toBe(11);
    const again = whitePage(60, 20);
    horizontalLine(again, 10, 5, 14);
    expect(removeRulingLines(again, { minRunPx: 11 })).toBe(0);
    expect(RULING_LINE_DILATE_PX).toBe(2);
  });

  it('keeps a thick bar (a headline stem) that is longer than the minimum run, by its aspect', () => {
    const page = whitePage(200, 80);
    for (let y = 20; y < 32; y += 1) horizontalLine(page, y, 10, 89); // 80 × 12 px: aspect 6.7
    horizontalLine(page, 60, 10, 189); // a real line next to it: 180 × 1 px
    expect(RULING_LINE_MIN_ASPECT).toBe(10);
    expect(removeRulingLines(page)).toBe(180);
    expect(pixel(page, 50, 25)).toEqual(BLACK);
    expect(countNonWhite(page)).toBe(80 * 12);
    // A lower aspect bound takes the bar too.
    expect(removeRulingLines(page, { minAspect: 6 })).toBe(80 * 12);
  });

  it('judges a line by its thinnest point, so one that crosses glyphs is still a line', () => {
    const page = whitePage(200, 60);
    horizontalLine(page, 30, 10, 189);
    // Three "stems" through the line, 12 px thick each.
    for (const x0 of [40, 100, 160]) {
      for (let x = x0; x < x0 + 12; x += 1) verticalLine(page, x, 24, 36);
    }
    expect(removeRulingLines(page)).toBeGreaterThanOrEqual(180);
    expect(pixel(page, 70, 30)).toEqual(WHITE);
    // The stems keep everything outside the two-pixel band around the line.
    expect(pixel(page, 45, 24)).toEqual(BLACK);
    expect(pixel(page, 45, 36)).toEqual(BLACK);
    expect(pixel(page, 45, 27)).toEqual(BLACK);
    expect(pixel(page, 45, 28)).toEqual(WHITE);
  });

  it('treats transparent pixels as background whatever their colour, and paints opaque white', () => {
    // A transparent PNG: black RGB under alpha 0 everywhere, an opaque line across it.
    const page = whitePage(120, 40);
    page.data.fill(0);
    for (let x = 10; x < 100; x += 1) {
      const offset = (20 * page.width + x) * 4;
      page.data[offset + 3] = 255; // opaque black: the line
    }
    const painted = removeRulingLines(page);
    // The line (90 px) plus its transparent neighbours within two pixels, all now opaque white.
    expect(painted).toBe(90 * 5 + 2 * 2 * 5);
    expect(page.data.slice((20 * page.width + 50) * 4, (20 * page.width + 50) * 4 + 4)).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
    expect(page.data.slice((17 * page.width + 50) * 4, (17 * page.width + 50) * 4 + 4)).toEqual(new Uint8ClampedArray([0, 0, 0, 0]));
    // Nothing opaque and dark: nothing is a line.
    const transparent = whitePage(120, 40);
    transparent.data.fill(0);
    expect(removeRulingLines(transparent)).toBe(0);
  });

  it('returns zero for an empty or undersized image', () => {
    expect(removeRulingLines({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBe(0);
    expect(removeRulingLines({ data: new Uint8ClampedArray(16), width: 10, height: 10 })).toBe(0);
    expect(removeRulingLines(null)).toBe(0);
  });
});

describe('rulingLineRemovalSteps and removeRulingLinesAsync', () => {
  it('yields once per band in each pass, and the async form yields to the caller between bands', async () => {
    const height = RULING_LINE_BAND_ROWS * 2 + 10;
    const page = whitePage(30, height);
    verticalLine(page, 15, 0, height - 1);
    let yields = 0;
    const steps = rulingLineRemovalSteps(page.data, page.width, page.height);
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    // Two full bands end inside the page in each of the three passes; the partial last band does not yield.
    expect(yields).toBe(6);
    expect(step.value).toBe(height);

    const asyncPage = whitePage(30, height);
    verticalLine(asyncPage, 15, 0, height - 1);
    let handedBack = 0;
    const painted = await removeRulingLinesAsync(asyncPage, {}, async () => { handedBack += 1; });
    expect(painted).toBe(height);
    expect(handedBack).toBe(6);
    expect(asyncPage.data).toEqual(page.data);
  });

  it('uses the default yield when none is given', async () => {
    const page = whitePage(20, RULING_LINE_BAND_ROWS + 1);
    verticalLine(page, 10, 0, RULING_LINE_BAND_ROWS);
    await expect(removeRulingLinesAsync(page)).resolves.toBe(RULING_LINE_BAND_ROWS + 1);
  });
});

describe('createEventLoopYield', () => {
  it('does not yield at all in a hidden tab, where timers are throttled and nothing needs to stay responsive', async () => {
    const timer = vi.fn();
    const yieldFn = createEventLoopYield({ document: { visibilityState: 'hidden' }, scheduler: { yield: vi.fn() }, MessageChannel: null, setTimeout: timer });
    await yieldFn();
    expect(timer).not.toHaveBeenCalled();
  });

  it('prefers scheduler.yield, then a MessageChannel task, then a zero-delay timer', async () => {
    const schedulerYield = vi.fn(async () => {});
    await createEventLoopYield({ document: { visibilityState: 'visible' }, scheduler: { yield: schedulerYield }, MessageChannel: null, setTimeout: vi.fn() })();
    expect(schedulerYield).toHaveBeenCalledTimes(1);

    const posted = [];
    class FakeChannel {
      constructor() {
        this.port1 = { onmessage: null, close: vi.fn() };
        this.port2 = { postMessage: (value) => { posted.push(value); queueMicrotask(() => this.port1.onmessage({ data: value })); } };
      }
    }
    const channelYield = createEventLoopYield({ document: null, scheduler: null, MessageChannel: FakeChannel, setTimeout: vi.fn() });
    await channelYield();
    expect(posted).toEqual([null]);

    const timer = vi.fn((callback) => callback());
    await createEventLoopYield({ document: null, scheduler: {}, MessageChannel: null, setTimeout: timer })();
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
