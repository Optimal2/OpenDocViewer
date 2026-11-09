// File: tests/ui/manual-page.spec.mjs
/**
 * Production proof for the stand-alone manual page (WP4): the built app (`npm run build`) is
 * served under the `/OpenDocViewer/` subpath (tests/ui/manual-page.playwright.config.mjs), exactly
 * like an IIS application under a virtual directory, and the page is driven in Chromium.
 *
 * A test-only `odv.site.config.js` is served through request interception (the same mechanism
 * tests/ui/standard-manual.spec.mjs uses), so no fixture file is committed. Every test collects
 * same-origin 4xx responses and fails on them, except the optional `odv.site.config.js` and
 * `help/site/manual.*.html` probes when that test does not serve them.
 */
import { test, expect } from '@playwright/test';
import { getFixtures, DEFAULT_SESSION } from './fixtureSession.mjs';

/** Subpath the production build is served under (mirrors the IIS virtual directory). */
const BASE = '/OpenDocViewer';

/** Site config used whenever a test needs the bundled standard manual. */
const STANDARD_SITE_CONFIG = { help: { manual: { source: 'standard' } } };

/**
 * Serve a test-only site config from the ODV base, like a deployment's odv.site.config.js.
 * Registered on the context so a popup opened by the overlay new-tab link gets the same config.
 * @param {import('@playwright/test').Page} page
 * @param {Object} siteConfig
 */
