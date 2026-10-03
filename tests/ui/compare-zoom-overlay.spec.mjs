// File: tests/ui/compare-zoom-overlay.spec.mjs
/**
 * Compare-mode per-pane zoom controls (CompareZoomOverlay) are anchored to the top-right of each
 * pane, clear of the page viewport's scrollbar, the pane selector (L/R marker) and the
 * page-turn edge indicator.
 */
import { test, expect } from '@playwright/test';
import { loadSession, intersects } from './fixtureSession.mjs';

test('per-pane zoom controls sit top-right in both compare panes and cover no other control', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();

  for (const paneClass of ['is-primary-pane', 'is-compare-pane']) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    const overlay = frame.locator('.compare-zoom-overlay');
    await expect(overlay).toBeVisible();
    const geometry = await frame.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const viewport = node.querySelector('.document-render-viewport');
      const overlayNode = node.querySelector('.compare-zoom-overlay');
      // A page-turn indicator as the viewer renders it while the user scrolls past the top edge.
      const indicator = document.createElement('div');
      indicator.className = 'odv-edge-scroll-page-turn is-previous';
      indicator.innerHTML = '<div class="odv-edge-scroll-page-turn-track"><div class="odv-edge-scroll-page-turn-fill"></div></div>';
      node.appendChild(indicator);
      const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const result = {
        contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        contentTop: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        paneCentre: box.left + box.width / 2,
        scrollbar: viewport ? viewport.offsetWidth - viewport.clientWidth : 0,
        overlay: rect(overlayNode),
        transform: getComputedStyle(overlayNode).transform,
        selector: rect(node.querySelector('.odv-pane-selector')),
        indicator: rect(indicator),
      };
      indicator.remove();
      return result;
    });
    // Anchored top-right (8px from the page viewport's right edge, past its scrollbar), no centring transform.
    expect(geometry.transform).toBe('none');
    expect(Math.abs((geometry.overlay.x + geometry.overlay.width) - (geometry.contentRight - 8 - geometry.scrollbar))).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.overlay.y - (geometry.contentTop + 8))).toBeLessThanOrEqual(1);
    expect(geometry.overlay.x).toBeGreaterThan(geometry.paneCentre);
    // Never over the L/R pane selector or the page-turn edge indicator.
    expect(intersects(geometry.overlay, geometry.selector)).toBe(false);
    expect(intersects(geometry.overlay, geometry.indicator)).toBe(false);
  }

  // The controls still work.
  const factor = page.locator('.document-pane-frame.is-compare-pane .compare-zoom-overlay .factor');
  const before = await factor.textContent();
  await page.locator('.document-pane-frame.is-compare-pane .compare-zoom-overlay button').nth(1).click();
  await expect(factor).not.toHaveText(String(before));
});

test('per-pane zoom controls stay inside very narrow panes (700px viewport, wide thumbnail pane)', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();

  // Narrow the window, then widen the thumbnail pane so each compare pane is narrower than the
  // zoom controls' natural width.
  await page.setViewportSize({ width: 700, height: 700 });
  const resizer = await page.locator('.resizer').first().boundingBox();
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizer.x + 300, resizer.y + resizer.height / 2, { steps: 10 });
  await page.mouse.up();

  for (const paneClass of ['is-primary-pane', 'is-compare-pane']) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    await expect(frame.locator('.compare-zoom-overlay')).toBeVisible();
    const geometry = await frame.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const overlay = node.querySelector('.compare-zoom-overlay').getBoundingClientRect();
      return {
        paneWidth: box.width,
        paneLeft: box.left + parseFloat(style.borderLeftWidth),
        paneRight: box.right - parseFloat(style.borderRightWidth),
        overlayLeft: overlay.left,
        overlayRight: overlay.right,
      };
    });
    expect(geometry.paneWidth).toBeLessThan(120);
    // The overlay's own box never reaches past its pane into the neighbouring pane.
    expect(geometry.overlayLeft).toBeGreaterThanOrEqual(geometry.paneLeft - 0.5);
    expect(geometry.overlayRight).toBeLessThanOrEqual(geometry.paneRight + 0.5);
  }
});
