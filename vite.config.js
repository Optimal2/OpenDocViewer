// File: vite.config.js
/**
 * Vite configuration for OpenDocViewer
 *
 * Goals:
 *  - Fast dev server with React Refresh
 *  - Predictable production builds with ES module workers (pdf.js, image workers)
 *  - App source uses `.jsx` for JSX and `.js` for logic-only modules
 *  - Keep dependency parsing conservative to avoid surprising 3P deps
 *
 * Important notes:
 *  - **Web Workers as ES modules**: `worker.format = 'es'` ensures worker code is bundled
 *    as native ES modules, matching how pdf.js ships its worker entry.
 *  - **JSX loaders**: App source uses Vite's default `.jsx` handling. Dependency pre-bundling
 *    keeps explicit module types because some third-party packages still ship JSX in `.js`.
 *    DO NOT widen this
 *    to all node_modules—some packages use `.js` for non-JSX content.
 *  - **Base path**: In production we use `./` (relative) so the app works under an IIS
 *    application folder (e.g. `/OpenDocViewer`). In dev we keep `/`.
 */

import { defineConfig } from 'vite';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
import { computeLocaleResourceHash } from './scripts/locale-resource-hash.mjs';
import { describeOcrAssets, isOcrAssetCopySkipped } from './scripts/ocr-assets.mjs';

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const APP_VERSION = String(PKG.version || '0.0.0');
const BUILD_STAMP = String(process.env.ODV_BUILD_STAMP || process.env.SOURCE_DATE_EPOCH || 'stable');
const ODV_BUILD_ID = String(process.env.ODV_BUILD_ID || `${APP_VERSION}-${BUILD_STAMP}`);
// The build id stays deterministic; the locale content hash makes the locale URL token change
// whenever a locale file changes (src/utils/i18nVersion.js).
const ODV_I18N_RESOURCE_HASH = computeLocaleResourceHash(new URL('./', import.meta.url));
const PDFJS_WASM_PUBLIC_PREFIX = '/pdfjs/wasm/';
const PDFJS_WASM_OUTPUT_PREFIX = 'pdfjs/wasm/';
const PDFJS_WASM_DIR = new URL('./node_modules/pdfjs-dist/wasm/', import.meta.url);
// The OCR engine files (tesseract.js worker, WebAssembly core, language models) and the
// dist-relative paths the app reads them from (the virtual module `virtual:odv-ocr-assets`,
// see ocrAssetsPlugin). See scripts/ocr-assets.mjs for the layout and why the folder names
// are versioned.
const OCR_ASSETS = describeOcrAssets(new URL('./node_modules/', import.meta.url));

function getPdfJsWasmAssetNames() {
  return readdirSync(PDFJS_WASM_DIR)
    .filter((name) => /\.(?:wasm|js)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function getStaticContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.wasm')) return 'application/wasm';
  if (lower.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (lower.endsWith('.gz')) return 'application/gzip';
  return 'application/octet-stream';
}

function pdfJsWasmAssetsPlugin() {
  return {
    name: 'odv-pdfjs-wasm-assets',
    configureServer(server) {
      server.middlewares.use(PDFJS_WASM_PUBLIC_PREFIX, (req, res, next) => {
        const requestedName = decodeURIComponent(String(req.url || '').split('?')[0] || '').replace(/^\/+/, '');
        if (!/^[A-Za-z0-9_.-]+$/.test(requestedName)) {
          next();
          return;
        }

        const fileUrl = new URL(requestedName, PDFJS_WASM_DIR);
        if (!existsSync(fileUrl)) {
          next();
          return;
        }

        res.setHeader('Content-Type', getStaticContentType(requestedName));
        res.end(readFileSync(fileUrl));
      });
    },
    generateBundle() {
      for (const name of getPdfJsWasmAssetNames()) {
        this.emitFile({
          type: 'asset',
          fileName: `${PDFJS_WASM_OUTPUT_PREFIX}${name}`,
          source: readFileSync(new URL(name, PDFJS_WASM_DIR)),
        });
      }
    },
  };
}

const OCR_ASSETS_VIRTUAL_ID = 'virtual:odv-ocr-assets';
const OCR_ASSETS_RESOLVED_ID = `\0${OCR_ASSETS_VIRTUAL_ID}`;

/**
 * Copies the OCR engine files into dist/ocr/ and serves them in dev at the same paths, like
 * pdfJsWasmAssetsPlugin does for pdf.js. The files are only ever fetched by the lazy OCR chunk
 * after `ocr.enabled` is true (src/utils/ocrLoader.js); copying them costs nothing at runtime.
 * `ODV_OCR_ASSETS=skip` leaves the folder out for sites that host it elsewhere via
 * `ocr.assetBaseUrl` (scripts/verify-ocr-lazy-chunk.mjs checks both outcomes after the build).
 */
function ocrAssetsPlugin() {
  const byPublicPath = new Map(OCR_ASSETS.files.map((file) => [`/${file.fileName}`, file]));
  return {
    name: 'odv-ocr-assets',
    // `import manifest from 'virtual:odv-ocr-assets'` (src/ocr/assetUrls.js only) gives the app
    // the dist-relative paths; as a module it is bundled into the lazy ocr chunk, unlike a define.
    resolveId(id) {
      return id === OCR_ASSETS_VIRTUAL_ID ? OCR_ASSETS_RESOLVED_ID : null;
    },
    load(id) {
      return id === OCR_ASSETS_RESOLVED_ID ? `export default ${JSON.stringify(OCR_ASSETS.manifest)};\n` : null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname;
        try {
          pathname = decodeURIComponent(String(req.url || '').split('?')[0]);
        } catch {
          next();
          return;
        }
        const file = byPublicPath.get(pathname);
        if (!file) {
          next();
          return;
        }
        res.setHeader('Content-Type', getStaticContentType(file.fileName));
        res.end(readFileSync(file.sourceUrl));
      });
    },
    generateBundle() {
      if (isOcrAssetCopySkipped()) {
        this.info(`ODV_OCR_ASSETS=skip: ${OCR_ASSETS.manifest.root} is not copied into the build output`);
        return;
      }
      for (const file of OCR_ASSETS.files) {
        this.emitFile({
          type: 'asset',
          fileName: file.fileName,
          source: readFileSync(file.sourceUrl),
        });
      }
    },
  };
}

