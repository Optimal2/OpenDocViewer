// File: tests/ui/manual-section-tracking.spec.mjs
/**
 * The manual marks the section being read in its contents tree and hands it to the "Open in new
 * tab" link (src/components/Manual/ManualView.jsx, findManualSectionAtLine in manualNavigation.js).
 * A collapsed `<details>` chapter must not take part in that. The browser hides its content with
 * `content-visibility: hidden` and still reports a box for every heading inside, placed below the
 * summary where it would have been shown, which is on top of the chapters after it. Counted, one
 * of those headings is taken for the section being read as soon as the reader scrolls.
 *
 * A synthetic manual with two collapsible chapters is served as the site manual, so the test does
 * not depend on the bundled manual's wording.
 * - The browser does report such a box (the premise; if it stops, this test says so).
 * - After the reader goes to a section in the second chapter and scrolls a little, that section
 *   is still the current one, in the tree and in the link.
 * - The tree follows the reader on to the next section of the open chapter.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt. ';

/** @returns {string} */
function manualWithChapters() {
  const chapter = (letter) => {
    const parts = [`<details><summary>Guide ${letter}</summary>`];
    for (let section = 1; section <= 6; section += 1) {
      parts.push(`<h3>${letter} section ${section}</h3>`);
      parts.push(`<p>${TEXT.repeat(40)}</p>`);
    }
    parts.push('</details>');
    return parts.join('');
  };
  return [
    '<!doctype html><html lang="en"><body>',
    '<h1>Test manual</h1>',
    `<h2>Start</h2><p>${TEXT.repeat(10)}</p>`,
    chapter('A'),
    chapter('B'),
    `<h2>End</h2><p>${TEXT.repeat(60)}</p>`,
    '</body></html>',
  ].join('');
}

/** @param {import('@playwright/test').Page} page */
async function openManual(page) {
  await page.route((url) => /\/help\/site\/manual\.(en|sv)\.html$/.test(url.pathname), (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: manualWithChapters(),
  }));
  // An empty site config keeps a developer's own public/odv.site.config.js out of the test.
  await loadSession(page, { siteConfig: {}, query: 'lng=en' });
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(page.locator('.odv-manual-content h2').first()).toBeVisible();
}

/**
 * Let the scroll reach the section tracker: it checks positions once per animation frame.
 * @param {import('@playwright/test').Page} page
 */
function settle(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
  }));
}

test('the section being read stays current when a collapsed chapter lies before it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openManual(page);
  const nav = page.locator('nav.odv-manual-toc');
  const pane = page.locator('.odv-manual-scroll');
  const current = nav.locator('a[aria-current="true"]');
  const heading = (name) => page.locator('.odv-manual-content h3', { hasText: new RegExp(`^${name}$`) });

  await nav.getByRole('link', { name: 'B section 2', exact: true }).click();
  await expect(current).toHaveText('B section 2');
  await expect(current).toHaveCount(1);

  // Chapter A is still collapsed, and its headings are not shown.
  const chapters = page.locator('.odv-manual-content details');
  expect(await chapters.nth(0).evaluate((node) => node.open)).toBe(false);
  expect(await chapters.nth(1).evaluate((node) => node.open)).toBe(true);
  await expect(heading('A section 6')).toBeHidden();

  // The premise: the hidden headings of chapter A have boxes that reach past the reader's place.
  const premise = await page.evaluate(() => {
    const paneTop = document.querySelector('.odv-manual-scroll').getBoundingClientRect().top;
    const tops = Array.from(document.querySelectorAll('.odv-manual-content details:first-of-type h3'))
      .map((node) => ({ top: node.getBoundingClientRect().top - paneTop, height: node.getBoundingClientRect().height }));
    return { above: tops.filter((box) => box.height > 0 && box.top < 0).length, below: tops.filter((box) => box.height > 0 && box.top > 300).length };
  });
  expect(premise.above).toBeGreaterThan(0);
  expect(premise.below).toBeGreaterThan(0);

  // The reader scrolls a little. The heading they went to is still at the top of the pane.
  const box = await pane.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await pane.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 30);
  await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(before);
  await settle(page);
  await expect(current).toHaveText('B section 2');
  await expect(current).toHaveCount(1);
  await expect(page.locator('.odv-manual-dialog').getByRole('link', { name: 'Open in new tab' }))
    .toHaveAttribute('href', new RegExp(`#${await current.evaluate((node) => node.getAttribute('href').slice(1))}$`));

  // The tree follows the reader on to the next section of the open chapter.
  await heading('B section 3').evaluate((node) => {
    const scroller = node.closest('.odv-manual-scroll');
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
  });
  await settle(page);
  await expect(current).toHaveText('B section 3');
  await expect(current).toHaveCount(1);
});
