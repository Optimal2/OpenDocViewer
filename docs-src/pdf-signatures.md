# PDF Signature Inspection (Level 1)

This document describes OpenDocViewer's level-1 PDF signature support: reading digital
signature information from PDF documents in the browser, checking integrity only, and
exposing the result as a stable data contract and user interface.

## Scope and self-sufficiency

pdf.js renders PDF pages and never exposes or verifies signatures: signature widgets carry
no field value and a visible signature is only page appearance. OpenDocViewer therefore
reads the AcroForm signature fields and their PKCS#7/CMS payloads itself with `pdf-lib` and
`pkijs` and verifies integrity with WebCrypto (`crypto.subtle`).

OpenDocViewer is self-sufficient for this inspection. It behaves identically with and without
ODVGateway, and does not require OpenModulePlatform. It makes **no network request for
signatures**: inspection uses only the document bytes the viewer already holds.

Level 1 answers exactly one question per signature: **"is the content this signature covered
byte-for-byte intact?"** It never states that a signature is valid or that the signer is who
they claim to be. Certificate chain building, issuer trust, revocation checking and trust-list
evaluation are not checked in the viewer. This limitation is accepted and shown as neutral
information for every signature, not as a warning or an error.

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

1. `/SubFilter` outside the handled formats -> `integrity: 'unsupported'` (signature still
   reported, never hidden).
2. `/Contents` missing or the CMS not parseable -> `integrity: 'unreadable'`.
3. ByteRange must contain four non-negative safe integers, start at zero, remain inside
   the file, and exclude exactly the direct `/Contents` hex string including `<` and `>`.
   Source positions come from the same parser objects as the signature dictionary;
   another hex string or a value in an object stream cannot stand in for `/Contents`.
   A malformed range is `unreadable`, with `coversWholeFile: null`.