function preserveBootstrapDataAttributePlugin() {
  /** @type {import('vite').ResolvedConfig | null} */
  let resolvedConfig = null;

  return {
    name: 'odv-preserve-bootstrap-data-attribute',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    closeBundle() {
      if (!resolvedConfig) {
        return;
      }

      const indexHtmlPath = resolve(resolvedConfig.root, resolvedConfig.build.outDir, 'index.html');
      if (!existsSync(indexHtmlPath)) {
        return;
      }

      const html = readFileSync(indexHtmlPath, 'utf8');
      const scriptPattern = new RegExp(
        '(<script\\b[^>]*\\btype=["\']module["\'][^>]*\\bsrc=["\'][^"\']+["\'][^>]*)(>)',
        'i'
      );

      const updatedHtml = html.replace(scriptPattern, (match, attrs, close) => (
        attrs.includes('data-odv-bootstrap') ? match : `${attrs} data-odv-bootstrap${close}`
      ));

      if (updatedHtml !== html) {
        writeFileSync(indexHtmlPath, updatedHtml, 'utf8');
      }
    },
  };
}

/**
 * @typedef {import('vite').UserConfigExport} UserConfigExport
 * @typedef {import('vite').ConfigEnv} ConfigEnv
 */

/**
 * Export a function to access `mode` (development/production).
 * We also expose PUBLIC_URL for any legacy code that relies on it.
 *
 * @param {ConfigEnv} env
 * @returns {UserConfigExport}
 */
