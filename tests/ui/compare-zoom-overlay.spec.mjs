// File: tests/ui/compare-zoom-overlay.spec.mjs
/**
 * Compare-mode per-pane zoom controls (CompareZoomOverlay) are tucked behind the pane marker ring at
 * the top-left of each pane. At rest only the semi-transparent ring (and a faded tail) shows and the
 * zoom controls are hidden; hover, keyboard focus or a tap expands the zone downwards into a
 * vertical control (zoom in, factor, zoom out), which collapses again when the pointer and focus
 * have left, or at once on Escape. The zone stays inside even a very narrow pane, clear of the
 * page-turn edge indicator, and does not take clicks outside its own box.
 */
import { test, expect } from '@playwright/test';
import { loadSession, intersects } from './fixtureSession.mjs';

const PANES = ['is-primary-pane', 'is-compare-pane'];

/** @param {import('@playwright/test').Page} page */
async function openCompare(page) {
  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await page.locator('#thumbnail-2').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  await expect(page.locator('.document-pane-frame.is-compare-pane')).toBeVisible();
}

/** @param {import('@playwright/test').Locator} frame */
function measureZone(frame) {
  return frame.evaluate((node) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const zone = node.querySelector('.compare-zoom-zone');
    const ring = zone.querySelector('.odv-pane-selector');
    const overlay = zone.querySelector('.compare-zoom-overlay');
    const controls = Array.from(overlay.querySelectorAll('button, .factor'));
    return {
      pane: {
        left: box.left + parseFloat(style.borderLeftWidth),
        right: box.right - parseFloat(style.borderRightWidth),
        top: box.top + parseFloat(style.borderTopWidth),
        bottom: box.bottom - parseFloat(style.borderBottomWidth),
        centre: box.left + box.width / 2,
        width: box.width,
      },
      zone: rect(zone),
      ring: rect(ring),
      ringOpacity: Number(getComputedStyle(ring).opacity),
      ringColor: getComputedStyle(ring).color,
      tail: rect(zone.querySelector('.compare-zoom-tail')),
      overlay: rect(overlay),
      overlayOpacity: Number(getComputedStyle(overlay).opacity),
      overlayVisibility: getComputedStyle(overlay).visibility,
      overlayTransition: getComputedStyle(overlay).transitionDuration,
      controls: controls.map((control) => ({ label: control.getAttribute('aria-label'), ...rect(control), opacity: Number(getComputedStyle(control).opacity) })),
      expanded: zone.classList.contains('is-expanded'),
    };
  });
}

/**
 * The topmost element at a point, and whether it belongs to the pane's compare zone.
 * @param {import('@playwright/test').Page} page
 */
function hitsZone(page, x, y) {
  return page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.compare-zoom-zone'), [x, y]);
}

test('at rest each pane shows only its semi-transparent ring at the top-left; the zoom controls are hidden', async ({ page }) => {
  await openCompare(page);
  const colours = [];
  for (const paneClass of PANES) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    await expect(frame.locator('.compare-zoom-zone')).toBeVisible();
    const m = await measureZone(frame);
    // Top-left of the pane, left of its centre.
    expect(m.zone.x - m.pane.left).toBeGreaterThanOrEqual(0);
    expect(m.zone.x - m.pane.left).toBeLessThanOrEqual(20);
    expect(m.zone.y - m.pane.top).toBeLessThanOrEqual(20);
    expect(m.zone.right).toBeLessThan(m.pane.centre);
    // Only the ring: semi-transparent, the zone's box is the ring, the controls are hidden.
    expect(m.expanded).toBe(false);
    expect(m.ringOpacity).toBeLessThan(1);
    expect(Math.round(m.zone.height)).toBe(Math.round(m.ring.height));
    expect(m.overlayVisibility).toBe('hidden');
    await expect(frame.locator('.compare-zoom-overlay')).toBeHidden();
    await expect(frame.getByRole('button', { name: 'Increase pane zoom' })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Decrease pane zoom' })).toHaveCount(0);
    // The hint: a tail showing below the ring, which takes no clicks.
    expect(m.tail.bottom).toBeGreaterThan(m.ring.bottom + 10);
    expect(await hitsZone(page, m.ring.x + m.ring.width / 2, m.ring.bottom + 8)).toBe(false);
    colours.push(m.ringColor);
  }
  // The ring keeps its pane colour: blue left, orange right.
  expect(colours[0]).not.toBe(colours[1]);
});

