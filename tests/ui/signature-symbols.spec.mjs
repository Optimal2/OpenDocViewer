// File: tests/ui/signature-symbols.spec.mjs
/**
 * Browser checks for the signature symbols and the toolbar signature overview
 * (docs-src/pdf-signatures.md, "Level-1 user interface").
 *
 * The viewer loads a session through `?sessionurl=`; the session JSON and the
 * PDFs are synthetic fixtures from scripts/generate-signature-fixtures.mjs,
 * served from memory with request interception (nothing is written to disk).
 *
 * Session layout (thumbnail page = session page):
 *   DOK 1 = valid-rsa.pdf (page 1) + two-signatures.pdf (page 2) -> 3 signatures, two signed files
 *   DOK 2 = unsigned.pdf (page 3)
 *   DOK 3 = extended-after-signing.pdf (page 4) -> warning severity
 */
import { test, expect } from '@playwright/test';
import { createSignatureFixtures } from '../../scripts/generate-signature-fixtures.mjs';

/** @type {Map<string, Uint8Array>} */
let fixtures;

const SESSION = {
  session: { id: 'ui-signature-symbols' },
  documents: [
    { documentId: 'doc-a', files: ['/ui-fixtures/valid-rsa.pdf', '/ui-fixtures/two-signatures.pdf'] },
    { documentId: 'doc-b', files: ['/ui-fixtures/unsigned.pdf'] },
    { documentId: 'doc-c', files: ['/ui-fixtures/extended-after-signing.pdf'] },
  ],
};

test.beforeAll(async () => {
  const generated = await createSignatureFixtures();
  fixtures = generated instanceof Map ? generated : new Map(Object.entries(generated));
});

/**
 * Serve the session and fixtures from memory and open the viewer.
 * @param {import('@playwright/test').Page} page
 * @param {Object} [siteConfig] Optional site config served as odv.site.config.js.
 */
