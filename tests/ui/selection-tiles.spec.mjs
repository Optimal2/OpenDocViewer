// File: tests/ui/selection-tiles.spec.mjs
/**
 * Page tiles in the print selection workspace (src/components/PrintSelectionWorkspace.jsx).
 * A tile is a button. Its "Show page" button is the tile's sibling inside a frame and not its
 * child, because a button must not contain another control (WCAG 4.1.2).
 * - No tile contains a focusable control, and every tile is followed by its Show page button.
 * - The Show page button sits in the top right corner of the tile's image, with the inset the
 *   stylesheet gives it, at the smallest, the default and the largest tile size.
 * - It shows while the pointer is over the tile or over the button itself, and the tile keeps
 *   its hover colours while the pointer is over the button.
 * - A selected tile keeps its selected colours under the pointer: hover does not win over them.
 * - A page that is already included is dimmed in one layer with its Show page button.
 * - Tab goes from a tile to its Show page button.
 * - A click, Enter and Space on it open the page preview and leave the selection alone.
 * - A tile is dragged from "Available pages" into the selection, also when the drag starts on
 *   its Show page button.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const LEFT_TILE = '.print-selection-panel-left .print-selection-tile';
const RIGHT_TILE = '.print-selection-panel-right .print-selection-tile';
const RIGHT_SHOW = '.print-selection-panel-right .print-selection-tile-preview';
const LEFT_SHOW = '.print-selection-panel-left .print-selection-tile-preview';
const LIGHTBOX = '.print-selection-lightbox';

/** @param {import('@playwright/test').Page} page */
async function openWorkspace(page) {
  // An empty site config keeps a developer's own public/odv.site.config.js out of the test.
  await loadSession(page, { siteConfig: {} });
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await page.getByRole('button', { name: /selection manag/i }).click();
  await expect(page.locator(RIGHT_TILE).first()).toBeVisible();
  await expect(page.locator(RIGHT_TILE)).toHaveCount(4);
}

/**
 * The pressed state of every tile in the selection, in order.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<string>>}
 */
function pressedStates(page) {
  return page.locator(RIGHT_TILE).evaluateAll((tiles) => tiles.map((tile) => String(tile.getAttribute('aria-pressed'))));
}

/**
 * Drag with the mouse from a point to the middle of a target, the way a user does.
 * @param {import('@playwright/test').Page} page
 * @param {{ x:number, y:number }} from
 * @param {import('@playwright/test').Locator} target
 */
async function dragFromPoint(page, from, target) {
  const box = await target.boundingBox();
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x + 3, to.y + 3, { steps: 3 });
  await page.mouse.up();
}

