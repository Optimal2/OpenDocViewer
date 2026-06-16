# Dependencies

This file combines package.json declarations with observed source imports.

## Runtime Dependencies

| Package | Version | Imports | Used In |
| --- | --- | ---: | --- |
| `axios` | `^1.18.0` | 1 | `src/logging/systemLogger.js` |
| `cors` | `^2.8.6` | 1 | `server/system-log-server.js` |
| `dompurify` | `^3.4.10` | 2 | `src/components/DocumentToolbar/ManualOverlayDialog.jsx`<br>`src/utils/printPdf.js` |
| `dotenv` | `^17.4.2` | 2 | `server/system-log-server.js`<br>`server/user-log-server.js` |
| `express` | `^5.2.1` | 2 | `server/system-log-server.js`<br>`server/user-log-server.js` |
| `express-rate-limit` | `^8.5.2` | 2 | `server/system-log-server.js`<br>`server/user-log-server.js` |
| `file-type` | `^22.0.1` | 1 | `src/components/DocumentLoader/DocumentLoader.js` |
| `helmet` | `^8.2.0` | 2 | `server/system-log-server.js`<br>`server/user-log-server.js` |
| `i18next` | `^26.3.1` | 5 | `src/ErrorBoundary.jsx`<br>`src/i18n.js`<br>`src/utils/printDom.js`<br>`src/utils/printParse.js`<br>`src/utils/printPdf.js` |
| `i18next-http-backend` | `^4.0.0` | 1 | `src/i18n.js` |
| `i18next-icu` | `^2.4.3` | 1 | `src/i18n.js` |
| `jspdf` | `^4.2.1` | 0 |  |
| `material-icons` | `^1.13.14` | 1 | `src/index.jsx` |
| `morgan` | `^1.11.0` | 2 | `server/system-log-server.js`<br>`server/user-log-server.js` |
| `pdf-lib` | `^1.17.1` | 0 |  |
| `pdfjs-dist` | `^6.0.227` | 8 | `src/components/DocumentLoader/documentLoaderUtils.js`<br>`src/components/DocumentLoader/mainThreadRenderer.js`<br>`src/utils/pageAssetRenderer.js`<br>`src/workers/pdfPageWorker.js` |
| `prop-types` | `^15.8.1` | 32 | `src/PerformanceMonitor.jsx`<br>`src/app/OpenDocViewer.jsx`<br>`src/components/CanvasRenderer.jsx`<br>`src/components/DocumentConsumerWrapper.jsx`<br>`src/components/DocumentLoader/LoadPressureDialog.jsx` |
| `react` | `^19.2.7` | 52 | `src/ErrorBoundary.jsx`<br>`src/PerformanceMonitor.jsx`<br>`src/app/AppBootstrap.jsx`<br>`src/app/OpenDocViewer.jsx`<br>`src/components/CanvasRenderer.jsx` |
| `react-dom` | `^19.2.7` | 1 | `src/index.jsx` |
| `react-i18next` | `^17.0.8` | 33 | `src/PerformanceMonitor.jsx`<br>`src/app/AppBootstrap.jsx`<br>`src/components/DocumentConsumerWrapper.jsx`<br>`src/components/DocumentLoader/DemoControls.jsx`<br>`src/components/DocumentLoader/DocumentLoader.js` |
| `utif2` | `^4.1.0` | 3 | `src/components/DocumentLoader/documentLoaderUtils.js`<br>`src/components/DocumentLoader/mainThreadRenderer.js`<br>`src/utils/pageAssetRenderer.js` |

## Development Dependencies

| Package | Version | Observed source imports |
| --- | --- | ---: |
| `@babel/core` | `^8.0.0` | 0 |
| `@babel/plugin-transform-runtime` | `^8.0.0` | 0 |
| `@babel/runtime` | `^8.0.0` | 0 |
| `@eslint/js` | `^10.0.1` | 0 |
| `@rolldown/plugin-babel` | `^0.2.3` | 0 |
| `@vitejs/plugin-react` | `^6.0.2` | 0 |
| `concurrently` | `^10.0.3` | 0 |
| `cross-env` | `^10.1.0` | 0 |
| `docdash` | `^2.0.2` | 0 |
| `eslint` | `^10.5.0` | 0 |
| `eslint-plugin-react-hooks` | `^7.1.1` | 0 |
| `eslint-plugin-react-refresh` | `^0.5.3` | 0 |
| `globals` | `^17.6.0` | 0 |
| `jsdoc` | `^4.0.5` | 0 |
| `prettier` | `^3.8.4` | 0 |
| `rolldown` | `^1.1.1` | 0 |
| `vite` | `^8.0.16` | 0 |

## Imported But Not Declared Directly

No undeclared package imports were detected.
