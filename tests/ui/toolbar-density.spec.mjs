// File: tests/ui/toolbar-density.spec.mjs
/**
 * Toolbar density (src/styles/toolbar.css) is a user preference: "Larger toolbar buttons" in the
 * theme menu, default from runtime config `toolbar.largeButtons` (true when unset).
 * - large: 62px toolbar (the height before the frame padding), 32px buttons with 18px icons,
 *   44px group frames (4px border + 2px padding), 32px signature overview button.
 * - compact: 40px toolbar, 26px buttons with 16px icons, 34px group frames (2px border + 2px
 *   padding), 4px between controls inside a group, 12px between groups, and theme/language/help as
 *   one tight end group.
 * In both densities there is at least 2px of air between a group frame and its buttons, buttons
 * outside a frame take the frame's outer height, and the toolbar neither overflows nor wraps.
 * Both densities keep touch targets, 4.5:1 button contrast and a visible keyboard focus ring.
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
    // Air between the inside of the frame border and the first/last button of each framed group.
    const frameGaps = Array.from(toolbar.querySelectorAll('.zoom-fixed-group')).map((group) => {
      const box = rect(group);
      const style = getComputedStyle(group);
      const inner = {
        left: box.left + parseFloat(style.borderLeftWidth),
        right: box.right - parseFloat(style.borderRightWidth),
        top: box.top + parseFloat(style.borderTopWidth),
        bottom: box.bottom - parseFloat(style.borderBottomWidth),
      };
      const groupButtons = Array.from(group.querySelectorAll('button')).filter((button) => button.offsetParent !== null);
      return [groupButtons[0], groupButtons[groupButtons.length - 1]].map((button) => {
        const b = rect(button);
        return { left: b.left - inner.left, right: inner.right - b.right, top: b.top - inner.top, bottom: inner.bottom - b.bottom };
      });
    });
    const marginBoxHeight = (element) => {
      const style = getComputedStyle(element);
      return Math.round(rect(element).height + parseFloat(style.marginTop) + parseFloat(style.marginBottom));
    };
    const unframed = [
      ...children.filter((child) => child.tagName === 'BUTTON' || child.classList.contains('toolbar-menu-shell')),
      ...Array.from(toolbar.querySelectorAll('.toolbar-end-actions > .toolbar-menu-shell')),
    ];
    const end = toolbar.querySelector('.toolbar-end-actions');
    const overview = toolbar.querySelector('.odv-signature-overview-button');
    return {
      toolbarHeight: rect(toolbar).height,
      overflow: toolbar.scrollWidth - toolbar.clientWidth,
      rowCenters: [...new Set(children.filter((child) => !child.classList.contains('toolbar-spacer'))
        .map((child) => Math.round((rect(child).top + rect(child).bottom) / 2)))],
      frameGaps,
      unframedOuterHeights: [...new Set(unframed.map(marginBoxHeight))],
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
  // The toolbar heights are those measured before the frame padding (large: 62px on af306bf).
  { name: 'large', siteConfig: null, toolbarHeight: 62, buttonHeight: 32, groupHeight: 44, iconSize: '18px' },
  { name: 'compact', siteConfig: COMPACT_SITE_CONFIG, toolbarHeight: 40, buttonHeight: 26, groupHeight: 34, iconSize: '16px' },
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
      expect(metrics.minButtonWidth).toBeGreaterThanOrEqual(density.buttonHeight); // split-menu arrows included
      expect(metrics.iconSizes).toEqual([density.iconSize]);
      expect(Math.round(metrics.overview.height)).toBe(density.buttonHeight);
      expect(metrics.endButtons).toEqual([density.buttonHeight, density.buttonHeight, density.buttonHeight]);

      // Frame border, at least 2px of air, button: on every side of a group's first and last button.
      expect(metrics.frameGaps).toHaveLength(3);
      for (const gaps of metrics.frameGaps.flat()) {
        for (const side of ['left', 'right', 'top', 'bottom']) expect(gaps[side], side).toBeGreaterThanOrEqual(2);
      }
      // Unframed buttons take a frame's outer height; everything sits on one row without overflow.
      expect(metrics.unframedOuterHeights).toEqual([density.groupHeight]);
      expect(metrics.rowCenters).toHaveLength(1);
      expect(metrics.overflow).toBeLessThanOrEqual(0);

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

    test(`toolbar buttons keep at least ${density.buttonHeight}px touch targets, 4.5:1 contrast and a visible keyboard focus ring`, async ({ page }) => {
      await loadSession(page, { siteConfig: density.siteConfig });
      await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
      const sizes = await page.locator('.toolbar button:visible').evaluateAll((buttons) => buttons
        .map((button) => { const box = button.getBoundingClientRect(); return Math.min(box.width, box.height); }));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(density.buttonHeight);

      const contrasts = await page.locator('.toolbar button:visible:enabled').evaluateAll((buttons) => {
        const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
          .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
        return buttons.map((button) => {
          const style = getComputedStyle(button);
          const [fg, bg] = [luminance(style.color), luminance(style.backgroundColor)];
          return { label: button.getAttribute('aria-label'), ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
        });
      });
      expect(contrasts.length).toBeGreaterThan(10);
      for (const { label, ratio } of contrasts) expect(ratio, label).toBeGreaterThanOrEqual(4.5);

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
  expect(metrics.buttonHeights).toEqual([32]);

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
  expect(metrics.buttonHeights).toEqual([26]);

  await page.reload();
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-density', 'compact');
  metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(40);
  expect(metrics.buttonHeights).toEqual([26]);

  // Space toggles back to the large buttons.
  const reopened = await openThemeMenu(page);
  await expect(reopened).toHaveAttribute('aria-checked', 'false');
  await reopened.focus();
  await page.keyboard.press('Space');
  await expect(reopened).toHaveAttribute('aria-checked', 'true');
  metrics = await measureToolbar(page);
  expect(Math.round(metrics.toolbarHeight)).toBe(62);
  expect(metrics.buttonHeights).toEqual([32]);
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
  expect(metrics.buttonHeights).toEqual([32]);
});
