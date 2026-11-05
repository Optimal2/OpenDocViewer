// File: tests/ui/standard-manual.spec.mjs
/**
 * Real-browser acceptance proof for help.manual.source=standard and runtime feature filtering.
 * Unlike the synthetic-manual specs, this uses the unchanged bundled English manual and its real
 * images. Screenshots are written only when ODV_STANDARD_MANUAL_SCREENSHOT_DIR is set; normal CI
 * runs keep the behavioral assertions without creating visual artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const OVERLAY_TITLE = 'Lay the pages on top of each other (overlay)';

/**
 * @param {import('@playwright/test').Page} page
 * @param {boolean} overlayEnabled
 * @param {{source: (string|undefined), siteManual: string}} options
 */
async function openStandardManual(page, overlayEnabled, { source, siteManual }) {
  const siteRequests = [];
  const standardHtmlRequests = [];
  await page.route((url) => /\/help\/site\//.test(url.pathname), (route) => {
    siteRequests.push(route.request().url());
    if (siteManual === 'missing') return route.fulfill({ status: 404, body: 'No site manual' });
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Site-owned manual sentinel</h1><h2 id="jmf-overlay">Site overlay must stay unfiltered</h2>',
    });
  });
  await page.route(
    (url) => /\/(help\/default|custom-fallback)\/manual\.[^/]+\.html$/.test(url.pathname),
    async (route) => {
      standardHtmlRequests.push(route.request().url());
      const response = await route.fetch({
        url: route.request().url().replace('/custom-fallback/', '/help/default/'),
      });
      return route.fulfill({ response });
    },
  );
  await loadSession(page, {
    query: 'lng=en',
    siteConfig: {
      help: {
        manual: {
          ...(source === undefined ? {} : { source }),
          fallbackPathTemplate: 'custom-fallback/manual.{{lng}}.html',
        },
      },
      compare: { overlay: { enabled: overlayEnabled } },
    },
  });
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(page.locator('.odv-manual-content h2#overview')).toBeVisible();
  if (source === 'standard') expect(siteRequests).toEqual([]);
  expect(await page.locator('.odv-manual-content').textContent()).not.toContain('Site-owned manual sentinel');
  return { siteRequests, standardHtmlRequests };
}

/**
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} name
 * @returns {Promise<string>}
 */
async function screenshotPath(testInfo, name) {
  const directory = process.env.ODV_STANDARD_MANUAL_SCREENSHOT_DIR;
  if (!directory) return '';
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

for (const { label, mode, source, siteManual } of [
  { label: 'standard', mode: 'standard', source: 'standard', siteManual: 'sentinel' },
  { label: 'default auto', mode: 'auto', source: undefined, siteManual: 'missing' },
]) {
  test(`${label} manual removes disabled overlay help without breaking navigation or images`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { siteRequests, standardHtmlRequests } = await openStandardManual(page, false, { source, siteManual });
    expect(standardHtmlRequests).toEqual([]);
    if (mode === 'auto') expect(siteRequests).toHaveLength(1);

    const content = page.locator('.odv-manual-content');
    const contents = page.locator('nav.odv-manual-toc');
    await expect(content.locator('#jmf-overlay')).toHaveCount(0);
    await expect(contents.locator('a[href="#jmf-overlay"]')).toHaveCount(0);
    await expect(content).not.toContainText(OVERLAY_TITLE);
    await expect(content.locator('#jmf-curtain')).toBeAttached();

    // An ordinary prose cross-link is unlinked, not deleted with the removed target.
    const curtainNote = content.locator('p').filter({ hasText: 'The curtain button in the toolbar is gray' });
    await expect(curtainNote).toContainText('Lay the pages on top of each other');
    await expect(curtainNote.locator('a[href="#jmf-overlay"]')).toHaveCount(0);

    // A direct fragment navigation cannot recreate a filtered element or its contents entry.
    await page.evaluate(() => {
      window.location.replace(`${window.location.href.split('#')[0]}#jmf-overlay`);
    });
    await expect(page).toHaveURL(/#jmf-overlay$/);
    await expect(content.locator('#jmf-overlay')).toHaveCount(0);
    await expect(contents.locator('a[href="#jmf-overlay"]')).toHaveCount(0);
    await expect(content).not.toContainText(OVERLAY_TITLE);
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, '', window.location.href.split('#')[0]);
    });

    const search = page.locator('[data-odv-manual-search="input"]');
    await search.fill(OVERLAY_TITLE);
    await expect(page.locator('.odv-manual-searchbar-count')).toHaveText('No matches');

    await contents.locator('a[href="#jmf-curtain"]').click();
    await expect(content.locator('#jmf-curtain')).toBeFocused();
    const disabledScreenshot = await screenshotPath(testInfo, `${mode}-overlay-disabled.png`);
    if (disabledScreenshot) await page.screenshot({ path: disabledScreenshot, fullPage: true });

    // The existing script-free lightbox and canonical image base survive a custom HTML fallback.
    await contents.locator('a[href="#loading"]').click();
    const thumbnail = content.locator('a[href="#lb-verktygsfalt-redo"]');
    const image = thumbnail.locator('img');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /\/help\/default\/img\//);
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    await thumbnail.click();
    const lightbox = content.locator('#lb-verktygsfalt-redo');
    await expect(lightbox).toBeVisible();
    expect(await lightbox.evaluate((node) => node.matches(':target'))).toBe(true);
    const lightboxScreenshot = await screenshotPath(testInfo, `${mode}-image-lightbox.png`);
    if (lightboxScreenshot) await page.screenshot({ path: lightboxScreenshot, fullPage: true });
    await lightbox.locator(':scope > a').click();
    await expect(lightbox).toBeHidden();
    await expect(content.locator('#jmf-overlay')).toHaveCount(0);
    expect(standardHtmlRequests).toEqual([]);
  });

  test(`${label} manual keeps enabled overlay help in headings, contents and search`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { standardHtmlRequests } = await openStandardManual(page, true, { source, siteManual });
    expect(standardHtmlRequests).toEqual([]);

    const content = page.locator('.odv-manual-content');
    const contents = page.locator('nav.odv-manual-toc');
    const heading = content.locator('#jmf-overlay');
    const contentsEntry = contents.locator('a[href="#jmf-overlay"]');
    await expect(heading).toBeAttached();
    await expect(contentsEntry).toBeVisible();
    await expect(content).toContainText(OVERLAY_TITLE);

    await contentsEntry.click();
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(contentsEntry).toHaveAttribute('aria-current', 'true');

    await page.locator('[data-odv-manual-search="input"]').fill(OVERLAY_TITLE);
    await expect(page.locator('.odv-manual-searchbar-count')).toHaveText(/\d+ of [1-9]\d*/);
    await expect(contentsEntry.locator('.odv-manual-toc-hits')).toBeVisible();
    await expect(heading).toBeVisible();

    const enabledScreenshot = await screenshotPath(testInfo, `${mode}-overlay-enabled.png`);
    if (enabledScreenshot) await page.screenshot({ path: enabledScreenshot, fullPage: true });
    expect(standardHtmlRequests).toEqual([]);
  });
}
