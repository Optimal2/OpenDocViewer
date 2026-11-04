/** Exercise actual Playwright attachment retention and subsequent default-run cleanup. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import measurementConfig from '../tests/ui/signature-first-check.playwright.config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/playwright/cli.js');
let scratch;
const measurementOutput = () => resolve(scratch, relative(root, measurementConfig.outputDir));

beforeAll(() => {
  mkdirSync(resolve(root, 'scratch'), { recursive: true });
  scratch = mkdtempSync(resolve(root, 'scratch/first-check-output-'));
  writeFileSync(join(scratch, 'passed.mjs'), `
import { test } from '@playwright/test';
test('successful measurement attachment', async ({}, info) => {
  await info.attach('sample.json', { contentType: 'application/json', body: '{"sample":42}' });
});
`);
});

afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

function runWithConfig(source, name, environment = {}) {
  const config = join(scratch, `${name}.config.mjs`);
  const url = pathToFileURL(resolve(root, source)).href;
  writeFileSync(config, `
import base from ${JSON.stringify(url)};
import { resolve, relative } from 'node:path';
// Relocate both runners together: preserve the real path relationship without
// allowing this regression to delete any genuine measurement evidence.
const relocate = (path) => resolve(${JSON.stringify(scratch)}, relative(${JSON.stringify(root)}, path));
export default { ...base, testDir: ${JSON.stringify(scratch)}, testMatch: 'passed.mjs',
  outputDir: relocate(base.outputDir || ${JSON.stringify(resolve(root, 'test-results'))}),
  reporter: base.reporter.map(([name, options]) => [name, options?.outputFile
    ? { ...options, outputFile: relocate(options.outputFile) } : options]),
  webServer: undefined };
`);
  const childEnvironment = { ...process.env, ...environment };
  // Reporter environment variables take precedence over config outputFile.
  // These children must always keep their reports within the relocated tree.
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_NAME']) {
    delete childEnvironment[key];
  }
  const result = spawnSync(process.execPath, [cli, 'test', '--config', config], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45_000,
    env: childEnvironment,
  });
  expect(result.error, result.stdout + result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}

it('retains a successful measurement attachment after Playwright exits', () => {
  runWithConfig('tests/ui/signature-first-check.playwright.config.mjs', 'measurement');
  const report = JSON.parse(readFileSync(join(measurementOutput(), 'report.json'), 'utf8'));
  const result = report.suites[0].specs[0].tests[0].results[0];
  expect(result.status).toBe('passed');
  const attachment = result.attachments.find((entry) => entry.name === 'sample.json');
  expect(attachment.contentType).toBe('application/json');
  expect(Buffer.from(attachment.body, 'base64').toString('utf8')).toBe('{"sample":42}');
}, 60_000);

it('retains measurement evidence when the normal UI runner cleans its output', () => {
  mkdirSync(measurementOutput(), { recursive: true });
  const marker = join(measurementOutput(), 'measurement-evidence.json');
  writeFileSync(marker, '{"sample":42}');
  runWithConfig('playwright.config.mjs', 'normal');
  expect(readFileSync(marker, 'utf8')).toBe('{"sample":42}');
}, 60_000);

it('keeps inherited reporter overrides from overwriting unrelated evidence', () => {
  // This sentinel models an external evidence file, but stays inside our scratch.
  const unrelatedEvidence = join(scratch, 'unrelated-evidence.json');
  writeFileSync(unrelatedEvidence, 'preserve this evidence');
  runWithConfig('tests/ui/signature-first-check.playwright.config.mjs', 'reporter-override', {
    PLAYWRIGHT_JSON_OUTPUT_FILE: unrelatedEvidence,
  });
  expect(readFileSync(unrelatedEvidence, 'utf8')).toBe('preserve this evidence');
}, 60_000);
