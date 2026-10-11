// File: tests/ui/compare-transform.spec.mjs
/**
 * Compare-view free transform (utils/compareTransform.js, docs-src/compare-transform.md): each
 * compared page gets a fine-tuning bar (only in compare mode) whose numeric fields, fine buttons,
 * arrow-key pan control, page drag and Ctrl+wheel write one transform per page. The renderer
 * applies it as a CSS transform on the page stage. The last test measures frame times for panning
 * and rotating a 300 dpi A4 raster with that same CSS path and logs the numbers.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/** @param {import('@playwright/test').Page} page */
async function openCompare(page) {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  // Not in compare mode yet: no fine-tuning bar anywhere.
  await expect(page.locator('.compare-transform-bar')).toHaveCount(0);
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page @param {'primary'|'compare'} pane */
function stageTransform(page, pane) {
  return page.locator(`.document-pane-frame.is-${pane}-pane .document-render-container`)
    .evaluate((node) => /** @type {HTMLElement} */ (node).style.transform);
}

test('fine-tuning bar: numeric fields, fine buttons and arrow keys write the page transform', async ({ page }) => {
  await openCompare(page);
  const bar = page.locator('.compare-transform-bar.is-compare');
  await expect(page.locator('.compare-transform-bar')).toHaveCount(2);
  const toggle = bar.locator('.compare-transform-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Rotation 0.5 degrees typed with a decimal comma, committed with Enter.
  const rotation = bar.getByRole('spinbutton', { name: 'Rotation in degrees' });
  await rotation.fill('0,5');
  await rotation.press('Enter');
  await expect.poll(() => stageTransform(page, 'compare')).toBe('scale(1) translate(0px, 0px) rotate(0.5deg)');
  await expect(rotation).toHaveValue('0.5');

  // Fine rotate button: -0.1 degrees, Shift: -1 degree.
  await bar.getByRole('button', { name: 'Rotate 0.1° counter-clockwise (Shift: 1°)' }).click();
  await expect(rotation).toHaveValue('0.4');
  await bar.getByRole('button', { name: 'Rotate 0.1° counter-clockwise (Shift: 1°)' }).click({ modifiers: ['Shift'] });
  await expect(rotation).toHaveValue('-0.6');

  // Zoom field, 0.1 % resolution.
  const zoom = bar.getByRole('spinbutton', { name: 'Page zoom in percent' });
  await zoom.fill('101.5');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('101.5');

  // Arrow keys on the pan control: 1 px, Shift 10 px; the page number must not change.
  const pageBefore = await page.locator('.document-pane-frame.is-compare-pane canvas, .document-pane-frame.is-compare-pane img').first().getAttribute('data-page-number');
  const pad = bar.getByRole('button', { name: /Move the page/ });
  await pad.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(bar.getByRole('spinbutton', { name: 'Horizontal offset in pixels' })).toHaveValue('1.0');
  await expect(bar.getByRole('spinbutton', { name: 'Vertical offset in pixels' })).toHaveValue('10.0');
  const pageAfter = await page.locator('.document-pane-frame.is-compare-pane canvas, .document-pane-frame.is-compare-pane img').first().getAttribute('data-page-number');
  expect(pageAfter).toBe(pageBefore);
  await expect.poll(() => stageTransform(page, 'compare')).toBe('scale(1.015) translate(1px, 10px) rotate(-0.6deg)');

  // The left page is untouched.
  expect(await stageTransform(page, 'primary')).toBe('');

  // Reset.
  await bar.getByRole('button', { name: 'Reset zoom, position and rotation for this page' }).click();
  await expect.poll(() => stageTransform(page, 'compare')).toBe('');
});

test('fine-tuning mode: dragging the page pans it and Ctrl+wheel zooms only that page', async ({ page }) => {
  await openCompare(page);
  const bar = page.locator('.compare-transform-bar.is-compare');
  await bar.locator('.compare-transform-toggle').click();
  const frame = page.locator('.document-pane-frame.is-compare-pane');
  await expect(frame).toHaveClass(/is-transform-active/);

  const box = await frame.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY + 25, { steps: 8 });
  await page.mouse.up();
  await expect(bar.getByRole('spinbutton', { name: 'Horizontal offset in pixels' })).toHaveValue('40.0');
  await expect(bar.getByRole('spinbutton', { name: 'Vertical offset in pixels' })).toHaveValue('25.0');

  // Ctrl+wheel over the fine-tuned page: +1 % per notch, base zoom (left page size) unchanged.
  const primaryStage = page.locator('.document-pane-frame.is-primary-pane .document-render-container');
  const primaryWidthBefore = await primaryStage.evaluate((node) => node.getBoundingClientRect().width);
  await page.mouse.move(startX, startY);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(bar.getByRole('spinbutton', { name: 'Page zoom in percent' })).toHaveValue('101.0');
  expect(await primaryStage.evaluate((node) => node.getBoundingClientRect().width)).toBe(primaryWidthBefore);

  // Collapsing the bar returns drag to normal scrolling.
  await bar.locator('.compare-transform-toggle').click();
  await expect(frame).not.toHaveClass(/is-transform-active/);
});

test('the 90 degree preset and the pane zoom preset write the same transform', async ({ page }) => {
  await openCompare(page);
  const bar = page.locator('.compare-transform-bar.is-compare');
  await bar.locator('.compare-transform-toggle').click();
  const zoom = bar.getByRole('spinbutton', { name: 'Page zoom in percent' });
  const frame = page.locator('.document-pane-frame.is-compare-pane');
  await frame.locator('.odv-pane-selector').hover();
  await frame.getByRole('button', { name: 'Increase pane zoom' }).click();
  await expect(zoom).toHaveValue('110.0');
  await expect(bar.locator('.compare-transform-summary')).toHaveText('110.0 % · 0.0°');

  // Ctrl+ArrowRight rotates the active (right) pane by a quarter turn: the canvas draws the 90°,
  // a fine step on top only adds a CSS residual, and the next quarter turn keeps that residual.
  const rotation = bar.getByRole('spinbutton', { name: 'Rotation in degrees' });
  await frame.locator('.odv-pane-selector').click();
  await expect(frame.locator('.odv-pane-selector')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+ArrowRight');
  await expect(rotation).toHaveValue('90.0');
  await expect(frame.locator('canvas')).toHaveCount(1);
  await bar.getByRole('button', { name: 'Rotate 0.1° clockwise (Shift: 1°)' }).click();
  await expect(rotation).toHaveValue('90.1');
  await expect.poll(() => stageTransform(page, 'compare')).toBe('scale(1.1) translate(0px, 0px) rotate(0.1deg)');
  await frame.locator('.odv-pane-selector').click();
  await page.keyboard.press('Control+ArrowRight');
  await expect(rotation).toHaveValue('-179.9');
});

test('frame times: panning and rotating a 300 dpi A4 raster through the stage CSS transform', async ({ page }, testInfo) => {
  await openCompare(page);
  const result = await page.evaluate(async () => {
    const stage = /** @type {HTMLElement} */ (document.querySelector('.document-pane-frame.is-compare-pane .document-render-container'));
    // 300 dpi A4 = 2480 × 3508 px, drawn once (as the viewer does) and never redrawn while moving.
    const canvas = document.createElement('canvas');
    canvas.width = 2480;
    canvas.height = 3508;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1f2937';
    ctx.font = '36px serif';
    for (let y = 120; y < canvas.height; y += 54) ctx.fillText('Lorem ipsum dolor sit amet, consectetur adipiscing elit — 300 dpi A4 '.repeat(2), 120, y);
    Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', transform: 'scale(0.25)', transformOrigin: 'top left' });
    stage.replaceChildren(canvas);
    Object.assign(stage.style, { width: '620px', height: '877px', transformOrigin: '310px 438.5px', willChange: 'transform' });

    const frames = 240;
    const deltas = [];
    await new Promise((resolve) => {
      let i = 0;
      let last = 0;
      const step = (now) => {
        if (last) deltas.push(now - last);
        last = now;
        if (i >= frames) { resolve(); return; }
        const dx = (i % 120) * 1.5;
        const rotation = ((i % 90) - 45) / 10;
        stage.style.transform = `scale(1.25) translate(${dx}px, ${dx / 2}px) rotate(${rotation}deg)`;
        i += 1;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const sorted = deltas.slice().sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      frames: deltas.length,
      medianMs: Math.round(pick(0.5) * 100) / 100,
      p95Ms: Math.round(pick(0.95) * 100) / 100,
      maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
      fps: Math.round(1000 / pick(0.5)),
    };
  });
  // eslint-disable-next-line no-console
  console.log(`[compare-transform perf] 300 dpi A4 (2480x3508) pan+rotate: ${JSON.stringify(result)}`);
  await testInfo.attach('compare-transform-perf.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.frames).toBe(240);
  // Interactive: median at least ~30 fps even on a loaded CI runner.
  expect(result.medianMs).toBeLessThan(34);
});
