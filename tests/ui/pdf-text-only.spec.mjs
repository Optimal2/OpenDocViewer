// File: tests/ui/pdf-text-only.spec.mjs
/**
 * `pdfTextLayer.enabled` with OCR off, end to end in a real browser: a PDF page that has text
 * of its own gets a selectable text layer from that text and is searchable from the toolbar,
 * a PDF page without usable text stays an image and is named so, and nothing of the engine is
 * ever requested. Not the engine's files, not tesseract.js, not the full OCR module: of
 * src/ocr/ only the text-only entry and what it imports are loaded (the dev server serves the
 * module graph file by file, so the list is exact), and no OCR worker starts.
 *
 * With OCR on as well, the switch changes nothing: the same page gets the same layer under the
 * words OCR uses. The PDFs are synthetic, built here with pdf-lib.
 */
import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadSession } from './fixtureSession.mjs';

const PAGE_SIZE = [595.28, 841.89];
const LINES = [
  'Provbolaget AB bekräftar registreringen av ärendet.',
  'Diarienummer 2026-4471 gäller tills vidare.',
  'Handläggningstiden är omkring sex veckor.',
  // Enough running Swedish for the language guess to be sure (src/ocr/detectLanguage.js MIN_HITS).
  'Vi har gått igenom handlingarna och kan bekräfta att ärendet är registrerat hos oss.',
];
const SESSION = {
  session: { id: 'ui-pdf-text-only' },
  documents: [
    { documentId: 'text', files: ['/ui-fixtures/synthetic-text.pdf'] },
    { documentId: 'picture', files: ['/ui-fixtures/synthetic-picture.pdf'] },
  ],
};

/** The files of src/ocr/ the text-only entry consists of; nothing else of the folder may load. */
const TEXT_ONLY_MODULES = ['pdfText.js', 'classify.js', 'pdfTextProbe.js', 'pdfTextWords.js', 'resultCache.js', 'window.js', 'queue.js', 'detectLanguage.js'];

/** @returns {Promise<Uint8Array>} A page of running text. */
async function buildTextPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE_SIZE);
  LINES.forEach((line, index) => page.drawText(line, { x: 60, y: 780 - index * 24, size: 14, font }));
  return pdf.save();
}

/** @returns {Promise<Uint8Array>} A page that is a picture with a page number: no usable text. */
async function buildPicturePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE_SIZE);
  page.drawRectangle({ x: 60, y: 300, width: 475, height: 440, color: rgb(0.82, 0.86, 0.9) });
  page.drawText('2', { x: 290, y: 40, size: 10, font });
  return pdf.save();
}

async function fixtures() {
  return new Map([
    ['synthetic-text.pdf', { body: await buildTextPdf(), contentType: 'application/pdf' }],
    ['synthetic-picture.pdf', { body: await buildPicturePdf(), contentType: 'application/pdf' }],
  ]);
}

