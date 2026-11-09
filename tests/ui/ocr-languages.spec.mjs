// File: tests/ui/ocr-languages.spec.mjs
/**
 * `ocr.languages` as a name, end to end: with `'swedish'` the engine requests the Swedish model
 * and never the English one (the network is the proof, not the configuration), and the page
 * still gets its text layer from the one model. The default name ('auto') is what
 * ocr-on.spec.mjs runs, which sees both models requested; the array form is covered by the unit
 * tests (runtimeConfig.test.js, ocrConfig.test.js).
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SESSION = {
  session: { id: 'ui-ocr-languages' },
  documents: [{ documentId: 'scan', files: ['/ui-fixtures/language-scan.png'] }],
};

/** Draw an A4 "scan" at 150 dpi with two lines of large Swedish text and return its PNG bytes. */
async function drawSyntheticScan(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 60px Arial, Helvetica, sans-serif';
    context.textBaseline = 'top';
    context.fillText('Språkval för OCR', 120, 240);
    context.fillText('Hej världen 2026', 120, 380);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('ocr languages: "swedish" loads the Swedish model alone and never requests the English one', async ({ page }) => {
  test.setTimeout(180000);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true, languages: 'swedish' } },
    session: SESSION,
    extraFixtures: new Map([['language-scan.png', { body: scan, contentType: 'image/png' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();

  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'done', { timeout: 120000 });
  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toContainText('världen');

  const models = requests.filter((url) => /\.traineddata(\.gz)?(\?|$)/.test(url));
  expect(models.length).toBeGreaterThanOrEqual(1);
  expect(models.every((url) => /\/swe\.traineddata\.gz$/.test(url)), models.join('\n')).toBe(true);
  expect(requests.some((url) => /eng\.traineddata/.test(url))).toBe(false);
});
