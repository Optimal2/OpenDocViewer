// File: tests/ui/signature-first-check.vite.config.mjs
/**
 * Production-only Vite build for the browser measurement entry. The default
 * application config and its inputs remain untouched; this separate build uses
 * the same plugins, production mode, chunking and ES-module worker pipeline.
 */
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../vite.config.js';

const MEASUREMENT_ROOT = fileURLToPath(new URL('./signature-first-check-app/', import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL('../../dist/signature-first-check/', import.meta.url));

export default defineConfig(async (env) => {
  const resolvedBase = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  return mergeConfig(resolvedBase, {
    root: MEASUREMENT_ROOT,
    publicDir: false,
    build: {
      outDir: OUTPUT_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: fileURLToPath(new URL('./signature-first-check-app/index.html', import.meta.url)),
      },
    },
  });
});
