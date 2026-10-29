# Third-Party Notices

OpenDocViewer bundles third-party open source components. This file records the licences of
the components that are re-distributed inside the application bundle. The full dependency
list with licence identifiers is in `package.json` / `package-lock.json`.

## Bundled runtime dependencies

| Component | Licence | Used for |
| --- | --- | --- |
| `pkijs` | BSD-3-Clause (Copyright (c) 2014 GlobalSign, 2015-2019 Peculiar Ventures) | Parsing CMS/PKCS#7 signature payloads in signed PDFs (loaded dynamically only when a document contains signature fields) |
| `asn1js` | BSD-3-Clause (Copyright (c) 2014 GMO GlobalSign, 2015-2022 Peculiar Ventures) | ASN.1/DER decoding backing `pkijs` |
| `@noble/hashes` | MIT (Copyright (c) 2022 Paul Miller) | SHA-1 and SHA-2 hashing backing `pkijs` |
| `@peculiar/utils` | MIT (Copyright (c) 2017-2026 Peculiar Ventures, LLC) | Binary, hex and base64 conversion helpers backing `pkijs` and `asn1js` |
| `bytestreamjs` | BSD-3-Clause (Copyright (c) 2016-2022 Peculiar Ventures) | Byte-stream reading and writing backing `pkijs` |

All five ship their licence text inside their npm packages
(`node_modules/pkijs/LICENSE`, `node_modules/asn1js/LICENSE`,
`node_modules/@noble/hashes/LICENSE`, `node_modules/pkijs/node_modules/@peculiar/utils/LICENSE`,
`node_modules/bytestreamjs/LICENSE`). The bundled `@peculiar/utils` 4.1.0 is installed under
`pkijs` and `asn1js`; the top-level `node_modules/@peculiar/utils` is an older,
development-only copy.

Redistribution notice for BSD-3-Clause components: these licences require retention of the
copyright notice, this list of conditions and the following disclaimer in redistributions.
The MIT licences require the copyright and permission notice in all copies or substantial
portions of the software. The full licence texts are in the installed packages listed above.

## OCR engine (opt-in; loaded only when `ocr.enabled` is `true`)

The in-browser OCR feature ships two kinds of files: the tesseract.js API bundle inside the lazy
`ocr-<hash>.js` chunk, and the engine files copied unchanged into `dist/ocr/` by the build
(`scripts/ocr-assets.mjs`). None of them is downloaded or executed unless a site turns the
feature on (`docs-src/runtime-configuration.md`).

| Component | Licence | Used for |
| --- | --- | --- |
| `tesseract.js` 7.0.0 | Apache-2.0 (Project Naptha, github.com/naptha/tesseract.js) | OCR API (`dist/tesseract.esm.min.js`, in the lazy chunk) and the Web Worker script (`dist/worker.min.js`, copied to `dist/ocr/`). The worker bundle embeds the package's runtime dependencies: `regenerator-runtime` (MIT, Facebook, Inc.), `buffer` (MIT, Feross Aboukhadijeh), `ieee754` (BSD-3-Clause, Feross Aboukhadijeh) and `zlib.js` (MIT, imaya), whose notices are in `node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt`, as well as `idb-keyval` (Apache-2.0, Jake Archibald; unused at runtime because model caching is off), `wasm-feature-detect` (Apache-2.0, Google LLC), `bmp-js` (MIT, shaozilee) and `is-url` (MIT, Segment.io). |
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
| `reflect-metadata` | Apache-2.0 | Polyfill required by `@peculiar/x509` v2 (via `tsyringe`); loaded once at the top of the fixture generator. Never imported from application code and never bundled. |
| `@playwright/test` | Apache-2.0 | Browser UI tests (`npm run test:ui`, `tests/ui/`) only. Never imported from application code and never bundled. |
