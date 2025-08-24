/**
 * ESLint configuration for OpenDocViewer (Flat Config, ESM)
 *
 * Purpose:
 * - Enforce modern JS/React best practices during development and CI.
 * - Keep the surface minimal so lint **never** blocks runtime builds or users.
 *
 * Notes for maintainers:
 * - This file uses the Flat Config API (ESM) available in ESLint 9+.
 * - Scope is limited to project sources; built artifacts are ignored.
 * - We intentionally do **not** enable heavy React rule sets here to avoid churn;
 *   Hooks and Fast Refresh safety rules are enabled as they catch real bugs.
 *
 * How to run:
 *   npm run lint
 *   npm run lint:fix
 *
 * Source reference for this baseline (traceability): :contentReference[oaicite:0]{index=0}
 */

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  /**
   * Ignore generated/compiled output. Add other transient folders as needed.
   * We ignore `docs` if you generate JSDoc via `npm run doc`.
   */
  globalIgnores(['dist', 'docs']),

  {
    /**
     * Lint only our source files. If you later add TypeScript, create a second
     * entry with the TS parser and *.ts/tsx globs.
     */
    files: ['**/*.{js,jsx}'],

    /**
     * Base rule sets:
     * - @eslint/js recommended: modern JS pitfalls
     * - react-hooks recommended-latest: correct useEffect/useMemo deps, etc.
     * - react-refresh vite: flags patterns that break Fast Refresh
     */
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      /**
       * Browser globals: window, document, etc.
       * If you add Node-specific scripts, consider a separate config block for them.
       */
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },

    /**
     * Local rule customizations:
     * - no-unused-vars: allow intentionally unused UPPER_SNAKE_CASE names (e.g., config flags)
     */
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]+' }],
    },
  },
]);
