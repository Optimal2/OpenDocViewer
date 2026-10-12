// File: tests/ui/compare-transform.spec.mjs
/**
 * Compare-view free transform (utils/compareTransform.js, docs-src/compare-transform.md): each
 * compared page gets one adjustment panel (only in compare mode) whose numeric fields, fine
 * buttons, 90° quick buttons, arrow-key pan control, page drag and Ctrl+wheel write one transform
 * per page, and whose image fields write the page's image adjustment. The renderer applies the
 * transform as a CSS transform on the page stage. The main toolbar's reset and the panel's full
 * reset are measured to end in the same state, and both compare.adjust.toolbarMode values are
 * covered. The last test measures frame times for panning and rotating a 300 dpi A4 raster with
 * that same CSS path and logs the numbers; keep it last.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/** The panel's numeric fields by accessible name (English). */
const PANEL_FIELDS = {
  zoom: 'Page zoom in percent',
  dx: 'Horizontal offset in pixels',
  dy: 'Vertical offset in pixels',
  rotation: 'Rotation in degrees',
  brightness: 'Brightness in percent (100 = unchanged)',
  contrast: 'Contrast in percent (100 = unchanged)',
  grayscale: 'Grayscale in percent (0 = in color)',
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ query?:string, siteConfig?:Object, showToRight?:RegExp }} [options] `query` and
 *   `siteConfig` go to loadSession; `showToRight` matches the context-menu entry in that language.
 */
async function openCompare(page, { query = '', siteConfig = null, showToRight = /show to right/i } = {}) {
  await loadSession(page, { query, siteConfig });
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  // Not in compare mode yet: no fine-tuning bar anywhere.
  await expect(page.locator('.compare-transform-bar')).toHaveCount(0);
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: showToRight }).click();
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

  // The layout part of the reset: zoom, position and rotation (the image adjustments are a separate part).
  await bar.getByRole('button', { name: 'Reset layout (zoom, position, rotation)' }).click();
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

test('the panel 90° quick button keeps the fine rotation: 4,6° + 90° reads 94,6 (Swedish)', async ({ page }) => {
  await openCompare(page, { query: 'lng=sv', showToRight: /visa till höger/i });
  const bar = page.locator('.compare-transform-bar.is-compare');
  await bar.locator('.compare-transform-toggle').click();
  const rotation = bar.getByRole('spinbutton', { name: 'Rotation i grader' });
  await rotation.fill('4,6');
  await rotation.press('Enter');
  await expect(rotation).toHaveValue('4,6');

  // The clockwise quick button sits right of the field and adds a quarter turn on top of the fine part.
  await bar.getByRole('button', { name: 'Rotera höger 90°' }).click();
  await expect(rotation).toHaveValue('94,6');
  await expect(bar.locator('.compare-transform-summary')).toHaveText('100,0 % · 94,6°');
  // The canvas draws the quarter turn; the CSS keeps only the 4.6° residual.
  await expect(page.locator('.document-pane-frame.is-compare-pane canvas')).toHaveCount(1);
  await expect.poll(() => stageTransform(page, 'compare')).toBe('scale(1) translate(0px, 0px) rotate(4.6deg)');

  // The counter-clockwise quick button takes it back to 4,6.
  await bar.getByRole('button', { name: 'Rotera vänster 90°' }).click();
  await expect(rotation).toHaveValue('4,6');
});

/**
 * Everything a user can observe of the right (compared) page's adjustment: the stage CSS
 * transform, which surface draws the page (canvas = an adjustment or quarter turn is active, plain
 * img = the neutral fast path), every numeric field of the panel, the invert checkbox, the summary,
 * the ◐ badge, the enabled state of the three resets, and the toolbar's mirrored state (value
 * chips, is-active). The left page (kept adjusted on purpose, panel expanded) is captured too, so
 * a reset that reaches the wrong page, or both pages, shows up as well.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Object>}
 */
