# Third-Party Notices

OpenDocViewer bundles third-party open source components. This file records the licences of
the components that are re-distributed inside the application bundle. The full dependency
list with licence identifiers is in `package.json` / `package-lock.json`.

## Bundled runtime dependencies

| Component | Licence | Used for |
| --- | --- | --- |
| `axios` 1.21.0 | MIT | HTTP requests in the system-log client. |
| `dompurify` 3.4.17 | MPL-2.0 OR Apache-2.0 | Sanitizing manual HTML and configured print markup. |
| `file-type` 22.3.0 | MIT | Byte-level source-format detection. |
| `i18next` 27.0.1, `i18next-http-backend` 4.0.10, `i18next-icu` 2.7.0 | MIT | Localized UI text, translation loading and ICU message formatting. |
| `jspdf` 4.2.1 | MIT | Generated-PDF printing and download. |
| `jxl-oxide-wasm` 0.12.6 | MIT OR Apache-2.0 (Wonwoo Choi and contributors, github.com/tirr-c/jxl-oxide) | JPEG XL decoding and lossless PNG encoding in Rust/WebAssembly, loaded only for JPEG XL input. The package includes LICENSE-MIT and LICENSE-APACHE. |
| `material-icons` 1.13.14 | Apache-2.0 | Self-hosted toolbar and dialog icons. |
| `pdf-lib` 1.17.1 | MIT | PDF signature parsing and generated-PDF merging. |
| `pdfjs-dist` 6.5.438 | Apache-2.0 | PDF rendering, text extraction and signature differential checks. |
| `prop-types` 15.8.1 | MIT | React component runtime prop validation. |
| `react` / `react-dom` 19.3.1, `react-i18next` 18.0.0 | MIT | Application UI and React localization bindings. |
| `utif2` 4.1.0 | MIT | TIFF decoding. |
| `pkijs` 4.0.1 | BSD-3-Clause (Copyright (c) 2014 GlobalSign, 2015-2019 Peculiar Ventures) | Parsing CMS/PKCS#7 signature payloads in signed PDFs (loaded dynamically only when a document contains signature fields) |
| `asn1js` 4.0.0 | BSD-3-Clause (Copyright (c) 2014 GMO GlobalSign, 2015-2022 Peculiar Ventures) | ASN.1/DER decoding backing `pkijs` |
| `@noble/hashes` 2.4.0 | MIT (Copyright (c) 2022 Paul Miller) | SHA-1 and SHA-2 hashing backing `pkijs`, and SHA-256 conversion provenance for JPEG XL |
| `@peculiar/utils` | MIT (Copyright (c) 2017-2026 Peculiar Ventures, LLC) | Binary, hex and base64 conversion helpers backing `pkijs` and `asn1js` |
| `bytestreamjs` | BSD-3-Clause (Copyright (c) 2016-2022 Peculiar Ventures) | Byte-stream reading and writing backing `pkijs` |

The signature components ship their licence text inside their npm packages
(`node_modules/pkijs/LICENSE`, `node_modules/asn1js/LICENSE`,
`node_modules/@noble/hashes/LICENSE`, `node_modules/@peculiar/utils/LICENSE`,
`node_modules/bytestreamjs/LICENSE`). The bundled `@peculiar/utils` 4.1.0 is installed once
at the top level and shared by `pkijs` and `asn1js`.

Redistribution notice for BSD-3-Clause components: these licences require retention of the
copyright notice, this list of conditions and the following disclaimer in redistributions.
The MIT licences require the copyright and permission notice in all copies or substantial
portions of the software. The full licence texts are in the installed packages listed above.

## Optional log-server dependencies

These packages are installed for the separately hosted Node services; they are not part of the
static viewer bundle.

| Component | Licence | Used for |
| --- | --- | --- |
| `cors` 2.8.6 | MIT | Opt-in CORS handling for the system-log endpoint. |
| `dotenv` 18.0.9 | BSD-2-Clause | Loading service environment settings from `.env`. |
| `express` 5.3.0 | MIT | HTTP routing and request parsing. |
| `express-rate-limit` 8.7.3 | MIT | Ingestion rate limits. |
| `helmet` 8.3.0 | MIT | HTTP security headers. |
| `morgan` 1.12.1 | MIT | HTTP access logs. |

## OCR engine (opt-in; loaded only when `ocr.enabled` is `true`)

The in-browser OCR feature ships two kinds of files: the tesseract.js API bundle inside the lazy
`ocr-<hash>.js` chunk, and the engine files copied unchanged into `dist/ocr/` by the build
(`scripts/ocr-assets.mjs`). None of them is downloaded or executed unless a site turns the
feature on (`docs-src/runtime-configuration.md`).

| Component | Licence | Used for |
| --- | --- | --- |
| `tesseract.js` 7.0.0 | Apache-2.0 (Project Naptha, github.com/naptha/tesseract.js) | OCR API (`dist/tesseract.esm.min.js`, in the lazy chunk) and the Web Worker script (`dist/worker.min.js`, copied to `dist/ocr/`). The worker bundle embeds the package's runtime dependencies: `regenerator-runtime` (MIT, Facebook, Inc.), `buffer` (MIT, Feross Aboukhadijeh), `ieee754` (BSD-3-Clause, Feross Aboukhadijeh) and `zlib.js` (MIT, imaya), whose notices are in `node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt`, `base64-js` (MIT, Jameson Little; pulled in by `buffer`, visible in `worker.min.js.map`), as well as `idb-keyval` (Apache-2.0, Jake Archibald; unused at runtime because model caching is off), `wasm-feature-detect` (Apache-2.0, Google LLC), `bmp-js` (MIT, shaozilee) and `is-url` (MIT, Segment.io). |
| `tesseract.js-core` 7.0.0 | Apache-2.0 (github.com/naptha/tesseract.js-core) | The OCR engine compiled to WebAssembly (`tesseract-core-simd-lstm.wasm.js`, copied to `dist/ocr/`): a build of the Tesseract OCR engine (Apache-2.0, Google and contributors) with Leptonica (BSD-2-Clause, Dan Bloomberg). |
| `@tesseract.js-data/swe` 1.0.0, `@tesseract.js-data/eng` 1.0.0 | MIT (npm packaging, github.com/naptha/tessdata); the models are the integer-quantized `tessdata_best` files of the Tesseract project (Apache-2.0) | Swedish and English language models (`swe.traineddata.gz`, `eng.traineddata.gz`, copied to `dist/ocr/`). Installed as development dependencies because only the build reads them. |

The licence texts ship inside the packages (`node_modules/tesseract.js/LICENSE.md`,
`node_modules/tesseract.js-core/LICENSE`). OpenDocViewer imports the prebuilt browser bundles
only; `node-fetch` and `opencollective-postinstall`, also declared by `tesseract.js`, are Node-only
and never shipped. Language-model caching in IndexedDB is turned off (`cacheMethod: 'none'`), so
the embedded `idb-keyval` never runs.

## Development-only dependencies (not shipped)

| Component | Licence | Used for |
| --- | --- | --- |
| `@peculiar/x509` | MIT | Fixture generator and tests only: creating throwaway test CA/signer certificates. Never imported from application code and never bundled. |
| `reflect-metadata` | Apache-2.0 | Polyfill required by `@peculiar/x509` v3 (via `tsyringe`); loaded once at the top of the fixture generator. Never imported from application code and never bundled. |
| `@playwright/test` | Apache-2.0 | Browser UI tests (`npm run test:ui`, `tests/ui/`) only. Never imported from application code and never bundled. |
