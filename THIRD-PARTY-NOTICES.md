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

## Development-only dependencies (not shipped)

| Component | Licence | Used for |
| --- | --- | --- |
| `@peculiar/x509` | MIT | Fixture generator and tests only: creating throwaway test CA/signer certificates. Never imported from application code and never bundled. |
| `reflect-metadata` | Apache-2.0 | Polyfill required by `@peculiar/x509` v2 (via `tsyringe`); loaded once at the top of the fixture generator. Never imported from application code and never bundled. |
| `@playwright/test` | Apache-2.0 | Browser UI tests (`npm run test:ui`, `tests/ui/`) only. Never imported from application code and never bundled. |
