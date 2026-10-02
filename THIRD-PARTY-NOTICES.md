# Third-Party Notices

OpenDocViewer bundles third-party open source components. This file records the licences of
the components that are re-distributed inside the application bundle. The full dependency
list with licence identifiers is in `package.json` / `package-lock.json`.

## Bundled runtime dependencies

| Component | Licence | Used for |
| --- | --- | --- |
| `pkijs` | BSD-3-Clause (Copyright (c) 2014 GlobalSign, 2015-2019 Peculiar Ventures) | Parsing CMS/PKCS#7 signature payloads in signed PDFs (loaded dynamically only when a document contains signature fields) |
| `asn1js` | BSD-3-Clause (Copyright (c) 2014 GMO GlobalSign, 2015-2022 Peculiar Ventures) | ASN.1/DER decoding backing `pkijs` |

Both ship their licence text inside their npm packages
(`node_modules/pkijs/LICENSE`, `node_modules/asn1js/LICENSE`).

Redistribution notice for BSD-3-Clause components: these licences require retention of the
copyright notice, this list of conditions and the following disclaimer in redistributions;
their full licence texts are available in the installed packages and in the release
artifacts' `node_modules`.

## Development-only dependencies (not shipped)

| Component | Licence | Used for |
| --- | --- | --- |
| `@peculiar/x509` | MIT | Fixture generator and tests only: creating throwaway test CA/signer certificates. Never imported from application code and never bundled. |
