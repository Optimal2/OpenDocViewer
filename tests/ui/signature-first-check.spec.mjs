// File: tests/ui/signature-first-check.spec.mjs
/**
 * Measures the FIRST signature check of a fresh browser session, including the
 * signature worker's own pdf.js module registration and production comparator.
 *
 * Method: a dedicated Vite production build/preview serves a measurement-only
 * entry that exposes the real getDocumentSignatures(). Each cold sample uses a
 * fresh browser context and a 1-page DSS-only fixture whose appended revision
 * the classifier accepts. A second call on the same page is the warm reference.
 * Ten cold samples run without requested load and ten with bounded, owned CPU
 * contention. Functional outcomes are asserted; timing thresholds are not.
 *
 * Timing boundaries: the production page and inspector module have loaded and
 * the fixture bytes have been fetched before coldStart. coldMs covers exactly
 * the first awaited getDocumentSignatures() call, including creation of its
 * worker, worker module registration, signature parsing and the real pdf.js
 * comparator. warmMs starts immediately before the second call with a copied
 * byte array in that same page. Context creation, fixture generation/fetch,
 * production module import and context teardown are outside both timings.
 *
 * Opt-in measurement (CI-pinned Node 22.23.3), cross-platform:
 *
 *   npx cross-env ODV_MEASURE_FIRST_CHECK=1 playwright test --config tests/ui/signature-first-check.playwright.config.mjs --grep "cold:|loaded:"
 *
 * ODV_FIRST_CHECK_PREVIEW_PORT selects an isolated preview port (default 5187).
 * Every sample is logged as raw JSON and attached with its measured CPU busy
 * fraction and memory snapshots. This harness supplies evidence for a later
 * budget review; it does not itself assert or update a performance budget.
 */
import { expect } from '@playwright/test';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { createMultiPageFixtures } from '../../scripts/signature-revision-fixtures.mjs';
import { createFixturePki } from '../../scripts/generate-signature-fixtures.mjs';
import { test } from './support/first-check-processes.mjs';

const RUNS_PER_CONDITION = 10;
const MAX_CONTENTION_PROCESSES = 32;
const MEASUREMENT_TEST_TIMEOUT_MS = 600_000;
const FIXTURE_GENERATION_TIMEOUT_MS = 180_000;
const FIXTURE_PATH = '/measure-fixtures/first-check.pdf';
const MEASURE = process.env.ODV_MEASURE_FIRST_CHECK === '1';
const PRODUCTION = process.env.ODV_FIRST_CHECK_PRODUCTION === '1';
const TIMING_BOUNDARIES = Object.freeze({
  included: 'await getDocumentSignatures(bytes), including the signature worker and real comparator',
  excluded: 'browser context/page creation, production page/module load, fixture generation/fetch and context teardown',
  warmReference: 'second awaited getDocumentSignatures(bytes.slice()) in the same page',
});

