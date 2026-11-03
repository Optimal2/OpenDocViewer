// File: tests/ui/signature-first-check-fixture-child.config.mjs
/** Isolated runner for intentional fixture failure/timeout regressions. */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: fileURLToPath(new URL('./', import.meta.url)),
  testMatch: 'signature-first-check-fixture-child.mjs',
  outputDir: resolve(ROOT, 'test-results/signature-first-check-fixture-child'),
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
