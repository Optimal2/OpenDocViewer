// File: tests/ui/ocr-on.spec.mjs
/**
 * The OCR switch on, end to end in a real browser: a site config with `ocr.enabled: true` and
 * the CSP token a site adds (`'wasm-unsafe-eval'`), a synthetic scanned page drawn in the browser
 * (no document from anywhere else), the self-hosted engine, worker and Swedish/English models
 * served by the dev server from the same origin, and finally a text layer over the page whose
 * words can be selected, copied and found, the toolbar's search button with the page's OCR
 * status and its search field marking the matches on the page, and the read-aloud button that
 * hands the selection to speech synthesis. Also proves what stays the same: the page image, the
 * print stylesheet hiding the layer, and no request leaving the origin.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SCAN_TEXT = ['OpenDocViewer OCR', 'Hej världen 2026'];
/** A ruled two-by-two table below the text: the case the ruling-line removal exists for. */
const TABLE_CELLS = [['Konto', 'Belopp'], ['Hyra', 'Summa']];
const SESSION = {
  session: { id: 'ui-ocr-on' },
  documents: [{ documentId: 'scan', files: ['/ui-fixtures/synthetic-scan.png'] }],
};

/**
 * Draw a clean A4 "scan" at 200 dpi with two lines of large text and a ruled table, and return
 * its PNG bytes.
 */