test('hover expands a vertical control (zoom in, factor, zoom out), fully opaque, that collapses on leave', async ({ page }) => {
  await openCompare(page);
  for (const paneClass of PANES) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    const ring = frame.locator('.odv-pane-selector');
    await ring.hover();
    await expect(frame.locator('.compare-zoom-zone')).toHaveClass(/is-expanded/);
    await expect(frame.getByRole('button', { name: 'Increase pane zoom' })).toBeVisible();
    await expect.poll(async () => (await measureZone(frame)).overlayOpacity).toBe(1);

    const m = await measureZone(frame);
    expect(m.ringOpacity).toBe(1);
    expect(m.controls.map((control) => control.label)).toEqual([
      'Increase pane zoom', expect.stringMatching(/^Pane zoom factor ×\d+\.\d$/), 'Decrease pane zoom',
    ]);
    // Stacked top to bottom below the ring, on one vertical axis, each fully opaque.
    const [zoomIn, factor, zoomOut] = m.controls;
    expect(zoomIn.y).toBeGreaterThanOrEqual(m.ring.bottom - 1);
    expect(factor.y).toBeGreaterThan(zoomIn.bottom - 1);
    expect(zoomOut.y).toBeGreaterThan(factor.bottom - 1);
    for (const control of m.controls) {
      expect(control.opacity, control.label).toBe(1);
      expect(Math.abs((control.x + control.width / 2) - (m.ring.x + m.ring.width / 2))).toBeLessThanOrEqual(1);
    }
    // The zone covers its expanded box only: the page beside and below it still takes the clicks.
    expect(m.overlay.bottom).toBeGreaterThanOrEqual(zoomOut.bottom);
    expect(m.overlay.y).toBeLessThanOrEqual(m.ring.y + 1.5); // the hovered ring lifts by 1px
    expect(await hitsZone(page, m.overlay.right + 6, zoomIn.y + zoomIn.height / 2)).toBe(false);
    expect(await hitsZone(page, m.ring.x + m.ring.width / 2, m.overlay.bottom + 6)).toBe(false);

    // Moving from the ring into the controls keeps it open; the controls work.
    const factorNode = frame.locator('.compare-zoom-overlay .factor');
    const before = await factorNode.textContent();
    await frame.getByRole('button', { name: 'Increase pane zoom' }).click();
    await expect(factorNode).not.toHaveText(String(before));
    await expect(frame.locator('.compare-zoom-zone')).toHaveClass(/is-expanded/);

    // Leaving collapses it again (after a short delay), even though the ring was clicked before.
    const box = await frame.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await expect(frame.locator('.compare-zoom-zone')).not.toHaveClass(/is-expanded/);
    await expect(frame.locator('.compare-zoom-overlay')).toBeHidden();
  }

  // A click on the ring itself still selects the pane, and leaving afterwards collapses.
  const compareFrame = page.locator('.document-pane-frame.is-compare-pane');
  await compareFrame.locator('.odv-pane-selector').click();
  await expect(compareFrame.locator('.odv-pane-selector')).toHaveAttribute('aria-pressed', 'true');
  const compareBox = await compareFrame.boundingBox();
  await page.mouse.move(compareBox.x + compareBox.width / 2, compareBox.y + compareBox.height / 2, { steps: 4 });
  await expect(compareFrame.locator('.compare-zoom-zone')).not.toHaveClass(/is-expanded/);
});