/**
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{ x:number, y:number }>}
 */
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('print selection workspace tiles', () => {
  test('a tile contains no other control, and its Show page button follows it', async ({ page }) => {
    await openWorkspace(page);
    const report = await page.evaluate(() => Array.from(document.querySelectorAll('.print-selection-tile')).map((tile) => {
      const next = tile.nextElementSibling;
      return {
        role: tile.getAttribute('role'),
        inner: tile.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"]').length,
        frame: tile.parentElement.classList.contains('print-selection-tile-frame'),
        nextIsShowPage: !!next && next.matches('button.print-selection-tile-preview'),
        nextName: next ? next.getAttribute('aria-label') : null,
      };
    }));
    expect(report).toHaveLength(8);
    for (const tile of report) {
      expect(tile).toEqual({ role: 'button', inner: 0, frame: true, nextIsShowPage: true, nextName: 'Show page' });
    }
  });

  test('the Show page button sits in the top right corner of the image at every tile size', async ({ page }) => {
    await openWorkspace(page);
    const slider = page.locator('.print-selection-thumbnail-slider-inline input[type="range"]');
    const measure = () => page.evaluate(() => Array.from(document.querySelectorAll('.print-selection-tile')).map((tile) => {
      const stage = tile.querySelector('.print-selection-tile-stage').getBoundingClientRect();
      const show = tile.nextElementSibling.getBoundingClientRect();
      const frame = tile.parentElement.getBoundingClientRect();
      const box = tile.getBoundingClientRect();
      return {
        stageWidth: stage.width,
        insetTop: show.top - stage.top,
        insetRight: stage.right - show.right,
        showWidth: show.width,
        showHeight: show.height,
        frameMatchesTile: Math.abs(frame.left - box.left) + Math.abs(frame.top - box.top) + Math.abs(frame.width - box.width) + Math.abs(frame.height - box.height),
      };
    }));
    const sizes = [];
    for (const key of [null, 'Home', 'End']) {
      if (key) {
        await slider.focus();
        await page.keyboard.press(key);
      }
      await expect.poll(async () => (await measure()).length).toBe(8);
      const tiles = await measure();
      sizes.push(tiles[0].stageWidth);
      for (const tile of tiles) {
        // layout.css: inset clamp(2px, size / 22, 4px), button side clamp(18px, size / 3.85, 26px).
        const inset = Math.min(4, Math.max(2, tile.stageWidth / 22));
        const side = Math.min(26, Math.max(18, tile.stageWidth / 3.85));
        expect(tile.insetTop).toBeCloseTo(inset, 1);
        expect(tile.insetRight).toBeCloseTo(inset, 1);
        expect(tile.showWidth).toBeCloseTo(side, 1);
        expect(tile.showHeight).toBeCloseTo(side, 1);
        expect(tile.frameMatchesTile).toBeLessThan(0.1);
      }
    }
    // Three different sizes were measured: default, smallest, largest.
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[2]).toBeGreaterThan(sizes[0]);
  });

  test('the Show page button shows over the tile and over itself, and the tile keeps its hover colours', async ({ page }) => {
    await openWorkspace(page);
    const tile = page.locator(RIGHT_TILE).nth(1);
    const show = page.locator(RIGHT_SHOW).nth(1);
    const opacity = () => show.evaluate((node) => getComputedStyle(node).opacity);
    const tileBackground = () => tile.evaluate((node) => getComputedStyle(node).backgroundColor);

    await page.mouse.move(700, 4);
    await expect.poll(opacity).toBe('0');
    const restBackground = await tileBackground();

    await tile.hover();
    await expect.poll(opacity).toBe('1');
    const hoverBackground = await tileBackground();
    expect(hoverBackground).not.toBe(restBackground);

    const point = await centerOf(show);
    await page.mouse.move(point.x, point.y);
    await expect.poll(opacity).toBe('1');
    expect(await tileBackground()).toBe(hoverBackground);
  });

  test('a selected tile keeps its selected colours under the pointer', async ({ page }) => {
    await openWorkspace(page);
    const tile = page.locator(RIGHT_TILE).nth(1);
    const show = page.locator(RIGHT_SHOW).nth(1);
    const colours = () => tile.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.backgroundColor} | ${style.borderTopColor}`;
    });

    await page.mouse.move(700, 4);
    const unselected = await colours();
    await tile.hover();
    const hovered = await colours();
    expect(hovered).not.toBe(unselected);

    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(700, 4);
    await expect.poll(colours).not.toBe(unselected);
    const selected = await colours();
    // Selected is its own look, not the hover look: otherwise this test could not tell them apart.
    expect(selected).not.toBe(hovered);

    await tile.hover();
    expect(await colours()).toBe(selected);
    const point = await centerOf(show);
    await page.mouse.move(point.x, point.y);
    expect(await colours()).toBe(selected);
  });

  test('a page that is already included is dimmed in one layer with its Show page button', async ({ page }) => {
    await openWorkspace(page);
    const measure = (index) => page.locator(LEFT_TILE).nth(index).evaluate((tile) => {
      const frame = tile.parentElement;
      const show = tile.nextElementSibling;
      return {
        disabled: tile.getAttribute('aria-disabled'),
        frameOpacity: getComputedStyle(frame).opacity,
        tileOpacity: getComputedStyle(tile).opacity,
        showInFrame: show.parentElement === frame,
      };
    });
    // Every page is in the selection at the start, so every tile under "Available pages" is dimmed.
    // The dimming sits on the frame, which holds both the tile and the button.
    expect(await measure(0)).toEqual({ disabled: 'true', frameOpacity: '0.72', tileOpacity: '1', showInFrame: true });

    await page.locator(RIGHT_TILE).nth(0).dblclick();
    await expect(page.locator(LEFT_TILE).nth(0)).toHaveAttribute('aria-disabled', 'false');
    expect(await measure(0)).toEqual({ disabled: 'false', frameOpacity: '1', tileOpacity: '1', showInFrame: true });
  });

  test('Tab goes from a tile to its Show page button, and the button shows when the tile has keyboard focus', async ({ page }) => {
    await openWorkspace(page);
    const tile = page.locator(RIGHT_TILE).nth(0);
    const show = page.locator(RIGHT_SHOW).nth(0);
    await page.keyboard.press('Shift');
    await tile.focus();
    await expect.poll(() => show.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    await page.keyboard.press('Tab');
    await expect(show).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(RIGHT_TILE).nth(1)).toBeFocused();
  });

  for (const key of ['Enter', 'Space']) {
    test(`${key} on the Show page button opens the preview and leaves the selection alone`, async ({ page }) => {
      await openWorkspace(page);
      await page.locator(RIGHT_TILE).nth(2).click();
      const before = await pressedStates(page);
      expect(before).toEqual(['false', 'false', 'true', 'false']);

      await page.locator(RIGHT_SHOW).nth(0).focus();
      await page.keyboard.press(key);
      await expect(page.locator(LIGHTBOX)).toBeVisible();
      expect(await pressedStates(page)).toEqual(before);
    });
  }

  test('a click on the Show page button opens the preview and leaves the selection alone', async ({ page }) => {
    await openWorkspace(page);
    await page.locator(RIGHT_TILE).nth(2).click();
    const before = await pressedStates(page);

    const point = await centerOf(page.locator(RIGHT_SHOW).nth(0));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    expect(await pressedStates(page)).toEqual(before);
    await page.mouse.up();
    await expect(page.locator(LIGHTBOX)).toBeVisible();
    expect(await pressedStates(page)).toEqual(before);
  });

  for (const grip of ['tile', 'Show page button']) {
    test(`a page is dragged into the selection by its ${grip}`, async ({ page }) => {
      await openWorkspace(page);
      // Take page 1 out of the selection, so its tile under "Available pages" can be dragged.
      await page.locator(RIGHT_TILE).nth(0).dblclick();
      await expect(page.locator(RIGHT_TILE)).toHaveCount(3);
      await expect(page.locator(LEFT_TILE).nth(0)).toHaveAttribute('aria-disabled', 'false');

      const source = grip === 'tile' ? page.locator(LEFT_TILE).nth(0) : page.locator(LEFT_SHOW).nth(0);
      await dragFromPoint(page, await centerOf(source), page.locator(RIGHT_TILE).nth(0));
      await expect(page.locator(RIGHT_TILE)).toHaveCount(4);
      await expect(page.locator(LIGHTBOX)).toHaveCount(0);
    });
  }
});
