# Entrypoints And Hubs

## Package Scripts

- `dev`: `vite`
- `build`: `vite build`
- `preview`: `vite preview`
- `lint`: `eslint "src/**/*.{js,jsx}"`
- `lint:fix`: `eslint "src/**/*.{js,jsx}" --fix`
- `format`: `prettier --write "src/**/*.{js,jsx,css,scss,md}"`
- `doc`: `jsdoc -c jsdoc.json`
- `doc:agent`: `node scripts/generate-agent-docs.mjs`
- `start:system-log`: `node server/system-log-server.js`
- `start:user-log`: `node server/user-log-server.js`
- `start:logs`: `concurrently -n sys,user -c auto "npm run start:system-log" "npm run start:user-log"`
- `dev:system-log`: `cross-env NODE_ENV=development PORT=3001 LOG_TOKEN=devtoken node server/system-log-server.js`
- `dev:user-log`: `cross-env NODE_ENV=development PORT=3002 node server/user-log-server.js`
- `dev:logs`: `concurrently -n sys,user -c auto "npm run dev:system-log" "npm run dev:user-log"`
- `dev:both`: `concurrently -n app,logs -c auto "npm run dev" "npm run dev:logs"`
- `// release helpers`: `Run one of the release:* scripts, then push with --follow-tags.`
- `release:patch`: `npm version patch -m "chore(release): %s"`
- `release:minor`: `npm version minor -m "chore(release): %s"`
- `release:major`: `npm version major -m "chore(release): %s"`

## Runtime Entrypoints

- `server/system-log-server.js` - System Log Server — Single-file, standalone (ESM) Responsibilities: - Expose POST /log for structured system logs (tiny JSON bodies) - Write NDJSON to daily-rotated files under ./logs/ - Keep access, ingestion, and error
- `server/user-log-server.js` - User Action Log Server — Single-file, standalone (ESM) Endpoint: POST /userlog/record - Body: application/x-www-form-urlencoded or JSON - reason: string|null - forWhom: string|null - Response: 200 OK with body: true (JSO
- `src/index.jsx` - OpenDocViewer — Application Entry - Load global styles (CSS variables + layout).

## Import Hubs

- `src/logging/systemLogger.js`: 35 incoming local imports
- `src/utils/runtimeConfig.js`: 13 incoming local imports
- `src/utils/documentLoadingConfig.js`: 12 incoming local imports
- `src/contexts/viewerContext.js`: 10 incoming local imports
- `src/utils/localizedValue.js`: 6 incoming local imports
- `src/utils/publicAssetUrl.js`: 6 incoming local imports
- `src/utils/viewerPreferences.js`: 5 incoming local imports
- `src/utils/pdfjsDocumentOptions.js`: 4 incoming local imports
- `src/utils/pdfPrintCacheKey.js`: 4 incoming local imports
- `src/components/DocumentLoader/documentLoaderUtils.js`: 3 incoming local imports
- `src/contexts/themeContext.js`: 3 incoming local imports
- `src/utils/documentMetadata.js`: 3 incoming local imports
- `src/utils/printPdf.js`: 3 incoming local imports
- `src/utils/printSanitize.js`: 3 incoming local imports
- `src/utils/printTemplate.js`: 3 incoming local imports
- `src/utils/supportDiagnostics.js`: 3 incoming local imports
- `src/components/common/StatusLed.jsx`: 2 incoming local imports
- `src/components/DocumentToolbar/SplitToolbarButton.jsx`: 2 incoming local imports
- `src/hooks/useAcceleratingHoldRepeat.js`: 2 incoming local imports
- `src/hooks/usePageTimer.js`: 2 incoming local imports
