/**
 * Vite configuration for OpenDocViewer
 *
 * Goals:
 *  - Fast dev server with React Refresh
 *  - Predictable production builds with ES module workers (pdf.js, image workers)
 *  - Robust JSX handling for `.js/.jsx` within **src/** only (avoid surprising 3P deps)
 *  - SVGs via SVGR (icon mode on)
 *
 * Important decisions & gotchas (for future humans and AIs):
 *  - **Web Workers as ES modules**: `worker.format = 'es'` ensures worker code is bundled
 *    as native ES modules, matching how pdf.js ships its worker entry.
 *  - **JSX loaders**: We treat `.js/.jsx` inside **src/** as JSX via esbuild (see `esbuild.include`).
 *    We also instruct dependency pre-bundling to parse `.js/.jsx` as JSX. DO NOT widen this
 *    to all node_modules—some packages use `.js` for non-JSX content.
 *  - **Base path**: Default `/`. When deploying under a subpath, pass `--base=/YourPath/`
 *    to `npm run build`. We also define `process.env.PUBLIC_URL` accordingly for legacy code.
 *  - **file-type (browser import trap)**: Elsewhere in the app we import from `'file-type'`
 *    (the root export) and pass `Uint8Array`/`Blob`. Do **not** import `'file-type/browser'`
 *    with v21; that subpath is not exported and will break the build. See README for details.
 *
 * Source for this baseline (traceability): :contentReference[oaicite:0]{index=0}
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

/**
 * @typedef {import('vite').UserConfigExport} UserConfigExport
 * @typedef {import('vite').ConfigEnv} ConfigEnv
 */

/**
 * Export a function to access the `mode` (development/production) at build time.
 * We forward `mode` into `define` so legacy code that relies on `process.env.NODE_ENV`
 * still behaves as expected.
 *
 * @param {ConfigEnv} env
 * @returns {UserConfigExport}
 */
export default defineConfig(({ mode }) => ({
  /**
   * Base public path when served or built.
   * - Dev: usually ignored (served from /)
   * - Build: override with `--base=/OpenDocViewer/` if deploying under a subpath
   */
  base: '/',

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
   *
   * NOTE: We only declare loaders here; we are **not** redefining include/exclude.
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
   * PUBLIC_URL follows `base` by default, but can be overridden at build time if desired.
   */
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.PUBLIC_URL': JSON.stringify('/'),
  },
}));