async function loadSession(page, siteConfig = null) {
  if (siteConfig) {
    // Served like a deployment's odv.site.config.js; bootConfig only keeps overrides from that file.
    await page.route((url) => url.pathname === '/odv.site.config.js', (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__ODV_SITE_CONFIG__ = ${JSON.stringify(siteConfig)};`,
    }));
  }
  await page.route((url) => url.pathname.startsWith('/ui-fixtures/'), async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'session.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
      return;
    }
    const bytes = fixtures.get(name);
    if (!bytes) {
      await route.fulfill({ status: 404, body: 'missing fixture' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(bytes) });
  });
  await page.goto('/?sessionurl=/ui-fixtures/session.json');
}

/**
 * Open the session and wait until the last signed file's report has arrived (inspection starts
 * after the first page is ready and runs one file at a time).
 * @param {import('@playwright/test').Page} page
 */
async function openSession(page) {
  await loadSession(page);
  await expect(page.locator('#thumbnail-4 .odv-signature-badge--thumbnail')).toBeVisible();
}

/** @param {{x:number,y:number,width:number,height:number}} a @param {{x:number,y:number,width:number,height:number}} b */
function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('D2 page symbol is on every signed page, centred at the top and clear of the compare markers', async ({ page }) => {
  await openSession(page);
  await expect(page.locator('#thumbnail-1 .odv-signature-badge--thumbnail')).toBeVisible();
  await expect(page.locator('#thumbnail-2 .odv-signature-badge--thumbnail')).toBeVisible();
  await expect(page.locator('#thumbnail-3 .odv-signature-badge')).toHaveCount(0);

  // Compare mode with BOTH markers (L and R) on the signed page 1.
  await page.locator('#thumbnail-1').click({ button: 'right' });
  await page.locator('.odv-context-menu-item', { hasText: /show to right/i }).click();
  const markers = page.locator('#thumbnail-1 .thumbnail-selection-badges.overlay-corner');
  await expect(markers.locator('.thumbnail-selection-badge.primary')).toBeVisible();
  await expect(markers.locator('.thumbnail-selection-badge.compare')).toBeVisible();

  const badge = page.locator('#thumbnail-1 .odv-signature-badge--thumbnail');
  const badgeBox = await badge.boundingBox();
  const markerBox = await markers.boundingBox();
  const stageBox = await page.locator('#thumbnail-1 .thumbnail-image-stage').boundingBox();
  expect(badgeBox && markerBox && stageBox).toBeTruthy();
  expect(intersects(badgeBox, markerBox)).toBe(false);
  // 22px pill, horizontally centred on the image stage, at its top edge.
  expect(Math.round(badgeBox.width)).toBe(22);
  expect(Math.round(badgeBox.height)).toBe(22);
  expect(Math.abs((badgeBox.x + badgeBox.width / 2) - (stageBox.x + stageBox.width / 2))).toBeLessThanOrEqual(1);
  expect(badgeBox.y - stageBox.y).toBeLessThanOrEqual(4);
  const glyphSize = await badge.locator('.material-icons').evaluate((node) => getComputedStyle(node).fontSize);
  expect(glyphSize).toBe('18px');
});

test('D2 page symbol is discreet at rest and fully opaque on hover and keyboard focus', async ({ page }) => {
  await openSession(page);
  const badge = page.locator('#thumbnail-2 .odv-signature-badge--thumbnail');
  const opacity = () => badge.evaluate((node) => Number(getComputedStyle(node).opacity));
  const rest = await opacity();
  expect(rest).toBeGreaterThan(0.4);
  expect(rest).toBeLessThan(0.7);

  await badge.hover();
  const hover = await opacity();
  expect(hover).toBeGreaterThan(rest);
  expect(hover).toBe(1);
  const hoverBackground = await badge.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(hoverBackground).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/);

  await page.mouse.move(0, 0);
  await badge.focus();
  await page.keyboard.press('Shift');
  const focused = await badge.evaluate((node) => ({
    opacity: Number(getComputedStyle(node).opacity),
    outline: getComputedStyle(node).outlineStyle,
    focusVisible: node.matches(':focus-visible'),
  }));
  expect(focused.focusVisible).toBe(true);
  expect(focused.opacity).toBe(1);
  expect(focused.outline).not.toBe('none');
});

test('D1 document symbol aggregates the files and opens the dialog with file tabs', async ({ page }) => {
  await openSession(page);
  const docSymbol = page.locator('.thumbnail-document-boundary.start .odv-signature-badge--document').first();
  await expect(docSymbol).toBeVisible();
  await expect(docSymbol).toHaveAttribute('aria-label', /3 signatures/);
  await expect(page.locator('.odv-signature-badge--document')).toHaveCount(2);

  const selectedBefore = await page.locator('#thumbnail-1').getAttribute('aria-selected');
  await docSymbol.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const tabs = dialog.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0).locator('.odv-signature-file-tab-label')).toHaveText('valid-rsa.pdf');
  await expect(dialog.locator('.odv-signature-file-heading')).toHaveText('File 1 of 2: valid-rsa.pdf');
  await expect(dialog.locator('.odv-signature-file-pages')).toHaveText('Page 1');
  await tabs.nth(0).press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.odv-signature-entry')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(docSymbol).toBeFocused();
  // The symbol did not steal the click that selects a page.
  expect(await page.locator('#thumbnail-1').getAttribute('aria-selected')).toBe(selectedBefore);

  // A page symbol opens the same document dialog with its own file preselected, named in the
  // group heading with its page range inside the document.
  await page.locator('#thumbnail-2 .odv-signature-badge--thumbnail').click();
  const fromPage = page.getByRole('dialog');
  await expect(fromPage.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(fromPage.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(fromPage.locator('.odv-signature-file-heading')).toHaveText('File 2 of 2: two-signatures.pdf');
  await expect(fromPage.locator('.odv-signature-file-pages')).toHaveText('Page 2');
  // The active tab is filled (inverted colours), the inactive one is not.
  const fills = await fromPage.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => getComputedStyle(tab).backgroundColor));
  expect(fills[1]).not.toBe(fills[0]);
  // Signing times are local "YYYY-MM-DD HH:MM" with the UTC ISO value in the title.
  const time = fromPage.locator('.odv-signature-entry time').first();
  await expect(time).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await expect(time).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Without ODVGateway the trust note explains why validity is not checked.
  await expect(fromPage.locator('.odv-signature-trust--unavailable').first()).toContainText('opened through ODVGateway');
});

test('D3 toolbar overview lists signed documents and navigates without closing', async ({ page }) => {
  await openSession(page);
  const button = page.locator('.odv-signature-overview-button');
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-label', /2 signed documents/);
  await expect(button).toHaveClass(/odv-signature-badge--warning/);

  await button.click();
  const dialog = page.getByRole('dialog');
  const rows = dialog.locator('.odv-signature-overview-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(0)).toContainText('valid-rsa.pdf');
  await expect(rows.nth(0)).toContainText('two-signatures.pdf');
  await expect(rows.nth(0)).toContainText('3 signatures');

  // Keyboard: ArrowDown moves to the DOK 3 row, Enter navigates and keeps the dialog open.
  await expect(rows.nth(0).locator('.odv-signature-overview-go')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1).locator('.odv-signature-overview-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#thumbnail-4')).toHaveClass(/selected-primary|selected-focus/);
  await expect(dialog).toBeVisible();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

  // "Details" opens the per-document dialog on top; Escape closes only that one.
  await rows.nth(1).locator('.odv-signature-overview-details').click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(rows.nth(1).locator('.odv-signature-overview-details')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('pdfSignatures.thumbnailPageBadge=false hides only the page symbols', async ({ page }) => {
  await loadSession(page, { pdfSignatures: { thumbnailPageBadge: false } });
  await expect(page.locator('.odv-signature-badge--document')).toHaveCount(2);
  await expect(page.locator('.odv-signature-overview-button')).toHaveCount(1);
  await expect(page.locator('.odv-signature-badge--thumbnail')).toHaveCount(0);
});
