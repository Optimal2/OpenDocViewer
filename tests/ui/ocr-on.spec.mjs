// File: tests/ui/ocr-on.spec.mjs
/**
 * The OCR switch on, end to end in a real browser: a site config with `ocr.enabled: true` and
 * the CSP token a site adds (`'wasm-unsafe-eval'`), a synthetic scanned page drawn in the browser
 * (no document from anywhere else), the self-hosted engine, worker and Swedish/English models
 * served by the dev server from the same origin, and finally a text layer over the page whose
 * words can be selected, copied and found. Also proves what stays the same: the page image, the
 * print stylesheet hiding the layer, and no request leaving the origin.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SCAN_TEXT = ['OpenDocViewer OCR', 'Hej världen 2026'];
const SESSION = {
  session: { id: 'ui-ocr-on' },
  documents: [{ documentId: 'scan', files: ['/ui-fixtures/synthetic-scan.png'] }],
};

/** Draw a clean A4 "scan" at 200 dpi with two lines of large text and return its PNG bytes. */
async function drawSyntheticScan(page) {
  const dataUrl = await page.evaluate((lines) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1654;
    canvas.height = 2339;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 72px Arial, Helvetica, sans-serif';
    context.textBaseline = 'top';
    lines.forEach((line, index) => context.fillText(line, 160, 300 + index * 160));
    return canvas.toDataURL('image/png');
  }, SCAN_TEXT);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/** The CSP a site deploys to turn OCR on: the shipped policy plus 'wasm-unsafe-eval'. */
function addWasmToken(html) {
  return html.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'");
}

test('ocr on: the synthetic scan gets a selectable text layer from the self-hosted engine, same origin only', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const origin = new URL(baseURL).origin;
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  // A throwaway page draws the scan; the viewer then loads it like any PNG document.
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-scan.png', { body: scan, contentType: 'image/png' }]]),
    transformIndexHtml: addWasmToken,
  });

  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const status = page.locator('.ocr-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-ocr-state', 'done', { timeout: 120000 });
  await expect(status).toHaveText(/Text tolkad|Text recognised/);

  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('data-odv-ocr', 'text-layer');
  const words = layer.locator('.ocr-text-layer-word');
  // Five words drawn; Tesseract may split or join a token at the edges, so at least four.
  expect(await words.count()).toBeGreaterThanOrEqual(SCAN_TEXT.join(' ').split(' ').length - 1);
  await expect(layer).toContainText('OpenDocViewer');
  await expect(layer).toContainText('världen');

  // The text is transparent and sits where the ink is: the first word's box is inside the page
  // image, towards its top left.
  const image = await page.locator('.document-render-container img').first().boundingBox();
  const first = await words.first().boundingBox();
  expect(first.x).toBeGreaterThan(image.x);
  expect(first.y).toBeGreaterThan(image.y);
  expect(first.x + first.width).toBeLessThan(image.x + image.width);
  expect(first.y).toBeLessThan(image.y + image.height / 3);
  expect(await words.first().evaluate((span) => getComputedStyle(span).color)).toBe('rgba(0, 0, 0, 0)');

  // Selection and copy see plain text in reading order; the browser's own find sees it too.
  const selected = await layer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected.replace(/\s+/g, ' ').trim()).toBe('OpenDocViewer OCR Hej världen 2026');
  // The browser's own find, as Ctrl+F uses it: from the top of the document, wrapping.
  const found = await page.evaluate(() => {
    window.getSelection().removeAllRanges();
    return window.find('världen', false, false, true, false, false, false);
  });
  expect(found).toBe(true);
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('världen');

  // Print hides the layer and the status; the screen shows them.
  await page.emulateMedia({ media: 'print' });
  expect(await layer.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  expect(await status.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  await page.emulateMedia({ media: 'screen' });
  await expect(layer).toBeVisible();

  // Everything the engine needed came from the viewer's own origin.
  const ocrRequests = requests.filter((url) => /\/ocr\//.test(url));
  expect(ocrRequests.length).toBeGreaterThanOrEqual(4);
  for (const url of requests) expect(url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:'), url).toBe(true);
  expect(ocrRequests.some((url) => /swe\.traineddata\.gz$/.test(url))).toBe(true);
  expect(ocrRequests.some((url) => /eng\.traineddata\.gz$/.test(url))).toBe(true);
  expect(consoleErrors.filter((text) => /ocr|tesseract|wasm/i.test(text))).toEqual([]);
});
