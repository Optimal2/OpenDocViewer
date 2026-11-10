// File: tests/ui/ocr-boost-benchmark.spec.mjs
/**
 * The opt-in OCR *boost* benchmark end to end, following tests/ui/ocr-benchmark.spec.mjs: with
 * `ocr.enabled` and `ocr.boostBenchmark.enabled` the About dialog's Diagnostics offers "Run OCR
 * boost benchmark"; a run over a synthetic scanned page with the self-hosted engine completes,
 * saves a result with the documented schema, states the reason for the worker count this client
 * cannot hold, and downloads itself as `opendocviewer-ocr-boost-benchmark.json`.
 *
 * Without `ocr.boostBenchmark.enabled` the dialog shows no such button AND the boost module is
 * never fetched: it is a lazy chunk of its own (loadOcrBoostBenchmark in src/ocr/index.js, kept
 * off the OCR entry point by scripts/verify-ocr-lazy-chunk.mjs), so a site that does not opt in
 * must not pay for it. The second test watches the network to prove that, and the first test
 * proves the same watch does see the module when the switch is on.
 *
 * Two deliberate choices in the run configuration, both to keep the proof exact and CI short:
 * - `navigator.hardwareConcurrency` is pinned to 2, so the configured count 4 is above the
 *   reported cores on every machine and its skip reason is always BOOST_SKIP_REASON.CORES. The
 *   memory rule is taken out of the way (`memoryBudgetFraction` 1, `memoryPerWorkerMiB` 1) so
 *   only the core rule can speak and the assertion does not depend on `navigator.deviceMemory`.
 * - `ocr.languages: 'english'` and `pageLimit: 1`: one language model per engine and one page per
 *   scenario, so the run is three engine starts and two recognitions.
 */
import { test, expect } from '@playwright/test';
import { loadSession } from './fixtureSession.mjs';

const SESSION = {
  session: { id: 'ui-ocr-boost-benchmark' },
  documents: [{ documentId: 'scan', files: ['/ui-fixtures/boost-scan.png'] }],
};
const RESULT_KEY = 'odv.ocrBoostBenchmark.latest.v1';
/** The lazy chunk the switch decides about; in the dev server it is fetched under its source path. */
const BOOST_MODULE = /boostBenchmark/;

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
    context.fillText('OpenDocViewer boost benchmark', 120, 240);
    context.fillText('Hello world 2026', 120, 380);
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