export default defineConfig(({ mode }) => {
  const BASE = mode === 'production' ? './' : '/';

  return {
    /**
     * Base public path when served or built.
     * - Dev: `/`
     * - Build: `./` so assets resolve correctly under a virtual directory.
     */
    base: BASE,

    // Vitest: run ONLY OpenDocViewer's own tests. The Release workflow checks out the AgentDocMap
    // tool into `_tools/` for `doc:agent`; without this exclude, `npm test` (vitest) also ran that
    // tool's tests, which fail in CI (`spawnSync node ENOENT`) and broke the v2.7.0 release publish.
    // Keep `_tools/**` out of the ODV test scan. See AGENTS.md ("Release workflow — do not change the trigger").
    // 2026-10-13 baseline: 37 full-suite runs, 1/2/4/8/12/default workers, Node 25.6.0 and 22.23.3.
    // Default (availableParallelism() - 1, ~23 forks on 24 cores) was fastest: ~31-82 s versus
    // 178-296 s with one worker. Leave maxWorkers UNSET. One of 21 Node 25.6.0 runs reproduced
    // [vitest-pool-runner]: Timeout waiting for worker to respond; 23 of 69 files never started,
    // yet "2317 passed" appeared. Use the process EXIT CODE, never the Tests line: Errors is separate.
    // Node 25.6.0 is outside the installed toolchain's engine range; CI-pinned Node 22.23.3 had
    // none in those 16 runs, including full-CPU load. Use CI's Node locally; one event is not a rate.
    // Later validation also reproduced on Node 22.23.3: the engine mismatch is not a proven cause.
    // Numeric maxWorkers replaces the default: 8 RAISES a 2-4 core CI runner from 1-3 workers to 8.
    // Any local cap must be environment-gated; leave .github/workflows/** unchanged.
    // Internal worker-start limits (60 s worker response, 90 s pool runner start) are separate
    // from testTimeout/hookTimeout below.
    test: {
      // `dist/**` is build output and must never be scanned for tests. `tests/ui/**` holds the
      // Playwright browser specs (`npm run test:ui`), which vitest cannot run.
      exclude: [...configDefaults.exclude, '_tools/**', 'dist/**', 'tests/ui/**'],
      // The signature-inspection suites run real CMS/X.509 verification on signed fixtures and
      // take 30–60 s on a machine under I/O load (pre-push gate measured 2026-10-05); the
      // default 5 s/30 s timeouts then report a timeout, not a defect.
      testTimeout: 120000,
      hookTimeout: 120000,
    },

    plugins: [
      // React + Fast Refresh
      react(),

      // pdf.js loads codec WASM/fallback modules by filename from `wasmUrl`.
      pdfJsWasmAssetsPlugin(),

      // tesseract.js loads its worker, core and language models from dist/ocr/ (lazy, opt-in).
      ocrAssetsPlugin(),

      // Vite emits a small HTML entry chunk that imports bootConfig. Keep the
      // bootstrap data marker on that emitted script so runtime config SRI
      // attributes survive in dist/index.html.
      preserveBootstrapDataAttributePlugin(),
    ],

    /**
     * Dependency pre-bundling (optimizeDeps) runs with Rolldown in Vite 8. Some
     * libraries ship JSX in `.js` or `.jsx`, so moduleTypes keeps the previous
     * parser behavior without relying on deprecated esbuild optimizer options.
     */
    optimizeDeps: {
      rolldownOptions: {
        moduleTypes: {
          '.js': 'jsx',
          '.jsx': 'jsx',
        },
      },
    },

    /**
     * Build web workers as ES modules to keep parity with modern libraries (e.g., pdf.js).
     * This avoids classic worker/URL interop issues and lets Vite handle asset URLs cleanly.
     */
    worker: {
      format: 'es',
    },

    /**
     * Conservative chunking to keep heavy format libraries out of the main lazy viewer chunks.
     * This improves cacheability and reduces the size of the DocumentLoader chunk without
     * changing runtime behavior.
     */
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          bootConfig: fileURLToPath(new URL('./src/app/bootConfig.js', import.meta.url)),
        },
        output: {
          manualChunks(id) {
            if (id.includes('pdfjs-dist')) return 'pdfjs';
            if (id.includes('utif2')) return 'utif';
            // The OCR module (src/ocr/, tesseract.js, virtual:odv-ocr-assets) is
            // deliberately NOT listed here. It is reached only by the import() in
            // src/utils/ocrLoader.js, so code splitting puts it in its own chunk,
            // named `ocr-<hash>.js` after the folder of src/ocr/index.js. A
            // manualChunks rule or an advancedChunks group would also capture the
            // module's shared dependencies (logger, runtime config, axios) and make
            // every eager chunk import the OCR chunk statically, which is exactly
            // what scripts/verify-ocr-lazy-chunk.mjs forbids after each build.
            return undefined;
          },
        },
      },
    },

    /**
     * Provide a small compatibility shim for code that inspects process.env.
     * PUBLIC_URL follows `base`.
     */
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.PUBLIC_URL': JSON.stringify(BASE),
      'import.meta.env.APP_VERSION': JSON.stringify(APP_VERSION),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
      'import.meta.env.ODV_BUILD_ID': JSON.stringify(ODV_BUILD_ID),
      'import.meta.env.ODV_I18N_RESOURCE_HASH': JSON.stringify(ODV_I18N_RESOURCE_HASH),
      // The OCR asset manifest is deliberately NOT a define: modules that read the whole
      // import.meta.env object (i18n, loggers) would inline it into the eager chunks. It is the
      // virtual module `virtual:odv-ocr-assets` (ocrAssetsPlugin) that only src/ocr/ imports.
    },
  };
});