async function captureCompareAdjustment(page) {
  const bar = page.locator('.compare-transform-bar.is-compare');
  const leftBar = page.locator('.compare-transform-bar.is-primary');
  const tools = page.locator('.toolbar .editing-tools');
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [key, name] of Object.entries(PANEL_FIELDS)) {
    fields[key] = await bar.getByRole('spinbutton', { name }).inputValue();
  }
  /** @param {import('@playwright/test').Locator} locator */
  const isActive = async (locator) => /\bis-active\b/.test(String(await locator.getAttribute('class')));
  return {
    stageTransform: await stageTransform(page, 'compare'),
    canvasCount: await page.locator('.document-pane-frame.is-compare-pane canvas').count(),
    fields,
    invert: await bar.getByRole('checkbox', { name: 'Invert colors' }).isChecked(),
    summary: await bar.locator('.compare-transform-summary').textContent(),
    badgeCount: await bar.locator('.compare-transform-badge').count(),
    resetsEnabled: {
      all: await bar.getByRole('button', { name: 'Reset all (layout and image)' }).isEnabled(),
      layout: await bar.getByRole('button', { name: 'Reset layout (zoom, position, rotation)' }).isEnabled(),
      image: await bar.getByRole('button', { name: 'Reset image (brightness, contrast, color)' }).isEnabled(),
    },
    toolbar: {
      brightnessActive: await isActive(tools.getByRole('button', { name: 'Adjust brightness' })),
      contrastActive: await isActive(tools.getByRole('button', { name: 'Adjust contrast' })),
      valueChips: await tools.locator('.toolbar-adjustment-value').count(),
      resetActive: await isActive(tools.locator('.toolbar-reset-adjustments')),
    },
    leftPage: {
      stageTransform: await stageTransform(page, 'primary'),
      canvasCount: await page.locator('.document-pane-frame.is-primary-pane canvas').count(),
      brightness: await leftBar.getByRole('spinbutton', { name: PANEL_FIELDS.brightness }).inputValue(),
    },
  };
}

/**
 * The capture once a reset has landed: polls until it differs from `before` and two consecutive
 * captures agree, so the equality assertions afterwards report the real end state of a divergence
 * instead of timing out on a guess about what it should look like.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} before The capture taken just before the reset.
 * @returns {Promise<Object>}
 */
async function captureAfterReset(page, before) {
  const beforeKey = JSON.stringify(before);
  let previous = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await captureCompareAdjustment(page));
    const settled = current === previous && current !== beforeKey;
    previous = current;
    return settled;
  }, { message: 'the reset changed the page and the state settled' }).toBe(true);
  return JSON.parse(previous);
}

/**
 * Builds the same non-trivial adjustment on the right page every time - zoom, pan, a fine rotation,
 * a 90° turn, brightness, contrast, grayscale and invert - and returns its capture.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Object>}
 */
async function buildCompareAdjustment(page) {
  const bar = page.locator('.compare-transform-bar.is-compare');
  /** @param {keyof typeof PANEL_FIELDS} key @param {string} value */
  const commit = async (key, value) => {
    const input = bar.getByRole('spinbutton', { name: PANEL_FIELDS[key] });
    await input.fill(value);
    await input.press('Enter');
  };
  await commit('zoom', '103.5');
  await commit('dx', '12');
  await commit('dy', '-7');
  await commit('rotation', '2.3');
  await bar.getByRole('button', { name: 'Rotate right 90°' }).click();
  await commit('brightness', '130');
  await commit('contrast', '80');
  await commit('grayscale', '40');
  await bar.getByRole('checkbox', { name: 'Invert colors' }).check();
  await expect(bar.getByRole('spinbutton', { name: PANEL_FIELDS.rotation })).toHaveValue('92.3');
  await expect(bar.getByRole('spinbutton', { name: PANEL_FIELDS.grayscale })).toHaveValue('40');
  await expect(page.locator('.document-pane-frame.is-compare-pane canvas')).toHaveCount(1);
  return captureCompareAdjustment(page);
}