/** Collect every request URL of the page, so the lazy chunk can be looked for afterwards. */
function watchRequests(page) {
  /** @type {Array<string>} */
  const urls = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

test('ocr boost benchmark: the About dialog runs it, states the skipped count and downloads the JSON', async ({ page }) => {
  const requested = watchRequests(page);
  // Pinned before any viewer code runs, so the boost run reads this count for its core rule.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 2 });
  });
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    siteConfig: {
      ocr: {
        enabled: true,
        languages: 'english',
        boostBenchmark: {
          enabled: true,
          // 1 and 2 run; 4 is above the two reported cores and is skipped with its reason.
          workerCounts: [1, 2, 4],
          pageLimit: 1,
          memoryBudgetFraction: 1,
          memoryPerWorkerMiB: 1,
          delayBetweenRunsMs: 0,
        },
      },
    },
    session: SESSION,
    extraFixtures: new Map([['boost-scan.png', { body: scan, contentType: 'image/png' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();

  const dialog = await openAboutDialog(page);
  const run = dialog.locator('[data-odv-ocr="boost-benchmark-run"]');
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await expect(run).toHaveText(/Run OCR boost benchmark|Kör OCR-boostbenchmark/);
  await expect(dialog.locator('[data-odv-ocr="boost-benchmark-download"]')).toHaveCount(0);
  const status = dialog.locator('[data-odv-ocr="boost-benchmark-status"]');
  await expect(status).toHaveText(/No OCR boost benchmark|Ingen OCR-boostbenchmark/);
  // Nothing has pulled the lazy chunk yet: the button alone does not load the module.
  expect(requested.filter((url) => BOOST_MODULE.test(url))).toEqual([]);

  await run.click();
  await expect(status).toHaveAttribute('data-odv-ocr-boost-benchmark-state', 'running');
  await expect(run).toBeDisabled();
  await expect(status).toHaveAttribute('data-odv-ocr-boost-benchmark-state', 'done', { timeout: 180000 });
  await expect(status).toHaveText(/completed|slutförd|Fastest OCR boost run|Snabbaste OCR-boostkörning/);
  await expect(run).toBeEnabled();
  // Running it is what fetches the chunk, which is the positive control for the second test.
  expect(requested.filter((url) => BOOST_MODULE.test(url)).length).toBeGreaterThan(0);

  const result = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), RESULT_KEY);
  expect(result).not.toBeNull();
  expect(result.schema).toBe('opendocviewer.ocr-boost-benchmark.v1');
  expect(result.boostMaxWorkerCount).toBe(32);
  expect(result.hardwareConcurrency).toBe(2);
  expect(result.languages).toEqual(['eng']);
  expect(result.pageCount).toBe(1);
  expect(result.sourcePageCount).toBe(1);
  expect(result.workerCounts).toEqual([1, 2, 4]);
  expect(result.scenarios.map((scenario) => scenario.label)).toEqual(['boost-workers-1', 'boost-workers-2', 'boost-workers-4']);
  // The viewer's own policy is reported read-only; the boost ceiling never becomes the live cap.
  expect(result.automaticPlan.policy.maxWorkerCount).toBe(4);
  expect(result.diagnostics.schema).toBe('opendocviewer.support-diagnostics.v1');

  const [one, two, four] = result.runs;
  for (const measured of [one, two]) {
    expect(measured).toMatchObject({ skipped: false, aborted: false, abortReason: null, startupError: null, pageCount: 1, recognizedPages: 1, errorCount: 0, deadLanes: 0 });
    expect(measured.enginesCreated).toBe(measured.workerCount);
    expect(measured.enginesTerminated).toBe(measured.workerCount);
    expect(measured.startupMs).toBeGreaterThan(0);
    expect(measured.durationMs).toBeGreaterThan(0);
    expect(measured.msPerPage).toBe(measured.durationMs);
    expect(measured.engineStartupMs.count).toBe(measured.workerCount);
    expect(measured.recognizeMs.count).toBe(1);
    expect(measured.words).toBeGreaterThanOrEqual(4);
    expect(measured.meanConfidence).toBeGreaterThan(50);
    expect(measured.pages[0]).toMatchObject({ viewerIndex: 0, width: 1240, height: 1754, error: null });
  }
  // The skipped count carries its reason, both in its run entry and in the summary list.
  expect(four).toMatchObject({ workerCount: 4, skipped: true, skipReason: 'cores', pageCount: 0, recognizedPages: 0 });
  expect(four.skipDetail).toMatch(/4 workers exceed the 2 logical cores/);
  expect(result.skippedCounts).toHaveLength(1);
  expect(result.skippedCounts[0]).toMatchObject({ workerCount: 4, skipReason: 'cores' });
  expect(result.skippedCounts[0].skipDetail).toMatch(/2 logical cores/);

  // The download the operator hands over: the same result, under the documented filename.
  const downloadButton = dialog.locator('[data-odv-ocr="boost-benchmark-download"]');
  await expect(downloadButton).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
  expect(download.suggestedFilename()).toBe('opendocviewer-ocr-boost-benchmark.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const downloaded = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(downloaded.schema).toBe('opendocviewer.ocr-boost-benchmark.v1');
  expect(downloaded.skippedCounts[0]).toMatchObject({ workerCount: 4, skipReason: 'cores' });
  expect(downloaded.runs.map((entry) => [entry.workerCount, entry.skipped])).toEqual([[1, false], [2, false], [4, true]]);

  // The result survives a reload, as the ordinary benchmark's does.
  await page.reload();
  await expect(page.locator('.document-render-container img').first()).toBeVisible();
  const afterReload = await openAboutDialog(page);
  await expect(afterReload.locator('[data-odv-ocr="boost-benchmark-status"]')).toHaveText(/Fastest OCR boost run|Snabbaste OCR-boostkörning/);
  await expect(afterReload.locator('[data-odv-ocr="boost-benchmark-download"]')).toBeVisible();
});

test('ocr boost benchmark: without the switch the dialog offers no run and the chunk is never fetched', async ({ page }) => {
  const requested = watchRequests(page);
  await page.goto('/');
  const scan = await drawSyntheticScan(page);
  await loadSession(page, {
    // OCR on, the ordinary benchmark on, the boost benchmark not mentioned at all.
    siteConfig: { ocr: { enabled: true, languages: 'english', benchmark: { enabled: true } } },
    session: SESSION,
    extraFixtures: new Map([['boost-scan.png', { body: scan, contentType: 'image/png' }]]),
  });
  await expect(page.locator('.document-render-container img').first()).toBeVisible();

  const dialog = await openAboutDialog(page);
  await expect(dialog.locator('.odv-about-diagnostics-actions')).toBeVisible();
  // The ordinary benchmark is still offered, so the dialog really did render its actions.
  await expect(dialog.locator('[data-odv-ocr="benchmark-run"]')).toBeVisible();
  await expect(dialog.locator('[data-odv-ocr="boost-benchmark-run"], [data-odv-ocr="boost-benchmark-status"], [data-odv-ocr="boost-benchmark-download"]')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), RESULT_KEY)).toBeNull();
  // The point of the separate chunk: a site that does not opt in never downloads the module.
  expect(requested.filter((url) => BOOST_MODULE.test(url))).toEqual([]);
});
