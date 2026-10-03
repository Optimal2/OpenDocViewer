// File: tests/ui/manual-contents-tree.spec.mjs
/**
 * The manual overlay uses almost the whole viewport and shows a contents tree built at runtime
 * from the manual's h2/h3 headings (src/utils/manualContentsTree.js). In a wide dialog the tree is
 * a column that stays put while the manual text scrolls in its own pane; in a narrow dialog the
 * column is hidden and a "Contents" toggle in the search row opens it as an overlay list.
 *
 * A synthetic manual is served as the site manual (help/site/manual.<lng>.html), so the test does
 * not depend on the bundled manual's wording. Set ODV_UPDATE_SCREENSHOTS=1 to also refresh
 * docs/img/manual-overlay.png from the bundled English manual.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/** @param {'en'|'sv'} language */
function syntheticManual(language) {
  const word = language === 'sv' ? 'Avsnitt' : 'Section';
  const parts = [`<h1>${language === 'sv' ? 'Testmanual' : 'Test manual'}</h1>`];
  for (let section = 1; section <= 14; section += 1) {
    parts.push(`<h2>${section}. ${word} ${section}</h2>`);
    parts.push(`<p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30)}</p>`);
    for (let sub = 1; sub <= 2; sub += 1) {
      parts.push(`<h3>${word} ${section}.${sub}</h3>`);
      parts.push(`<p>${'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(30)}</p>`);
    }
  }
  return `<!doctype html><html lang="${language}"><body>${parts.join('')}</body></html>`;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'en'|'sv'} language
 */
async function openManual(page, language) {
  await page.route((url) => /\/help\/site\/manual\.(en|sv)\.html$/.test(url.pathname), (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: syntheticManual(language),
  }));
  await loadSession(page, { query: `lng=${language}` });
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(page.locator('.odv-manual-content h2').first()).toBeVisible();
}

/** @param {import('@playwright/test').Page} page */
function contentsNav(page) {
  return page.locator('nav.odv-manual-toc');
}

test('wide dialog: near full width, sticky tree column, entry scrolls only the content pane', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openManual(page, 'en');

  const dialog = page.locator('.odv-manual-dialog');
  const box = await dialog.boundingBox();
  expect(box.width).toBeGreaterThan(1400 * 0.9);
  expect(box.height).toBeGreaterThan(900 * 0.85);

  const nav = page.getByRole('navigation', { name: 'Contents of this page' });
  await expect(nav).toBeVisible();
  await expect(page.locator('.odv-manual-toc-toggle')).toBeHidden();
  const navBox = await nav.boundingBox();
  expect(navBox.width).toBeGreaterThanOrEqual(260);
  expect(navBox.width).toBeLessThanOrEqual(300);
  await expect(nav.locator('a')).toHaveCount(14 * 3);

  // The tree is scrolled a little so an unchanged scrollTop proves it did not move.
  await nav.evaluate((node) => { node.scrollTop = 40; });
  const navScrollBefore = await nav.evaluate((node) => node.scrollTop);
  expect(navScrollBefore).toBeGreaterThan(0);

  // An entry already visible in the tree (Playwright would scroll a hidden one into view itself).
  const entry = nav.getByRole('link', { name: '5. Section 5', exact: true });
  const entryBox = await entry.boundingBox();
  expect(entryBox.y).toBeGreaterThanOrEqual(navBox.y);
  expect(entryBox.y + entryBox.height).toBeLessThanOrEqual(navBox.y + navBox.height);
  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'true');
  await expect(nav.locator('a[aria-current="true"]')).toHaveCount(1);
  const pane = page.locator('.odv-manual-scroll');
  expect(await pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  // The heading sits at the top of the content pane and has focus.
  const offset = await page.evaluate(() => {
    const scroll = document.querySelector('.odv-manual-scroll').getBoundingClientRect();
    const heading = document.getElementById('section-5').getBoundingClientRect();
    return heading.top - scroll.top;
  });
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(24);
  await expect(page.locator('#section-5')).toBeFocused();
  expect(await nav.evaluate((node) => node.scrollTop)).toBe(navScrollBefore);
  expect(await nav.boundingBox()).toEqual(navBox);
  expect(new URL(page.url()).hash).toBe('');

  // Scrolling the text by hand moves the highlighted entry (IntersectionObserver).
  await pane.evaluate((node) => {
    const heading = document.getElementById('section-3-1');
    node.scrollTop += heading.getBoundingClientRect().top - node.getBoundingClientRect().top - 4;
  });
  await expect(nav.getByRole('link', { name: 'Section 3.1', exact: true })).toHaveAttribute('aria-current', 'true');

  // Keyboard: Tab from the search field reaches the tree before the content.
  await page.locator('[data-odv-manual-search="input"]').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focusedInTree = await page.evaluate(() => !!document.activeElement?.closest('nav.odv-manual-toc'));
  expect(focusedInTree).toBe(true);
});

