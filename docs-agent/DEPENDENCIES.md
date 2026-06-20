# Dependencies

This file combines package.json declarations with observed source imports.

## Runtime Dependencies

| Package | Version | Imports | Used In |
| --- | --- | ---: | --- |
| <code>axios</code> | <code>^1.18.0</code> | 1 | <code>src/logging/systemLogger.js</code> |
| <code>cors</code> | <code>^2.8.6</code> | 1 | <code>server/system-log-server.js</code> |
| <code>dompurify</code> | <code>^3.4.11</code> | 3 | <code>src/components/DocumentToolbar/ManualOverlayDialog.jsx</code><br><code>src/utils/printDom.js</code><br><code>src/utils/printPdf.js</code> |
| <code>dotenv</code> | <code>^17.4.2</code> | 2 | <code>server/system-log-server.js</code><br><code>server/user-log-server.js</code> |
| <code>express</code> | <code>^5.2.1</code> | 2 | <code>server/system-log-server.js</code><br><code>server/user-log-server.js</code> |
| <code>express-rate-limit</code> | <code>^8.5.2</code> | 2 | <code>server/system-log-server.js</code><br><code>server/user-log-server.js</code> |
| <code>file-type</code> | <code>^22.0.1</code> | 1 | <code>src/components/DocumentLoader/DocumentLoader.js</code> |
| <code>helmet</code> | <code>^8.2.0</code> | 2 | <code>server/system-log-server.js</code><br><code>server/user-log-server.js</code> |
| <code>i18next</code> | <code>^26.3.1</code> | 5 | <code>src/ErrorBoundary.jsx</code><br><code>src/i18n.js</code><br><code>src/utils/printDom.js</code><br><code>src/utils/printParse.js</code><br><code>src/utils/printPdf.js</code> |
| <code>i18next-http-backend</code> | <code>^4.0.0</code> | 1 | <code>src/i18n.js</code> |
| <code>i18next-icu</code> | <code>^2.4.3</code> | 1 | <code>src/i18n.js</code> |
| <code>jspdf</code> | <code>^4.2.1</code> | 0 |  |
| <code>material-icons</code> | <code>^1.13.14</code> | 1 | <code>src/index.jsx</code> |
| <code>morgan</code> | <code>^1.11.0</code> | 2 | <code>server/system-log-server.js</code><br><code>server/user-log-server.js</code> |
| <code>pdf-lib</code> | <code>^1.17.1</code> | 0 |  |
| <code>pdfjs-dist</code> | <code>^6.0.227</code> | 8 | <code>src/components/DocumentLoader/documentLoaderUtils.js</code><br><code>src/components/DocumentLoader/mainThreadRenderer.js</code><br><code>src/utils/pageAssetRenderer.js</code><br><code>src/workers/pdfPageWorker.js</code> |
| <code>prop-types</code> | <code>^15.8.1</code> | 32 | <code>src/PerformanceMonitor.jsx</code><br><code>src/app/OpenDocViewer.jsx</code><br><code>src/components/CanvasRenderer.jsx</code><br><code>src/components/DocumentConsumerWrapper.jsx</code><br><code>src/components/DocumentLoader/LoadPressureDialog.jsx</code> |
| <code>react</code> | <code>^19.2.7</code> | 52 | <code>src/ErrorBoundary.jsx</code><br><code>src/PerformanceMonitor.jsx</code><br><code>src/app/AppBootstrap.jsx</code><br><code>src/app/OpenDocViewer.jsx</code><br><code>src/components/CanvasRenderer.jsx</code> |
| <code>react-dom</code> | <code>^19.2.7</code> | 1 | <code>src/index.jsx</code> |
| <code>react-i18next</code> | <code>^17.0.8</code> | 33 | <code>src/PerformanceMonitor.jsx</code><br><code>src/app/AppBootstrap.jsx</code><br><code>src/components/DocumentConsumerWrapper.jsx</code><br><code>src/components/DocumentLoader/DemoControls.jsx</code><br><code>src/components/DocumentLoader/DocumentLoader.js</code> |
| <code>utif2</code> | <code>^4.1.0</code> | 3 | <code>src/components/DocumentLoader/documentLoaderUtils.js</code><br><code>src/components/DocumentLoader/mainThreadRenderer.js</code><br><code>src/utils/pageAssetRenderer.js</code> |

## Development Dependencies

| Package | Version | Observed source imports |
| --- | --- | ---: |
| <code>@babel/core</code> | <code>^8.0.0</code> | 0 |
| <code>@babel/plugin-transform-runtime</code> | <code>^8.0.0</code> | 0 |
| <code>@babel/runtime</code> | <code>^8.0.0</code> | 0 |
| <code>@eslint/js</code> | <code>^10.0.1</code> | 0 |
| <code>@rolldown/plugin-babel</code> | <code>^0.2.3</code> | 0 |
| <code>@vitejs/plugin-react</code> | <code>^6.0.2</code> | 0 |
| <code>concurrently</code> | <code>^10.0.3</code> | 0 |
| <code>cross-env</code> | <code>^10.1.0</code> | 0 |
| <code>docdash</code> | <code>^2.0.2</code> | 0 |
| <code>eslint</code> | <code>^10.5.0</code> | 0 |
| <code>eslint-plugin-react-hooks</code> | <code>^7.1.1</code> | 0 |
| <code>eslint-plugin-react-refresh</code> | <code>^0.5.3</code> | 0 |
| <code>globals</code> | <code>^17.6.0</code> | 0 |
| <code>jsdoc</code> | <code>^4.0.5</code> | 0 |
| <code>prettier</code> | <code>^3.8.4</code> | 0 |
| <code>rolldown</code> | <code>^1.1.1</code> | 0 |
| <code>vite</code> | <code>^8.0.16</code> | 0 |

## Imported But Not Declared Directly

No undeclared package imports were detected.
