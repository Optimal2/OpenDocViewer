// File: tests/ui/compare-overlay.spec.mjs
/**
 * Overlay view of the compare mode (CompareOverlayView.jsx, utils/compareOverlay.js): opened from
 * the toolbar only while two pages are compared, it stacks page A below page B with their own
 * transforms; the slider sets the top page's opacity, nudge mode moves the top page with the arrow
 * keys, and Close returns to the compare view with the calibration kept in the viewer context.
 * The pages' image adjustments travel along: the overlay draws the same colour as side by side,
 * "reset to compare" restores them, and the copied calibration carries them.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';
import {
  drawnPixelStats, expectSamePixels, readImageAdjustment, setImageAdjustment,
} from './compareImageAdjust.mjs';

/** @param {import('@playwright/test').Page} page */
async function openCompare(page) {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  // Single-page view: no overlay button.
  await expect(page.locator('.compare-overlay-button')).toHaveCount(0);
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page @param {'primary'|'compare'} target */
function layerTransform(page, target) {
  return page.locator(`.compare-overlay-layer.is-${target} .document-render-container`)
    .evaluate((node) => /** @type {HTMLElement} */ (node).style.transform);
}

/** @param {import('@playwright/test').Locator} bar @param {string} name */
function field(bar, name) {
  return bar.getByRole('spinbutton', { name });
}

test('overlay view: open from compare, calibrate, close and reopen keep the calibration', async ({ page }) => {
  await openCompare(page);

  // Calibrate page B in the compare view first.
  const compareBar = page.locator('.compare-transform-bar.is-compare');
  await compareBar.locator('.compare-transform-toggle').click();
  await field(compareBar, 'Page zoom in percent').fill('101,5');
  await field(compareBar, 'Page zoom in percent').press('Enter');
  await field(compareBar, 'Rotation in degrees').fill('0.5');
  await field(compareBar, 'Rotation in degrees').press('Enter');

  // Open the overlay view: full surface with its own toolbar, the main toolbar is gone.
  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const view = page.locator('.compare-overlay-view');
  await expect(view).toBeVisible();
  await expect(page.locator('.document-pane-frame')).toHaveCount(0);
  await expect(page.locator('.compare-button')).toHaveCount(0);
  await expect(page.locator('.compare-overlay-layer.is-primary img, .compare-overlay-layer.is-primary canvas').first()).toBeVisible();
  await expect(page.locator('.compare-overlay-layer.is-compare img, .compare-overlay-layer.is-compare canvas').first()).toBeVisible();

  // Page B lies on top at 50 % and keeps the transform from the compare view.
  const layerB = page.locator('.compare-overlay-layer.is-compare');
  await expect(layerB).toHaveClass(/is-top/);
  await expect(layerB).toHaveCSS('opacity', '0.5');
  await expect.poll(() => layerTransform(page, 'compare')).toBe('scale(1.015) translate(0px, 0px) rotate(0.5deg)');
  expect(await layerTransform(page, 'primary')).toBe('');

  // Opacity slider: Right +1 %, Shift+Left −10 %.
  const slider = view.locator('input.compare-overlay-opacity');
  await expect(slider).toHaveValue('50');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(slider).toHaveValue('41');
  await expect(layerB).toHaveCSS('opacity', '0.41');

  // Nudge mode: arrow keys move only the top page.
  await view.getByRole('button', { name: /Nudge mode/ }).click();
  await view.locator('.compare-overlay-stage').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const overlayBarB = view.locator('.compare-transform-bar.is-compare');
  await expect(field(overlayBarB, 'Horizontal offset in pixels')).toHaveValue('2.0');
  await expect(field(overlayBarB, 'Vertical offset in pixels')).toHaveValue('10.0');
  expect(await layerTransform(page, 'primary')).toBe('');

  // Drag moves the top page too: dx/dy are CSS px at scale 1, so 203 px at 101.5 % is 200.
  const stageBox = await view.locator('.compare-overlay-stage').boundingBox();
  const startX = Math.round(stageBox.x + stageBox.width / 2);
  const startY = Math.round(stageBox.y + stageBox.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 203, startY, { steps: 7 });
  await page.mouse.up();
  await expect(field(overlayBarB, 'Horizontal offset in pixels')).toHaveValue('202.0');

  // Swap: page A on top; the slider now sets page A.
  await view.getByRole('button', { name: 'Swap which page is on top' }).click();
  await expect(page.locator('.compare-overlay-layer.is-primary')).toHaveClass(/is-top/);
  await expect(page.locator('.compare-overlay-layer.is-primary')).toHaveCSS('opacity', '0.41');
  await expect(layerB).toHaveCSS('opacity', '1');

  // Close: back to the compare view with both pages and the calibrated transforms.
  await view.getByRole('button', { name: 'Close the overlay view and return to the compare view' }).click();
  await expect(view).toHaveCount(0);
  await expect(page.locator('.document-pane-frame.is-primary-pane')).toBeVisible();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
  const barAfter = page.locator('.compare-transform-bar.is-compare');
  if (await barAfter.locator('.compare-transform-toggle').getAttribute('aria-expanded') !== 'true') {
    await barAfter.locator('.compare-transform-toggle').click();
  }
  await expect(field(barAfter, 'Page zoom in percent')).toHaveValue('101.5');
  await expect(field(barAfter, 'Rotation in degrees')).toHaveValue('0.5');
  await expect(field(barAfter, 'Horizontal offset in pixels')).toHaveValue('202.0');
  await expect(field(barAfter, 'Vertical offset in pixels')).toHaveValue('10.0');

  // Reopen: opacity and top page are kept as well.
  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  await expect(view.locator('input.compare-overlay-opacity')).toHaveValue('41');
  await expect(page.locator('.compare-overlay-layer.is-primary')).toHaveClass(/is-top/);

  // Reset to compare restores the transforms from when the view was (re)opened.
  const reopenedBarB = view.locator('.compare-transform-bar.is-compare');
  await field(reopenedBarB, 'Horizontal offset in pixels').fill('-300');
  await field(reopenedBarB, 'Horizontal offset in pixels').press('Enter');
  await expect(field(reopenedBarB, 'Horizontal offset in pixels')).toHaveValue('-300.0');
  await view.getByRole('button', { name: 'Reset to the alignment from the compare view' }).click();
  await expect(field(reopenedBarB, 'Horizontal offset in pixels')).toHaveValue('202.0');

  // Escape closes the view as well.
  await view.locator('.compare-overlay-stage').focus();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
});

test('overlay view: copy calibration writes { version, A, B } as JSON', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCompare(page);
  const primaryBar = page.locator('.compare-transform-bar.is-primary');
  await primaryBar.locator('.compare-transform-toggle').click();
  await field(primaryBar, 'Page zoom in percent').fill('99.9');
  await field(primaryBar, 'Page zoom in percent').press('Enter');

  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const view = page.locator('.compare-overlay-view');
  await view.getByRole('button', { name: 'Copy the calibration as JSON (for support)' }).click();
  await expect(view.locator('.compare-overlay-status')).toHaveText('Calibration copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const image = { brightness: 100, contrast: 100, grayscale: 0, invert: false };
  expect(JSON.parse(text)).toEqual({
    version: 2,
    A: { scale: 0.999, dx: 0, dy: 0, rotation: 0, ...image },
    B: { scale: 1, dx: 0, dy: 0, rotation: 0, ...image },
  });
});

/** Non-neutral starting adjustments set in the compare view, one per page. */
const START_A = { brightness: 120, contrast: 90, grayscale: 30, invert: true };
const START_B = { brightness: 80, contrast: 130, grayscale: 60, invert: false };

/**
 * Expands both compare-view panels and sets START_A and START_B.
 * @param {import('@playwright/test').Page} page
 */
async function adjustBothPagesInCompare(page) {
  for (const [pane, values] of [['primary', START_A], ['compare', START_B]]) {
    const bar = page.locator(`.compare-transform-bar.is-${pane}`);
    await bar.locator('.compare-transform-toggle').click();
    await setImageAdjustment(bar, values);
    await expect(page.locator(`.document-pane-frame.is-${pane}-pane canvas`)).toHaveCount(1);
  }
}

test('overlay view: copy calibration carries non-neutral image adjustments', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCompare(page);
  await adjustBothPagesInCompare(page);

  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const view = page.locator('.compare-overlay-view');
  await view.getByRole('button', { name: 'Copy the calibration as JSON (for support)' }).click();
  await expect(view.locator('.compare-overlay-status')).toHaveText('Calibration copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(text)).toEqual({
    version: 2,
    A: { scale: 1, dx: 0, dy: 0, rotation: 0, ...START_A },
    B: { scale: 1, dx: 0, dy: 0, rotation: 0, ...START_B },
  });
});

