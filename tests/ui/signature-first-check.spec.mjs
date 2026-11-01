// File: tests/ui/signature-first-check.spec.mjs
/**
 * Measures the FIRST signature check of a fresh browser session, including the
 * signature worker's own pdf.js module registration.
 *
 * Background: the startup allowance RENDER_CHECK_STARTUP_MS
 * (src/utils/pdfSignatureRenderCheck.js) was justified from Node-side
 * comparator measurements only. The first check per browser session runs in
 * the signature worker, which has its own pdf.js module registration, so it
 * pays a module load no later check in that session pays. This spec measures
 * that first check end to end in a real Chromium session and backs the budget
 * number quoted in docs-src/pdf-signatures.md.
 *
 * Method: one fresh browser context per run (a fresh page, hence a fresh
 * signature worker with a cold pdf.js module cache). Inside the page, the
 * production entry point getDocumentSignatures() is called on a 1-page
 * DSS-only fixture whose appended revision the classifier accepts, so the
 * real comparator runs; a second call on the same page is the warm reference.
 * The test asserts only functional outcomes (the comparator ran and stayed
 * green), never timing thresholds, so it cannot go flaky on a slow machine:
 * the timings are recorded, not asserted.
 *
 * Opt-in only: 20 fresh-context runs take minutes and are timing-sensitive,
 * so the suite stays skipped in the default `npm run test:ui` run. Re-measure
 * with (CI-pinned Node 22.23.3):
 *
 *   ODV_MEASURE_FIRST_CHECK=1 npx playwright test tests/ui/signature-first-check.spec.mjs
 *
 * Load recording reuses the approach of scripts/measure-signature-import-cost.mjs
 * (busy-loop processes for contention, os.cpus() snapshots for the measured
 * busy fraction): the requested level is stated, but the reported number is
 * always the measured fraction over the runs.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { createMultiPageFixtures } from '../../scripts/signature-revision-fixtures.mjs';
import { createFixturePki } from '../../scripts/generate-signature-fixtures.mjs';

const RUNS_PER_CONDITION = 10;
const FIXTURE_PATH = '/measure-fixtures/first-check.pdf';

const MEASURE = process.env.ODV_MEASURE_FIRST_CHECK === '1';

test.describe('first signature check startup measurement', () => {
  test.skip(!MEASURE, 'opt-in measurement only: set ODV_MEASURE_FIRST_CHECK=1 to run');

  /** @type {Uint8Array} 1-page signed PDF with a DSS-only append (the comparator runs). */
  let fixtureBytes;

  test.beforeAll(async () => {
    if (!MEASURE) return;
    const pki = await createFixturePki();
    fixtureBytes = (await createMultiPageFixtures(pki, 1)).dss;
  }, 180000);

  const cpuTimes = () => cpus().reduce((acc, cpu) => {
    const t = cpu.times;
    acc.idle += t.idle;
    acc.total += t.idle + t.user + t.nice + t.sys + t.irq;
    return acc;
  }, { idle: 0, total: 0 });
  const cpuBusyFraction = (before, after) => (after.total > before.total
    ? 1 - (after.idle - before.idle) / (after.total - before.total)
    : NaN);
  const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);
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
   */
  async function coldRun(browser) {
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
      const measured = await page.evaluate(async (path) => {
        const { getDocumentSignatures } = await import('/src/utils/pdfSignatureInspector.js');
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
      const busy = cpuBusyFraction(cpuBefore, cpuTimes());
      return { ...measured, cpuBusy: busy };
    } finally {
      await context.close();
    }
  }

  async function measureCondition(browser, label, runs) {
    const results = [];
    for (let index = 0; index < runs; index++) {
      const result = await coldRun(browser);
      results.push(result);
      console.log(`${label} run ${index + 1}/${runs} | first ${result.coldMs.toFixed(0)} ms | warm ${result.warmMs.toFixed(0)} ms | ${result.outcome} | comparator ran: ${result.comparatorRan} | cpu busy ${(100 * result.cpuBusy).toFixed(1)}%`);
      // The comparator must have run and stayed green: otherwise the timing
      // below is not a first CHECK but a classifier-only inspection.
      expect(result.comparatorRan).toBe(true);
      expect(result.outcome).toBe('intact/extended-with-validation-data');
    }
    const first = stats(results.map((r) => r.coldMs));
    const warm = stats(results.map((r) => r.warmMs));
    console.log(`${label} first-check ms (n=${runs}) | median ${first.median.toFixed(0)} | min ${first.min.toFixed(0)} | max ${first.max.toFixed(0)}`);
    console.log(`${label} warm-check ms (n=${runs}) | median ${warm.median.toFixed(0)} | min ${warm.min.toFixed(0)} | max ${warm.max.toFixed(0)}`);
    return { label, results, first, warm };
  }

  test('cold: fresh browser session per run, machine otherwise quiet', async ({ browser }) => {
    const profile = { node: process.version, cores: availableParallelism(), chromium: browser.version() };
    console.log(`machine | node ${profile.node} | cores ${profile.cores} | mem ${gib(totalmem())} GiB total, ${gib(freemem())} GiB free | chromium ${profile.chromium} | requested load none`);
    const cpuStart = cpuTimes();
    await measureCondition(browser, 'cold', RUNS_PER_CONDITION);
    console.log(`machine | measured cpu busy ${(100 * cpuBusyFraction(cpuStart, cpuTimes())).toFixed(1)}% of all cores over the cold runs`);
  }, 600000);

  test('loaded: fresh browser session per run under CPU contention', async ({ browser }) => {
    const cores = availableParallelism();
    const burners = Array.from({ length: Math.max(1, cores - 1) },
      () => spawn(process.execPath, ['--eval', 'while (true) {}'], { stdio: 'ignore' }));
    try {
      console.log(`machine | node ${process.version} | cores ${cores} | requested load ${burners.length} busy processes`);
      const cpuStart = cpuTimes();
      await measureCondition(browser, 'loaded', RUNS_PER_CONDITION);
      console.log(`machine | measured cpu busy ${(100 * cpuBusyFraction(cpuStart, cpuTimes())).toFixed(1)}% of all cores over the loaded runs (requested load ${burners.length})`);
    } finally {
      for (const burner of burners) burner.kill();
    }
  }, 600000);
});
