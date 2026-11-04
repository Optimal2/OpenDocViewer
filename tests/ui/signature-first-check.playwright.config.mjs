// File: tests/ui/signature-first-check.playwright.config.mjs
/** Dedicated production-preview runner for the opt-in first-check measurement. */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('./', import.meta.url));
const VITE_CONFIG = 'tests/ui/signature-first-check.vite.config.mjs';
const PORT = Number(process.env.ODV_FIRST_CHECK_PREVIEW_PORT || 5187);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new RangeError('ODV_FIRST_CHECK_PREVIEW_PORT must be an integer between 1024 and 65535');
}

process.env.ODV_FIRST_CHECK_PRODUCTION = '1';

export default defineConfig({
  testDir: TEST_DIR,
  testMatch: ['signature-first-check.spec.mjs', 'signature-first-check-harness.regression.mjs'],
  // Keep successful evidence outside the normal UI runner's cleaned output tree.
  outputDir: resolve(ROOT, 'signature-measurement-results'),
  preserveOutput: 'always',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // Body attachments are in-memory unless a reporter persists them.
  reporter: [['list'], ['json', { outputFile: resolve(ROOT, 'signature-measurement-results/report.json') }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
  }],
  webServer: {
    cwd: ROOT,
    command: `npx vite build --config ${VITE_CONFIG} && npx vite preview --config ${VITE_CONFIG} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