4. If CMS signed attributes exist, exactly one `messageDigest` value is mandatory and
   must match the hash of the CMS content. For detached signatures that content is the
   ByteRange bytes; for encapsulated signatures it is the eContent bytes. The signed
   `contentType` must also match. Missing/ambiguous attributes are `unreadable` and a
   different digest is `digest-mismatch`. Encapsulated SHA-1 / TSTInfo must additionally
   match the document digest / imprint. These are separate mandatory checks, following
   [RFC 5652 section 5.4](https://www.rfc-editor.org/rfc/rfc5652#section-5.4).
5. The CMS signer signature does not verify over the signed attributes with the embedded
   certificate's public key -> `integrity: 'signature-invalid'`.
   Without signed attributes, verification operates directly on the CMS content.
   Certificates must match SignerInfo issuer **and** serial, or its subject key identifier
   (SKI extension, with SHA-1 of the subjectPublicKey bits as fallback only when the
   extension is absent). An unmatched identifier is `unreadable`; certificate order
   never determines signer identity.
6. Everything verifies but the ByteRange does not reach the end of the file: the file was
   extended after this signature was applied.
   - If the added bytes are themselves covered by a *verified intact later signature* in the same document
     (the normal case for the first signature of a multi-signature document), the content
     this signature protected is still byte-for-byte intact: `integrity: 'intact'` with
     `coversWholeFile: false` and an `integrityReason` saying the file was extended by later
     signature(s).
     Verification runs from the last revision backwards. The later range must start at
     zero, its first segment must include the entire earlier revision, and its end must
     reach EOF. An unreadable or invalid later CMS cannot authorize an extension.
   - If the extension is **not** covered by any later signature, someone changed the file
     without signing the change: `integrity: 'modified-after-signing'`.
7. Everything verifies and the range reaches EOF -> `integrity: 'intact'`,
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
`Worker` API is available. Worker construction/execution errors and timeouts return a
document-level `unreadable` entry; they never start inline parsing. A timeout terminates
the worker and settles all pending requests. Later documents may recreate a failed worker
up to three times per viewer session (including construction failures); successful requests
do not reset this budget. The failed document remains unreadable. Disposal also settles
requests and resets the budget for a fresh session. Inline parsing is allowed only without a Worker API
and for inputs at most 256 KiB. It never rejects for document reasons: a PDF with no signatures, a
corrupt CMS blob, or an unsupported environment all resolve to a report (an empty
`signatures` list or per-signature `unreadable`/`unsupported` entries). Callers should fetch
it once per document and cache the report next to the document state.

Inspection budgets are 64 MiB input (checked before worker cloning or reading a Blob),
256 signatures, 1 MiB per CMS, ASN.1 depth 64 / 100,000 nodes, and PDF object depth 128.
Structural streams (ObjStm/XRef) have an 8 MiB decoded limit each and 32 MiB total;
multiple structural stream filters are conservatively reported unreadable. Page and
image streams are not decoded by signature inspection. Worker execution has a default
30-second deadline. Exceeding a budget returns `unreadable`, never an unsigned verdict.

Discovery parses PDF objects rather than relying on raw ASCII name searches: escaped
names, object streams, nested dictionaries and signatures superseded in later revisions
remain discoverable. Unsigned documents avoid importing the CMS stack, but still pay
for PDF structure parsing. If structure/discovery cannot complete, a document-level
`unreadable` placeholder with null identity fields communicates the incomplete inspection;
it is not evidence that a particular signature exists.

Discovery starts at byte zero regardless of where, or whether, a `%PDF-` header
exists: rendering can recover PDFs whose headers fall outside an initial search window.
Leading junk is never stripped. ByteRange verification uses actual file offsets, so a
prefix added after signing leaves the signature visible but its broken offsets unreadable.
A prefix included before signing can be intact only when the actual bytes verify.

## Level-1 user interface

The viewer surfaces the inspection result without ever blocking page rendering:

- `src/hooks/usePdfSignatureReports.js` (driven from `ViewerProvider`) starts the
  inspection only after the first page is ready (or after every page with runtime config
  `pdfSignatures.inspectAfter: 'allPages'`; `pdfSignatures.enabled: false` never starts it —
  see `docs-src/runtime-configuration.md`), calls `getDocumentSignatures` once per PDF
  document with the bytes already held in the source temp store (the file is never fetched
  again), and caches one report per document (`sourceKey`) in viewer context state for the
  session. Non-PDF documents are never inspected. `ViewerProvider` calls
  `disposePdfSignatureWorker()` when the viewer unmounts.
  A serial queue reads one source at a time, prioritizing the current document and
  then page order. Pending results survive page-list updates; only removal or unmount
  discards them. Recycled source keys get fresh entries. Read/inspection failures are
  reported as unreadable rather than unsigned. The disposable source-store copy is
  transferred to the worker with `{ transfer: true }`; other inspector callers retain
  their buffers by default. No document bytes are retained in the report cache.
- `src/utils/pdfSignatureStatus.js` maps the contract to presentation: the badge colour and
  icon follow the *worst* integrity status of a document's signatures (`intact` =
  neutral/positive, `modified-after-signing`/`unsupported` = warning,
  `digest-mismatch`/`signature-invalid`/`unreadable` = error; unknown values fail safe to
  error).
  Every signature is normalized before selecting the worst status, so mixing an intact
  signature with a missing or unexpected status still yields unreadable. Tooltip and
  dialog labels use the same normalization and translation helper.
- `src/utils/pdfSignatureDocuments.js` folds the per-file reports into per-document entries.
  Reports are keyed per file (`sourceKey`), while the thumbnail strip groups pages into
  documents ("DOK n") and one document can consist of several files. A document entry carries
  every file ("File k of m", plus a display file name taken from the last URL path segment when
  it looks like a file name), the signed files, the total signature count, the worst severity and
  integrity across all its files, and the newest signature. Pages without document context form
  one document per file. No signatures means no entry, no symbol and no toolbar button.
