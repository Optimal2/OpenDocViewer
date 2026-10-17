import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const toggle = (page) => page.getByRole('button', { name: 'Fine tuning', exact: true });
const bars = (page) => page.locator('.compare-transform-bar');
const field = (scope, name) => scope.getByRole('spinbutton', { name, exact: true });
async function compare(page) {
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
}
async function setOffset(scope, value) {
  await field(scope, 'Horizontal offset in pixels').fill(value);
  await field(scope, 'Horizontal offset in pixels').press('Enter');
}

test('single and two-page toggle preserves geometry, page identity and session preference', async ({ page }, testInfo) => {
  await loadSession(page);
  await expect(page.locator('.document-pane-frame.is-single-pane img[data-page-number]')).toBeVisible();
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(bars(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(bars(page)).toHaveCount(1);
  await setOffset(bars(page), '17');
  const stage = page.locator('.document-pane-frame.is-single-pane .document-render-container');
  await expect(stage).toHaveCSS('transform', /17/);
  const singleFrame = await page.locator('.document-pane-frame.is-single-pane').boundingBox();
  expect(singleFrame.height).toBeGreaterThan(100);
  expect(singleFrame.y + singleFrame.height).toBeLessThanOrEqual(901);
  await page.screenshot({ path: testInfo.outputPath('single-fine-tuning.png') });
  await toggle(page).click();
  await expect(bars(page)).toHaveCount(0);
  await expect(stage).toHaveCSS('transform', /17/);
  await page.locator('#thumbnail-3').click();
  await expect(stage).toHaveCSS('transform', 'none');
  await page.locator('#thumbnail-1').click();
  await expect(stage).toHaveCSS('transform', /17/);
  await compare(page);
  await expect(bars(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(bars(page)).toHaveCount(2);
  await expect(field(page.locator('.compare-transform-bar.is-primary'), 'Horizontal offset in pixels')).toHaveValue('17.0');
  await page.screenshot({ path: testInfo.outputPath('two-page-fine-tuning.png') });
  await setOffset(page.locator('.compare-transform-bar.is-compare'), '29');
  await expect(field(page.locator('.compare-transform-bar.is-primary'), 'Horizontal offset in pixels')).toHaveValue('17.0');
  await page.locator('.compare-button').click();
  await expect(bars(page)).toHaveCount(1);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(field(bars(page), 'Horizontal offset in pixels')).toHaveValue('17.0');
  await compare(page);
  await expect(field(page.locator('.compare-transform-bar.is-compare'), 'Horizontal offset in pixels')).toHaveValue('29.0');
});

for (const toolbarMode of ['mirror', 'hide']) {
  test(`global toggle respects compare.adjust.toolbarMode=${toolbarMode}`, async ({ page }) => {
    await loadSession(page, { siteConfig: { compare: { adjust: { toolbarMode } } } });
    await compare(page);
    const rotation = page.getByRole('toolbar', { name: 'Document controls', exact: true })
      .getByRole('button', { name: 'Rotate right 90°', exact: true });
    await expect(rotation).toBeVisible();
    await toggle(page).click();
    if (toolbarMode === 'hide') await expect(rotation).toHaveCount(0);
    else await expect(rotation).toBeVisible();
    await toggle(page).click();
    await expect(rotation).toBeVisible();
    await expect(bars(page)).toHaveCount(0);
  });
}

test('single-page gestures are enabled only with panels visible; hiding keeps image and layout edits', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('.document-pane-frame.is-single-pane img[data-page-number]')).toBeVisible();
  await toggle(page).click();
  const bar = page.locator('.compare-transform-bar.is-primary');
  const frame = page.locator('.document-pane-frame.is-single-pane');
  await expect(frame).toHaveClass(/is-transform-active/);
  const box = await frame.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(field(bar, 'Horizontal offset in pixels')).toHaveValue('30.0');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(field(bar, 'Page zoom in percent')).toHaveValue('101.0');
  await field(bar, 'Brightness in percent (100 = unchanged)').fill('115');
  await field(bar, 'Brightness in percent (100 = unchanged)').press('Enter');
  await toggle(page).click();
  await expect(frame).not.toHaveClass(/is-transform-active/);
  await expect(frame).not.toHaveAttribute('data-odv-transform-wheel', 'on');
  await toggle(page).click();
  await expect(field(bar, 'Horizontal offset in pixels')).toHaveValue('30.0');
  await expect(field(bar, 'Brightness in percent (100 = unchanged)')).toHaveValue('115');
  await bar.getByRole('button', { name: 'Reset all (layout and image)', exact: true }).click();
  await expect(field(bar, 'Horizontal offset in pixels')).toHaveValue('0.0');
  await expect(field(bar, 'Page zoom in percent')).toHaveValue('100.0');
});

test('Swedish toggle is labelled and keyboard accessible', async ({ page }) => {
  await loadSession(page, { query: 'lng=sv' });
  const button = page.getByRole('button', { name: 'Finjustering', exact: true });
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(bars(page)).toHaveCount(1);
  await button.press('Space');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(bars(page)).toHaveCount(0);
});

for (const normalVisible of [false, true]) {
  test(`fullscreen controls preserve normal visibility (${normalVisible}) and calibration`, async ({ page }) => {
    await loadSession(page);
    await compare(page);
    if (normalVisible) await toggle(page).click();
    await page.getByRole('button', { name: 'Overlay the two pages (transparency)', exact: true }).click();
    const overlay = page.locator('.compare-overlay-view');
    await expect(overlay.locator('.compare-transform-controls')).toHaveCount(2);
    await setOffset(overlay.locator('.compare-transform-bar.is-primary'), '12');
    await overlay.locator('.compare-overlay-close').click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', String(normalVisible));
    await page.locator('.toolbar .compare-curtain-button').click();
    const curtain = page.locator('.compare-curtain-view');
    await expect(curtain.locator('.compare-transform-controls')).toHaveCount(2);
    await expect(field(curtain.locator('.compare-transform-bar.is-primary'), 'Horizontal offset in pixels')).toHaveValue('12.0');
    await setOffset(curtain.locator('.compare-transform-bar.is-compare'), '24');
    const slider = curtain.getByRole('slider', { name: /Border between/ });
    await slider.focus();
    const before = Number(await slider.getAttribute('aria-valuenow'));
    await slider.press('ArrowDown');
    await expect(slider).toHaveAttribute('aria-valuenow', String(before + 1));
    await curtain.locator('.compare-curtain-close').click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', String(normalVisible));
    if (!normalVisible) await toggle(page).click();
    await expect(field(page.locator('.compare-transform-bar.is-compare'), 'Horizontal offset in pixels')).toHaveValue('24.0');
  });
}

test('site capability disables fine tuning and advanced views while simple compare remains', async ({ page }) => {
  await loadSession(page, { siteConfig: { fineTune: { enabled: false } } });
  await expect(page.locator('#thumbnail-1')).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);
  await compare(page);
  await expect(bars(page)).toHaveCount(0);
  await expect(page.locator('.compare-curtain-button, .compare-overlay-open')).toHaveCount(0);
});
