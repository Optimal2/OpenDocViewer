# OpenDocViewer / src/i18n.js

File count: 1. Line count: 562. JSDoc symbol count: 21.

## src/i18n.js

i18n bootstrap for OpenDocViewer.

Exports: `i18next`

Local imports: `src/utils/viewerPreferences.js`, `src/utils/i18nVersion.js`

Symbols:

- `getSafeWindow` (function) - Return browser window safely in browser, SSR, test, and documentation contexts.
- `getImportMetaEnv` (function) - Return Vite import.meta.env safely.
- `IS_DEV` (constant) - Dev\-mode detector \(Vite \+ Node envs\).
- `readQuery` (function) - Read a query parameter by name \(no deps\).
- `WANT_DIAG` (constant) - Diagnostics ON only in dev builds.
- `BUNDLED_I18N_RESOURCE_REVISION` (constant) - Fallback cache\-busting token for bundled locale resources.
- `DIAGNOSTIC_RELOAD_DELAY_MS` (constant) - Dev\-only reload delay after diagnostic localStorage writes.
- `readStoredI18nVersion` (function) - Read the persisted diagnostic version token, if storage is available.
- `getI18nVersion` (function) - Return cache\-busting version token \(see header and utils/i18nVersion.js\).
- `appendQuery` (function) - Helper: append query params safely to a URL.
- `sanitizeI18nPathSegment` (function) - Keep i18n URL template substitutions constrained to plain path segments.
- `getUnsupportedVersionPlaceholders` (function) - Find malformed version\-like placeholders in loadPath without extra array passes.