test('the toolbar reset and the panel full reset reach the same end state (both measured)', async ({ page }) => {
  await openCompare(page);
  const bar = page.locator('.compare-transform-bar.is-compare');
  await bar.locator('.compare-transform-toggle').click();
  // "Show to right" makes the right page the active pane, so the toolbar edits that page.
  await expect(page.locator('.toolbar .editing-tools')).toHaveClass(/editing-target-compare/);

  // The left page stays adjusted throughout; neither reset may touch it.
  const leftBar = page.locator('.compare-transform-bar.is-primary');
  await leftBar.locator('.compare-transform-toggle').click();
  await leftBar.getByRole('spinbutton', { name: PANEL_FIELDS.zoom }).fill('98');
  await leftBar.getByRole('spinbutton', { name: PANEL_FIELDS.zoom }).press('Enter');
  await leftBar.getByRole('spinbutton', { name: PANEL_FIELDS.brightness }).fill('115');
  await leftBar.getByRole('spinbutton', { name: PANEL_FIELDS.brightness }).press('Enter');
  await expect(page.locator('.document-pane-frame.is-primary-pane canvas')).toHaveCount(1);

  const startViaToolbar = await buildCompareAdjustment(page);
  await page.locator('.toolbar .toolbar-reset-adjustments').click();
  const afterToolbar = await captureAfterReset(page, startViaToolbar);

  const startViaPanel = await buildCompareAdjustment(page);
  await bar.getByRole('button', { name: 'Reset all (layout and image)' }).click();
  const afterPanel = await captureAfterReset(page, startViaPanel);

  const leftPage = { stageTransform: 'scale(0.98) translate(0px, 0px) rotate(0deg)', canvasCount: 1, brightness: '115' };

  // Both runs started from the same, really adjusted state, so the equality below means something.
  expect(startViaPanel).toEqual(startViaToolbar);
  expect(startViaToolbar).toEqual({
    stageTransform: 'scale(1.035) translate(12px, -7px) rotate(2.3deg)',
    canvasCount: 1,
    fields: { zoom: '103.5', dx: '12.0', dy: '-7.0', rotation: '92.3', brightness: '130', contrast: '80', grayscale: '40' },
    invert: true,
    summary: '103.5 % · 92.3°',
    badgeCount: 1,
    resetsEnabled: { all: true, layout: true, image: true },
    toolbar: { brightnessActive: true, contrastActive: true, valueChips: 2, resetActive: true },
    leftPage,
  });

  // The claim: the toolbar reset and the panel's full reset end in the same observable state ...
  expect(afterToolbar).toEqual(afterPanel);
  // ... and that state is the neutral page on the plain <img> fast path.
  expect(afterPanel).toEqual({
    stageTransform: '',
    canvasCount: 0,
    fields: { zoom: '100.0', dx: '0.0', dy: '0.0', rotation: '0.0', brightness: '100', contrast: '100', grayscale: '0' },
    invert: false,
    summary: '100.0 % · 0.0°',
    badgeCount: 0,
    resetsEnabled: { all: false, layout: false, image: false },
    toolbar: { brightnessActive: false, contrastActive: false, valueChips: 0, resetActive: false },
    leftPage,
  });
});

test("toolbarMode 'mirror' (default): the toolbar keeps its controls and shows the panel's values", async ({ page }) => {
  await openCompare(page);
  const bar = page.locator('.compare-transform-bar.is-compare');
  await bar.locator('.compare-transform-toggle').click();
  const tools = page.locator('.toolbar .editing-tools');
  const brightnessButton = tools.getByRole('button', { name: 'Adjust brightness' });
  const resetButton = tools.locator('.toolbar-reset-adjustments');
  // Panel expanded, controls still there.
  await expect(brightnessButton).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Adjust contrast' })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Rotate right 90°' })).toBeVisible();
  await expect(resetButton).toBeVisible();
  await expect(resetButton).not.toHaveClass(/is-active/);

  const brightness = bar.getByRole('spinbutton', { name: PANEL_FIELDS.brightness });
  await brightness.fill('135');
  await brightness.press('Enter');
  await expect(brightnessButton).toHaveClass(/is-active/);
  await expect(brightnessButton.locator('.toolbar-adjustment-value')).toHaveText('135');
  await expect(brightnessButton).toHaveAttribute('title', 'Adjust brightness (135 %)');
  await expect(resetButton).toHaveClass(/is-active/);

  // Grayscale has no toolbar control of its own, yet the toolbar reset is marked for it too.
  await brightness.fill('100');
  await brightness.press('Enter');
  await expect(resetButton).not.toHaveClass(/is-active/);
  const grayscale = bar.getByRole('spinbutton', { name: PANEL_FIELDS.grayscale });
  await grayscale.fill('50');
  await grayscale.press('Enter');
  await expect(resetButton).toHaveClass(/is-active/);
});