test.describe('first signature check startup measurement', () => {
  // Playwright's supported suite API: a third argument to test(title, fn) is ignored.
  test.describe.configure({ timeout: MEASUREMENT_TEST_TIMEOUT_MS });

  /** @type {Uint8Array} 1-page signed PDF with a DSS-only append (the comparator runs). */
  let fixtureBytes;
  let fixtureHookTimeoutMs;

  test.beforeAll(async () => {
    // In beforeAll, test.setTimeout() configures the hook, not the tests.
    test.setTimeout(FIXTURE_GENERATION_TIMEOUT_MS);
    // TestInfo.timeout is the default TEST slot even in beforeAll. For this
    // metadata-only regression, inspect the actual running hook slot instead.
    fixtureHookTimeoutMs = test.info()._timeoutManager?._running?.slot?.timeout;
    if (!MEASURE) return;
    const pki = await createFixturePki();
    fixtureBytes = (await createMultiPageFixtures(pki, 1)).dss;
  });

  const cpuTimes = () => cpus().reduce((acc, cpu) => {
    const t = cpu.times;
    acc.idle += t.idle;
    acc.total += t.idle + t.user + t.nice + t.sys + t.irq;
    return acc;
  }, { idle: 0, total: 0 });
  const cpuBusyFraction = (before, after) => (after.total > before.total
    ? 1 - (after.idle - before.idle) / (after.total - before.total)
    : NaN);
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return { median, min: sorted[0], max: sorted.at(-1) };
  };

  /**
   * One cold run: a fresh browser context (fresh page, fresh signature
   * worker, cold pdf.js module), then the first production inspection.
   * @param {import('@playwright/test').Browser} browser
   * @param {number} requestedLoadProcesses Number of owned busy processes active during the run.
   */
  async function coldRun(browser, requestedLoadProcesses) {
    const cpuBefore = cpuTimes();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route(FIXTURE_PATH, (route) => route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from(fixtureBytes),
      }));
      await page.goto('/');
      await page.waitForFunction(() => Boolean(window.__ODV_FIRST_CHECK_MEASUREMENT__));
      const measured = await page.evaluate(async (path) => {
        const { getDocumentSignatures } = window.__ODV_FIRST_CHECK_MEASUREMENT__;
        const bytes = new Uint8Array(await (await fetch(path)).arrayBuffer());
        const coldStart = performance.now();
        const cold = await getDocumentSignatures(bytes);
        const coldMs = performance.now() - coldStart;
        const warmStart = performance.now();
        const warm = await getDocumentSignatures(bytes.slice());
        const warmMs = performance.now() - warmStart;
        const approval = (cold.signatures || []).find((sig) => sig.kind === 'approval');
        return {
          coldMs,
          warmMs,
          outcome: approval ? `${approval.integrity}/${approval.integrityCode}` : 'no-approval-signature',
          comparatorRan: typeof approval?.integrityReason === 'string'
            && approval.integrityReason.includes('pdf.js shows the same document as the signed revision'),
        };
      }, FIXTURE_PATH);
      return {
        ...measured,
        requestedLoadProcesses,
        cpuBusyFraction: cpuBusyFraction(cpuBefore, cpuTimes()),
        memoryFreeBytes: freemem(),
        memoryTotalBytes: totalmem(),
        runnerRssBytes: process.memoryUsage().rss,
      };
    } finally {
      await context.close();
    }
  }

  async function measureCondition(browser, label, requestedLoadProcesses) {
    const profile = {
      node: process.version,
      cores: availableParallelism(),
      chromium: browser.version(),
      requestedLoadProcesses,
    };
    const cpuStart = cpuTimes();
    const results = [];
    for (let index = 0; index < RUNS_PER_CONDITION; index++) {
      const result = await coldRun(browser, requestedLoadProcesses);
      results.push(result);
      console.log(`${label} raw ${JSON.stringify({ run: index + 1, runs: RUNS_PER_CONDITION, ...result })}`);
      // Otherwise this is not a first CHECK timing but a failed/classifier-only inspection.
      expect(result.comparatorRan).toBe(true);
      expect(result.outcome).toBe('intact/extended-with-validation-data');
    }
    const summary = {
      label,
      runs: RUNS_PER_CONDITION,
      profile,
      timingBoundaries: TIMING_BOUNDARIES,
      firstCheckMs: stats(results.map((result) => result.coldMs)),
      warmCheckMs: stats(results.map((result) => result.warmMs)),
      cpuBusyFraction: cpuBusyFraction(cpuStart, cpuTimes()),
      memoryFreeBytes: {
        min: Math.min(...results.map((result) => result.memoryFreeBytes)),
        max: Math.max(...results.map((result) => result.memoryFreeBytes)),
      },
      memoryTotalBytes: totalmem(),
    };
    console.log(`${label} summary ${JSON.stringify(summary)}`);
    await test.info().attach(`${label}-raw-measurement.json`, {
      contentType: 'application/json',
      body: JSON.stringify({ summary, results }, null, 2),
    });
  }

  test('effective timeout metadata covers measurement and fixture generation', () => {
    expect(test.info().timeout).toBe(MEASUREMENT_TEST_TIMEOUT_MS);
    expect(fixtureHookTimeoutMs).toBe(FIXTURE_GENERATION_TIMEOUT_MS);
  });

  test('measurement entry is served as a production bundle', async ({ page }) => {
    test.skip(!PRODUCTION, 'use signature-first-check.playwright.config.mjs for the production entry');
    const sourceRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/src/')) sourceRequests.push(request.url());
    });
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('assets/');
    expect(html).not.toContain('/src/');
    await page.waitForFunction(() => Boolean(window.__ODV_FIRST_CHECK_MEASUREMENT__));
    expect(await page.evaluate(() => typeof window.__ODV_FIRST_CHECK_MEASUREMENT__.getDocumentSignatures)).toBe('function');
    expect(sourceRequests).toEqual([]);
  });

  test('cold: fresh browser session per run, machine otherwise quiet', async ({ browser }) => {
    test.skip(!MEASURE, 'opt-in measurement only: set ODV_MEASURE_FIRST_CHECK=1 to run');
    await measureCondition(browser, 'cold', 0);
  });

  test('loaded: fresh browser session per run under CPU contention', async ({ browser, ownedProcesses }) => {
    test.skip(!MEASURE, 'opt-in measurement only: set ODV_MEASURE_FIRST_CHECK=1 to run');
    const contentionCount = Math.max(1, Math.min(availableParallelism() - 1, MAX_CONTENTION_PROCESSES));
    const burners = ownedProcesses.startCpuContention(contentionCount);
    console.log(`loaded contention ${JSON.stringify({ requestedLoadProcesses: burners.length, maximum: MAX_CONTENTION_PROCESSES, boundedByTestTimeoutMs: test.info().timeout })}`);
    await measureCondition(browser, 'loaded', burners.length);
    // ownedProcesses teardown awaits every burner on return, failure or timeout.
  });
});
