// File: vite.config.js
/**
 * Vite configuration for OpenDocViewer
 *
 * Goals:
 *  - Fast dev server with React Refresh
 *  - Predictable production builds with ES module workers (pdf.js, image workers)
 *  - Robust JSX handling for `.js/.jsx` within **src/** only (avoid surprising 3P deps)
 *  - SVGs via SVGR (icon mode on)
 *
 * Important notes:
 *  - **Web Workers as ES modules**: `worker.format = 'es'` ensures worker code is bundled
 *    as native ES modules, matching how pdf.js ships its worker entry.
 *  - **JSX loaders**: We treat `.js/.jsx` inside **src/** as JSX via esbuild (see `esbuild.include`).
 *    We also instruct dependency pre-bundling to parse `.js/.jsx` as JSX. DO NOT widen this
 *    to all node_modules—some packages use `.js` for non-JSX content.
 *  - **Base path**: In production we use `./` (relative) so the app works under an IIS
 *    application folder (e.g. `/OpenDocViewer`). In dev we keep `/`.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

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
     * Dependency pre-bundling (optimizeDeps) runs with esbuild. Some libraries ship
     * JSX in `.js` or `.jsx`. We explicitly tell esbuild to parse those extensions
     * as JSX to avoid syntax errors during pre-bundle.
     */
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
          '.jsx': 'jsx',
        },
      },
    },

    /**
     * App source compilation via esbuild:
     * - Treat only files under **src/** as JSX-capable `.js`
     * - Use the automatic JSX runtime (no need to import React in every file)
     */
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.[jt]sx?$/, // explicitly include all js, jsx, ts, tsx in src
      jsx: 'automatic',
    },

    /**
     * Build web workers as ES modules to keep parity with modern libraries (e.g., pdf.js).
     * This avoids classic worker/URL interop issues and lets Vite handle asset URLs cleanly.
     */
    worker: {
      format: 'es',
    },

    /**
     * Provide a small compatibility shim for code that inspects process.env.
     * PUBLIC_URL follows `base`.
     */
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.PUBLIC_URL': JSON.stringify(BASE),
    },
  };
});
