// File: tests/ui/ocr-boost.spec.mjs
/**
 * The OCR boost (`ocr.boost`), end to end in a real browser: a three-page synthetic document
 * (drawn in the browser; no document from anywhere else), the client pinned to two threads so the
 * cautious count is one engine, and the boost's idle trigger set to one second. With nothing
 * happening the boost control climbs to its one level above the cautious count, two engines, so
 * the browser starts a second tesseract.js worker while the first still works; with the key off
 * (the shipped default) the same document is recognised by one engine throughout. Everything
 * stays on the viewer's own origin either way, and the reference page is never requested.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const PAGE_FILES = ['/ui-fixtures/boost-1.png', '/ui-fixtures/boost-2.png', '/ui-fixtures/boost-3.png'];
const SESSION = {
  session: { id: 'ui-ocr-boost' },
  documents: [{ documentId: 'boost', files: PAGE_FILES }],
};

/** A clean A4 "scan" at 150 dpi with two lines of large text, as PNG bytes. */
async function drawSyntheticScan(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 64px Arial, Helvetica, sans-serif';
    context.textBaseline = 'top';
    ['OpenDocViewer boost', 'Sida med text 2026'].forEach((line, index) => context.fillText(line, 120, 240 + index * 140));
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/** Pin the client the boost plans with: two threads (cautious count one), memory for several engines. */
async function pinClient(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 2 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 8 });
  });
}

/** tesseract.js starts each engine's worker from a blob URL; the preparation worker comes from the origin. */
const engineWorkers = (workers) => workers.filter((url) => url.startsWith('blob:'));

async function openDocument(page, siteConfig) {
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await pinClient(page);
  const fixtures = new Map(PAGE_FILES.map((file) => [file.split('/').pop(), { body: scan, contentType: 'image/png' }]));
  await loadSession(page, { siteConfig, session: SESSION, extraFixtures: fixtures });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
}

test('ocr boost on: left alone, the viewer starts a second engine for the waiting pages, on its own origin', async ({ page, baseURL }) => {
  test.setTimeout(240000);
  const origin = new URL(baseURL).origin;
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));

  await openDocument(page, { ocr: { enabled: true, boost: { enabled: true, idleAfterMs: 1000 } } });

  // The first page starts on the one cautious engine.
  await expect.poll(() => engineWorkers(workers).length, { timeout: 60000 }).toBeGreaterThanOrEqual(1);
  // Nothing happens on the page: after the idle second the control measures the reference page
  // at the cautious count and climbs to two engines, so a second worker starts while pages wait.
  await expect.poll(() => engineWorkers(workers).length, { timeout: 150000 }).toBeGreaterThanOrEqual(2);
  // The shown page is recognised as before.
  await expect(page.locator('.toolbar [data-odv-ocr="status"]')).toHaveAttribute('data-ocr-state', 'done', { timeout: 120000 });
  // The toolbar says so: the search carries the boost's state and the tooltip ends with a line
  // about it (which line depends on how the climb went on this machine).
  await expect(page.locator('.toolbar [data-odv-ocr="search"]')).toHaveAttribute('data-ocr-boost', /cautious|rising|boosted/);
  await expect(page.locator('.toolbar [data-odv-ocr="status"]')).toHaveAttribute('title', /(Boost|boost|Pådrag|pådrag)/);

  // Everything stayed on the viewer's own origin, and the reference page was drawn, not fetched.
  for (const url of requests) expect(url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:'), url).toBe(true);
  expect(requests.filter((url) => /reference[^/]*\.(png|jpe?g|webp|gif)$/i.test(url))).toEqual([]);
  expect(consoleErrors.filter((text) => /ocr|tesseract|wasm|boost/i.test(text))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('ocr boost off (the default): the same document is recognised by the cautious engine alone', async ({ page }) => {
  test.setTimeout(240000);
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));

  await openDocument(page, { ocr: { enabled: true } });

  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'done', { timeout: 120000 });
  // Give the queue the time the boosted run needed to grow, then look: still one engine.
  await page.waitForTimeout(5000);
  expect(engineWorkers(workers)).toHaveLength(1);
  // And the toolbar says nothing about a boost: no attribute, no badge, no tooltip line.
  expect(await page.locator('.toolbar [data-odv-ocr="search"]').getAttribute('data-ocr-boost')).toBeNull();
  await expect(page.locator('[data-odv-ocr="boost"]')).toHaveCount(0);
  expect(await status.getAttribute('title')).not.toMatch(/boost|pådrag/i);
});
