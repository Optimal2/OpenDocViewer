# PDF Signature Inspection (Level 1)

This document describes OpenDocViewer's level-1 PDF signature support: reading digital
signature information from PDF documents in the browser, checking integrity only, and
exposing the result as a stable data contract that the user interface (level 1 UI, a later
campaign) and trust validation (level 2, server-side in the gateway repository) build on.

## Scope and trust model

pdf.js renders PDF pages and never exposes or verifies signatures: signature widgets carry
no field value and a visible signature is only page appearance. OpenDocViewer therefore
reads the AcroForm signature fields and their PKCS#7/CMS payloads itself with `pdf-lib` and
`pkijs` and verifies integrity with WebCrypto (`crypto.subtle`).

Level 1 answers exactly one question per signature: **"is the content this signature covered
byte-for-byte intact?"** It never states that a signature is valid, trusted, or that the
signer is who they claim to be:

- Certificate chain building, revocation checking, and trust-list evaluation are level 2 and
  run server-side (ODVGateway), not in the viewer. The contract reserves the `trust` field
  for that; at level 1 it is always `'not-checked'`.
- The design keeps that door open: level 2 only fills in `trust` (and optionally replaces the
  verification source); no field added later may change the meaning of the existing fields.

## Formats handled

Signature dictionaries carry `/SubFilter`, which names the CMS format. Level 1 handles:

| SubFilter | Meaning | Handling |
| --- | --- | --- |
| `adbe.pkcs7.detached` | Classic Adobe detached PKCS#7/CMS signature | Full integrity verification |
| `ETSI.CAdES.detached` | PAdES / CMS detached signature (often with extra signed attributes) | Full integrity verification; unrecognized signed attributes are ignored, not errors |
| `adbe.pkcs7.sha1` | Legacy format where the CMS embeds the document SHA-1 digest instead of signing the byte range | Full verification of the CMS signature; document digest is compared against the embedded content |
| `ETSI.RFC3161` | Document timestamp token (RFC 3161 TSTInfo, signed by a TSA) | Reported with `kind: 'timestamp'`; integrity = TSTInfo `messageImprint` matches the digest of the covered bytes and the token signature verifies |

Any other `/SubFilter` (or a missing one) is **never hidden**: the signature is still
reported with `integrity: 'unsupported'` and the reason `signature present, format not
supported` plus the raw SubFilter value, so the UI can say "a signature exists but this
format cannot be checked here".

Approval vs certification: a signature whose signature dictionary has a `/Reference` entry
(DocMDP transform parameters) is a certification signature - it fixes permissions from the
moment of signing onward. It is reported with `kind: 'certification'`. Normal approval
signatures use `kind: 'approval'`. Level 1 does not verify what the DocMDP dictionary says
about the document revision; it only distinguishes the two so the UI can label them.

## Multiple signatures and incremental updates

A PDF can be signed several times; each later signing step appends an incremental update.
Byte ranges recorded by an earlier signature then no longer reach the end of the file. The
parser reports this per signature:

- `coversWholeFile: true` - the ByteRange covers the file up to its end (nothing was
  appended after this signature).
- `coversWholeFile: false` - the file was extended (or, when the covered bytes themselves
  no longer match, the content was changed) after signing.

Integrity rules, in evaluation order:

1. `/Contents` missing or the CMS not parseable -> `integrity: 'unreadable'`.
2. `/SubFilter` outside the handled formats -> `integrity: 'unsupported'` (signature still
   reported, never hidden).
3. CMS `messageDigest` (or the embedded SHA-1 in `adbe.pkcs7.sha1`, or the TSTInfo
   `messageImprint` for timestamps) does not match the WebCrypto digest of the signed bytes
   -> `integrity: 'digest-mismatch'`.
4. The CMS signer signature does not verify over the signed attributes with the embedded
   certificate's public key -> `integrity: 'signature-invalid'`.
5. Everything verifies but the ByteRange does not reach the end of the file: the file was
   extended after this signature was applied.
   - If the added bytes are themselves covered by a *later signature* in the same document
     (the normal case for the first signature of a multi-signature document), the content
     this signature protected is still byte-for-byte intact: `integrity: 'intact'` with
     `coversWholeFile: false` and an `integrityReason` saying the file was extended by later
     signature(s).
   - If the extension is **not** covered by any later signature, someone changed the file
     without signing the change: `integrity: 'modified-after-signing'`.
6. Everything verifies and the range reaches EOF -> `integrity: 'intact'`,
   `coversWholeFile: true`.

Signature algorithms are mapped to WebCrypto: RSA PKCS#1 v1.5 (`RSASSA-PKCS1-v1_5`),
RSA-PSS (`RSA-PSS`, salt length from the PSS parameters when present, otherwise the digest
length), and ECDSA (`ECDSA`, DER signature converted to the raw `r||s` form WebCrypto
expects). When the environment or algorithm is not supported by WebCrypto the result is
`integrity: 'unreadable'` with a reason, never an exception.

## Where it runs

`src/utils/pdfSignatures.js` is environment-agnostic pure logic (it works on the main
thread, in a worker, and in Node/vitest). To keep the main thread free it is normally
executed inside a dedicated module worker, exactly like the PDF page worker pool:

- `src/workers/pdfSignatureWorker.js` - worker entry; calls the parser on the received
  document bytes and posts the report back.
- `src/utils/pdfSignatureInspector.js` - the single entry point for callers:

```js
import { getDocumentSignatures } from '../utils/pdfSignatureInspector.js';

// bytes: ArrayBuffer | Uint8Array of the complete PDF document (e.g. from
// `await documentBlob.arrayBuffer()` where the loader already holds the source blob).
const report = await getDocumentSignatures(bytes);
for (const sig of report.signatures) {
  // sig.integrity, sig.signer, ... - see the data contract below
}
```

`getDocumentSignatures` offloads to a lazily created singleton worker when the browser
`Worker` API is available, and falls back to running the parser inline when worker creation
or execution fails. It never rejects for document reasons: a PDF with no signatures, a
corrupt CMS blob, or an unsupported environment all resolve to a report (an empty
`signatures` list or per-signature `unreadable`/`unsupported` entries). Callers should fetch
it once per document and cache the report next to the document state.

## Data contract

Defined as JSDoc typedefs in `src/utils/pdfSignatures.js` (`PdfSignatureInfo`,
`PdfSignatureReport`):

```ts
interface PdfSignatureReport {
  signatures: PdfSignatureInfo[]; // [] when the document has no signature fields
}

interface PdfSignatureInfo {
  fieldName: string | null;              // AcroForm field name (/T)
  signer: string | null;                 // certificate subject CN, else signature /Name
  signerOrganization: string | null;     // certificate subject O, else null
  issuer: string | null;                 // certificate issuer CN (else issuer DN)
  serial: string | null;                 // certificate serial, colon-separated hex (DER sign padding removed)
  notBefore: string | null;              // ISO 8601, certificate validity start
  notAfter: string | null;               // ISO 8601, certificate validity end
  signingTime: string | null;            // ISO 8601 signing time (see signingTimeSource)
  signingTimeSource: 'signed-attribute' | 'pdf-M' | 'none';
  reason: string | null;                 // signature dictionary /Reason
  location: string | null;               // signature dictionary /Location
  subFilter: string | null;              // raw /SubFilter value, e.g. "adbe.pkcs7.detached"
  kind: 'approval' | 'certification' | 'timestamp';
  integrity:
    | 'intact'
    | 'modified-after-signing'
    | 'digest-mismatch'
    | 'signature-invalid'
    | 'unsupported'
    | 'unreadable';
  integrityReason: string | null;        // short human-readable explanation; null when there is nothing to explain
  coversWholeFile: boolean | null;       // false = file extended after signing
  trust: 'not-checked';                  // reserved for level 2 (server-side chain/trust)
}
```

Notes:

- Every field is `null` when it cannot be read; the parser never omits a key, so the UI can
  rely on the shape.
- `signer` prefers the certificate subject CN because the PDF `/Name` string is
  self-declared; `/Name` is only used when no certificate could be read.
- `integrityReason` is a stable, short string intended for display (it is written in
  English; localization is the UI layer's job via stable integrity values).
- Timestamp fields (`ETSI.RFC3161` document timestamps) appear as normal entries with
  `kind: 'timestamp'`, so a document's signature chain (approval signatures plus their
  long-term timestamps) is visible in one list, ordered by ByteRange position.

## Fixtures

`scripts/generate-signature-fixtures.mjs` is the committed generator. It creates a throwaway
test CA and signer certificates (fixed dates and serial numbers, generated keys - never
committed, never real-world identities) and signs synthetic one-page PDFs that cover every
integrity status and format branch:

| Fixture | Covers |
| --- | --- |
| `valid-rsa.pdf` | `adbe.pkcs7.detached`, RSA PKCS#1 v1.5 SHA-256, visible widget, `intact` |
| `cades-ecdsa-invisible.pdf` | `ETSI.CAdES.detached`, ECDSA P-256, invisible widget (`/F 128`), `intact` |
| `pss-rsa-no-signing-time-attr.pdf` | RSA-PSS signature without a `signingTime` attribute (falls back to `/M`) |
| `digest-mismatch.pdf` | content byte changed inside the signed range after signing |
| `extended-after-signing.pdf` | plain incremental update appended after signing (no second signature) |
| `two-signatures.pdf` | approval signature followed by a second signature in an incremental update |
| `certified-docmdp.pdf` | certification signature (`/Reference` DocMDP) |
| `doc-timestamp-rfc3161.pdf` | `ETSI.RFC3161` document timestamp token |
| `pkcs7-sha1.pdf` | legacy `adbe.pkcs7.sha1` embedded digest |
| `unsupported-subfilter.pdf` | `/SubFilter /ICVN.SADES` -> reported `unsupported`, never hidden |
| `corrupt-contents.pdf` | invalid CMS bytes (`deadbeef`) -> `unreadable` |
| `signature-invalid.pdf` | CMS signed with a foreign key, correct digests -> `signature-invalid` |
| `unsigned.pdf` | no signature fields -> empty list fast path |

The fixtures are generated in the vitest setup instead of being committed as binary files:
the public repository stays free of binaries that cannot be diff-reviewed, keys are
regenerated per run, and the generator CLI (`node
scripts/generate-signature-fixtures.mjs --out <dir>`) reproduces any fixture on demand for
manual inspection.

## Third-party components

`pkijs` and `asn1js` (both BSD-3-Clause) are bundled runtime dependencies used only for
signature parsing, loaded with a dynamic import when a document actually contains
signature fields. The certificate helper `@peculiar/x509` (MIT) is a devDependency used only
by the fixture generator and tests, never shipped. Licences are recorded in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

## Out of scope (level 2)

Certificate chain building to a trust anchor, revocation status (OCSP/CRL), trust-list
evaluation, and any statement stronger than integrity. Those need server-side validation
and a trust store; the `trust` field is the only hook they will fill.
