// File: tests/ui/help-dialog-theme.spec.mjs
/**
 * The header of the help dialogs (About, Manual) follows the theme. Its background used to be a
 * fixed near-white gradient while its text took the theme's colour, so the dark theme showed
 * light text on white. Measured on the painted pixels, since the background is a gradient.
 */
import { test, expect } from '@playwright/test';
import { decode as decodePng } from 'fast-png';
import { loadSession } from './fixtureSession.mjs';

/** @param {Array<number>} rgb  0..255 per channel. */
function luminance(rgb) {
  return rgb.slice(0, 3)
    .map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
}

/** @param {Array<number>} a @param {Array<number>} b */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The header's painted background (a pixel in its padding, clear of the text) and its text colours.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} dialog
 */
async function measureHeader(page, dialog) {
  const header = dialog.locator('.odv-help-header');
  await expect(header).toBeVisible();
  const box = await header.boundingBox();
  // Top padding (20px) left of the title, and bottom padding (16px) under it: no glyphs there.
  const points = [{ x: 10, y: 8 }, { x: 10, y: Math.round(box.height) - 6 }];
  const backgrounds = [];
  for (const point of points) {
    const png = decodePng(await page.screenshot({ clip: { x: Math.round(box.x) + point.x, y: Math.round(box.y) + point.y, width: 1, height: 1 } }));
    backgrounds.push(Array.from(png.data.slice(0, 3)));
  }
  const colors = await header.evaluate((node) => {
    const rgb = (element) => getComputedStyle(element).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    return { title: rgb(node.querySelector('.odv-help-title')), subtitle: rgb(node.querySelector('.odv-help-subtitle')) };
  });
  return { backgrounds, ...colors };
}

/** @param {import('@playwright/test').Page} page @param {('Dark'|'Light'|'Normal')} name */
async function chooseTheme(page, name) {
  await page.getByRole('button', { name: 'Choose theme' }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', name.toLowerCase());
  await page.keyboard.press('Escape');
}

/** @param {import('@playwright/test').Page} page @param {('Manual'|'About OpenDocViewer')} item */
async function openHelpDialog(page, item) {
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: item }).click();
  const dialog = page.locator('.odv-help-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const item of ['About OpenDocViewer', 'Manual']) {
  test(`${item}: the dialog header is dark in the dark theme and its text is readable in every theme`, async ({ page }) => {
    await loadSession(page);
    await expect(page.locator('.odv-signature-overview-button')).toBeVisible();

    await chooseTheme(page, 'Dark');
    let dialog = await openHelpDialog(page, item);
    const dark = await measureHeader(page, dialog);
    for (const background of dark.backgrounds) {
      // A dark surface, as the dialog's body: the old header was 0.93 and up.
      expect(luminance(background), `dark header background ${background}`).toBeLessThan(0.2);
      expect(contrast(dark.title, background), 'title on dark header').toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark.subtitle, background), 'subtitle on dark header').toBeGreaterThanOrEqual(4.5);
    }
    await dialog.locator('.odv-help-header .odv-help-close-icon').last().click();
    await expect(dialog).toBeHidden();

    await chooseTheme(page, 'Light');
    dialog = await openHelpDialog(page, item);
    const light = await measureHeader(page, dialog);
    for (const background of light.backgrounds) {
      // Unchanged in the light theme: the near-white gradient it had (#ffffff to #f7f9fc).
      expect(Math.min(...background), `light header background ${background}`).toBeGreaterThanOrEqual(244);
      expect(contrast(light.title, background), 'title on light header').toBeGreaterThanOrEqual(4.5);
      expect(contrast(light.subtitle, background), 'subtitle on light header').toBeGreaterThanOrEqual(4.5);
    }
    await dialog.locator('.odv-help-header .odv-help-close-icon').last().click();
    await expect(dialog).toBeHidden();

    // The normal theme has a tinted surface: the header takes it, like the other dialog headers.
    await chooseTheme(page, 'Normal');
    dialog = await openHelpDialog(page, item);
    const normal = await measureHeader(page, dialog);
    for (const background of normal.backgrounds) {
      expect(contrast(normal.title, background), 'title on normal header').toBeGreaterThanOrEqual(4.5);
      expect(contrast(normal.subtitle, background), 'subtitle on normal header').toBeGreaterThanOrEqual(4.5);
    }
  });
}
