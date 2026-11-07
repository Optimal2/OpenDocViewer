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

test('custom manual: Tab and Shift+Tab follow browser eligibility and restore focus on every close', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // Site manuals may retain positive tabindex and fieldset/select/textarea/disabled markup. Put
  // positive targets out of DOM order and inherited-disabled controls between eligible targets.
  const customManual = [
    '<!doctype html><html lang="en"><body><h1>Keyboard order</h1>',
    '<h2 id="keyboard-heading">Keyboard heading</h2>',
    '<a id="zero-in-content" href="#zero-in-content" tabindex="0">Zero in content</a>',
    '<a id="positive-two" href="#positive-two" tabindex="2">Positive two</a>',
    '<a id="negative" href="#negative" tabindex="-1">Negative</a>',
    '<a id="hidden" href="#hidden" tabindex="0" hidden>Hidden</a>',
    '<a id="positive-one" href="#positive-one" tabindex="1">Positive one</a>',
    '<a id="css-hidden" href="#css-hidden" tabindex="0" style="display: none">CSS hidden</a>',
    '<a id="before-disabled" href="#before-disabled">Before disabled controls</a>',
    '<fieldset disabled><legend>',
    '<select id="first-legend-select"><option>First legend select</option></select>',
    '<a id="first-legend-link" href="#first-legend-link">First legend link</a>',
    '</legend>',
    '<select id="inherited-disabled-select"><option>Inherited disabled select</option></select>',
    '<textarea id="inherited-disabled-textarea">Inherited disabled textarea</textarea>',
    '<a id="disabled-fieldset-link" href="#disabled-fieldset-link">Link in disabled fieldset</a>',
    '</fieldset>',
    '<a id="after-disabled" href="#after-disabled">After disabled controls</a>',
    '</body></html>',
  ].join('');
  await page.route((url) => /\/help\/site\/manual\.en\.html$/.test(url.pathname), (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: customManual,
  }));
  await loadSession(page, { query: 'lng=en' });

  const openCustomManual = async () => {
    await page.locator('button.help-button').click();
    await page.getByRole('menuitem', { name: 'Manual' }).click();
    await expect(page.locator('.odv-manual-content #positive-one')).toBeVisible();
    await expect(page.locator('.odv-manual-dialog')).toBeFocused();
  };

  for (let opening = 0; opening < 2; opening += 1) {
    await openCustomManual();
    await page.keyboard.press('Tab');
    await expect(page.locator('#positive-one')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#positive-two')).toBeFocused();
    // Positive targets precede every zero/default target, including dialog chrome earlier in
    // the DOM. Real browser Tab navigation, rather than synthetic keydown events, moves focus.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reload manual from server' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#positive-two')).toBeFocused();

    // The browser reports inherited fieldset disability, except in its first legend. Links are
    // not form controls and remain eligible even inside the disabled fieldset.
    const eligibility = await page.locator('.odv-manual-content fieldset').evaluate((fieldset) => (
      Array.from(fieldset.querySelectorAll('select, textarea, a')).map((element) => ({
        id: element.id,
        ownDisabled: element.disabled,
        actuallyDisabled: element.matches(':disabled'),
      }))
    ));
    expect(eligibility).toEqual([
      { id: 'first-legend-select', ownDisabled: false, actuallyDisabled: false },
      { id: 'first-legend-link', ownDisabled: undefined, actuallyDisabled: false },
      { id: 'inherited-disabled-select', ownDisabled: false, actuallyDisabled: true },
      { id: 'inherited-disabled-textarea', ownDisabled: false, actuallyDisabled: true },
      { id: 'disabled-fieldset-link', ownDisabled: undefined, actuallyDisabled: false },
    ]);

    // Contents navigation programmatically focuses a tabindex=-1 heading. Native navigation
    // continues from that DOM position; the trap must not redirect it to its own sorted start.
    await page.locator('nav.odv-manual-toc a[href="#keyboard-heading"]').click();
    await expect(page.locator('#keyboard-heading')).toBeFocused();
    await expect(page.locator('#keyboard-heading')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Tab');
    await expect(page.locator('#zero-in-content')).toBeFocused();

    await page.locator('#before-disabled').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#first-legend-select')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#first-legend-link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#disabled-fieldset-link')).toBeFocused();
    await expect(page.locator('#inherited-disabled-select')).not.toBeFocused();
    await expect(page.locator('#inherited-disabled-textarea')).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#after-disabled')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#disabled-fieldset-link')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#first-legend-link')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#first-legend-select')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#before-disabled')).toBeFocused();

    const close = page.locator('.odv-help-footer button');
    await close.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#positive-one')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.odv-manual-dialog')).toHaveCount(0);
    await expect(page.locator('button.help-button')).toBeFocused();
  }
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

for (const mediaOrder of ['default', 'positive-last', 'positive-first', 'positive-reversed']) {
  test(`custom manual: native media controls retain their internal Tab stops (${mediaOrder})`, async ({ page, context }) => {
    const wav = Buffer.alloc(44 + 32000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
    // This VP8 WebM is a locally generated canvas recording, with no external media or audio.
    const webm = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAS7EU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZUrmtTrIGTTbuLU6uEH0O2dVOsgdRNu4xTq4QcU7trU6yCBKnsrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBEiYREb8PnTYCGQ2hyb21lV0GGQ2hyb21lFlSua7yuuteBAXPFhx88h/E6k5KDgQFV7oEBhoVWX1ZQOOCdsIGguoFaU8CBAVWwkFWxgQFVuYECVbqBDVW7gQEfQ7Z1AQAAAAAAA8nngQCgQJShz4EAAADwBQCdASqgAFoAAAcIhYWImYSIASQQE61QH8AQNNCfBDVUmu4h1VJruIdVSa7iHVUmu4h1VJruIMD+5zD/+N24w34Lv/ILlhdcRgB1ocCmvu6BAaW5UAUAnQEqoABaAABHCIWFiJmEiAICAAYoDwh1VJruIdVSa7iHVUmu4h1VJruIdVSa7iG8AP7/uoMAoNihtYEAkQCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/v0+Av/G7cYb8F3/kFywuuIwdaGbppnugQGllBECAAEQGAAYABhYL/QACICBAAAA+4EAoNihtYEA2QCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/ucw//jduMN+C7/yC5YXXEYAdaGbppnugQGllBECAAEQEAAYABhYL/QACICBAAAA+4GRoNihtYEBOwCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/v0+Av/G7cYb8F3/kFywuuIwdaGbppnugQGllBECAAEQCSAAwADCwX+gAEQECAAA+4HZoNmhtYEBpwCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/ucw//jduMN+C7/yC5YXXEYAdaGbppnugQGllBECAAEQCSAAwADCwX+gAEQECAAA+4IBO6DZobWBAhMAkQMAABAJIADAAMW/oGAAAKwAVgArABWACsAFYAKvAP79PgL/xu3GG/Bd/5BcsLriMHWhm6aZ7oEBpZQRAgABEAkgAMAAwsF/oABEBAgAAPuCAaeg2aG1gQKAAJEDAAAQCSAAwADFv6BgAACsAFYAKwAVgArABWACrwD+5zD/+N24w34Lv/ILlhdcRgB1oZumme6BAaWUEQIAARAJIADAAMLBf6AARAQIAAD7ggIToNihtYEC6wCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/v0+Av/G7cYb8F3/kFywuuIwdaGappjugQGlk/EBAAEQEBRgAGFgv9AAIgIEAAD7ggKAoNmhtYEDVQCRAwAAEAkgAMAAxb+gYAAArABWACsAFYAKwAVgAq8A/ucw//jduMN+C7/yC5YXXEYAdaGbppnugQGllBECAAEQCSAAwADCwX+gAEQECAAA+4IC66DZobWBA78AkQMAABAJIADAAMW/oGAAAKwAVgArABWACsAFYAKvAP79PgL/xu3GG/Bd/5BcsLriMHWhm6aZ7oEBpZQRAgABEAkgAMAAwsF/oABEBAgAAPuCA1UcU7trjbuLs4EAt4b3gQHxgdQ=', 'base64');
    const serveMedia = async (target) => {
      await target.route('**/focus-media.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
      await target.route('**/focus-media.webm', route => route.fulfill({ contentType: 'video/webm', body: webm }));
    };
    await serveMedia(page);
    const mediaTabIndex = (position) => mediaOrder === 'default' ? ''
      : ` tabindex="${mediaOrder === 'positive-reversed' ? 5 - position : position + (mediaOrder === 'positive-last' ? 2 : 0)}"`;
    const anchorTabIndex = mediaOrder === 'positive-first' ? 2 : 0;
    const html = [
      '<h1>Media keyboard order</h1><h2 id="media-heading">Media controls</h2>',
      '<a id="zero-in-content" href="#zero-in-content">Zero in content</a>',
      `<a id="positive-two" href="#positive-two" tabindex="${anchorTabIndex + 2}">Positive two</a>`,
      `<a id="positive-one" href="#positive-one" tabindex="${anchorTabIndex + 1}">Positive one</a>`,
      '<a id="before-media" href="#before-media">Before media</a>',
      `<audio id="manual-audio" controls loop preload="auto" src="/focus-media.wav"${mediaTabIndex(1)}></audio>`,
      `<video id="manual-video" controls preload="auto" width="320" height="180" src="/focus-media.webm"${mediaTabIndex(2)}></video>`,
      '<a id="after-media" href="#after-media">After media</a>',
    ].join('');
    await page.route(url => /\/help\/site\/manual\.en\.html$/.test(url.pathname), route => route.fulfill({ contentType: 'text/html', body: html }));
    await loadSession(page, { query: 'lng=en' });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const snapshot = async (target, session) => ({
      id: await target.evaluate(() => document.activeElement.id),
      focused: (await session.send('Accessibility.getFullAXTree')).nodes
        .filter(node => node.role?.value !== 'RootWebArea'
          && node.properties?.some(property => property.name === 'focused' && property.value.value === true))
        .map(node => ({ role: node.role?.value, name: node.name?.value })),
    });
    const waitForMedia = async (target) => {
      await target.waitForFunction(() => [...document.querySelectorAll('audio, video')]
        .every(node => node.readyState >= 2 || node.error));
      expect(await target.locator('audio, video').evaluateAll(nodes => nodes.map(node => ({
        controls: node.controls, loaded: node.readyState >= 2, error: node.error?.code || null,
      })))).toEqual([
        { controls: true, loaded: true, error: null },
        { controls: true, loaded: true, error: null },
      ]);
    };
    const close = page.locator('.odv-help-footer button');
    const refresh = page.getByRole('button', { name: 'Reload manual from server' });
    let native;
    const trace = [];
    try {
      for (let opening = 0; opening < 2; opening += 1) {
        await page.locator('button.help-button').click();
        await page.getByRole('menuitem', { name: 'Manual', exact: true }).click();
        await expect(page.locator('#manual-audio')).toBeVisible();
        await waitForMedia(page);
        const sanitized = await page.locator('.odv-manual-content').innerHTML();
        expect(sanitized).toContain('<audio');
        expect(sanitized).toContain('<video');
        // The oracle is the very same product-sanitized fixture with no application key handler.
        native = await context.newPage();
        await serveMedia(native);
        await native.route('**/native-media-fixture', route => route.fulfill({ contentType: 'text/html', body: sanitized }));
        await native.goto('/native-media-fixture');
        await waitForMedia(native);
        const nativeCdp = await context.newCDPSession(native);
        await nativeCdp.send('Accessibility.enable');
        const oracle = {};
        for (const id of ['manual-audio', 'manual-video']) {
          await native.locator(`#${id}`).focus();
          const forward = [];
          // A finite bound detects a stuck native fixture; it never truncates a passing trace.
          for (let step = 0; step < 20; step += 1) {
            const state = await snapshot(native, nativeCdp);
            if (state.id !== id) break;
            forward.push(state);
            await native.keyboard.press('Tab');
          }
          expect((await snapshot(native, nativeCdp)).id).not.toBe(id);
          expect(forward.flatMap(state => state.focused)).toEqual(expect.arrayContaining([
            { role: 'button', name: 'play' },
            { role: 'button', name: 'show more media controls' },
            { role: 'slider', name: id === 'manual-audio' ? 'audio time scrubber' : 'video time scrubber' },
          ]));
          expect(forward.flatMap(state => state.focused)).toEqual(expect.arrayContaining(id === 'manual-audio' ? [
            { role: 'slider', name: 'volume' }, { role: 'button', name: 'mute' },
          ] : [{ role: 'button', name: 'enter full screen' }]));
          const reverse = [];
          for (let step = 0; step < forward.length; step += 1) {
            await native.keyboard.press('Shift+Tab');
            reverse.push(await snapshot(native, nativeCdp));
          }
          expect(reverse).toEqual([...forward].reverse());
          oracle[id] = forward;
        }
        trace.push({ opening, sanitized, oracle });
        // Keyboard input and page focus must belong to the dialog tab, not the oracle tab.
        await page.bringToFront();
        expect(await page.evaluate(() => document.hasFocus())).toBe(true);
        const mediaSequence = mediaOrder === 'positive-reversed'
          ? ['manual-video', 'manual-audio'] : ['manual-audio', 'manual-video'];
        const beforeMedia = mediaOrder === 'default' ? page.locator('#before-media')
          : mediaOrder === 'positive-first' ? close : page.locator('#positive-two');
        const afterMedia = mediaOrder === 'default' ? page.locator('#after-media')
          : mediaOrder === 'positive-first' ? page.locator('#positive-one') : refresh;
        await beforeMedia.focus();
        await page.keyboard.press('Tab');
        for (const id of mediaSequence) {
          for (const state of oracle[id]) {
            const actual = await snapshot(page, cdp);
            trace.push({ opening, direction: 'forward', actual });
            expect(actual).toEqual(state);
            expect(await page.evaluate(() => document.querySelector('.odv-manual-dialog').contains(document.activeElement))).toBe(true);
            await expect(page.locator('.odv-manual-content span[tabindex="-1"]')).toHaveCount(0);
            if (id === 'manual-audio' && state.focused.some(node => node.name === 'play')) {
              await page.keyboard.press('Space');
              await expect(page.locator('#manual-audio')).toHaveJSProperty('paused', false);
              await page.keyboard.press('Space');
              await expect(page.locator('#manual-audio')).toHaveJSProperty('paused', true);
            }
            await page.keyboard.press('Tab');
          }
        }
        await expect(afterMedia).toBeFocused();
        await expect(page.locator('.odv-manual-content span[tabindex]')).toHaveCount(0);
        await page.keyboard.press('Shift+Tab');
        for (const id of [...mediaSequence].reverse()) {
          for (const state of [...oracle[id]].reverse()) {
            const actual = await snapshot(page, cdp);
            trace.push({ opening, direction: 'reverse', actual });
            expect(actual).toEqual(state);
            expect(await page.evaluate(() => document.querySelector('.odv-manual-dialog').contains(document.activeElement))).toBe(true);
            await page.keyboard.press('Shift+Tab');
          }
        }
        trace.push({ opening, direction: 'reverse-exit', actual: await snapshot(page, cdp), documentHasFocus: await page.evaluate(() => document.hasFocus()) });
        await expect(beforeMedia).toBeFocused();
        await expect(page.locator('.odv-manual-content span[tabindex]')).toHaveCount(0);
        // Native continuation from a programmatically focused heading still starts at its DOM position.
        await page.locator('nav.odv-manual-toc a[href="#media-heading"]').click();
        await expect(page.locator('#media-heading')).toHaveAttribute('tabindex', '-1');
        await page.keyboard.press('Tab');
        await expect(page.locator('#zero-in-content')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('.odv-manual-dialog')).toHaveCount(0);
        await expect(page.locator('button.help-button')).toBeFocused();
        await native.close();
        native = null;
      }
    } finally {
      await test.info().attach(`media-focus-${mediaOrder}`, { body: JSON.stringify(trace, null, 2), contentType: 'application/json' });
      await native?.close();
      await cdp.detach();
    }
  });
}
