// File: tests/ui/toolbar-density.spec.mjs
/**
 * Toolbar density and grouping (src/styles/toolbar.css): 40px toolbar, 30px buttons with 18px
 * icons, 4px between controls inside a group, 12px between groups, the signature overview button
 * on the same metrics, and theme/language/help as one tight end group. Keyboard focus rings stay.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/** @param {import('@playwright/test').Page} page */
function measureToolbar(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar');
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const buttons = Array.from(toolbar.querySelectorAll('button'))
      .filter((button) => button.offsetParent !== null && !button.closest('.toolbar-popup-menu, .toolbar-adjustment-menu'));
    const children = Array.from(toolbar.children).filter((child) => child.offsetParent !== null || child.classList.contains('toolbar-spacer'));
    const groups = [];
    let current = [];
    for (const child of children) {
      if (child.classList.contains('separator')) {
        if (current.length) groups.push(current);
        current = [];
      } else if (!child.classList.contains('toolbar-spacer')) {
        current.push(child);
      }
    }
    if (current.length) groups.push(current);
    const pairGaps = (nodes) => nodes.slice(1).map((node, index) => Math.round((rect(node).left - rect(nodes[index]).right) * 10) / 10);
    const separatedGroups = [];
    for (let index = 0; index + 1 < children.length; index += 1) {
      if (children[index + 1].classList.contains('separator') && children[index + 2]) {
        separatedGroups.push(Math.round((rect(children[index + 2]).left - rect(children[index]).right) * 10) / 10);
      }
    }
    const end = toolbar.querySelector('.toolbar-end-actions');
    const overview = toolbar.querySelector('.odv-signature-overview-button');
    return {
      toolbarHeight: rect(toolbar).height,
      buttonHeights: [...new Set(buttons.map((button) => Math.round(rect(button).height)))],
      minButtonWidth: Math.min(...buttons.map((button) => Math.round(rect(button).width))),
      iconSizes: [...new Set(Array.from(toolbar.querySelectorAll('button > .material-icons'))
        .filter((icon) => !icon.closest('.toolbar-split-arrow'))
        .map((icon) => getComputedStyle(icon).fontSize))],
      gapsInsideGroups: [
        ...Array.from(toolbar.querySelectorAll('.zoom-fixed-group')).flatMap((group) => pairGaps(Array.from(group.children).filter((child) => child.offsetParent !== null && !child.classList.contains('sr-only')))),
        ...groups.filter((group) => group.length > 1).flatMap((group) => pairGaps(group.filter((child) => !child.classList.contains('odv-signature-overview-button') && !child.classList.contains('toolbar-end-actions')))),
      ],
      gapsBetweenGroups: separatedGroups,
      overview: rect(overview),
      overviewToEnd: Math.round((rect(end).left - rect(overview).right) * 10) / 10,
      endGaps: pairGaps(Array.from(end.children)),
      endButtons: Array.from(end.querySelectorAll(':scope > .toolbar-menu-shell > button')).map((button) => Math.round(rect(button).height)),
    };
  });
}

test('toolbar is 40px with 30px buttons, 18px icons, 4px in-group and 12px between-group spacing', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  const metrics = await measureToolbar(page);

  expect(Math.round(metrics.toolbarHeight)).toBe(40);
  expect(metrics.buttonHeights).toEqual([30]);
  expect(metrics.minButtonWidth).toBeGreaterThanOrEqual(22); // the split-menu arrow; every other button is >= 30px
  expect(metrics.iconSizes).toEqual(['18px']);
  expect(metrics.gapsInsideGroups.length).toBeGreaterThanOrEqual(10);
  for (const gap of metrics.gapsInsideGroups) expect(gap).toBeCloseTo(4, 0);
  expect(metrics.gapsBetweenGroups.length).toBeGreaterThanOrEqual(4);
  for (const gap of metrics.gapsBetweenGroups) expect(gap).toBeCloseTo(12, 0);

  // Signature overview button on the same metrics, then 12px, then theme/language/help at 4px.
  expect(Math.round(metrics.overview.height)).toBe(30);
  expect(metrics.overviewToEnd).toBeCloseTo(12, 0);
  expect(metrics.endGaps).toEqual([4, 4]);
  expect(metrics.endButtons).toEqual([30, 30, 30]);
});

test('toolbar buttons keep at least 30px touch targets and a visible keyboard focus ring', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  const sizes = await page.locator('.toolbar button:visible').evaluateAll((buttons) => buttons
    .filter((button) => !button.classList.contains('toolbar-split-arrow'))
    .map((button) => { const box = button.getBoundingClientRect(); return Math.min(box.width, box.height); }));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(30);

  const overview = page.locator('.odv-signature-overview-button');
  await overview.focus();
  await page.keyboard.press('Shift');
  const ring = await overview.evaluate((node) => ({
    focusVisible: node.matches(':focus-visible'),
    outlineStyle: getComputedStyle(node).outlineStyle,
    outlineWidth: getComputedStyle(node).outlineWidth,
    outlineColor: getComputedStyle(node).outlineColor,
  }));
  expect(ring.focusVisible).toBe(true);
  expect(ring.outlineStyle).not.toBe('none');
  expect(ring.outlineWidth).toBe('2px');
  expect(ring.outlineColor).not.toMatch(/rgba\(.*,\s*0\)$/);
});
