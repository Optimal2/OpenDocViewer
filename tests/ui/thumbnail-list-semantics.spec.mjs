// File: tests/ui/thumbnail-list-semantics.spec.mjs
/**
 * The thumbnail strip (src/components/DocumentThumbnailList.jsx) is a list of page buttons.
 * It is page navigation and not a value choice, and its rows also hold document headers and
 * signature symbols, which a listbox may not contain (WCAG 1.3.1, axe aria-required-children).
 * - The strip holds one list named "Document thumbnails"; every child that assistive
 *   technology sees is a list item, and there is one item per page.
 * - Each item holds exactly one page button with a name; nothing in the strip is a listbox or
 *   an option, and no page button contains another control.
 * - The page that is shown carries aria-current="page", and only that one. It moves with a
 *   click and with Enter and Space on a page button.
 * - Keyboard order is unchanged: one tab stop for the page buttons (the shown page), then the
 *   signature symbols.
 * - The document header is a labelled group inside its row's list item, before the page button.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const STRIP = '.thumbnails-container';

/** @param {import('@playwright/test').Page} page */
async function openSession(page) {
  // An empty site config keeps a developer's own public/odv.site.config.js out of the test.
  await loadSession(page, { siteConfig: {} });
  await expect(page.locator('.odv-signature-overview-button')).toBeVisible();
  await expect(page.locator(`${STRIP} .thumbnail-wrapper`)).toHaveCount(4);
}

/**
 * The ids of the page buttons marked as the current page.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<string>>}
 */
function currentPages(page) {
  return page.locator(`${STRIP} [aria-current]`).evaluateAll((nodes) => nodes.map((node) => `${node.id}=${node.getAttribute('aria-current')}`));
}

test.describe('thumbnail strip semantics', () => {
  test('the strip is one list with a list item per page, and nothing in it is a listbox or an option', async ({ page }) => {
    await openSession(page);
    await expect(page.locator(`${STRIP} [role="listbox"], ${STRIP} [role="option"]`)).toHaveCount(0);
    await expect(page.locator(STRIP)).not.toHaveAttribute('role', /.*/);
    await expect(page.locator(STRIP)).not.toHaveAttribute('aria-activedescendant', /.*/);

    const list = page.getByRole('list', { name: 'Document thumbnails' });
    await expect(list).toHaveCount(1);
    await expect(list.getByRole('listitem')).toHaveCount(4);

    const children = await list.evaluate((node) => Array.from(node.children)
      .filter((child) => child.getAttribute('aria-hidden') !== 'true')
      .map((child) => child.getAttribute('role')));
    expect(children).toEqual(['listitem', 'listitem', 'listitem', 'listitem']);
  });

  test('each list item holds one named page button that contains no other control', async ({ page }) => {
    await openSession(page);
    const items = await page.getByRole('list', { name: 'Document thumbnails' }).evaluate((node) => Array.from(node.querySelectorAll(':scope > [role="listitem"]')).map((item) => {
      const buttons = Array.from(item.querySelectorAll('.thumbnail-wrapper'));
      return {
        pageButtons: buttons.length,
        role: buttons[0]?.getAttribute('role'),
        name: buttons[0]?.getAttribute('aria-label') || '',
        inner: buttons[0]?.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"]').length,
        selected: buttons[0]?.hasAttribute('aria-selected'),
      };
    }));
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      expect(item.pageButtons).toBe(1);
      expect(item.role).toBe('button');
      expect(item.name).toContain(`Go to page ${index + 1}`);
      expect(item.inner).toBe(0);
      expect(item.selected).toBe(false);
    });
    await expect(page.getByRole('list', { name: 'Document thumbnails' }).getByRole('button', { name: /^Go to page / })).toHaveCount(4);
  });

  test('the shown page is the current one, and it moves with a click, Enter and Space', async ({ page }) => {
    await openSession(page);
    expect(await currentPages(page)).toEqual(['thumbnail-1=page']);

    await page.locator('#thumbnail-3').click();
    await expect.poll(() => currentPages(page)).toEqual(['thumbnail-3=page']);

    await page.locator('#thumbnail-2').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => currentPages(page)).toEqual(['thumbnail-2=page']);

    await page.locator('#thumbnail-4').focus();
    await page.keyboard.press('Space');
    await expect.poll(() => currentPages(page)).toEqual(['thumbnail-4=page']);
  });

  test('the page buttons are one tab stop, followed by the signature symbols', async ({ page }) => {
    await openSession(page);
    const tabIndexes = await page.locator(`${STRIP} .thumbnail-wrapper`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('tabindex')));
    expect(tabIndexes).toEqual(['0', '-1', '-1', '-1']);

    await page.locator('#thumbnail-1').focus();
    await page.keyboard.press('Tab');
    // The next stop is a signature symbol, not the page button of page 2.
    await expect(page.locator('[data-thumbnail-row="thumbnail-1"] .odv-signature-badge--thumbnail')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-thumbnail-row="thumbnail-2"] .odv-signature-badge--thumbnail')).toBeFocused();
  });

  test('the document header is a labelled group in its row, before the page button', async ({ page }) => {
    await openSession(page);
    const firstItem = page.getByRole('list', { name: 'Document thumbnails' }).getByRole('listitem').first();
    const order = await firstItem.evaluate((node) => Array.from(node.querySelectorAll('[role="group"], .thumbnail-wrapper')).map((el) => `${el.getAttribute('role')}:${el.getAttribute('aria-label') || ''}`));
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/^group:Document 1/);
    expect(order[1]).toMatch(/^button:Go to page 1/);
    await expect(firstItem.getByRole('group', { name: /Document 1/ }).locator('.odv-signature-badge--document')).toBeVisible();
  });
});
