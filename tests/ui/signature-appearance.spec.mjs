// File: tests/ui/signature-appearance.spec.mjs
/**
 * Pixel-level regression lock for pdfjs 6.4 annotation rendering (campaign
 * opendocviewer-pdfjs-6-4-renderingsregression).
 *
 * The viewer rasterizes PDF pages through `page.render({ canvasContext, viewport })`
 * without an explicit annotationMode, so pdfjs' default (AnnotationMode.ENABLE)
 * decides whether signature appearances are painted into the page image. pdfjs
 * 6.4 changed annotation rendering; these specs prove, in a real browser, that
 *
 *   - a signature widget WITH an /AP appearance stream (visible signature) is
 *     painted into the main page image and into the thumbnail, and
 *   - a signature widget WITHOUT an appearance stream (invisible signature)
 *     paints nothing, in both the non-zero-rect and the zero-rect/hidden-flag
 *     shapes.
 *
 * The fixtures come from scripts/generate-signature-fixtures.mjs; the visible
 * appearance is a solid blue banner ("signature blue"), so the assertions
 * count blue pixels inside the widget rect of the rasterized page.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SESSION = {
  session: { id: 'ui-signature-appearance' },
  documents: [
    { documentId: 'doc-a', files: ['/ui-fixtures/visible-appearance.pdf'] },
    { documentId: 'doc-b', files: ['/ui-fixtures/invisible-appearance.pdf'] },
    { documentId: 'doc-c', files: ['/ui-fixtures/cades-ecdsa-invisible.pdf'] },
  ],
};

/**
 * Widget rect [60 640 320 700] (PDF user units, bottom-left origin) on a
 * 595x842 page, expressed as top-left-origin fractions of the raster.
 */
const SIGNATURE_REGION = {
  x0: 60 / 595,
  x1: 320 / 595,
  y0: (842 - 700) / 842,
  y1: (842 - 640) / 842,
};

/**
 * Draw the rendered page image into a canvas and count "signature blue"
 * pixels inside the widget region. Returns { blue, total } for the region.
 * @param {import('@playwright/test').Locator} image
 * @returns {Promise<{ blue:number, total:number }>}
 */
async function countSignatureBlue(image, region = SIGNATURE_REGION) {
  return image.evaluate((node, rect) => {
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(node, 0, 0);
    const x0 = Math.floor(canvas.width * rect.x0);
    const x1 = Math.ceil(canvas.width * rect.x1);
    const y0 = Math.floor(canvas.height * rect.y0);
    const y1 = Math.ceil(canvas.height * rect.y1);
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > 120 && b > r + 80 && b > g + 60) blue += 1;
    }
    return { blue, total: data.length / 4 };
  }, region);
}

/**
 * Wait until the given image locator points at a fully decoded raster and
 * return it.
 * @param {import('@playwright/test').Locator} image
 */
async function waitForRaster(image) {
  await expect(image).toBeVisible();
  await expect.poll(async () => image.evaluate(
    (node) => (node.complete && node.naturalWidth > 0 ? node.naturalWidth : 0)
  )).toBeGreaterThan(0);
  return image;
}

/** Main-view image for a session page (1-based). */
function mainPageImage(page, pageNumber) {
  return page.locator(`.document-render-container img[data-page-number="${pageNumber}"]`).first();
}

test('visible signature appearance is painted into the main page and the thumbnail', async ({ page }) => {
  await loadSession(page, { session: SESSION });

  // Main page image (session page 1 = visible-appearance.pdf).
  const main = await waitForRaster(mainPageImage(page, 1));
  const mainCount = await countSignatureBlue(main);
  expect(mainCount.blue).toBeGreaterThan(mainCount.total * 0.5);

  // Thumbnail of the same page goes through the same pdfjs render call.
  const thumbnail = await waitForRaster(page.locator('#thumbnail-1 img.thumbnail').first());
  const thumbCount = await countSignatureBlue(thumbnail);
  expect(thumbCount.blue).toBeGreaterThan(thumbCount.total * 0.5);
});

test('invisible signatures paint nothing, in both invisible shapes', async ({ page }) => {
  await loadSession(page, { session: SESSION });

  // Page 2: non-zero widget rect but no /AP appearance stream.
  await page.locator('#thumbnail-2').click();
  const main2 = await waitForRaster(mainPageImage(page, 2));
  const count2 = await countSignatureBlue(main2);
  expect(count2.blue).toBe(0);

  // Page 3: zero-rect widget with the hidden flag (cades-ecdsa-invisible.pdf).
  await page.locator('#thumbnail-3').click();
  const main3 = await waitForRaster(mainPageImage(page, 3));
  const count3 = await countSignatureBlue(main3);
  expect(count3.blue).toBe(0);

  // The thumbnails of the invisible pages stay free of the banner as well.
  const thumb2 = await waitForRaster(page.locator('#thumbnail-2 img.thumbnail').first());
  expect((await countSignatureBlue(thumb2)).blue).toBe(0);
  const thumb3 = await waitForRaster(page.locator('#thumbnail-3 img.thumbnail').first());
  expect((await countSignatureBlue(thumb3)).blue).toBe(0);
});

test('the signature pipeline still detects both appearance shapes', async ({ page }) => {
  await loadSession(page, { session: SESSION });

  // Level-1 badges rely on the byte-level parser, not on the painted
  // appearance: both the visible and the invisible pages get a page symbol,
  // and the overview button reports all three signed documents.
  await expect(page.locator('[data-thumbnail-row="thumbnail-1"] .odv-signature-badge--thumbnail')).toBeVisible();
  await expect(page.locator('[data-thumbnail-row="thumbnail-2"] .odv-signature-badge--thumbnail')).toBeVisible();
  await expect(page.locator('[data-thumbnail-row="thumbnail-3"] .odv-signature-badge--thumbnail')).toBeVisible();
  await expect(page.locator('.odv-signature-overview-button')).toHaveAttribute('aria-label', /3 signed documents/);
});