- `src/components/SignatureStatusBadge.jsx` is the signature symbol, a native button with an
  accessible name that includes the count (for example "Signed document, 3 signatures") and a
  tooltip. It is shown in two places in the thumbnail strip:
  - **Document symbol** next to the "DOK n" label in the document boundary header (shown when
    the session has several documents). It aggregates all files of the document (worst
    severity, total count shown next to the icon) and opens the details dialog for the
    document with the first signed file preselected. The header is not collapsible, so the
    symbol stays visible; the click stops propagation and never selects or toggles pages.
    The inline header and the sticky header shown while scrolling the strip are one component
    (`DocumentBoundaryHeader` in `DocumentThumbnailList.jsx`), so both have the same typography,
    size, spacing and clickable symbol. The sticky header appears only once the current
    document's inline header has scrolled out of view, so the two are never visible together;
    while it is shown, the scrolled-out inline header is `aria-hidden` and `inert`, so the
    symbol is announced and tab-reachable once. Verified by
    `tests/ui/thumbnail-sticky-header.spec.mjs`.
  - **Page symbol** on every page thumbnail that belongs to a signed file: an 18 px glyph in a
    22 px pill centred on the top edge of the thumbnail image, so the top-right corner stays
    free for the compare-mode L/R pane markers. At rest it is discreet (opacity 0.55, no
    translucent overlay); hover and keyboard focus make it fully opaque with a shadow and a
    focus ring, never more transparent than at rest. It opens the same document dialog with
    its own file preselected. Runtime config `pdfSignatures.thumbnailPageBadge: false` hides
    the page symbol and keeps the document symbol (see `docs-src/runtime-configuration.md`).
- `src/components/SignatureOverviewButton.jsx` replaces the former active-document toolbar
  badge with one overview button for the whole loaded set: the signature icon in the worst
  severity colour across all loaded files plus the number of signed documents. It is rendered
  only when at least one loaded file has signatures, so unsigned sets see no change.
- `src/components/SignatureOverviewDialog.jsx` lists every signed document: "DOK n", file
  name(s), signature count, worst integrity text (the shared status helpers), and signer and
  signing time of the newest signature. The active document's row is marked
  (`aria-current`). Rows are keyboard navigable (ArrowUp/ArrowDown/Home/End); activating a row
  navigates the viewer to the document's first page through the normal page navigation and
  keeps the dialog open. The secondary "Details" action opens the document's details dialog
  on top; Escape then closes only the top dialog. Closing the overview returns focus to the
  toolbar button.
- All symbols exist in the viewer UI only and are never part of printed or exported output
  (print and PDF export build their own output documents, not the app DOM).
- `src/components/SignatureDetailsDialog.jsx` opens per document. When the document has more
  than one file with signatures, a file selector (tabs, arrow-key navigable) sits above the
  groups and the requested file is preselected (a page symbol preselects its own file). The
  tabs look like tabs on a rail: the active tab is filled with inverted text/surface colours,
  and every tab shows the file's page range inside the document. The selected file is repeated
  in the group heading ("File k of m: name", or "File k of m" without a name) with its page
  range ("Pages 19–24", the thumbnail "S" numbers), followed by its signatures. With one signed
  file it is a plain list. Each signature lists signer and organisation, issuer, signing time
  and its source, reason, location, kind, integrity in plain words with `integrityReason`,
  whole-document coverage, certificate validity period and format.
  All times in the dialog and the overview (signing time and certificate validity) are shown as
  local time, "2022-04-27 19:55", in both languages, with the exact UTC ISO value in the `title`
  attribute and `<time dateTime>` (`formatSignatureTime()` in `pdfSignatureStatus.js`, rendered by
  `SignatureTime.jsx`). Its accessibility mirrors `DocumentMetadataOverlayDialog`: focus moves into
  the dialog, Tab is trapped inside, Escape closes, and focus returns to the symbol that opened it.
  Unsupported formats are shown as "signature present, format not supported", never hidden.
- Every signature starts with the neutral information line `signatures.notCheckedInViewer`:
  English "Not checked in the viewer: issuer trust and revocation status", Swedish "Inte
  kontrollerat i visaren: utfärdarens förtroende och spärrstatus". It is a `role="note"` with
  neutral styling, never a warning colour or badge severity.
