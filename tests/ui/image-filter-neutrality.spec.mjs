// File: tests/ui/image-filter-neutrality.spec.mjs
/**
 * Pixel-level proof for the canvas filter of DocumentRender.jsx (utils/imageAdjustments.js): with
 * neutral adjustments the filter draws the same bytes as the brightness/contrast-only filter used
 * before grayscale and invert existed, while grayscale and invert really change pixels. jsdom has
 * no canvas 2d implementation, so the unit tests can only compare filter strings; this spec draws
 * through a real Chromium canvas.
 */
import { test, expect } from '@playwright/test';
import { buildImageFilter } from '../../src/utils/imageAdjustments.js';

const PRE_CAMPAIGN_FILTER = 'brightness(100%) contrast(100%)';
const NEUTRAL = { rotation: 0, brightness: 100, contrast: 100, grayscale: 0, invert: false };

/**
 * Draws a fixed 16×16 test pattern through each filter and returns the resulting RGBA bytes.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<string>} filters
 * @returns {Promise<Array<Array<number>>>} The source bytes first, then one result per filter.
 */
function drawThroughFilters(page, filters) {
  return page.evaluate((filterList) => {
    const size = 16;
    const source = document.createElement('canvas');
    source.width = size;
    source.height = size;
    const sourceCtx = source.getContext('2d');
    const pattern = sourceCtx.createImageData(size, size);
    for (let i = 0; i < size * size; i += 1) {
      pattern.data[i * 4] = (i * 37) % 256;
      pattern.data[i * 4 + 1] = (i * 91 + 13) % 256;
      pattern.data[i * 4 + 2] = (i * 151 + 7) % 256;
      pattern.data[i * 4 + 3] = 255;
    }
    sourceCtx.putImageData(pattern, 0, 0);

    // Index 0 is the source pattern itself (no draw, no filter): the reference bytes.
    return [Array.from(pattern.data)].concat(filterList.map((filter) => {
      const target = document.createElement('canvas');
      target.width = size;
      target.height = size;
      const ctx = target.getContext('2d', { willReadFrequently: true });
      ctx.filter = filter;
      ctx.drawImage(source, 0, 0);
      return Array.from(ctx.getImageData(0, 0, size, size).data);
    }));
  }, filters);
}

test('neutral adjustments draw exactly the pre-campaign pixels; grayscale and invert change them', async ({ page }) => {
  await page.setContent('<!doctype html><html><body></body></html>');

  const neutralFilter = buildImageFilter(NEUTRAL);
  expect(neutralFilter).toBe(PRE_CAMPAIGN_FILTER);

  const [sourceBytes, unfiltered, before, neutral, explicitNeutral, grayscale, inverted] = await drawThroughFilters(page, [
    'none',
    PRE_CAMPAIGN_FILTER,
    neutralFilter,
    // Even spelled out, zero grayscale and zero invert leave the bytes alone.
    `${PRE_CAMPAIGN_FILTER} grayscale(0%) invert(0%)`,
    buildImageFilter({ ...NEUTRAL, grayscale: 100 }),
    buildImageFilter({ ...NEUTRAL, invert: true }),
  ]);

  // `neutral` and `before` share one filter string (asserted above), so their equality alone only
  // shows determinism. The real pixel claim: that filter is an identity on the bytes — it draws the
  // same pixels as the <img>-equivalent unfiltered draw and as the source pattern itself.
  expect(unfiltered).toEqual(sourceBytes);
  expect(before).toEqual(sourceBytes);
  expect(neutral).toEqual(before);
  expect(explicitNeutral).toEqual(before);

  expect(grayscale).not.toEqual(before);
  for (let i = 0; i < grayscale.length; i += 4) {
    expect(grayscale[i]).toBe(grayscale[i + 1]);
    expect(grayscale[i + 1]).toBe(grayscale[i + 2]);
  }

  expect(inverted).not.toEqual(before);
  // Chromium's filter pipeline rounds invert by up to one step, so allow ±1 per channel here;
  // the neutral comparison above stays byte-exact.
  for (let i = 0; i < inverted.length; i += 4) {
    expect(Math.abs(inverted[i] - (255 - before[i]))).toBeLessThanOrEqual(1);
    expect(inverted[i + 3]).toBe(before[i + 3]);
  }
});