test('overlay view: both pages show the same colour as side by side', async ({ page }) => {
  await openCompare(page);
  await adjustBothPagesInCompare(page);
  const sideA = await drawnPixelStats(page, '.document-pane-frame.is-primary-pane canvas');
  const sideB = await drawnPixelStats(page, '.document-pane-frame.is-compare-pane canvas');
  // The two pages carry different adjustments, so their colour differs.
  expect(sideA).not.toEqual(sideB);

  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  await expect(page.locator('.compare-overlay-view')).toBeVisible();
  await expectSamePixels(page, '.compare-overlay-layer.is-primary canvas', sideA);
  await expectSamePixels(page, '.compare-overlay-layer.is-compare canvas', sideB);
});

test('overlay view: reset to compare restores the image adjustment of both pages', async ({ page }) => {
  await openCompare(page);
  await adjustBothPagesInCompare(page);
  const compareBar = page.locator('.compare-transform-bar.is-compare');
  await compareBar.getByRole('spinbutton', { name: 'Rotation in degrees' }).fill('0.5');
  await compareBar.getByRole('spinbutton', { name: 'Rotation in degrees' }).press('Enter');

  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const view = page.locator('.compare-overlay-view');
  const barA = view.locator('.compare-transform-bar.is-primary');
  const barB = view.locator('.compare-transform-bar.is-compare');
  expect(await readImageAdjustment(barA)).toEqual(START_A);
  expect(await readImageAdjustment(barB)).toEqual(START_B);

  // Change all four image fields on both pages, plus the layout of B.
  const changedA = { brightness: 150, contrast: 60, grayscale: 0, invert: false };
  const changedB = { brightness: 110, contrast: 105, grayscale: 100, invert: true };
  await setImageAdjustment(barA, changedA);
  await setImageAdjustment(barB, changedB);
  await barB.getByRole('spinbutton', { name: 'Rotation in degrees' }).fill('-2');
  await barB.getByRole('spinbutton', { name: 'Rotation in degrees' }).press('Enter');
  expect(await readImageAdjustment(barA)).toEqual(changedA);
  expect(await readImageAdjustment(barB)).toEqual(changedB);

  // Reset restores the state from when the view was opened - not neutral values.
  await view.getByRole('button', { name: 'Reset to the alignment from the compare view' }).click();
  await expect(barB.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('0.5');
  await expect.poll(() => readImageAdjustment(barA)).toEqual(START_A);
  await expect.poll(() => readImageAdjustment(barB)).toEqual(START_B);
  await expect.poll(() => layerTransform(page, 'compare')).toBe('scale(1) translate(0px, 0px) rotate(0.5deg)');

  // Back in the compare view the restored adjustment is the pages' state.
  await view.getByRole('button', { name: 'Close the overlay view and return to the compare view' }).click();
  await expect(view).toHaveCount(0);
  for (const [pane, values] of [['primary', START_A], ['compare', START_B]]) {
    const bar = page.locator(`.compare-transform-bar.is-${pane}`);
    if (await bar.locator('.compare-transform-toggle').getAttribute('aria-expanded') !== 'true') {
      await bar.locator('.compare-transform-toggle').click();
    }
    expect(await readImageAdjustment(bar)).toEqual(values);
  }
});

test('overlay button leaves with compare mode', async ({ page }) => {
  await openCompare(page);
  await expect(page.locator('.compare-overlay-button')).toHaveCount(1);
  await page.locator('.compare-button').click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toHaveCount(0);
  await expect(page.locator('.compare-overlay-button')).toHaveCount(0);
});

test('overlay view: Print opens the one shared print dialog for the composed page', async ({ page }) => {
  await openCompare(page);
  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const view = page.locator('.compare-overlay-view');
  await expect(view).toBeVisible();

  const print = view.getByRole('button', { name: 'Print the overlay view as one page' });
  await expect(print).toBeEnabled();
  await expect(print).toHaveAttribute('title', 'Print the overlay view as one page');
  await print.click();

  // The same dialog as the toolbar's, in its compare-view mode: one page, no page or scope choice.
  const dialog = page.locator('.odv-prd-backdrop');
  await expect(dialog).toHaveCount(1);
  await expect(view.locator('.odv-prd-backdrop')).toBeVisible();
  await expect(dialog.locator('.odv-prd-summary')).toHaveText('Prepare the overlay view of pages 1 and 2 as one page.');
  await expect(dialog.locator('input[name="activeScope"]')).toHaveCount(0);
  await expect(dialog.locator('#odv-prd-pages-header')).toHaveCount(0);

  // Cancel keeps the view.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(view).toBeVisible();

  // Back in the compare view the toolbar opens the same dialog for the side-by-side print.
  await view.getByRole('button', { name: 'Close the overlay view and return to the compare view' }).click();
  await expect(view).toHaveCount(0);
  await page.locator('.toolbar .toolbar-split-main').first().click();
  await expect(page.locator('.odv-prd-backdrop')).toHaveCount(1);
  await expect(page.locator('.odv-prd-backdrop input[name="activeScope"]')).toHaveCount(2);
  await expect(page.locator('.odv-prd-backdrop .odv-prd-summary')).not.toContainText('overlay view');
});
