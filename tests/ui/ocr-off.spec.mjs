// File: tests/ui/ocr-off.spec.mjs
/**
 * The OCR switch is off by default, and off means nothing: with the shipped configuration the
 * viewer loads a session and renders pages without requesting anything under /ocr/ or
 * /src/ocr/, without starting an OCR worker and without an OCR element in the DOM. The second
 * test proves the plumbing for the on state exists: the dev server serves the engine files at the
 * exact paths the build injects, so a site that turns the switch on finds them.
 */
import { test, expect } from '@playwright/test';
import { describeOcrAssets } from '../../scripts/ocr-assets.mjs';
import { loadSession } from './fixtureSession.mjs';

const OCR_URL_PATTERN = /\/ocr\/|\/src\/ocr\/|tesseract|odv-ocr-assets/i;

/**
 * The viewer keeps connections open (prefetch, log transport), so `networkidle` never arrives.
 * A negative test needs a window in which nothing happens after the first page has rendered;
 * the hook that would import the module runs on mount, long before that.
 * @param {import('@playwright/test').Page} page
 */
async function settle(page) {
  await page.waitForTimeout(1500);
}

test('ocr off by default: no engine requests, no OCR worker, no OCR element', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));

  await loadSession(page);
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await expect(page.locator('.document-render-container canvas, .document-render-container img').first()).toBeVisible();
  await settle(page);

  expect(requests.filter((url) => OCR_URL_PATTERN.test(url))).toEqual([]);
  expect(workers.filter((url) => OCR_URL_PATTERN.test(url))).toEqual([]);
  expect(workers.filter((url) => url.startsWith('blob:'))).toEqual([]);
  await expect(page.locator('[data-odv-ocr], .ocr-text-layer')).toHaveCount(0);
});

test('ocr off stays off when a site file sets anything but the literal true', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));

  await loadSession(page, { siteConfig: { ocr: { enabled: 'true', languages: ['swe'] } } });
  await expect(page.locator('#thumbnail-1 .thumbnail-image-stage img')).toBeVisible();
  await settle(page);

  expect(requests.filter((url) => OCR_URL_PATTERN.test(url))).toEqual([]);
  await expect(page.locator('[data-odv-ocr], .ocr-text-layer')).toHaveCount(0);
});

test('the dev server serves the engine files at the paths the build injects', async ({ request }) => {
  const { manifest } = describeOcrAssets(new URL('../../node_modules/', import.meta.url));
  const paths = [manifest.workerPath, manifest.corePath, ...manifest.languages.map((lang) => `${manifest.langPath}${lang}.traineddata.gz`)];
  for (const path of paths) {
    const response = await request.get(`/${path}`);
    expect(response.status(), path).toBe(200);
    expect(Number(response.headers()['content-length'] || (await response.body()).length), path).toBeGreaterThan(1000);
  }
  // An unknown name under ocr/ is not served by the OCR middleware: the dev server answers with
  // its index.html fallback, never with a script.
  const missing = await request.get(`/${manifest.root}does-not-exist.js`);
  expect(String(missing.headers()['content-type'] || '')).not.toMatch(/javascript/);
});
