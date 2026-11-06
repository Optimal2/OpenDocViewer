// File: tests/ui/ocr-on.spec.mjs
/**
 * The OCR switch on, end to end in a real browser: a site config with `ocr.enabled: true` and
 * the unmodified shipped CSP, a synthetic scanned page drawn in the browser
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
  // must hand the selection to `speechSynthesis.speak` as utterances in the reading language,
  // with a voice that runs on the machine (it never speaks without one; an online voice is
  // offered here and must not be chosen).
  await page.addInitScript(() => {
    const spoken = [];
    window.__odvSpoken = spoken;
    const voices = [
      { name: 'Local Swedish', lang: 'sv-SE', localService: true, default: false },
      { name: 'Local English', lang: 'en-US', localService: true, default: true },
      { name: 'Online English', lang: 'en-US', localService: false, default: false },
    ];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, getVoices: () => voices, speak(utterance) { spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.name }); } },
    });
    // The browser's own utterance class accepts only its own voice objects; the fake takes ours.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class FakeUtterance { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null; } },
    });
  });
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true } },
    session: SESSION,
    extraFixtures: new Map([['synthetic-scan.png', { body: scan, contentType: 'image/png' }]]),
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

  // Read-aloud lives in the page's context menu: a right-click on a word (the selection is
  // the whole layer, and the right-click keeps it) offers "Read the selection aloud", which
  // speaks the selection line by line in the reading language with a local voice; while a
  // reading runs the entry is "Stop reading aloud". No read-aloud button in the toolbar.
  await expect(page.locator('.toolbar [data-odv-ocr="read"]')).toHaveCount(0);
  const contextMenu = page.locator('.odv-context-menu');
  const readEntry = contextMenu.locator('[data-odv-ocr="read"]');
  await layer.locator('.ocr-text-layer-word').first().click({ button: 'right' });
  await expect(contextMenu).toBeVisible();
  await expect(readEntry).not.toHaveAttribute('aria-disabled', 'true');
  await expect(readEntry).toHaveText(/Läs upp markering|Read the selection aloud/);
  // The menu took the focus (its first entry); the arrows move between the entries and wrap,
  // without turning the page; Escape closes it.
  await expect(readEntry).toBeFocused();
  const entryCount = await contextMenu.locator('.odv-context-menu-item').count();
  await page.keyboard.press('ArrowDown');
  await expect(contextMenu.locator('.odv-context-menu-item').nth(entryCount > 1 ? 1 : 0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(readEntry).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(contextMenu.locator('.odv-context-menu-item').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(readEntry).toBeFocused();
  await page.keyboard.press('End');
  await expect(contextMenu.locator('.odv-context-menu-item').last()).toBeFocused();
  await expect(status).toHaveAttribute('data-ocr-state', 'done');
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);
  // Escape gave the focus back to where it was before the menu opened (the viewer's
  // container, focused by the right-click); Tab leaves the menu the same way.
  const returnedFocus = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);
  expect(returnedFocus).not.toBe('BODY');
  // Shift+F10 opens the menu from the keyboard, at the selection, with the focus on its first
  // entry; the Menu key too; pressed again it closes; Tab leaves it.
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu).toBeVisible();
  await expect(readEntry).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu).toHaveCount(0);
  await page.keyboard.press('ContextMenu');
  await expect(contextMenu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(contextMenu).toHaveCount(0);
  await page.keyboard.press('Shift+F10');
  await expect(readEntry).toBeFocused();
  // Enter on the focused entry reads the selection (the menu closes).
  await page.keyboard.press('Enter');
  await expect(contextMenu).toHaveCount(0);
  const spoken = await page.evaluate(() => window.__odvSpoken);
  expect(spoken.length).toBeGreaterThanOrEqual(3);
  expect(spoken[0]).toEqual({ text: 'OpenDocViewer OCR', lang: expect.stringMatching(/^(sv|en)-/), voice: expect.stringMatching(/^Local /) });
  expect(spoken[1].text).toBe('Hej världen 2026');
  expect(spoken.every((utterance) => utterance.voice.startsWith('Local '))).toBe(true);
  await layer.locator('.ocr-text-layer-word').first().click({ button: 'right' });
  await expect(readEntry).toHaveAttribute('data-speaking', 'true');
  await expect(readEntry).toHaveText(/Sluta läsa upp|Stop reading aloud/);
  // An Escape that closes this menu, or the language menu, leaves the reading alone; only a
  // plain Escape on the page stops it.
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);
  await page.locator('.toolbar-end-actions button[aria-haspopup="menu"]').filter({ has: page.locator('.material-icons', { hasText: 'language' }) }).click();
  await expect(page.locator('.toolbar-popup-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar-popup-menu')).toHaveCount(0);
  await layer.locator('.ocr-text-layer-word').first().click({ button: 'right' });
  await expect(readEntry).toHaveAttribute('data-speaking', 'true');
  await readEntry.click();
  await expect(contextMenu).toHaveCount(0);
  // Without a selection the entry stays listed, greyed with the reason.
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await layer.locator('.ocr-text-layer-word').first().click({ button: 'right' });
  await expect(readEntry).toHaveAttribute('aria-disabled', 'true');
  await expect(readEntry).not.toHaveAttribute('data-speaking', 'true');
  await expect(readEntry).toHaveAttribute('title', /Markera text|Select text/);
  // Greyed, it is still focusable (the reason is in its name) and does nothing on Enter.
  await expect(readEntry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(contextMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);

  // The reading language is chosen in the toolbar's language menu, in a titled section of
  // its own under the interface languages: "Auto" first, then the OCR languages that have a
  // local voice (both here; the online voice counts for nothing).
  await page.locator('.toolbar-end-actions button[aria-haspopup="menu"]').filter({ has: page.locator('.material-icons', { hasText: 'language' }) }).click();
  const readingSection = page.locator('.toolbar-popup-menu [data-odv-ocr="read-menu"]');
  await expect(readingSection).toBeVisible();
  await expect(readingSection.locator('.toolbar-split-menu-title')).toHaveText(/Uppläsningsspråk|Reading language/);
  const readingEntries = readingSection.locator('[data-speech-language]');
  expect(await readingEntries.evaluateAll((items) => items.map((item) => item.getAttribute('data-speech-language')))).toEqual(['', 'sv', 'en']);
  // (The entry's text starts with its check-mark ligature.)
  await expect(readingEntries.first()).toHaveText(/Auto \(/);
  await expect(page.locator('.toolbar-popup-menu .toolbar-split-menu-section').first().locator('[role="menuitemradio"]')).toHaveCount(2);
  // With the focus in the toolbar's menu, Shift+F10 is not the page menu's.
  await readingEntries.first().focus();
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu).toHaveCount(0);
  await expect(page.locator('.toolbar-popup-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar-popup-menu')).toHaveCount(0);

  // The toolbar's search in the recognised text: the field grows out of the status button, a
  // phrase across the line break is found, the match's words are marked on the page (the
  // current match stronger), Enter walks the matches and Escape closes the field.
  // Observe the exact anchor measurement supplied to product placement. The wrapper returns the
  // original DOMRect unchanged; test reads below use the original function to avoid self-sampling.
  await status.evaluate((anchor) => {
    const original = anchor.getBoundingClientRect.bind(anchor);
    window.__odvOcrOriginalAnchorMeasure = original;
    window.__odvOcrAnchorMeasurements = [];
    anchor.getBoundingClientRect = () => {
      const rect = original();
      if (anchor.closest('.toolbar-ocr-search').classList.contains('is-open')) {
        window.__odvOcrAnchorMeasurements.push({
          right: rect.right,
          viewport: document.documentElement.clientWidth,
        });
      }
      return rect;
    };
  });
  await status.click();
  const searchField = page.locator('.toolbar-ocr-search-input');
  await expect(searchField).toBeFocused();
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBeGreaterThan(150);
  // The field took only the room the toolbar had: nothing overflows and it ends inside the window.
  const measureFit = () => page.locator('.toolbar').evaluate((toolbar) => {
    const panel = toolbar.querySelector('.toolbar-ocr-search-panel');
    const close = panel.querySelector('.toolbar-ocr-search-close').getBoundingClientRect();
    return { overflow: toolbar.scrollWidth - toolbar.clientWidth, right: panel.getBoundingClientRect().right, closeRight: close.right, placement: panel.dataset.placement, viewport: document.documentElement.clientWidth };
  });
  const fit = await measureFit();
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.viewport);
  // A narrow window: the field hangs under the toolbar at the button's right edge, still inside,
  // and the toolbar overflows no more than it does with the field closed (at these widths the
  // toolbar's own groups already overflow; that is not the field's doing).
  const measureToolbar = () => page.locator('.toolbar').evaluate((toolbar) => {
    const panel = toolbar.querySelector('.toolbar-ocr-search-panel');
    const rect = panel.getBoundingClientRect();
    const root = toolbar.querySelector('.toolbar-ocr-search').getBoundingClientRect();
    const close = panel.querySelector('.toolbar-ocr-search-close').getBoundingClientRect();
    const anchor = window.__odvOcrOriginalAnchorMeasure();
    return {
      overflow: toolbar.scrollWidth - toolbar.clientWidth,
      left: rect.left,
      right: rect.right,
      rootLeft: root.left,
      rootRight: root.right,
      closeRight: close.right,
      top: rect.top,
      toolbarBottom: toolbar.getBoundingClientRect().bottom,
      anchorLeft: anchor.left,
      anchorRight: anchor.right,
      offset: Number.parseFloat(panel.style.right) || 0,
      viewport: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      scrollX: window.scrollX,
    };
  });
  // Independent geometry contract: the product freezes a CSS right offset when it places the
  // hanging panel. Measure the anchor at that placement, not after later font/count/layout drift.
  // An attribute observer records real product commits without changing styles or sending events.
  await page.evaluate(() => {
    const root = document.querySelector('.toolbar-ocr-search');
    const panel = root.querySelector('.toolbar-ocr-search-panel');
    const anchor = root.querySelector('[data-odv-ocr="status"]');
    const toolbar = root.closest('.toolbar');
    const records = [];
    window.__odvOcrPlacementRecords = records;
    const record = () => {
      if (!root.classList.contains('is-open') || panel.dataset.placement !== 'hanging') return;
      const rect = panel.getBoundingClientRect();
      const anchorRect = window.__odvOcrOriginalAnchorMeasure();
      const measured = window.__odvOcrAnchorMeasurements.at(-1);
      records.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        anchorRight: anchorRect.right,
        measuredAnchorRight: measured?.right,
        measuredViewport: measured?.viewport,
        offset: Number.parseFloat(panel.style.right) || 0,
        viewport: document.documentElement.clientWidth,
        toolbarBottom: toolbar.getBoundingClientRect().bottom,
      });
    };
    const observer = new MutationObserver(record);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    observer.observe(panel, { attributes: true, attributeFilter: ['data-placement', 'style'] });
    window.__odvOcrPlacementObserver = observer;
    // A real resize can produce the same attributes (notably offset 0). Sample after the product's
    // resize handler and React commit as well, so a broken placement still reaches the oracle.
    window.addEventListener('resize', () => {
      requestAnimationFrame(() => requestAnimationFrame(record));
    });
    record();
  });
  const clearPlacementRecords = () => page.evaluate(() => {
    window.__odvOcrPlacementRecords.length = 0;
    window.__odvOcrAnchorMeasurements.length = 0;
  });
  const placementRecords = () => page.evaluate(() => window.__odvOcrPlacementRecords);
  const settleToolbarLayout = () => page.evaluate(async () => {
    await document.fonts.ready;
    const toolbar = document.querySelector('.toolbar');
    await Promise.all(toolbar.getAnimations({ subtree: true }).map((animation) => (
      animation.finished.catch(() => undefined)
    )));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const assertContained = (geometry) => {
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 0.5);
    expect(geometry.left).toBeGreaterThanOrEqual(-0.5);
    expect(geometry.closeRight).toBeLessThanOrEqual(geometry.right + 0.5);
    expect(geometry.right - geometry.left).toBeGreaterThan(150);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom);
  };
  const assertPlacementOffset = (placed) => {
    expect(placed.measuredViewport).toBe(placed.viewport);
    expect(Number.isFinite(placed.measuredAnchorRight)).toBe(true);
    const expectedOffset = placed.measuredAnchorRight > placed.viewport - 8
      ? Math.ceil(placed.measuredAnchorRight - (placed.viewport - 8))
      : 0;
    expect(placed.offset).toBe(expectedOffset);
  };
  // Exercise clamping and unclamped anchoring through all four transitions. Containment is checked
  // after real animations settle; anchoring and clamping use the product's actual measurement.
  const geometries = [];
  for (const width of [1000, 900, 1100, 1000]) {
    await clearPlacementRecords();
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.toolbar-ocr-search-panel')).toHaveAttribute('data-placement', 'hanging');
    await expect.poll(async () => {
      const records = await placementRecords();
      return records.at(-1)?.viewport === width;
    }).toBe(true);
    await settleToolbarLayout();
    const placed = (await placementRecords()).at(-1);
    const current = await measureToolbar();
    try {
      assertPlacementOffset(placed);
      expect(Math.abs(current.anchorRight - current.right - current.offset)).toBeLessThanOrEqual(1);
      assertContained(current);
    } catch (error) {
      // CI has no layout artifact on this path: retain both placement and failed live measurement.
      console.log(`OCR hanging geometry at viewport ${width}: ${JSON.stringify({ placed, current })}`);
      throw error;
    }
    geometries.push({ viewport: width, placed, settled: current });
  }
  expect(geometries.some(({ placed }) => placed.measuredAnchorRight <= placed.viewport - 8)).toBe(true);
  expect(geometries.some(({ placed }) => placed.measuredAnchorRight > placed.viewport - 8)).toBe(true);
  const hanging = await measureToolbar();
  await searchField.press('Escape');
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(0);
  const closedNarrow = await measureToolbar();
  expect(hanging.overflow).toBeLessThanOrEqual(closedNarrow.overflow);

  // Deterministic counterexample to the old moving-anchor equality: place with a small positive
  // clamp offset, then let count collapse move the live anchor back inside the unclamped range.
  // The root and panel drift together, preserving the frozen offset and a correct contained layout.
  await page.setViewportSize({ width: 1100, height: 900 });
  await settleToolbarLayout();
  const countWidth = () => page.locator('.toolbar-ocr-search-count').evaluate((count) => ({
    width: count.getBoundingClientRect().width,
    maxWidth: getComputedStyle(count).maxWidth,
  }));
  await expect.poll(async () => (await countWidth()).width).toBeGreaterThan(0);
  const expandedCount = await countWidth();
  const expandedAnchorRight = (await measureToolbar()).anchorRight;
  const driftViewport = Math.ceil(expandedAnchorRight);
  await page.setViewportSize({ width: driftViewport, height: 900 });
  await settleToolbarLayout();
  await clearPlacementRecords();
  await status.click();
  await expect(searchField).toBeFocused();
  await expect(page.locator('.toolbar-ocr-search-panel')).toHaveAttribute('data-placement', 'hanging');
  await expect.poll(async () => (await placementRecords()).length).toBeGreaterThan(0);
  await settleToolbarLayout();
  const driftPlacement = (await placementRecords()).at(-1);
  const drifted = await measureToolbar();
  const collapsedCount = await countWidth();
  assertPlacementOffset(driftPlacement);
  expect(driftPlacement.offset).toBeGreaterThan(0);
  expect(drifted.anchorRight).toBeLessThan(drifted.viewport - 8);
  expect(Math.abs(drifted.anchorRight - drifted.right - driftPlacement.offset)).toBeLessThanOrEqual(1);
  expect(collapsedCount.width).toBe(0);
  assertContained(drifted);
  const oldMovingAnchorError = Math.abs(drifted.right - Math.min(drifted.anchorRight, drifted.viewport - 8));
  console.log(`OCR count-collapse counterexample: ${JSON.stringify({ expandedCount, collapsedCount, driftPlacement, drifted, oldMovingAnchorError })}`);
  // The old oracle rejects this supported-correct layout; the placement and containment checks
  // above accept it without assigning a tolerance to unrelated later anchor drift.
  expect(oldMovingAnchorError).toBeGreaterThan(1);
  geometries.push({ viewport: driftViewport, placed: driftPlacement, settled: drifted, expandedCount, collapsedCount, oldMovingAnchorError });
  await test.info().attach('ocr-hanging-geometry', {
    body: JSON.stringify(geometries, null, 2),
    contentType: 'application/json',
  });
  await searchField.press('Escape');
  await expect.poll(() => page.locator('.toolbar-ocr-search-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(0);
  await status.click();
  await expect(searchField).toBeFocused();
  // Wide enough for the field inline (at 1400 px the toolbar leaves it less than its minimum).
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator('.toolbar-ocr-search-panel')).toHaveAttribute('data-placement', 'inline');
  // Inline, the field fits the toolbar (no overflow) and its last button lies inside it: the
  // field is never laid inline narrower than its contents.
  await expect.poll(async () => (await measureFit()).overflow).toBeLessThanOrEqual(0);
  // The reopened field settles its width after the toolbar stops overflowing; wait for the close
  // button to lie inside it before the one-shot checks below (CI run 41729421855 measured once,
  // mid-layout: closeRight 1562 against right 1489, green on the rerun of the same commit).
  await expect.poll(async () => {
    const fit = await measureFit();
    return fit.closeRight - fit.right;
  }).toBeLessThanOrEqual(0.5);
  const inlineFit = await measureFit();
  expect(inlineFit.right).toBeLessThanOrEqual(inlineFit.viewport);
  expect(inlineFit.closeRight).toBeLessThanOrEqual(inlineFit.right + 0.5);
  await searchField.fill('ocr hej');
  const searchStatus = page.locator('.toolbar-ocr-search-status-short');
  await expect(searchStatus).toHaveText(/^1\/1/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['OCR', 'Hej']);
  await searchField.fill('hej');
  await expect(searchStatus).toHaveText(/^1\/1/);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveText(['Hej']);
  await searchField.fill('o');
  const matchCount = Number((await searchStatus.textContent()).match(/(\d+)\/(\d+)/)[2]);
  expect(matchCount).toBeGreaterThanOrEqual(3);
  // Several matches can fall in one word ("OpenDocViewer" holds two), so marked words are
  // fewer than matches, never more.
  const markedWords = await layer.locator('.ocr-text-layer-word--match, .ocr-text-layer-word--match-current').count();
  expect(markedWords).toBeGreaterThanOrEqual(3);
  expect(markedWords).toBeLessThanOrEqual(matchCount);
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveCount(1);
  await searchField.press('Enter');
  await expect(searchStatus).toHaveText(new RegExp(`^2/${matchCount}`));
  await searchField.press('Shift+Enter');
  await expect(searchStatus).toHaveText(new RegExp(`^1/${matchCount}`));
  // Limited to the displayed page (the only page here): the same matches, the toggle pressed,
  // the marks still on the page; off again afterwards.
  const scope = page.locator('.toolbar-ocr-search-scope');
  await expect(scope).toHaveAttribute('aria-pressed', 'false');
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
  await expect(searchStatus).toHaveText(new RegExp(`^1/${matchCount}$`));
  await expect(layer.locator('.ocr-text-layer-word--match-current')).toHaveCount(1);
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'false');
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
