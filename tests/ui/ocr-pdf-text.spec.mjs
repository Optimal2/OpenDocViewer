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
  'Vi har gått igenom handlingarna och kan bekräfta att ärendet är registrerat hos oss.',
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
  // The OCR group sits right after the image-adjustment group (the one ending with "Reset
  // adjustments"), behind a separator and before the toolbar's spacer, laid out as the
  // toolbar's own flex items (the wrapper has no box).
  const order = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar');
    const children = [...toolbar.children];
    const group = toolbar.querySelector('.toolbar-ocr-actions');
    return {
      afterEditing: children.indexOf(group) === children.indexOf(toolbar.querySelector('.editing-tools')) + 1,
      beforeSpacer: children.indexOf(group) < children.indexOf(toolbar.querySelector('.toolbar-spacer')),
      separatorFirst: group.firstElementChild.classList.contains('separator'),
      display: getComputedStyle(group).display,
    };
  });
  expect(order).toEqual({ afterEditing: true, beforeSpacer: true, separatorFirst: true, display: 'contents' });

  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('data-ocr-source', 'pdf-text');
  await expect(layer).toHaveAttribute('aria-label', /Sidans egen text|The page's own text/);
  // The page's language is guessed among the OCR languages (Swedish here) and set as the
  // text flow's lang; the labelled layer keeps the UI language for its name.
  await expect(layer.locator('.ocr-text-layer-flow')).toHaveAttribute('lang', 'sv');
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
  await expect(searchStatus).toHaveText(/^1\/1$/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['Diarienummer']);
  await searchField.fill('sex veckor');
  await expect(searchStatus).toHaveText(/^1\/1$/);
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

test('ocr on with the search and read-aloud switched off: the status stays, no field, no read-aloud button', async ({ page }) => {
  test.setTimeout(120000);
  const { bytes } = await buildTextPdf();
  // A speech synthesiser is present so that, were the button mounted, it would show; a probe
  // records whether anything read the voices (the toolbar must not touch speech at all).
  await page.addInitScript(() => {
    window.__odvVoiceReads = 0;
    const voices = [{ name: 'Local Swedish', lang: 'sv-SE', localService: true, default: true }];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, getVoices() { window.__odvVoiceReads += 1; return voices; }, speak() {}, addEventListener() {}, removeEventListener() {} },
    });
  });
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true, search: { enabled: false }, speech: { enabled: false } } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-text.pdf', { body: bytes, contentType: 'application/pdf' }]]),
  });

  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const group = page.locator('.toolbar .toolbar-ocr-actions');
  await expect(group).toHaveAttribute('data-ocr-search', 'off');

  // The status indicator keeps the search button's place and LED, but never enables and has no
  // field; its name is the status itself.
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'pdfText', { timeout: 60000 });
  await expect(status).toBeDisabled();
  await expect(status).toHaveAttribute('aria-label', /Sidan har egen text|The page has its own text/);
  await expect(status.locator('.odv-status-led--ready')).toHaveCount(1);
  await expect(page.locator('.toolbar-ocr-search-panel, .toolbar-ocr-search-input')).toHaveCount(0);
  await status.click({ force: true });
  await expect(page.locator('.toolbar-ocr-search-input')).toHaveCount(0);

  // The text layer is there as usual, with the page's guessed language; selecting its text
  // brings no read-aloud button, and the voices were never read.
  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer.locator('.ocr-text-layer-flow')).toHaveAttribute('lang', 'sv');
  await page.evaluate(() => {
    const flow = document.querySelector('.ocr-text-layer-flow');
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(flow);
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(300);
  // Neither the context menu's read-aloud entry nor the language menu's reading section exists.
  await layer.locator('.ocr-text-layer-word').first().click({ button: 'right' });
  await expect(page.locator('[data-odv-ocr="read"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.toolbar-end-actions button[aria-haspopup="menu"]').filter({ has: page.locator('.material-icons', { hasText: 'language' }) }).click();
  await expect(page.locator('.toolbar-popup-menu')).toBeVisible();
  await expect(page.locator('[data-odv-ocr="read-menu"], [data-speech-language]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__odvVoiceReads)).toBe(0);
});

test('ocr on with Ctrl+F handed over: Ctrl+F opens the toolbar search, not the browser find', async ({ page }) => {
  test.setTimeout(120000);
  const { bytes } = await buildTextPdf();
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true, search: { overridesCtrlF: true } } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-text.pdf', { body: bytes, contentType: 'application/pdf' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  await expect(page.locator('.toolbar .toolbar-ocr-actions')).toHaveAttribute('data-ocr-search-ctrl-f', 'on');
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toHaveAttribute('data-ocr-state', 'pdfText', { timeout: 60000 });
  await expect(status).toHaveAttribute('title', /\(Ctrl\+F\)/);

  // The viewer itself sees the keystroke and keeps it (the browser's find never opens, which
  // the page can only show by the event being consumed): the field opens with the focus.
  await page.evaluate(() => {
    window.__odvCtrlF = null;
    // Bubble phase on the window: the viewer's capture listener has already decided by then.
    // Not `once`: the Control key's own keydown comes first.
    window.addEventListener('keydown', (event) => { if (event.key === 'f') window.__odvCtrlF = event.defaultPrevented; });
  });
  await page.locator('body').press('Control+f');
  await expect.poll(() => page.evaluate(() => window.__odvCtrlF)).toBe(true);
  const searchField = page.locator('.toolbar-ocr-search-input');
  await expect(searchField).toBeFocused();
  await searchField.fill('diarienummer');
  await expect(page.locator('.toolbar-ocr-search-status')).toHaveText(/^1\/1$/);
  // Again with the field open: the cursor comes back with the text selected.
  await status.focus();
  await page.keyboard.press('Control+f');
  await expect(searchField).toBeFocused();
  expect(await searchField.evaluate((input) => [input.selectionStart, input.selectionEnd])).toEqual([0, 'diarienummer'.length]);
});