test('keyboard: the ring expands the zone, Tab reaches zoom in, factor, zoom out, Escape collapses', async ({ page }) => {
  await openCompare(page);
  const frame = page.locator('.document-pane-frame.is-compare-pane');
  const zone = frame.locator('.compare-zoom-zone');
  const ring = frame.locator('.odv-pane-selector');

  // Keyboard focus on the ring (a key press first, so the focus is keyboard focus).
  await page.mouse.move(5, 5);
  await page.keyboard.press('Shift');
  await ring.focus();
  await expect(zone).toHaveClass(/is-expanded/);

  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Increase pane zoom' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.locator('.compare-zoom-overlay .factor')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Decrease pane zoom' })).toBeFocused();

  // Enter on zoom out changes the factor and keeps the zone open.
  const factorNode = frame.locator('.compare-zoom-overlay .factor');
  const before = await factorNode.textContent();
  await page.keyboard.press('Enter');
  await expect(factorNode).not.toHaveText(String(before));
  await expect(zone).toHaveClass(/is-expanded/);

  // Escape collapses at once and returns focus to the ring; the zone stays closed there.
  await page.keyboard.press('Escape');
  await expect(zone).not.toHaveClass(/is-expanded/);
  await expect(ring).toBeFocused();
  await expect(frame.locator('.compare-zoom-overlay')).toBeHidden();

  // Focus moving out of the zone collapses it too.
  await page.keyboard.press('Shift+Tab');
  await ring.focus();
  await expect(zone).toHaveClass(/is-expanded/);
  await page.keyboard.press('Shift+Tab');
  await expect(zone).not.toHaveClass(/is-expanded/);
});

test('reduced motion: the zone expands and collapses without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCompare(page);
  const frame = page.locator('.document-pane-frame.is-primary-pane');
  expect((await measureZone(frame)).overlayTransition).toMatch(/^0s(, 0s)*$/);
  await frame.locator('.odv-pane-selector').hover();
  await expect(frame.locator('.compare-zoom-zone')).toHaveClass(/is-expanded/);
  const m = await measureZone(frame);
  expect(m.overlayTransition).toMatch(/^0s(, 0s)*$/);
  expect(m.overlayOpacity).toBe(1);
});

test('the expanded zone stays clear of the page-turn edge indicator', async ({ page }) => {
  await openCompare(page);
  for (const paneClass of PANES) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    await frame.locator('.odv-pane-selector').hover();
    await expect(frame.locator('.compare-zoom-zone')).toHaveClass(/is-expanded/);
    const geometry = await frame.evaluate((node) => {
      // A page-turn indicator as the viewer renders it while the user scrolls past the top edge.
      const indicator = document.createElement('div');
      indicator.className = 'odv-edge-scroll-page-turn is-previous';
      indicator.innerHTML = '<div class="odv-edge-scroll-page-turn-track"><div class="odv-edge-scroll-page-turn-fill"></div></div>';
      node.appendChild(indicator);
      const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const result = {
        zone: rect(node.querySelector('.compare-zoom-zone')),
        overlay: rect(node.querySelector('.compare-zoom-overlay')),
        indicator: rect(indicator),
      };
      indicator.remove();
      return result;
    });
    expect(geometry.indicator.width).toBeGreaterThan(0);
    expect(intersects(geometry.zone, geometry.indicator)).toBe(false);
    expect(intersects(geometry.overlay, geometry.indicator)).toBe(false);
  }
});

test('the zone stays inside very narrow panes (700px viewport, wide thumbnail pane), collapsed and expanded', async ({ page }) => {
  await openCompare(page);

  // Narrow the window, then widen the thumbnail pane so each compare pane is very narrow.
  await page.setViewportSize({ width: 700, height: 700 });
  const resizer = await page.locator('.resizer').first().boundingBox();
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizer.x + 300, resizer.y + resizer.height / 2, { steps: 10 });
  await page.mouse.up();

  for (const paneClass of PANES) {
    const frame = page.locator(`.document-pane-frame.${paneClass}`);
    await expect(frame.locator('.compare-zoom-zone')).toBeVisible();
    const inside = (m) => {
      expect(m.pane.width).toBeLessThan(120);
      for (const box of [m.zone, m.ring, m.tail]) {
        expect(box.x).toBeGreaterThanOrEqual(m.pane.left - 0.5);
        expect(box.right).toBeLessThanOrEqual(m.pane.right + 0.5);
      }
    };
    inside(await measureZone(frame));

    await frame.locator('.odv-pane-selector').hover();
    await expect(frame.locator('.compare-zoom-zone')).toHaveClass(/is-expanded/);
    const expanded = await measureZone(frame);
    inside(expanded);
    // The expanded box never reaches past its pane, also downwards.
    expect(expanded.overlay.x).toBeGreaterThanOrEqual(expanded.pane.left - 0.5);
    expect(expanded.overlay.right).toBeLessThanOrEqual(expanded.pane.right + 0.5);
    expect(expanded.overlay.bottom).toBeLessThanOrEqual(expanded.pane.bottom + 0.5);
    await page.mouse.move(5, 5);
  }
});
