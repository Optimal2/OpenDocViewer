// File: tests/ui/thumbnail-sticky-header.spec.mjs
/**
 * The inline "DOK n" header and the sticky header shown while scrolling the thumbnail strip are
 * one component (DocumentBoundaryHeader in src/components/DocumentThumbnailList.jsx): identical
 * rendering, never visible together for the same document, and the sticky one carries a working
 * signature symbol without announcing it twice.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

/**
 * Headers of DOK 1 that are actually visible inside the thumbnail strip's viewport.
 * @param {import('@playwright/test').Page} page
 */
async function visibleFirstDocumentHeaders(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.thumbnails-container');
    const viewport = strip.getBoundingClientRect();
    return Array.from(strip.querySelectorAll('.thumbnail-document-boundary.start[data-document-number="1"]'))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.height > 0 && box.bottom > viewport.top + 0.5 && box.top < viewport.bottom - 0.5;
      })
      .map((node) => ({ sticky: node.classList.contains('is-sticky'), ariaHidden: node.getAttribute('aria-hidden') }));
  });
}

/**
 * Computed metrics that must match between the inline and the sticky header.
 * @param {import('@playwright/test').Locator} header
 */
function headerMetrics(header) {
  return header.evaluate((node) => {
    const label = node.querySelector('.thumbnail-document-boundary-label');
    const badge = node.querySelector('.odv-signature-badge');
    const pick = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        width: Math.round(box.width), height: Math.round(box.height),
        fontSize: style.fontSize, fontWeight: style.fontWeight, fontFamily: style.fontFamily,
        letterSpacing: style.letterSpacing, padding: style.padding,
      };
    };
    const box = node.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height), gap: getComputedStyle(node).columnGap, label: pick(label), badge: pick(badge) };
  });
}

test('sticky document header appears only after the inline header scrolled out and has a working symbol', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 520 });
  await loadSession(page);
  await expect(page.locator('[data-thumbnail-row="thumbnail-4"] .odv-signature-badge--thumbnail')).toBeVisible();
  const strip = page.locator('.thumbnails-container');

  // scrollTop 0: exactly one DOK 1 header, the inline one; no sticky header at all.
  await strip.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(() => visibleFirstDocumentHeaders(page)).toEqual([{ sticky: false, ariaHidden: null }]);
  await expect(page.locator('.thumbnail-sticky-document-header')).toHaveCount(0);
  const inline = page.locator('.thumbnails-static-list .thumbnail-document-boundary.start[data-document-number="1"]');
  const inlineMetrics = await headerMetrics(inline);

  // Scroll past the inline header but stay inside DOK 1: exactly one header, the sticky one.
  const scrollPast = await inline.evaluate((node) => Math.ceil(node.getBoundingClientRect().bottom
    - node.closest('.thumbnails-container').getBoundingClientRect().top) + 4);
  await strip.evaluate((node, top) => { node.scrollTop = top; }, scrollPast);
  await expect.poll(() => visibleFirstDocumentHeaders(page)).toEqual([{ sticky: true, ariaHidden: null }]);

  // The scrolled-out inline twin is out of the accessibility tree and the tab order.
  await expect(inline).toHaveAttribute('aria-hidden', 'true');
  expect(await inline.evaluate((node) => node.inert)).toBe(true);
  const sticky = page.locator('.thumbnail-sticky-document-header .thumbnail-document-boundary.is-sticky');
  await expect(sticky).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: /Signed document, 3 signatures/ })).toHaveCount(1);

  // Pixel-identical rendering: same size, typography and spacing as the inline header.
  expect(await headerMetrics(sticky)).toEqual(inlineMetrics);

  // The sticky symbol opens the document dialog and focus returns to it.
  const symbol = sticky.locator('.odv-signature-badge--document');
  await expect(symbol).toHaveAttribute('aria-label', /3 signatures/);
  await symbol.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(symbol).toBeFocused();

  // Back at the top the sticky header disappears and the inline one is accessible again.
  await strip.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(() => visibleFirstDocumentHeaders(page)).toEqual([{ sticky: false, ariaHidden: null }]);
  await expect(page.locator('.thumbnail-sticky-document-header')).toHaveCount(0);
});

test('sticky document header still appears when off-screen rows skip rendering (viewport strategy)', async ({ page }) => {
  // 'viewport' thumbnail loading gives every row shell content-visibility:auto, so the first
  // document's inline header is skipped once it is far out of view. Chromium force-lays-out
  // skipped content when it is measured; engines that skip it report an empty rect instead.
  // Emulate the latter for inline headers in off-screen rows, so the sticky header must not
  // depend on measuring content that may be skipped.
  await page.addInitScript(() => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const shell = this.classList?.contains('thumbnail-document-boundary') && !this.classList.contains('is-sticky')
        ? this.closest('.thumbnail-row-shell')
        : null;
      const strip = shell?.closest('.thumbnails-container');
      if (shell && strip && getComputedStyle(shell).contentVisibility === 'auto') {
        const row = original.call(shell);
        const view = original.call(strip);
        if (row.bottom <= view.top || row.top >= view.bottom) return new DOMRect(0, 0, 0, 0);
      }
      return original.call(this);
    };
  });
  await page.setViewportSize({ width: 1400, height: 520 });
  const longDocument = Array.from({ length: 14 }, () => '/ui-fixtures/unsigned.pdf');
  await loadSession(page, {
    siteConfig: { documentLoading: { mode: 'memory', render: { thumbnailLoadingStrategy: 'viewport' } } },
    session: {
      session: { id: 'ui-sticky-viewport' },
      documents: [
        { documentId: 'doc-long', files: longDocument },
        { documentId: 'doc-tail', files: ['/ui-fixtures/unsigned.pdf'] },
      ],
    },
  });
  const strip = page.locator('.thumbnails-container');
  await expect(page.locator('.thumbnails-static-list .thumbnail-row-shell')).toHaveCount(15);
  expect(await page.locator('.thumbnails-static-list .thumbnail-row-shell').first()
    .evaluate((node) => getComputedStyle(node).contentVisibility)).toBe('auto');

  // Jump deep into DOK 1, far enough that its first row (and inline header) is skipped.
  const rowHeight = await page.locator('.thumbnails-static-list .thumbnail-row-shell').first()
    .evaluate((node) => node.getBoundingClientRect().height);
  await strip.evaluate((node, top) => { node.scrollTop = top; }, Math.round(rowHeight * 9));
  const sticky = page.locator('.thumbnail-sticky-document-header .thumbnail-document-boundary.is-sticky');
  await expect(sticky).toHaveAttribute('data-document-number', '1');

  // Small scroll steps inside DOK 1 keep it sticky.
  await strip.evaluate((node, top) => { node.scrollTop = top; }, Math.round(rowHeight * 9.5));
  await expect(sticky).toHaveAttribute('data-document-number', '1');

  // Back at the top the sticky header disappears again.
  await strip.evaluate((node) => { node.scrollTop = 0; });
  await expect(page.locator('.thumbnail-sticky-document-header')).toHaveCount(0);
});
