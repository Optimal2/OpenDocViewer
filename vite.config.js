// File: vite.config.js
/**
 * Vite configuration for OpenDocViewer
 *
 * Goals:
 *  - Fast dev server with React Refresh
 *  - Predictable production builds with ES module workers (pdf.js, image workers)
 *  - App source uses `.jsx` for JSX and `.js` for logic-only modules
 *  - Keep dependency parsing conservative to avoid surprising 3P deps
 *  - SVGs via SVGR (icon mode on)
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
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const APP_VERSION = String(PKG.version || '0.0.0');
const BUILD_STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '');
const ODV_BUILD_ID = `${APP_VERSION}-${BUILD_STAMP}`;

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

    plugins: [
      // React + Fast Refresh
      react(),

      // Import SVGs as React components: `import { ReactComponent as Icon } from './icon.svg'`
      svgr({ svgrOptions: { icon: true } }),
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
        output: {
          manualChunks(id) {
            if (id.includes('pdfjs-dist')) return 'pdfjs';
            if (id.includes('utif2')) return 'utif';
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
    },
  };
});