async function drawSyntheticScan(page) {
  const dataUrl = await page.evaluate(({ lines, cells }) => {
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
    // The table: 4 px solid borders around every cell, text inside each cell.
    const left = 160;
    const top = 800;
    const cellWidth = 620;
    const cellHeight = 150;
    context.strokeStyle = '#111111';
    context.lineWidth = 4;
    context.font = 'bold 56px Arial, Helvetica, sans-serif';
    cells.forEach((row, rowIndex) => row.forEach((text, columnIndex) => {
      const x = left + columnIndex * cellWidth;
      const y = top + rowIndex * cellHeight;
      context.strokeRect(x, y, cellWidth, cellHeight);
      context.fillText(text, x + 40, y + 45);
    }));
    return canvas.toDataURL('image/png');
  }, { lines: SCAN_TEXT, cells: TABLE_CELLS });
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
  // A recording speech synthesiser, installed before the viewer loads: the read-aloud button
  // must hand the selection to `speechSynthesis.speak` as utterances in the UI language.
  await page.addInitScript(() => {
    const spoken = [];
    window.__odvSpoken = spoken;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, getVoices: () => [], speak(utterance) { spoken.push({ text: utterance.text, lang: utterance.lang }); } },
    });
  });
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-scan.png', { body: scan, contentType: 'image/png' }]]),
    transformIndexHtml: addWasmToken,
  });

  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  // The page's OCR status is the toolbar's search button: its LED and tooltip, and it is
  // disabled until the page's text is recognised. Nothing is drawn over the page itself.
  const status = page.locator('.toolbar [data-odv-ocr="status"]');
  await expect(status).toBeVisible();
  await expect(status).toBeDisabled();
  await expect(page.locator('.ocr-status')).toHaveCount(0);
  await expect(status).toHaveAttribute('data-ocr-state', 'done', { timeout: 120000 });
  await expect(status).toHaveAttribute('title', /Text tolkad|Text recognised/);
  await expect(status).toBeEnabled();
  await expect(status.locator('.odv-status-led--ready')).toHaveCount(1);

  const layer = page.locator('.ocr-text-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('data-odv-ocr', 'text-layer');
  const words = layer.locator('.ocr-text-layer-word');
  // Five words drawn; Tesseract may split or join a token at the edges, so at least four.
  expect(await words.count()).toBeGreaterThanOrEqual(SCAN_TEXT.join(' ').split(' ').length - 1);
  await expect(layer).toContainText('OpenDocViewer');
  await expect(layer).toContainText('världen');
  // The ruled table: its lines were removed from the engine's copy and the cell text came out.
  await expect(layer).toHaveAttribute('data-ruling-lines-removed', 'true');
  for (const text of TABLE_CELLS.flat()) await expect(layer).toContainText(text);

  // The text is transparent and sits where the ink is: the first word's box is inside the page
  // image, towards its top left.
  const image = await page.locator('.document-render-container img').first().boundingBox();
  const first = await words.first().boundingBox();
  expect(first.x).toBeGreaterThan(image.x);
  expect(first.y).toBeGreaterThan(image.y);
  expect(first.x + first.width).toBeLessThan(image.x + image.width);
  expect(first.y).toBeLessThan(image.y + image.height / 3);
  expect(await words.first().evaluate((span) => getComputedStyle(span).color)).toBe('rgba(0, 0, 0, 0)');
  // The no-break space between two words sits in the gap between their boxes (where find and
  // selection paint it), not at its natural place in the flow.
  const gapPlacement = await layer.evaluate((element) => {
    const gap = element.querySelector('.ocr-text-layer-gap');
    const before = gap.previousElementSibling.getBoundingClientRect();
    const after = gap.nextElementSibling.getBoundingClientRect();
    const rect = gap.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, before: before.right, after: after.left, wordTop: Math.min(before.top, after.top) };
  });
  expect(gapPlacement.left).toBeGreaterThanOrEqual(gapPlacement.before - 1);
  expect(gapPlacement.right).toBeLessThanOrEqual(gapPlacement.after + 1);
  expect(gapPlacement.right - gapPlacement.left).toBeGreaterThan(0);
  // And at the words' height, not lower in the line box (which reaches to the next line).
  expect(Math.abs(gapPlacement.top - gapPlacement.wordTop)).toBeLessThanOrEqual(2);

  // Selection and copy see plain text in reading order; the browser's own find sees it too.
  const selected = await layer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  const selectedText = selected.replace(/\s+/g, ' ').trim();
  expect(selectedText).toMatch(/^OpenDocViewer OCR Hej världen 2026/);
  expect(selectedText).toContain('Konto Belopp');
  // A pointer drag (not a programmatic range) from the first word of the first line to the last
  // word of the second line selects across the words and lines: the drag must start on a word
  // (a word is not a pan start) and extend through the one text flow the layer is.
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const last = await words.filter({ hasText: '2026' }).first().boundingBox();
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, { steps: 12 });
  await page.mouse.up();
  const dragged = (await page.evaluate(() => window.getSelection().toString())).replace(/\s+/g, ' ').trim();
  expect(dragged.startsWith('OpenDocViewer OCR')).toBe(true);
  expect(dragged.endsWith('2026')).toBe(true);
  expect(dragged).toContain('OCR Hej världen');
  // The layer paints the selection itself, over the selected words only: the native highlight
  // would cover each line box down to the next line. The five dragged words are marked and
  // painted, the table's words are not.
  const painted = await words.evaluateAll((spans) => spans.map((span) => ({
    text: span.textContent,
    marked: span.classList.contains('ocr-text-layer-word--selected'),
    background: getComputedStyle(span).backgroundColor,
    native: getComputedStyle(span, '::selection').backgroundColor,
  })));
  expect(painted.filter((word) => word.marked).map((word) => word.text).join(' ')).toBe('OpenDocViewer OCR Hej världen 2026');
  for (const word of painted) {
    expect(word.native).toBe('rgba(0, 0, 0, 0)');
    expect(word.background === 'rgba(0, 0, 0, 0)').toBe(!word.marked);
  }
  // The browser's own find, as Ctrl+F uses it: from the top of the document, wrapping. A word,
  // a phrase on one line, and a phrase across the line break, all typed with ordinary spaces.
  const find = (text) => page.evaluate((needle) => {
    window.getSelection().removeAllRanges();
    return window.find(needle, false, false, true, false, false, false);
  }, text);
  expect(await find('världen')).toBe(true);
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('världen');
  expect(await find('Hej världen')).toBe(true);
  expect(await find('OCR Hej')).toBe(true);
  expect(await find('Hej världen 2026 Konto')).toBe(true);
  expect(await find('världen Hej')).toBe(false);

  // Copy gives the text as it reads on the page: spaces between words, newlines between lines.
  const copied = await layer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    element.querySelector('.ocr-text-layer-word').dispatchEvent(event);
    return { prevented: event.defaultPrevented, text: data.getData('text/plain') };
  });
  expect(copied.prevented).toBe(true);
  expect(copied.text.startsWith('OpenDocViewer OCR\nHej världen 2026\n')).toBe(true);
  expect(copied.text).toContain('Konto Belopp\n');
  expect(copied.text).not.toMatch(/\u00a0/);

  // The read-aloud button appears while recognised text is selected (the whole layer is) and
  // speaks the selection line by line in the UI language; while speaking it is a stop button.
  const read = page.locator('.toolbar [data-odv-ocr="read"]');
  await expect(read).toBeVisible();
  await read.click();
  await expect(read).toHaveAttribute('data-speaking', 'true');
  const spoken = await page.evaluate(() => window.__odvSpoken);
  expect(spoken.length).toBeGreaterThanOrEqual(3);
  expect(spoken[0]).toEqual({ text: 'OpenDocViewer OCR', lang: expect.stringMatching(/^(sv|en)-/) });
  expect(spoken[1].text).toBe('Hej världen 2026');
  await read.click();
  await expect(read).not.toHaveAttribute('data-speaking', 'true');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await expect(read).toHaveCount(0);

  // The toolbar's search in the recognised text: the field grows out of the status button, a
  // phrase across the line break is found, the match's words are marked on the page (the
  // current match stronger), Enter walks the matches and Escape closes the field.
  await status.click();
  const searchField = page.locator('.toolbar-ocr-search-input');
  await expect(searchField).toBeFocused();
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBeGreaterThan(150);
  // The field took only the room the toolbar had: nothing overflows and it ends inside the window.
  const fit = await page.locator('.toolbar').evaluate((toolbar) => {
    const panel = toolbar.querySelector('.toolbar-ocr-search-panel');
    return { overflow: toolbar.scrollWidth - toolbar.clientWidth, right: panel.getBoundingClientRect().right, placement: panel.dataset.placement, viewport: document.documentElement.clientWidth };
  });
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.viewport);
  // A narrow window: the field hangs under the toolbar at the button's right edge, still inside,
  // and the toolbar overflows no more than it does with the field closed (at this width the
  // toolbar's own groups already overflow; that is not the field's doing).
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('.toolbar-ocr-search-panel')).toHaveAttribute('data-placement', 'hanging');
  const measureToolbar = () => page.locator('.toolbar').evaluate((toolbar) => {
    const panel = toolbar.querySelector('.toolbar-ocr-search-panel');
    const rect = panel.getBoundingClientRect();
    return { overflow: toolbar.scrollWidth - toolbar.clientWidth, right: rect.right, top: rect.top, toolbarBottom: toolbar.getBoundingClientRect().bottom, viewport: document.documentElement.clientWidth };
  });
  const hanging = await measureToolbar();
  expect(hanging.right).toBeLessThanOrEqual(hanging.viewport);
  expect(hanging.top).toBeGreaterThanOrEqual(hanging.toolbarBottom);
  await searchField.press('Escape');
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(0);
  const closedNarrow = await measureToolbar();
  expect(hanging.overflow).toBeLessThanOrEqual(closedNarrow.overflow);
  await status.click();
  await expect(searchField).toBeFocused();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator('.toolbar-ocr-search-panel')).toHaveAttribute('data-placement', 'inline');
  await searchField.fill('ocr hej');
  const searchStatus = page.locator('.toolbar-ocr-search-status');
  await expect(searchStatus).toHaveText(/^1 (of|av) 1/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['OCR', 'Hej']);
  await searchField.fill('hej');
  await expect(searchStatus).toHaveText(/^1 (of|av) 1/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['Hej']);
  await searchField.fill('o');
  const matchCount = Number((await searchStatus.textContent()).match(/(\d+) (of|av) (\d+)/)[3]);
  expect(matchCount).toBeGreaterThanOrEqual(3);
  // Several matches can fall in one word ("OpenDocViewer" holds two), so marked words are
  // fewer than matches, never more.
  const markedWords = await layer.locator('.ocr-text-layer-word--match, .ocr-text-layer-word--match-current').count();
  expect(markedWords).toBeGreaterThanOrEqual(3);
  expect(markedWords).toBeLessThanOrEqual(matchCount);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveCount(1);
  await searchField.press('Enter');
  await expect(searchStatus).toHaveText(new RegExp(`^2 (of|av) ${matchCount}`));
  await searchField.press('Shift+Enter');
  await expect(searchStatus).toHaveText(new RegExp(`^1 (of|av) ${matchCount}`));
  await searchField.fill('finnsinte');
  await expect(searchStatus).toHaveText(/No matches|Inga träffar/);
  await searchField.press('Escape');
  await expect(status).toBeFocused();
  await expect(layer.locator('.ocr-text-layer-word--match, .ocr-text-layer-word--match-current')).toHaveCount(0);
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(0);

  // Print hides the layer and the toolbar's OCR group; the screen shows them.
  await page.emulateMedia({ media: 'print' });
  expect(await layer.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  expect(await page.locator('.toolbar-ocr-actions').evaluate((element) => getComputedStyle(element).display)).toBe('none');
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
