// File: tests/ui/toolbar-density.spec.mjs
/**
 * Toolbar density (src/styles/toolbar.css) is a user preference: "Larger toolbar buttons" in the
 * theme menu, default from runtime config `toolbar.largeButtons` (true when unset).
 * - large: the pre-compact look, 36px buttons in a toolbar with a 48px minimum height (62px
 *   rendered, because the framed zoom/page groups are 54px tall), 36px signature overview button.
 * - compact: 40px toolbar, 30px buttons with 18px icons, 4px between controls inside a group,
 *   12px between groups, and theme/language/help as one tight end group.
 * Both densities keep touch targets and a visible keyboard focus ring.
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
        .filter((icon) => !icon.closest('.toolbar-split-arrow, .toolbar-popup-menu'))
        .map((icon) => getComputedStyle(icon).fontSize))],
      gapsInsideGroups: [
        ...Array.from(toolbar.querySelectorAll('.zoom-fixed-group')).flatMap((group) => pairGaps(Array.from(group.children).filter((child) => child.offsetParent !== null && !child.classList.contains('sr-only')))),
        ...groups.filter((group) => group.length > 1).flatMap((group) => pairGaps(group.filter((child) => !child.classList.contains('odv-signature-overview-button') && !child.classList.contains('toolbar-end-actions')))),
      ],
      gapsBetweenGroups: separatedGroups,
      groupHeights: Array.from(toolbar.querySelectorAll('.zoom-fixed-group')).map((group) => Math.round(rect(group).height)),
      overview: rect(overview),
      overviewToEnd: Math.round((rect(end).left - rect(overview).right) * 10) / 10,
      endGaps: pairGaps(Array.from(end.children)),
      endButtons: Array.from(end.querySelectorAll(':scope > .toolbar-menu-shell > button')).map((button) => Math.round(rect(button).height)),
    };
  });
}

const COMPACT_SITE_CONFIG = { toolbar: { largeButtons: false } };

const DENSITIES = [
  { name: 'large', siteConfig: null, toolbarHeight: 62, buttonHeight: 36, groupHeight: 54, iconSize: '18.24px' },
  { name: 'compact', siteConfig: COMPACT_SITE_CONFIG, toolbarHeight: 40, buttonHeight: 30, groupHeight: 34, iconSize: '18px' },
];

/** @param {import('@playwright/test').Page} page */
async function openThemeMenu(page) {
  await page.getByRole('button', { name: 'Choose theme' }).click();
  return page.getByRole('menuitemcheckbox', { name: 'Larger toolbar buttons' });
}

for (const density of DENSITIES) {
  test.describe(`${density.name} toolbar`, () => {
    test(`toolbar is ${density.toolbarHeight}px with ${density.buttonHeight}px buttons and ${density.iconSize} icons`, async ({ page }) => {
      await loadSession(page, { siteConfig: density.siteConfig });
      await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', density.name);
      const metrics = await measureToolbar(page);

      expect(Math.round(metrics.toolbarHeight)).toBe(density.toolbarHeight);
      expect(metrics.buttonHeights).toEqual([density.buttonHeight]);
      expect(metrics.groupHeights).toEqual([density.groupHeight, density.groupHeight, density.groupHeight]);
      expect(metrics.minButtonWidth).toBeGreaterThanOrEqual(22); // the split-menu arrow; every other button is >= the button size
      expect(metrics.iconSizes).toEqual([density.iconSize]);
      expect(Math.round(metrics.overview.height)).toBe(density.buttonHeight);
      expect(metrics.endButtons).toEqual([density.buttonHeight, density.buttonHeight, density.buttonHeight]);

      if (density.name === 'compact') {
        // 4px in-group spacing, 12px between groups, then theme/language/help at 4px.
        expect(metrics.gapsInsideGroups.length).toBeGreaterThanOrEqual(10);
        for (const gap of metrics.gapsInsideGroups) expect(gap).toBeCloseTo(4, 0);
        expect(metrics.gapsBetweenGroups.length).toBeGreaterThanOrEqual(4);
        for (const gap of metrics.gapsBetweenGroups) expect(gap).toBeCloseTo(12, 0);
        expect(metrics.overviewToEnd).toBeCloseTo(12, 0);
        expect(metrics.endGaps).toEqual([4, 4]);
      }
    });

    test(`toolbar buttons keep at least ${density.buttonHeight}px touch targets and a visible keyboard focus ring`, async ({ page }) => {
      await loadSession(page, { siteConfig: density.siteConfig });
      await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
      const sizes = await page.locator('.toolbar button:visible').evaluateAll((buttons) => buttons
        .filter((button) => !button.classList.contains('toolbar-split-arrow'))
        .map((button) => { const box = button.getBoundingClientRect(); return Math.min(box.width, box.height); }));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(density.buttonHeight);

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
  });
}

test('the theme-menu checkbox switches the toolbar density and the choice survives a reload', async ({ page }) => {
  await loadSession(page);
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  let metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(62);
  expect(metrics.buttonHeights).toEqual([36]);

  const checkbox = await openThemeMenu(page);
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(1);

  // Keyboard operable: focus the item and toggle it with Enter; the menu stays open.
  await checkbox.focus();
  await page.keyboard.press('Enter');
  await expect(checkbox).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'compact');
  metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(40);
  expect(metrics.buttonHeights).toEqual([30]);

  await page.reload();
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'compact');
  metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(40);
  expect(metrics.buttonHeights).toEqual([30]);

  // Space toggles back to the large buttons.
  const reopened = await openThemeMenu(page);
  await expect(reopened).toHaveAttribute('aria-checked', 'false');
  await reopened.focus();
  await page.keyboard.press('Space');
  await expect(reopened).toHaveAttribute('aria-checked', 'true');
  metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(62);
  expect(metrics.buttonHeights).toEqual([36]);
});

test('a stored choice outranks the site default toolbar.largeButtons=false', async ({ page }) => {
  await loadSession(page, { siteConfig: COMPACT_SITE_CONFIG });
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'compact');
  const checkbox = await openThemeMenu(page);
  await expect(checkbox).toHaveAttribute('aria-checked', 'false');
  await checkbox.click();
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'large');

  await page.reload();
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'large');
  const metrics = await measureToolbar(page);
  expect(metrics.buttonHeights).toEqual([36]);
});