- Strings live under the `signatures` key (including `signatures.overview`) in
  `public/locales/en/common.json` and `public/locales/sv/common.json`; colours use the
  `--odv-signature-*` theme tokens (light, normal, dark, and the print reset).
- Verification: `src/utils/__tests__/pdfSignatureDocuments.test.js` (aggregation, page ranges),
  `src/components/__tests__/signatureInfoLine.test.jsx` (localized information lines and badge
  integrity), `src/components/__tests__/signatureDetailsDialog.test.jsx` (information notes and
  local times), `src/components/__tests__/signatureOverview.test.jsx` (button and file tabs), and
  the Playwright browser suite `tests/ui/*.spec.mjs` (`npm run test:ui`: page symbol placement clear
  of the compare markers, rest/hover opacity, document dialog and page-symbol preselection,
  overview navigation, the runtime flag, no signature-endpoint requests, the sticky document header,
  compare-mode zoom controls and toolbar density) using the synthetic fixtures from
  `scripts/generate-signature-fixtures.mjs`. The first run needs the Playwright Chromium build
  (`npx playwright install chromium`).

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
| `cades-ecdsa-invisible.pdf` | `ETSI.CAdES.detached`, ECDSA P-256, zero-rectangle invisible widget (`/F 128` means Locked, not Hidden), `intact` |
| `pss-rsa-no-signing-time-attr.pdf` | RSA-PSS signature without a `signingTime` attribute (falls back to `/M`) |
| `digest-mismatch.pdf` | content byte changed inside the signed range after signing |
| `extended-after-signing.pdf` | plain incremental update appended after signing (no second signature) |
| `two-signatures.pdf` | approval signature followed by a second signature in an incremental update (rewritten objects keep generation 0, ISO 32000-1 7.5.6) |
| `two-signatures-generation-bumped.pdf` | negative fixture: the same document written out of spec, with the rewritten page and AcroForm bumped to generation 1 while references still say `0 R`; keeps the parser's tolerance for such writers under test |
| `certified-docmdp.pdf` | certification signature (`/Reference` DocMDP) |
| `doc-timestamp-rfc3161.pdf` | `ETSI.RFC3161` document timestamp token |
| `pkcs7-sha1.pdf` | legacy `adbe.pkcs7.sha1` embedded digest |
| `unsupported-subfilter.pdf` | `/SubFilter /ICVN.SADES` -> reported `unsupported`, never hidden |
| `corrupt-contents.pdf` | invalid CMS bytes (`deadbeef`) -> `unreadable` |
| `signature-invalid.pdf` | CMS signed with a foreign key, correct digests -> `signature-invalid` |
| `unsigned.pdf` | no signature fields -> empty list fast path |
| `visible-appearance.pdf` | signed widget with a blue `/AP /N` appearance stream |
| `invisible-appearance.pdf` | signed widget with a non-zero rectangle but no appearance stream |

The fixtures are generated in the vitest setup instead of being committed as binary files:
the public repository stays free of binaries that cannot be diff-reviewed, keys are
regenerated per run, and the generator CLI (`node
scripts/generate-signature-fixtures.mjs --out <dir>`) reproduces any fixture on demand for
manual inspection.

### PDF.js 6.4 rendering regression checks

Campaign `opendocviewer-pdfjs-6-4-renderingsregression` checks the installed,
lockfile-resolved PDF.js **6.4.299**; it does not upgrade the dependency again.
`src/utils/__tests__/pdfjsAnnotationRendering.test.js` uses the real PDF.js parser
and operator lists, including signature appearances, text widgets, checked checkbox
appearance selection, ordinary square annotations, and Hidden/NoView filtering.
`scripts/generate-annotation-fixtures.mjs` supplies a synthetic, font-independent
annotation matrix with a page-content anchor. Hidden (`2`), NoView (`32`) and
Locked (`128`) are distinct flags.

`tests/ui/signature-appearance.spec.mjs` checks pixels in the real viewer with both
`main-thread` and `worker` PDF rendering configurations: main pages, thumbnails,
and the compare pane for the widget matrix. Negative checks require white regions
and positive page content, so blank rasters or unexpected non-blue marks cannot
pass. These checks concern display appearances, not certificate trust validation.

