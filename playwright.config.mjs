// File: playwright.config.mjs
/**
 * Browser UI tests (Playwright). Run with `npm run test:ui`; they start the Vite dev server and
 * drive the real viewer with synthetic fixtures served through request interception (see
 * tests/ui/*.spec.mjs). Vitest ignores tests/ui/**.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.ODV_UI_TEST_PORT || 5179);

export default defineConfig({
  testDir: 'tests/ui',
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
