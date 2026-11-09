// File: tests/ui/ocr-benchmark.spec.mjs
/**
 * The opt-in OCR benchmark end to end: with `ocr.enabled` and `ocr.benchmark.enabled` the About
 * dialog's Diagnostics offers "Run OCR benchmark"; a run over a synthetic scanned page with the
 * self-hosted engine completes, saves a result in localStorage with the documented schema, and
 * offers it as a download. Without `ocr.benchmark.enabled` the dialog shows no such button, even
 * with OCR on.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SESSION = {
  session: { id: 'ui-ocr-benchmark' },
  documents: [{ documentId: 'scan', files: ['/ui-fixtures/benchmark-scan.png'] }],
};
const RESULT_KEY = 'odv.ocrBenchmark.latest.v1';

/** Draw an A4 "scan" at 150 dpi with two lines of large text and return its PNG bytes. */
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
    context.fillText('OpenDocViewer benchmark', 120, 240);
    context.fillText('Hej världen 2026', 120, 380);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function openAboutDialog(page) {
  await page.locator('.toolbar .help-button').click();
  await page.getByRole('menuitem', { name: /About OpenDocViewer|Om OpenDocViewer/ }).click();
  const dialog = page.locator('.odv-about-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.odv-about-diagnostics summary').click();
  return dialog;
}

test('ocr benchmark: the About dialog runs it over the page and saves a result with the documented schema', async ({ page }) => {
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    siteConfig: {
      ocr: {
        enabled: true,
        // One scenario (one worker, configured languages, the image as it is) over the one page.
        benchmark: { enabled: true, pageLimit: 1, workerCounts: [1], languageVariants: ['configured'], imageScales: [1], delayBetweenRunsMs: 0 },
      },
    },
    session: SESSION,
    extraFixtures: new Map([['benchmark-scan.png', { body: scan, contentType: 'image/png' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();

  const dialog = await openAboutDialog(page);
  const run = dialog.locator('[data-odv-ocr="benchmark-run"]');
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await expect(dialog.locator('[data-odv-ocr="benchmark-download"]')).toHaveCount(0);
  const status = dialog.locator('[data-odv-ocr="benchmark-status"]');
  await expect(status).toHaveText(/No OCR benchmark|Ingen OCR-benchmark/);

  await run.click();
  await expect(status).toHaveAttribute('data-odv-ocr-benchmark-state', 'running');
  await expect(run).toBeDisabled();
  await expect(status).toHaveAttribute('data-odv-ocr-benchmark-state', 'done', { timeout: 180000 });
  await expect(status).toHaveText(/completed|slutförd/);
  await expect(dialog.locator('[data-odv-ocr="benchmark-download"]')).toBeVisible();
  await expect(run).toBeEnabled();

  const result = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), RESULT_KEY);
  expect(result).not.toBeNull();
  expect(result.schema).toBe('opendocviewer.ocr-benchmark.v1');
  expect(result.languages).toEqual(['swe', 'eng']);
  expect(result.pageCount).toBe(1);
  expect(result.sourcePageCount).toBe(1);
  expect(result.scenarios.map((scenario) => scenario.label)).toEqual(['workers-1']);
  expect(result.runs).toHaveLength(1);
  const [only] = result.runs;
  expect(only).toMatchObject({ label: 'workers-1', workerCount: 1, pageCount: 1, recognizedPages: 1, errorCount: 0, startupError: null });
  expect(only.startupMs).toBeGreaterThan(0);
  expect(only.durationMs).toBeGreaterThan(0);
  expect(only.msPerPage).toBe(only.durationMs);
  expect(only.words).toBeGreaterThanOrEqual(4);
  expect(only.meanConfidence).toBeGreaterThan(50);
  expect(only.recognizeMs.count).toBe(1);
  expect(only.mainThread.samples).toBeGreaterThan(0);
  expect(only.pages[0]).toMatchObject({ viewerIndex: 0, width: 1240, height: 1754, error: null });
  expect(result.best.label).toBe('workers-1');
  expect(result.baseline.label).toBe('workers-1');
  expect(result.diagnostics.schema).toBe('opendocviewer.support-diagnostics.v1');

  // The diagnostics JSON carries the result after a reopen (the dialog keeps its "completed"
  // message while mounted, like the other benchmarks), and the summary comes back from
  // localStorage after a reload.
  await dialog.locator('.odv-help-footer .odv-help-close-button').last().click();
  const reopened = await openAboutDialog(page);
  await expect(reopened.locator('[data-odv-ocr="benchmark-status"]')).toHaveAttribute('data-odv-ocr-benchmark-state', 'done');
  await expect(reopened.locator('.odv-about-diagnostics-json')).toContainText('"latestOcrBenchmark"');
  await page.reload();
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const afterReload = await openAboutDialog(page);
  await expect(afterReload.locator('[data-odv-ocr="benchmark-status"]')).toHaveText(/Fastest OCR run|Snabbaste OCR-körning/);
  await expect(afterReload.locator('[data-odv-ocr="benchmark-download"]')).toBeVisible();
});

test('ocr benchmark: without ocr.benchmark.enabled the About dialog offers no run, even with OCR on', async ({ page }) => {
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    siteConfig: { ocr: { enabled: true } },
    session: SESSION,
    extraFixtures: new Map([['benchmark-scan.png', { body: scan, contentType: 'image/png' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const dialog = await openAboutDialog(page);
  await expect(dialog.locator('.odv-about-diagnostics-actions')).toBeVisible();
  await expect(dialog.locator('[data-odv-ocr="benchmark-run"], [data-odv-ocr="benchmark-status"], [data-odv-ocr="benchmark-download"]')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), RESULT_KEY)).toBeNull();
});
