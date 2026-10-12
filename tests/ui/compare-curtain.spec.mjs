// File: tests/ui/compare-curtain.spec.mjs
/**
 * Curtain view of the compare mode (CompareCurtainView.jsx, utils/compareCurtain.js): the entry in
 * the compare toolbar stays disabled until the overlay view has calibrated the pages; opened from
 * the overlay view or the compare view it shows both calibrated pages with page B clipped to one
 * side of a draggable border, and Close returns to the view it was opened from.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const CURTAIN_READY = 'Curtain: show the calibrated pages with a draggable border';
const CURTAIN_NEEDS_CALIBRATION = 'Curtain: open the overlay view first – it calibrates the two pages';

/** @param {import('@playwright/test').Page} page */
async function openCompare(page) {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await expect(page.locator('.compare-curtain-button')).toHaveCount(0);
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page */
function clipOfB(page) {
  return page.locator('.compare-curtain-layer.is-compare').evaluate((node) => /** @type {HTMLElement} */ (node).style.clipPath);
}

test('curtain view: disabled until calibrated, opened from overlay and compare, drag and keys move the border', async ({ page }) => {
  await openCompare(page);

  // No calibration yet: the compare toolbar entry is disabled and explains why.
  const entry = page.locator('.toolbar .compare-curtain-button');
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await expect(entry).toHaveAttribute('title', CURTAIN_NEEDS_CALIBRATION);
  await entry.click({ force: true });
  await expect(page.locator('.compare-curtain-view')).toHaveCount(0);

  // The overlay view calibrates; its toolbar opens the curtain.
  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  const overlay = page.locator('.compare-overlay-view');
  await expect(overlay).toBeVisible();
  await overlay.locator('.compare-transform-bar.is-compare').getByRole('spinbutton', { name: 'Rotation in degrees' }).fill('0.5');
  await overlay.locator('.compare-transform-bar.is-compare').getByRole('spinbutton', { name: 'Rotation in degrees' }).press('Enter');
  await overlay.getByRole('button', { name: CURTAIN_READY }).click();

  const curtain = page.locator('.compare-curtain-view');
  await expect(curtain).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.document-pane-frame')).toHaveCount(0);
  await expect(page.locator('.compare-curtain-layer.is-primary img, .compare-curtain-layer.is-primary canvas').first()).toBeVisible();
  await expect(page.locator('.compare-curtain-layer.is-compare img, .compare-curtain-layer.is-compare canvas').first()).toBeVisible();
  await expect.poll(() => page.locator('.compare-curtain-layer.is-compare .document-render-container')
    .evaluate((node) => /** @type {HTMLElement} */ (node).style.transform)).toBe('scale(1) translate(0px, 0px) rotate(0.5deg)');
  await expect(curtain.locator('.compare-curtain-label.is-primary')).toHaveText('A · page 1');
  await expect(curtain.locator('.compare-curtain-label.is-compare')).toHaveText('B · page 2');

  // Only the direction toggle, Print and Close in the toolbar.
  await expect(curtain.locator('.compare-curtain-toolbar button')).toHaveCount(4);
  await expect(curtain.getByRole('button', { name: 'Print the curtain view as one page' })).toBeEnabled();
  expect(await clipOfB(page)).toBe('inset(0% 0% 0% 50%)');

  // Keyboard on the border (focused on open): Right +1 %, Shift+Left −10 %.
  const border = curtain.getByRole('slider');
  await expect(border).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(border).toHaveAttribute('aria-valuenow', '41');
  expect(await clipOfB(page)).toBe('inset(0% 0% 0% 41%)');

  // Drag the border to a quarter of the stage.
  const stageBox = await curtain.locator('.compare-curtain-stage').boundingBox();
  const borderBox = await border.boundingBox();
  if (!stageBox || !borderBox) throw new Error('curtain stage not laid out');
  const startX = borderBox.x + borderBox.width / 2;
  const y = stageBox.y + stageBox.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.25, y, { steps: 8 });
  await page.mouse.up();
  const dragged = Number(await border.getAttribute('aria-valuenow'));
  expect(Math.abs(dragged - 25)).toBeLessThan(1);

  // Horizontal mode: own position (50 %), page B below the line.
  await curtain.getByRole('button', { name: 'Horizontal' }).click();
  // Chromium serializes inset(50% 0% 0% 0%) in its shortest form.
  expect(await clipOfB(page)).toBe('inset(50% 0% 0%)');
  await curtain.getByRole('button', { name: 'Vertical' }).click();
  await expect(border).toHaveAttribute('aria-valuenow', String(dragged));

  // Escape returns to the overlay view.
  await border.focus();
  await page.keyboard.press('Escape');
  await expect(curtain).toHaveCount(0);
  await expect(overlay).toBeVisible();

  // Close the overlay; now the compare toolbar entry is enabled and Close returns to compare.
  await overlay.getByRole('button', { name: 'Close the overlay view and return to the compare view' }).click();
  await expect(entry).toHaveAttribute('aria-disabled', 'false');
  await entry.click();
  await expect(curtain).toBeVisible();
  await curtain.getByRole('button', { name: 'Close the curtain view and go back' }).click();
  await expect(curtain).toHaveCount(0);
  await expect(page.locator('.compare-overlay-view')).toHaveCount(0);
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
});

test('curtain view: Print opens the one shared print dialog for the composed page', async ({ page }) => {
  await openCompare(page);
  await page.getByRole('button', { name: 'Overlay the two pages (transparency)' }).click();
  await page.locator('.compare-overlay-view').getByRole('button', { name: CURTAIN_READY }).click();
  const curtain = page.locator('.compare-curtain-view');
  await expect(curtain).toBeVisible();

  await curtain.getByRole('button', { name: 'Print the curtain view as one page' }).click();
  const dialog = page.locator('.odv-prd-backdrop');
  await expect(dialog).toHaveCount(1);
  await expect(curtain.locator('.odv-prd-backdrop')).toBeVisible();
  await expect(dialog.locator('.odv-prd-summary')).toHaveText('Prepare the curtain view of pages 1 and 2 as one page.');
  await expect(dialog.locator('input[name="activeScope"]')).toHaveCount(0);

  // Escape closes the dialog first; the curtain view stays.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(curtain).toBeVisible();
});