The overview accessibility watch items were already fixed in the campaign's base
commit `bf2bf446`: `SignatureOverviewDialog` renders `ul/li` with sibling action
buttons, and its suspended backdrop has `inert` plus `aria-hidden`. The unit suite
`signatureOverview.test.jsx` and browser suite `signature-symbols.spec.mjs` lock
those semantics, stacked-dialog keyboard focus, Escape and focus restoration.

Run `node scripts/test-pdfjs-rendering-mutations.mjs` in an isolated worktree to
prove the checks fail when either renderer disables annotations, the overview
regresses to a listbox, or the suspended overview loses `inert`. The runner expects
assertion failures and restores each source file in `finally`. Do not run it
concurrently with source edits or other tests; run `npm test`, `npm run test:ui`
and `npm run lint` on restored sources afterwards. CI runs the unit and browser
suites automatically; mutation proofs are a local verification command.

For an operator's manual check in a separately managed environment, open a PDF
with a visible signature and one with an invisible signature; compare the page
and thumbnail appearances, then open Signed documents → Details, use Tab and
Escape, and verify that focus returns to Details and then the overview button.
Use a form PDF to check text/checkbox appearances and confirm hidden fields remain
absent. Automated fixtures do not establish compatibility with every external PDF.

### Adversarial regression proofs

`scripts/signature-security-fixtures.mjs` generates eContent swaps, signed attributes
without messageDigest, invalid later signatures, widened/foreign gaps, mismatched
certificate identifiers, SKI signatures, and escaped/compressed dictionaries. The
Vitest security suites also cover nested ASN.1/PDF input, a 50 MiB extension, worker
timeouts/errors, bounded worker recreation, bounded fallback and disposal. Parser tests
also generate junk-prefixed signed/tampered PDFs and verify the unsigned fast path.
No binary fixture is committed.

Run `npm test -- pdfSignature` for both positive and hostile inputs. In an isolated
worktree, `node scripts/test-signature-security-mutations.mjs --baseline` temporarily
loads the original vulnerable parser/inspector and then breaks each reviewed fix
individually. Every selected regression must fail with an assertion (test exit 1),
and the runner restores the original source in `finally`. Do not run it concurrently
with editing or validation of these source files. The runner exits 0 only when all
mutation groups are detected. Run the unmodified suite again afterwards.

For UI regression proofs, run `node scripts/test-signature-ui-mutations.mjs`.
It checks the reviewed hook baseline and individually breaks result retention, queue
concurrency, buffer transfer, mixed-status handling, worker disposal, and provider
report/disposal wiring. Each selected test must fail with an assertion (exit 1);
the runner restores sources and exits 0 only when every mutation is detected.
The provider integration test uses real React scheduling, ViewerProvider, context and
badges, with storage/rendering/inspection I/O mocked.

The mutation runner additionally checks that renamed/minified PDF classes cannot hide
signatures. After `npm run build`, run `node scripts/test-built-signature-worker.mjs`
to inspect six generated signed PDFs through the actual minified worker artifact.
The harness uses a Node worker with a browser message-protocol adapter and verifies
both successful inspection and rejection outcomes. PDF types are identified by stable
APIs and `instanceof`, never `constructor.name`.

## Third-party components

`pkijs` and `asn1js` (both BSD-3-Clause) are bundled runtime dependencies used only for
signature parsing, loaded with a dynamic import when a document actually contains
signature fields. The certificate helper `@peculiar/x509` (MIT) is a devDependency used only
by the fixture generator and tests, never shipped. Licences are recorded in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

## Checks not performed in the viewer

Certificate chain building to a trust anchor, revocation status (OCSP/CRL), trust-list
evaluation, and any statement stronger than integrity are outside the viewer's contract.
OpenDocViewer does not consume a server or gateway verdict, build certificate chains, query
revocation services or maintain a trust store in the browser. Other software may perform those
checks independently, but no such result is part of this data contract or user interface.