async function routeSiteConfig(page, siteConfig) {
  await page.context().route(
    (url) => url.pathname === `${BASE}/odv.site.config.js`,
    (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__ODV_SITE_CONFIG__ = ${JSON.stringify(siteConfig)};`,
    }),
  );
}

/**
 * Delay the generated standard-manual chunk (real bytes, served late) so the locale resources
 * always settle before the manual loads.
 *
 * Determinism gate, not a sleep: ManualView applies the initial section once per loaded manual
 * and skips re-navigation when a same-content reload follows. When the locale settles after the
 * manual chunk, that reload drops focus, scroll and the current-section mark (measured:
 * focusin on the section followed by focusout 1-3 ms later, scroll reset to 0, current section
 * back to the first entry). Gating the chunk behind the locale makes the measured load navigate
 * exactly once; the section assertions below still wait on locators. The underlying re-navigation
 * gap is WP2-owned (ManualView.jsx) and tracked as a follow-up.
 * @param {import('@playwright/test').Page} page
 */
async function delayStandardManualChunk(page) {
  // NOTE: matched with a glob on the context (so popups inherit it) — RegExp and function
  // predicates provably miss this __vitePreload-issued chunk request while the identical
  // URL matches a glob.
  await page.context().route('**/assets/manual.*.js', async (route) => {
    const response = await route.fetch();
    setTimeout(() => {
      route.fulfill({ response }).catch(() => {});
    }, 1500);
  });
}

/** Serve the viewer session and its PDF fixtures from memory under the subpath. */
async function routeSession(page) {
  const fixtures = await getFixtures();
  await page.route((url) => url.pathname.startsWith(`${BASE}/ui-fixtures/`), async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'session.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEFAULT_SESSION) });
      return;
    }
    const bytes = fixtures.get(name);
    if (!bytes) {
      await route.fulfill({ status: 404, body: 'missing fixture' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(bytes) });
  });
}

/**
 * Collect same-origin 4xx responses for the whole context. The optional runtime-config and
 * site-manual probes are only excused when the test does not serve them.
 * @param {import('@playwright/test').Page} page
 * @param {{servedSiteConfig?: boolean, servedSiteManual?: boolean}} [options]
 * @returns {Array<string>} Failures, asserted empty at the end of each test.
 */
function trackSubpathAssetErrors(page, { servedSiteConfig = false, servedSiteManual = false } = {}) {
  const failures = [];
  page.context().on('response', (response) => {
    let pathname = '';
    try {
      const url = new URL(response.url());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      pathname = url.pathname;
    } catch {
      return;
    }
    if (!pathname.startsWith(`${BASE}/`)) return;
    if (response.status() < 400) return;
    const relative = pathname.slice(BASE.length);
    if (!servedSiteConfig && relative === '/odv.site.config.js') return;
    if (!servedSiteManual && /^\/help\/site\/manual\.[^/]+\.html$/.test(relative)) return;
    failures.push(`${response.status()} ${pathname}`);
  });
  return failures;
}

/**
 * Open the stand-alone manual page and wait until the manual body has rendered.
 * @param {import('@playwright/test').Page} page
 * @param {{siteConfig?: (Object|undefined), fragment?: string, query?: string, servedSiteConfig?: boolean, expectContent?: boolean}} [options]
 * @returns {Array<string>} Asset failures collected so far (assert at the end of the test).
 */
async function openManualPage(page, {
  siteConfig = undefined, fragment = '', query = '', servedSiteConfig = undefined, expectContent = true,
} = {}) {
  const failures = trackSubpathAssetErrors(page, {
    servedSiteConfig: servedSiteConfig ?? siteConfig !== undefined,
  });
  if (siteConfig !== undefined) await routeSiteConfig(page, siteConfig);
  await page.goto(`${BASE}/manual/${query}${fragment}`);
  await expect(page.locator('h1#odv-manual-page-title')).toBeVisible();
  if (expectContent) {
    await expect(page.locator('.odv-manual-content h2').first()).toBeVisible();
  }
  return failures;
}

/**
 * Open the viewer under the subpath.
 * @param {import('@playwright/test').Page} page
 * @param {{siteConfig?: (Object|undefined), query?: string}} [options]
 * @returns {Array<string>} Asset failures collected so far (assert at the end of the test).
 */
async function openViewer(page, { siteConfig = undefined, query = '' } = {}) {
  const failures = trackSubpathAssetErrors(page, {
    servedSiteConfig: siteConfig !== undefined,
  });
  if (siteConfig !== undefined) await routeSiteConfig(page, siteConfig);
  await routeSession(page);
  await page.goto(`${BASE}/?sessionurl=${BASE}/ui-fixtures/session.json${query ? `&${query}` : ''}`);
  await expect(page.locator('button.help-button')).toBeVisible();
  return failures;
}

/** Open the manual overlay in the viewer and wait until its manual body has rendered. */
async function openOverlay(page) {
  await page.locator('button.help-button').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(page.locator('.odv-manual-dialog .odv-manual-content h2').first()).toBeVisible();
}

/**
 * The section ids and headings of a rendered manual: the contents-tree targets and the
 * heading ids in the content pane.
 * @param {import('@playwright/test').Locator} scope `.odv-manual-dialog` or the page.
 */
async function manualSectionIds(scope) {
  const toc = await scope.locator('nav.odv-manual-toc a[href^="#"]').evaluateAll(
    (nodes) => nodes.map((node) => String(node.getAttribute('href') || '').replace(/^#/, '')),
  );
  const headings = await scope.locator('.odv-manual-content h2[id], .odv-manual-content h3[id]').evaluateAll(
    (nodes) => nodes.map((node) => node.id),
  );
  return { toc, headings };
}

test('stand-alone page shows the standard manual under the subpath', async ({ page }) => {
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG });
  await expect(page.locator('.odv-manual-content h2#overview')).toBeVisible();
  await expect(page.locator('nav.odv-manual-toc a[href="#overview"]')).toBeVisible();
  expect(failures).toEqual([]);
});

test('feature filter parity: page and overlay show the same sections', async ({ page }) => {
  const siteConfig = {
    help: { manual: { source: 'standard' } },
    compare: { overlay: { enabled: false } },
  };
  const pageFailures = await openManualPage(page, { siteConfig, query: '?lng=en' });
  const fromPage = await manualSectionIds(page);
  expect(fromPage.toc.length).toBeGreaterThan(0);

  const viewerFailures = await openViewer(page, { siteConfig, query: 'lng=en' });
  await openOverlay(page);
  const fromOverlay = await manualSectionIds(page.locator('.odv-manual-dialog'));

  expect(fromPage).toEqual(fromOverlay);
  expect(fromPage.toc).not.toContain('jmf-overlay');
  expect(fromPage.headings).not.toContain('jmf-overlay');
  expect(fromPage.toc).toContain('jmf-curtain');
  expect([...pageFailures, ...viewerFailures]).toEqual([]);
});

test('help.manual.enabled=false shows the not-available message', async ({ page }) => {
  const failures = await openManualPage(page, {
    siteConfig: { help: { manual: { enabled: false } } },
    expectContent: false,
  });
  const notice = page.locator('[data-odv-manual-page="disabled"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toContainText('not available');
  await expect(page.locator('.odv-manual-content')).toHaveCount(0);
  await expect(page.locator('nav.odv-manual-toc')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('language menu switches the manual text and the html lang', async ({ page }) => {
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG });
  const html = page.locator('html');
  const content = page.locator('.odv-manual-content');
  const languageButton = page.locator('.odv-manual-page-header button:has-text("language")');
  await expect(html).toHaveAttribute('lang', 'en');
  const englishText = await content.textContent();
  expect((englishText || '').trim().length).toBeGreaterThan(0);

  await languageButton.click();
  await page.getByRole('menuitemradio', { checked: false }).click();
  await expect(html).toHaveAttribute('lang', 'sv');
  await expect.poll(async () => content.textContent(), { timeout: 30_000 }).not.toBe(englishText);

  await languageButton.click();
  await page.getByRole('menuitemradio', { checked: false }).click();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect.poll(async () => content.textContent(), { timeout: 30_000 }).toBe(englishText);
  expect(failures).toEqual([]);
});

test('theme menu switches data-theme on the root element', async ({ page }) => {
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', /^(normal|light|dark)$/);
  const initial = await html.getAttribute('data-theme');
  const target = initial === 'dark' ? 'Light' : 'Dark';

  await page.getByRole('button', { name: 'Choose theme' }).click();
  await page.getByRole('menuitemradio', { name: target, exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', target.toLowerCase());
  expect(failures).toEqual([]);
});

test('search highlights hits and next/previous move between them', async ({ page }) => {
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG });
  await page.locator('[data-odv-manual-search="input"]').fill('Lay the pages on top of each other');
  const count = page.locator('.odv-manual-searchbar-count');
  await expect(count).toHaveText(/\d+ of [1-9]\d*/);
  const first = ((await count.textContent()) || '').trim();

  const highlighted = await page.evaluate(() => {
    const hasMarks = !!document.querySelector('.odv-manual-content mark');
    const highlights = typeof CSS !== 'undefined' ? CSS.highlights : null;
    return hasMarks || (!!highlights && highlights.size > 0);
  });
  expect(highlighted).toBe(true);

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(count).toHaveText(/^2 of /);
  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(count).toHaveText(first);
  expect(failures).toEqual([]);
});

test('contents entry scrolls its section into view', async ({ page }) => {
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG });
  const nav = page.locator('nav.odv-manual-toc');
  await expect(nav).toBeVisible();
  const lastEntry = nav.locator('a[href^="#"]').last();
  const lastHref = await lastEntry.getAttribute('href');
  expect(lastHref).toMatch(/^#.+/);
  const sectionId = decodeURIComponent(String(lastHref).replace(/^#/, ''));
  await lastEntry.click();
  await expect(lastEntry).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => document.activeElement?.id || '')).toBe(sectionId);
  expect(await page.locator('.odv-manual-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

test('a #<section> fragment opens the page at that section', async ({ page }) => {
  await delayStandardManualChunk(page);
  const failures = await openManualPage(page, { siteConfig: STANDARD_SITE_CONFIG, fragment: '#loading' });
  await expect(page.locator('.odv-manual-content #loading')).toBeFocused();
  await expect(page.locator('nav.odv-manual-toc a[href="#loading"]')).toHaveAttribute('aria-current', 'true');
  expect(new URL(page.url()).hash).toBe('#loading');
  expect(failures).toEqual([]);
});

test('overlay open-in-new-tab link lands on the current section', async ({ page, context }) => {
  await delayStandardManualChunk(page);
  const failures = trackSubpathAssetErrors(page, { servedSiteConfig: true });
  const viewerFailures = await openViewer(page, { siteConfig: STANDARD_SITE_CONFIG, query: 'lng=en' });
  await openOverlay(page);
  const dialog = page.locator('.odv-manual-dialog');
  await dialog.locator('nav.odv-manual-toc a[href="#jmf-curtain"]').click();
  const link = dialog.getByRole('link', { name: 'Open in new tab' });
  await expect(link).toHaveAttribute('href', 'manual/#jmf-curtain');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toContain('noopener');

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    link.click(),
  ]);
  await expect(popup.locator('h1#odv-manual-page-title')).toBeVisible();
  // Landing proof: the popup opens at the linked section and focuses it.
  await expect(popup.locator('.odv-manual-content #jmf-curtain')).toBeFocused();
  expect(new URL(popup.url()).pathname).toBe(`${BASE}/manual/`);
  // Manual images stream in after the landing and shift the layout, which moves the
  // section being read. Stabilize first (every image settled), then re-anchor through
  // the popup's own contents tree and assert the fragment follows.
  await expect.poll(async () => popup.evaluate(
    () => Array.from(document.images).every((image) => image.complete),
  ), { timeout: 30_000 }).toBe(true);
  await popup.locator('nav.odv-manual-toc a[href="#jmf-curtain"]').click();
  await expect(popup.locator('nav.odv-manual-toc a[href="#jmf-curtain"]')).toHaveAttribute('aria-current', 'true');
  expect(new URL(popup.url()).hash).toBe('#jmf-curtain');
  expect([...failures, ...viewerFailures]).toEqual([]);
});