test('narrow dialog: column hidden, Swedish toggle opens the list, selection and Escape close it', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await openManual(page, 'sv');

  const nav = contentsNav(page);
  const toggle = page.locator('.odv-manual-toc-toggle');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(/Innehåll/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByRole('navigation', { name: 'Innehåll på sidan' });
  await expect(list).toBeVisible();
  const entry = nav.locator('a[href="#avsnitt-5"]');
  await entry.click();
  await expect(nav).toBeHidden();
  await expect(entry).toHaveAttribute('aria-current', 'true');
  expect(await page.locator('.odv-manual-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  await toggle.click();
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(page.locator('.odv-manual-dialog')).toBeVisible();
  await expect(toggle).toBeFocused();

  // The next Escape closes the dialog as before.
  await page.keyboard.press('Escape');
  await expect(page.locator('.odv-manual-dialog')).toHaveCount(0);
});

test('narrow dialog: English toggle labelled "Contents" opens the list and selection closes it', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await openManual(page, 'en');

  const nav = contentsNav(page);
  const toggle = page.locator('.odv-manual-toc-toggle');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(/^\s*toc\s*Contents\s*$/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Contents of this page' })).toBeVisible();
  const entry = nav.locator('a[href="#section-7"]');
  await entry.click();
  await expect(nav).toBeHidden();
  await expect(entry).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#section-7')).toBeFocused();
  expect(await page.locator('.odv-manual-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

// The bundled manuals open their screenshots in a script-free lightbox: a thumbnail links to
// "#lb-<name>", `.lb` is display:none until it is the URL fragment target (`.lb:target`), and the
// lightbox links to "#lb-stang" (no such element) to close. The viewer keeps no state in the URL
// fragment, so the manual may set it; the dialog puts the original URL back when it closes.
test('bundled Swedish manual: image lightbox opens and closes through the URL fragment', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await loadSession(page, { query: 'lng=sv' });
  const urlBefore = new URL(page.url());
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  const nav = contentsNav(page);
  await expect(nav).toBeVisible();
  await expect(page.locator('.odv-manual-content a[href="#lb-verktygsfalt-redo"] img')).toBeVisible();

  // Go to section 2 through the tree; its two thumbnails are then in view.
  await nav.locator('a[href="#laddning"]').click();
  const current = nav.locator('a[aria-current="true"]');
  await expect(current).toHaveAttribute('href', '#laddning');
  expect(new URL(page.url()).hash).toBe('');

  const pane = page.locator('.odv-manual-scroll');
  const lightbox = page.locator('#lb-verktygsfalt-redo');
  await expect(lightbox).toBeHidden();
  const thumbnail = page.locator('.odv-manual-content a[href="#lb-verktygsfalt-redo"]');
  await expect(thumbnail).toBeInViewport();
  const scrollBefore = await pane.evaluate((node) => node.scrollTop);
  const pageScroll = () => page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement.scrollTop]);
  const pageScrollBefore = await pageScroll();

  await thumbnail.click();
  await expect(lightbox).toBeVisible();
  expect(await lightbox.evaluate((node) => node.matches(':target'))).toBe(true);
  // The fragment is replaced in place: same path and query, no extra history entry.
  const opened = new URL(page.url());
  expect(opened.hash).toBe('#lb-verktygsfalt-redo');
  expect(opened.pathname + opened.search).toBe(urlBefore.pathname + urlBefore.search);
  expect(await pane.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
  expect(await pageScroll()).toEqual(pageScrollBefore);
  await expect(current).toHaveAttribute('href', '#laddning');

  // A click anywhere in the lightbox follows its "#lb-stang" link and closes it.
  await lightbox.locator(':scope > a').click();
  await expect(lightbox).toBeHidden();
  expect(new URL(page.url()).hash).toBe('#lb-stang');
  expect(await pane.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
  expect(await pageScroll()).toEqual(pageScrollBefore);
  await expect(current).toHaveAttribute('href', '#laddning');

  // A tree link still scrolls only the content pane and puts the viewer's own URL back.
  await nav.locator('a[href="#utskrift"]').click();
  await expect(current).toHaveAttribute('href', '#utskrift');
  expect(await pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(scrollBefore);
  expect(page.url()).toBe(urlBefore.toString());

  // Closing with a lightbox open restores the URL, and focus goes back to the help button.
  await page.locator('.odv-manual-content a[href="#lb-utskrift-aktiv-sida"]').click();
  await expect(page.locator('#lb-utskrift-aktiv-sida')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.odv-manual-dialog')).toHaveCount(0);
  expect(page.url()).toBe(urlBefore.toString());
  await expect(page.locator('button.help-button')).toBeFocused();
});

test('search hits are counted per section in the tree', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openManual(page, 'en');
  await page.locator('[data-odv-manual-search="input"]').fill('Section 4');
  const nav = contentsNav(page);
  // "Section 4" matches the h2 (as part of "4. Section 4") and both of its h3 headings.
  await expect(nav.getByRole('link', { name: /^4\. Section 4/ }).locator('.odv-manual-toc-hits [aria-hidden="true"]')).toHaveText('1');
  await expect(nav.getByRole('link', { name: /^Section 4\.1/ }).locator('.odv-manual-toc-hits [aria-hidden="true"]')).toHaveText('1');
  await expect(nav.getByRole('link', { name: /^4\. Section 4/ })).toHaveAttribute('aria-current', 'true');
});

test('documentation screenshot of the bundled manual', async ({ page }) => {
  test.skip(!process.env.ODV_UPDATE_SCREENSHOTS, 'set ODV_UPDATE_SCREENSHOTS=1 to refresh docs/img/manual-overlay.png');
  await page.setViewportSize({ width: 1400, height: 900 });
  await loadSession(page, {
    query: 'lng=en',
    session: { session: { id: 'docs-manual' }, documents: [{ documentId: 'sample', files: ['/sample.png', '/sample.jpg', '/sample.png'] }] },
  });
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(contentsNav(page)).toBeVisible();
  await expect(page.locator('.odv-manual-content img').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/img/manual-overlay.png' });
});
