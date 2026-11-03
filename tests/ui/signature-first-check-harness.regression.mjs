// File: tests/ui/signature-first-check-harness.regression.mjs
/**
 * Runs forced failure/timeout cases in an isolated child Playwright process.
 * The child run must fail; this parent regression passes only when both harmless
 * timer-only children have persisted exit evidence from fixture teardown.
 */
import { expect } from '@playwright/test';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, CLEANUP_REPORT_FILENAME } from './support/first-check-processes.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_CLI = resolve(ROOT, 'node_modules/playwright/cli.js');
const CHILD_CONFIG = resolve(ROOT, 'tests/ui/signature-first-check-fixture-child.config.mjs');
const CHILD_OUTPUT = resolve(ROOT, 'test-results/signature-first-check-fixture-child');

test('first-check harness cleans owned children after forced failure and timeout', async ({ ownedProcesses }, testInfo) => {
  const childRunner = ownedProcesses.spawn([
    PLAYWRIGHT_CLI,
    'test',
    '--config',
    CHILD_CONFIG,
    '--reporter=list',
  ]);
  const [exitCode, signal] = await once(childRunner, 'exit');
  expect(signal).toBeNull();
  // The nested run contains one intentional body failure and one intentional timeout.
  expect(exitCode).toBe(1);

  const reportText = await readFile(resolve(CHILD_OUTPUT, CLEANUP_REPORT_FILENAME), 'utf8');
  const reports = reportText.trim().split('\n').map((line) => JSON.parse(line));
  expect(reports).toHaveLength(2);
  expect(new Set(reports.map((report) => report.title)).size).toBe(2);
  for (const report of reports) {
    expect(report.childCount, report.title).toBe(1);
    expect(report.allExited, `${report.title}: ${JSON.stringify(report.children)}`).toBe(true);
    expect(report.children[0].exitCode !== null || report.children[0].signalCode !== null).toBe(true);
  }
  await testInfo.attach('forced-failure-cleanup-reports.json', {
    contentType: 'application/json',
    body: JSON.stringify(reports, null, 2),
  });
});