test('pdf text layer on, ocr off: own text is shown and searchable, and no engine code is loaded', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const origin = new URL(baseURL).origin;
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await loadSession(page, {
    siteConfig: { pdfTextLayer: { enabled: true } },
    session: SESSION,
    extraFixtures: await fixtures(),
  });

  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const group = page.locator('.toolbar .toolbar-ocr-actions');
  await expect(group).toHaveAttribute('data-ocr-recognition', 'off');

  // The first page has text of its own: the status says so, under the words of this mode.
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'pdfText', { timeout: 60000 });
  await expect(status).toHaveAttribute('title', /^(Sök i dokumentets text|Search in the document’s text)$/);
  await expect(page.locator('[data-odv-ocr="status-text"]')).toHaveText(/Sidan har egen text|The page has its own text/);
  await expect(status).toBeEnabled();

  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('data-ocr-source', 'pdf-text');
  const words = layer.locator('.ocr-text-layer-word');
  await expect(words).toHaveCount(LINES.join(' ').split(' ').length);
  await expect(words.first()).toHaveText('Provbolaget');
  await expect(layer.locator('.ocr-text-layer-flow')).toHaveAttribute('lang', 'sv');

  // Both pages are read although only one is shown: the whole document is planned in this mode.
  // One of two pages has text; nothing is named "not recognised", and there are no workers.
  const details = status.locator('[data-odv-ocr="details"]');
  await expect(details.locator('[data-odv-ocr="count"]')).toHaveText('1/2');
  await expect(page.locator('[data-odv-ocr="coverage-text"]')).toHaveText(/^1 (of 2 pages have text|av 2 sidor har text)$/);
  await expect(details.locator('[data-odv-ocr="not-recognised"], [data-odv-ocr="workers"], [data-odv-ocr="time-left"]')).toHaveCount(0);

  // The toolbar's search finds a word and a phrase in the page's own text and marks them.
  await status.click();
  const searchField = page.locator('.toolbar-ocr-search-input');
  await expect(searchField).toBeFocused();
  const searchStatus = page.locator('.toolbar-ocr-search-status-short');
  await searchField.fill('diarienummer');
  await expect(searchStatus).toHaveText(/^1\/1/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['Diarienummer']);
  await searchField.fill('sex veckor');
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['sex', 'veckor.']);
  await searchField.press('Escape');

  // The second page is a picture with a page number: it stays an image and is named so.
  await page.locator('#thumbnail-2').click();
  await expect(status).toHaveAttribute('data-ocr-state', 'noOwnText', { timeout: 30000 });
  await expect(page.locator('[data-odv-ocr="status-text"]')).toHaveText(/Sidan har ingen egen text|The page has no text of its own/);
  await expect(page.locator('.ocr-text-layer')).toHaveCount(0);
  // Another page has text, so the search is still offered from here.
  await expect(status).toBeEnabled();

  // Nothing of the engine was requested: no file of the ocr/ asset folder, no tesseract.js, no
  // asset manifest, no preparation worker; of src/ocr/ only the text-only entry's own files.
  const paths = requests.filter((url) => url.startsWith(origin)).map((url) => new URL(url).pathname);
  expect(paths.filter((path) => path.startsWith('/ocr/'))).toEqual([]);
  expect(requests.filter((url) => /tesseract|odv-ocr-assets|prepareWorker|traineddata/i.test(url))).toEqual([]);
  const ocrModules = [...new Set(paths.filter((path) => path.startsWith('/src/ocr/')).map((path) => path.slice('/src/ocr/'.length)))].sort();
  expect(ocrModules).toEqual([...TEXT_ONLY_MODULES].sort());
  expect(workers.filter((url) => /\/ocr\/|tesseract|prepareWorker/i.test(url))).toEqual([]);
  const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:'));
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('pdf text layer on with ocr on: the switch changes nothing, the words are OCR\'s own', async ({ page }) => {
  test.setTimeout(120000);
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true }, pdfTextLayer: { enabled: true } },
    session: { session: { id: 'ui-pdf-text-with-ocr' }, documents: [{ documentId: 'text', files: ['/ui-fixtures/synthetic-text.pdf'] }] },
    extraFixtures: await fixtures(),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  await expect(page.locator('.toolbar .toolbar-ocr-actions')).toHaveAttribute('data-ocr-recognition', 'on');
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'pdfText', { timeout: 60000 });
  await expect(status).toHaveAttribute('title', /^(Sök i tolkad text|Search in the recognised text)$/);
  await expect(page.locator('[data-odv-ocr="coverage-text"]')).toHaveText(/^1 (of|av) 1 (pages ready|sidor klara)$/);
  await expect(page.locator('.ocr-text-layer')).toHaveAttribute('data-ocr-source', 'pdf-text');
});

test('pdf text layer stays off when a site file sets anything but the literal true', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await loadSession(page, {
    siteConfig: { pdfTextLayer: { enabled: 'true' } },
    session: SESSION,
    extraFixtures: await fixtures(),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(requests.filter((url) => /\/ocr\/|\/src\/ocr\/|tesseract|odv-ocr-assets|prepareWorker/i.test(url))).toEqual([]);
  await expect(page.locator('[data-odv-ocr], .ocr-text-layer')).toHaveCount(0);
});
