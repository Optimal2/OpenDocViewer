// File: tests/ui/rotate-quarter-turns.spec.mjs
/**
 * The 90° toolbar buttons, four times round, in a real browser: after every quarter turn the page
 * canvas holds painted pixels and has the orientation the turn asks for. Before the fix in
 * CanvasRenderer.jsx the second press (180°) showed an empty page: the parent drew the rotated
 * page into the canvas, then React re-applied the canvas's width/height attributes with the size
 * the parent had just reported, and setting those attributes clears the bitmap even when the
 * value is unchanged (HTML specification). A unit test watches the setters; this spec reads pixels.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/**
 * Count opaque samples in the page canvas and report its bitmap size.
 * @param {import('@playwright/test').Page} page
 */
function readPageCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.document-pane-frame.is-single-pane canvas[data-page-number]');
    if (!canvas) return null;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (data[i + 3] > 0) opaque += 1;
      if (data[i + 3] > 0 && data[i] < 128) dark += 1;
    }
    return { width: canvas.width, height: canvas.height, opaque, dark };
  });
}

test('four quarter turns with the toolbar button: the page stays painted at 90°, 180°, 270° and 0°', async ({ page }) => {
  await loadSession(page);
  const image = page.locator('.document-pane-frame.is-single-pane img[data-page-number]');
  await expect(image).toBeVisible();
  const natural = await image.evaluate((node) => ({ width: node.naturalWidth, height: node.naturalHeight }));
  expect(natural.width).toBeGreaterThan(0);
  expect(natural.height).toBeGreaterThan(natural.width);

  // The installed browser may start the viewer in Swedish; both names are accepted.
  const rotateRight = page.getByRole('button', { name: /^(Rotate right|Rotera höger) 90°$/ });
  const rotateLeft = page.getByRole('button', { name: /^(Rotate left|Rotera vänster) 90°$/ });
  const canvas = page.locator('.document-pane-frame.is-single-pane canvas[data-page-number]');

  /** @param {number} degrees */
  const expectPainted = async (degrees) => {
    const swapped = degrees === 90 || degrees === 270;
    await expect.poll(() => readPageCanvas(page), { message: `canvas at ${degrees}°` }).toMatchObject({
      width: swapped ? natural.height : natural.width,
      height: swapped ? natural.width : natural.height,
    });
    const sample = await readPageCanvas(page);
    // The fixture page is mostly white with text: well over half the samples are opaque, some dark.
    expect(sample.opaque, `opaque samples at ${degrees}°`).toBeGreaterThan(1000);
    expect(sample.dark, `dark (text) samples at ${degrees}°`).toBeGreaterThan(0);
    await expect(canvas).toBeVisible();
  };

  await rotateRight.click();
  await expectPainted(90);
  await rotateRight.click();
  await expectPainted(180);
  await rotateRight.click();
  await expectPainted(270);

  // Back to upright through the other button: the canvas gives way to the plain image again.
  await rotateLeft.click();
  await expectPainted(180);
  await rotateLeft.click();
  await expectPainted(90);
  await rotateLeft.click();
  await expect(canvas).toHaveCount(0);
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS('visibility', 'visible');
});
