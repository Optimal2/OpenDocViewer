/**
 * Shared helper for the compare overlay and curtain specs: sets and reads a page's image
 * adjustment (brightness, contrast, grayscale, invert) through its adjustment panel
 * (CompareTransformControls.jsx), and reads the pixel statistics of a drawn page canvas so the
 * same page can be compared between the side-by-side, overlay and curtain views.
 */
import { expect } from '@playwright/test';

/**
 * Two colour pages (public/sample.png and sample.jpg, served by the dev server: a black digit and
 * a blue bar). The signed-PDF fixtures are monochrome, so grayscale would change no pixel there;
 * colour-parity specs use this session.
 */
export const COLOUR_SESSION = {
  session: { id: 'ui-compare-colour' },
  documents: [{ documentId: 'colour', files: ['/sample.png', '/sample.jpg'] }],
};

/** The panel's image fields by accessible name (English). */
export const IMAGE_FIELDS = {
  brightness: 'Brightness in percent (100 = unchanged)',
  contrast: 'Contrast in percent (100 = unchanged)',
  grayscale: 'Grayscale in percent (0 = in color)',
};

/**
 * @typedef {Object} ImageAdjustment
 * @property {number} brightness
 * @property {number} contrast
 * @property {number} grayscale
 * @property {boolean} invert
 */

/**
 * Commits every image field of one expanded panel and sets the invert checkbox.
 *
 * @param {import('@playwright/test').Locator} bar `.compare-transform-bar` of the page.
 * @param {ImageAdjustment} values
 * @returns {Promise<void>}
 */
export async function setImageAdjustment(bar, values) {
  for (const [key, name] of Object.entries(IMAGE_FIELDS)) {
    const input = bar.getByRole('spinbutton', { name });
    await input.fill(String(values[key]));
    await input.press('Enter');
    await expect(input).toHaveValue(String(values[key]));
  }
  await bar.getByRole('checkbox', { name: 'Invert colors' }).setChecked(values.invert);
}

/**
 * Reads the image fields of one expanded panel.
 *
 * @param {import('@playwright/test').Locator} bar
 * @returns {Promise<ImageAdjustment>}
 */
export async function readImageAdjustment(bar) {
  /** @type {Record<string, number>} */
  const numbers = {};
  for (const [key, name] of Object.entries(IMAGE_FIELDS)) {
    numbers[key] = Number(await bar.getByRole('spinbutton', { name }).inputValue());
  }
  return {
    brightness: numbers.brightness,
    contrast: numbers.contrast,
    grayscale: numbers.grayscale,
    invert: await bar.getByRole('checkbox', { name: 'Invert colors' }).isChecked(),
  };
}

/**
 * Size and mean RGBA of the first canvas matching `selector`, or null while none is drawn. The
 * canvas holds the page after the image filter, so equal statistics mean equal colour.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<({ width:number, height:number, r:number, g:number, b:number, a:number }|null)>}
 */
export function canvasPixelStats(page, selector) {
  return page.evaluate((sel) => {
    const canvas = /** @type {(HTMLCanvasElement|null)} */ (document.querySelector(sel));
    if (!canvas || canvas.width < 2 || canvas.height < 2) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      sums[0] += data[i];
      sums[1] += data[i + 1];
      sums[2] += data[i + 2];
      sums[3] += data[i + 3];
    }
    const count = data.length / 4;
    // A canvas that is not drawn yet is fully transparent.
    if (sums[3] === 0) return null;
    const mean = (sum) => Math.round((sum / count) * 100) / 100;
    return {
      width: canvas.width,
      height: canvas.height,
      r: mean(sums[0]),
      g: mean(sums[1]),
      b: mean(sums[2]),
      a: mean(sums[3]),
    };
  }, selector);
}

/**
 * Waits until the canvas at `selector` is drawn with the same size and mean colour (±0.5 per
 * channel) as `expected`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {{ width:number, height:number, r:number, g:number, b:number, a:number }} expected
 * @returns {Promise<void>}
 */
export async function expectSamePixels(page, selector, expected) {
  await expect.poll(async () => {
    const actual = await canvasPixelStats(page, selector);
    if (!actual) return 'not drawn';
    if (actual.width !== expected.width || actual.height !== expected.height) return `size ${actual.width}x${actual.height}`;
    const off = ['r', 'g', 'b', 'a'].filter((channel) => Math.abs(actual[channel] - expected[channel]) > 0.5);
    return off.length ? `colour ${JSON.stringify(actual)}` : 'same';
  }).toBe('same');
}

/**
 * Waits for the canvas at `selector` to be drawn and returns its statistics.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<{ width:number, height:number, r:number, g:number, b:number, a:number }>}
 */
export async function drawnPixelStats(page, selector) {
  await expect.poll(() => canvasPixelStats(page, selector)).not.toBeNull();
  // Two equal reads in a row: the draw has settled.
  let previous = await canvasPixelStats(page, selector);
  await expect.poll(async () => {
    const current = await canvasPixelStats(page, selector);
    const settled = JSON.stringify(current) === JSON.stringify(previous);
    previous = current;
    return settled;
  }).toBe(true);
  return /** @type {{ width:number, height:number, r:number, g:number, b:number, a:number }} */ (previous);
}
