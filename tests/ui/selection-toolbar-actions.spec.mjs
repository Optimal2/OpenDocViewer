// File: tests/ui/selection-toolbar-actions.spec.mjs
/**
 * The actions at the end of the print selection workspace's toolbar
 * (src/components/DocumentToolbar/DocumentToolbar.jsx): reset, "Save" and "Leave". Save and
 * Leave hold an icon and a text. They are laid out as a centred row like the undo and redo
 * buttons beside them: left to the inline flow, the icon rode 2 px above the middle of the
 * button, the text sat below it, and nothing separated the two.
 * - The icon and the text of Save and of Leave are centred on the button's middle line.
 * - The text follows the icon after the 6 px the workspace's other icon buttons use.
 * - The icon of the icon-only reset button is centred both ways.
 *
 * Layout only: the icon's box is measured, not its glyph, so the test says nothing about the
 * icon font having loaded. Save and reset are disabled when the workspace opens, and are
 * measured as they are.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/**
 * Where a button's icon and text sit, relative to the button (CSS px).
 * @param {import('@playwright/test').Locator} button
 */
function measure(button) {
  return button.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const icon = node.querySelector('.material-icons').getBoundingClientRect();
    const textNode = Array.from(node.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    let text = null;
    if (textNode) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      text = range.getBoundingClientRect();
    }
    const middle = box.top + box.height / 2;
    return {
      iconOffMiddle: icon.top + icon.height / 2 - middle,
      textOffMiddle: text ? text.top + text.height / 2 - middle : null,
      gap: text ? text.left - icon.right : null,
      iconOffCentre: icon.left + icon.width / 2 - (box.left + box.width / 2),
      spaceBefore: icon.left - box.left,
      spaceAfter: box.right - (text || icon).right,
    };
  });
}

test('the workspace toolbar\'s Save and Leave hold their icon and text on one centred line', async ({ page }) => {
  // An empty site config keeps a developer's own public/odv.site.config.js out of the test.
  await loadSession(page, { siteConfig: {} });
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await page.getByRole('button', { name: /selection manag/i }).click();
  const actions = page.locator('.print-selection-toolbar-end-actions');
  await expect(actions).toBeVisible();

  for (const name of ['print-selection-save-action', 'print-selection-leave-action']) {
    const button = actions.locator(`.${name}`);
    await expect(button).toBeVisible();
    const placed = await measure(button);
    expect(Math.abs(placed.iconOffMiddle), `${name}: icon on the middle line`).toBeLessThanOrEqual(0.5);
    // A text's box is as tall as its font's line, which need not be a whole number of pixels:
    // within 1 px (it was 1.5 px off, and on the other side of the middle from the icon).
    expect(Math.abs(placed.textOffMiddle), `${name}: text on the middle line`).toBeLessThanOrEqual(1);
    expect(placed.gap, `${name}: air between icon and text`).toBeCloseTo(6, 0);
    // The row is centred in the button: the same room before the icon as after the text. (At
    // the buttons' natural width this follows from their padding; it guards a later min-width.)
    expect(Math.abs(placed.spaceBefore - placed.spaceAfter), `${name}: centred row`).toBeLessThanOrEqual(1);
  }

  const reset = await measure(actions.locator('.print-selection-reset-draft-action'));
  expect(Math.abs(reset.iconOffMiddle)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(reset.iconOffCentre)).toBeLessThanOrEqual(0.5);
});
