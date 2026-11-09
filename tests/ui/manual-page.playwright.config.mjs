// File: tests/ui/manual-page.playwright.config.mjs
/**
 * Dedicated production proof for the stand-alone manual page: builds the app (`npm run build`),
 * serves `dist/` under the `/OpenDocViewer/` subpath (tests/ui/manual-page-subpath-server.mjs,
 * Node built-ins only) and runs only tests/ui/manual-page.spec.mjs against it.
 *
 * Modelled on the signature-first-check production-preview pattern. Port through
 * ODV_MANUAL_PAGE_PORT (default 5181, clear of the dev-runner default 5179).
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.ODV_MANUAL_PAGE_PORT || 5181);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new RangeError('ODV_MANUAL_PAGE_PORT must be an integer between 1024 and 65535');
}

export default defineConfig({
  testDir: TEST_DIR,
  testMatch: ['manual-page.spec.mjs'],
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
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
    command: 'npm run build && node tests/ui/manual-page-subpath-server.mjs',
    env: { ODV_MANUAL_PAGE_PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/OpenDocViewer/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
