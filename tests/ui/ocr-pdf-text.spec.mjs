// File: tests/ui/ocr-pdf-text.spec.mjs
/**
 * A PDF page that already has a text layer, with the OCR switch on, end to end in a real
 * browser: the page gets a selectable text layer from its own text (no engine, worker or model
 * is ever requested), the toolbar's search button reports "The page has its own text", and the
 * search finds words and phrases in that text and marks them on the page. The word boxes are
 * checked against where the text was drawn: the first word of a line lies where pdf-lib put
 * the line, in the proportion of the displayed page image. The PDF is synthetic, built here
 * with pdf-lib (no document from anywhere else).
 */
import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadSession } from './fixtureSession.mjs';

const PAGE_SIZE = [595.28, 841.89];
const MARGIN = 60;
const FONT_SIZE = 14;
const LINE_STEP = 24;
const FIRST_BASELINE = 780;
const LINES = [
  'Provbolaget AB bekräftar registreringen av ärendet.',
  'Diarienummer 2026-4471 gäller tills vidare.',
  'Handläggningstiden är omkring sex veckor.',
];
const SESSION = {
  session: { id: 'ui-ocr-pdf-text' },
  documents: [{ documentId: 'text', files: ['/ui-fixtures/synthetic-text.pdf'] }],
};

/** @returns {Promise<{ bytes: Uint8Array, firstWordWidth: number }>} */
async function buildTextPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE_SIZE);
  LINES.forEach((line, index) => page.drawText(line, { x: MARGIN, y: FIRST_BASELINE - index * LINE_STEP, size: FONT_SIZE, font }));
  return { bytes: await pdf.save(), firstWordWidth: font.widthOfTextAtSize(LINES[0].split(' ')[0], FONT_SIZE) };
}

test('ocr on: a PDF page with its own text layer is searchable without the engine', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const origin = new URL(baseURL).origin;
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const { bytes, firstWordWidth } = await buildTextPdf();
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-text.pdf', { body: bytes, contentType: 'application/pdf' }]]),
  });

  const image = page.locator('.document-render-container img').first();
  await expect(image).toBeVisible();
  // The page's own text is the outcome: the status says so, the LED is ready, no recognition
  // ever runs (no "Recognising text…" and no engine files requested).
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'pdfText', { timeout: 60000 });
  await expect(status).toHaveAttribute('title', /Sidan har egen text|The page has its own text/);
  await expect(status).toBeEnabled();
  await expect(status.locator('.odv-status-led--ready')).toHaveCount(1);

  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('data-ocr-source', 'pdf-text');
  await expect(layer).toHaveAttribute('aria-label', /Sidans egen text|The page's own text/);
  const words = layer.locator('.ocr-text-layer-word');
  await expect(words).toHaveCount(LINES.join(' ').split(' ').length);
  await expect(words.first()).toHaveText('Provbolaget');
  await expect(layer.locator('.ocr-text-layer-line')).toHaveCount(LINES.length);

  // The first word's box lies where the line was drawn, in the proportion of the page image:
  // left at the margin, its top one Helvetica ascent (0.718 × 14 pt) above the baseline, its
  // width close to the font's own advance (shared out by a rough per-character weight).
  const geometry = await page.evaluate(() => {
    const img = document.querySelector('.document-render-container img');
    const word = document.querySelector('.ocr-text-layer-word');
    const imageRect = img.getBoundingClientRect();
    const wordRect = word.getBoundingClientRect();
    return {
      left: (wordRect.left - imageRect.left) / imageRect.width,
      top: (wordRect.top - imageRect.top) / imageRect.height,
      width: wordRect.width / imageRect.width,
    };
  });
  expect(Math.abs(geometry.left - MARGIN / PAGE_SIZE[0])).toBeLessThan(0.01);
  expect(Math.abs(geometry.top - (PAGE_SIZE[1] - FIRST_BASELINE - 0.718 * FONT_SIZE) / PAGE_SIZE[1])).toBeLessThan(0.01);
  expect(Math.abs(geometry.width - firstWordWidth / PAGE_SIZE[0])).toBeLessThan(0.25 * firstWordWidth / PAGE_SIZE[0]);

  // The toolbar's search finds a word and a phrase across the page's own text and marks them.
  await status.click();
  const searchField = page.locator('.toolbar-ocr-search-input');
  await expect(searchField).toBeFocused();
  const searchStatus = page.locator('.toolbar-ocr-search-status');
  await searchField.fill('diarienummer');
  await expect(searchStatus).toHaveText(/^1 (of|av) 1$/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['Diarienummer']);
  await searchField.fill('sex veckor');
  await expect(searchStatus).toHaveText(/^1 (of|av) 1$/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['sex', 'veckor.']);
  await searchField.fill('finnsinte');
  await expect(searchStatus).toHaveText(/No matches|Inga träffar/);
  await searchField.press('Escape');
  await expect(status).toBeFocused();

  // Print hides the layer; the screen shows it.
  await page.emulateMedia({ media: 'print' });
  expect(await layer.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  await page.emulateMedia({ media: 'screen' });
  await expect(layer).toBeVisible();

  // No engine, worker or language model was requested (the `ocr/` asset folder: the lazy OCR
  // module itself loads, it holds the probe), and nothing left the origin.
  const engineRequests = requests.filter((url) => /\/ocr\/[^?]*(tesseract|tessdata|worker|traineddata)/i.test(url));
  expect(engineRequests).toEqual([]);
  const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:'));
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