test("toolbarMode 'hide': the toolbar controls give way while any panel is expanded", async ({ page }) => {
  await openCompare(page, { siteConfig: { compare: { adjust: { toolbarMode: 'hide' } } } });
  const tools = page.locator('.toolbar .editing-tools');
  const coarse = [
    tools.getByRole('button', { name: 'Rotate left 90°' }),
    tools.getByRole('button', { name: 'Rotate right 90°' }),
    tools.getByRole('button', { name: 'Adjust brightness' }),
    tools.getByRole('button', { name: 'Adjust contrast' }),
    tools.locator('.toolbar-reset-adjustments'),
  ];
  /** @param {number} count */
  const expectCoarse = async (count) => {
    for (const control of coarse) await expect(control).toHaveCount(count);
  };
  // Every panel collapsed: the controls are there.
  await expectCoarse(1);

  const primaryToggle = page.locator('.compare-transform-bar.is-primary .compare-transform-toggle');
  const compareToggle = page.locator('.compare-transform-bar.is-compare .compare-transform-toggle');
  await compareToggle.click();
  await expectCoarse(0);
  await primaryToggle.click();
  await expectCoarse(0);
  // One panel still expanded: still hidden.
  await compareToggle.click();
  await expectCoarse(0);
  // Every panel collapsed again: back.
  await primaryToggle.click();
  await expectCoarse(1);

  // Outside compare mode the key has no effect.
  await primaryToggle.click();
  await expectCoarse(0);
  await page.locator('.compare-button').click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toHaveCount(0);
  await expectCoarse(1);
});

test('dragging an adjusted page moves the stage without redrawing either page canvas', async ({ page }) => {
  // Count every drawImage onto a page canvas. The draw effect in DocumentRender.jsx depends on
  // its callback props, so a fresh function passed on every viewer render redraws the canvas on
  // each drag step; the drag only changes the stage CSS transform and must draw nothing.
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    window.__odvPageDraws = 0;
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(...args) {
      if (this.canvas?.closest?.('.document-pane-frame')) window.__odvPageDraws += 1;
      return original.apply(this, args);
    };
  });
  await openCompare(page);
  // Both pages adjusted, so both are drawn on a canvas.
  for (const pane of ['primary', 'compare']) {
    const paneBar = page.locator(`.compare-transform-bar.is-${pane}`);
    await paneBar.locator('.compare-transform-toggle').click();
    const brightness = paneBar.getByRole('spinbutton', { name: PANEL_FIELDS.brightness });
    await brightness.fill('120');
    await brightness.press('Enter');
    await expect(page.locator(`.document-pane-frame.is-${pane}-pane canvas`).first()).toBeVisible();
  }
  await page.waitForTimeout(500);

  const bar = page.locator('.compare-transform-bar.is-compare');
  const box = await page.locator('.document-pane-frame.is-compare-pane').boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.evaluate(() => { window.__odvPageDraws = 0; });
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY + 25, { steps: 8 });
  await page.mouse.up();
  await expect(bar.getByRole('spinbutton', { name: PANEL_FIELDS.dx })).toHaveValue('40.0');
  // Read right after the drag has committed (two frames), so no unrelated later redraw can land in the count.
  const draws = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__odvPageDraws)));
  }));
  // eslint-disable-next-line no-console
  console.log(`[compare-transform redraws] 8-step drag of an adjusted page, page-canvas draws: ${draws}`);
  expect(draws).toBe(0);
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
