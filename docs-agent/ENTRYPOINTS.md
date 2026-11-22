# Entrypoints And Hubs

## Package Scripts

- `build:standard-manual`: `node scripts/build-standard-manual.mjs`
- `dev`: `npm run build:standard-manual && vite`
- `build`: `npm run build:standard-manual && vite build && node scripts/verify-ocr-lazy-chunk.mjs`
- `preview`: `vite preview`
- `lint`: `eslint "src/**/*.{js,jsx}"`
- `lint:fix`: `eslint "src/**/*.{js,jsx}" --fix`
- `format`: `prettier --write "src/**/*.{js,jsx,css,scss,md}"`
- `test`: `npm run build:standard-manual && vitest run`
- `test:watch`: `npm run build:standard-manual && vitest`
- `test:ui`: `npm run build:standard-manual && playwright test`
- `test:ui:manual-page`: `playwright test -c tests/ui/manual-page.playwright.config.mjs`
- `doc`: `jsdoc -c jsdoc.json`
- `doc:agent`: `npm run build:standard-manual && node scripts/generate-agent-docs.mjs`
- `start:system-log`: `node server/system-log-server.js`
- `start:user-log`: `node server/user-log-server.js`
- `start:logs`: `concurrently -n sys,user -c auto "npm run start:system-log" "npm run start:user-log"`
- `dev:system-log`: `cross-env NODE_ENV=development PORT=3001 LOG_TOKEN=*** node server/system-log-server.js`
- `dev:user-log`: `cross-env NODE_ENV=development PORT=3002 node server/user-log-server.js`
- `dev:logs`: `concurrently -n sys,user -c auto "npm run dev:system-log" "npm run dev:user-log"`
- `dev:both`: `concurrently -n app,logs -c auto "npm run dev" "npm run dev:logs"`

## Runtime Entrypoints

- `server/accessLog.js` - HTTP access log of the log servers: the "combined" line, with a clean address and one line.
- `server/clientAddress.js` - The client's address without a port, for the rate limit key and the log records.
- `server/headerText.js` - Text of an HTTP header value as the sender wrote it.
- `server/logRetention.js` - Shared best\-effort retention for the optional standalone log servers.
- `server/rateLimitConfig.js` - Settings and reporting for the per\-client rate limits of the log servers.
- `server/system-log-server.js` - System Log Server — standalone Express endpoint for structured system logs.
- `server/user-log-server.js` - User Action Log Server — standalone Express endpoint for print/user\-action audit events.
- `server/userLogOrigin.js` - Evaluate the browser origin signals used by the user print\-log endpoint.
- `server/userLogPayload.js` - Compatibility reader for form posts and the viewer's JSON print envelope.
- `src/index.jsx` - OpenDocViewer — Application Entry \- Load global styles \(CSS variables \+ layout\).
- `src/manual-page/main.jsx` - Entry of the stand\-alone manual page \(manual/index.html\).
- `src/ocr/index.js` - Entry point of the OCR module: the file the viewer imports while OCR is on, and only through \`src/utils/ocrLoader.js\` with \`import\(\)\` after \`isOcrEnabled\(\)\` returned true.

## Import Hubs

- `src/logging/systemLogger.js`: 46 incoming local imports
- `src/utils/runtimeConfig.js`: 38 incoming local imports
- `src/utils/documentLoadingConfig.js`: 14 incoming local imports
- `src/contexts/viewerContext.js`: 13 incoming local imports
- `src/utils/compareTransform.js`: 13 incoming local imports
- `src/utils/imageAdjustments.js`: 9 incoming local imports
- `src/utils/viewerPreferences.js`: 9 incoming local imports
- `src/utils/localizedValue.js`: 8 incoming local imports
- `src/utils/pdfjsDocumentOptions.js`: 6 incoming local imports
- `src/utils/pdfResolution.js`: 6 incoming local imports
- `src/utils/pdfResolutionRuntime.js`: 6 incoming local imports
- `src/utils/pdfSignatureStatus.js`: 6 incoming local imports
- `src/utils/publicAssetUrl.js`: 6 incoming local imports
- `src/utils/pdfSignatureDocuments.js`: 5 incoming local imports
- `src/utils/supportDiagnostics.js`: 5 incoming local imports
- `src/components/DocumentViewer/hooks/useViewerEffects.js`: 4 incoming local imports
- `src/contexts/readAloudContext.js`: 4 incoming local imports
- `src/integrations/integrationSettings.js`: 4 incoming local imports
- `src/utils/compareOverlay.js`: 4 incoming local imports
- `src/utils/objectUrlRegistry.js`: 4 incoming local imports
