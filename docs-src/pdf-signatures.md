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
reported with `integrity: 'not-checked-in-viewer'`, `integrityCode: 'format-unsupported'`
and the reason `signature present, format not supported` plus the raw SubFilter value, so
the UI can say "a signature exists but this format cannot be checked here".

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

1. `/SubFilter` outside the handled formats -> `not-checked-in-viewer` /
   `format-unsupported` (signature still reported, never hidden).
2. `/Contents` missing -> `unreadable` / `contents-missing`; a CMS that cannot be decoded
   -> `unreadable` / `cms-malformed`.
3. ByteRange must contain four non-negative safe integers, start at zero, remain inside
   the file, and exclude exactly the direct `/Contents` hex string including `<` and `>`.
   Source positions come from the same parser objects as the signature dictionary;
   another hex string or a value in an object stream cannot stand in for `/Contents`.
   A malformed range is `unreadable` / `byte-range-invalid`, with `coversWholeFile: null`.
4. If CMS signed attributes exist, exactly one `messageDigest` value is mandatory and
   must match the hash of the CMS content. For detached signatures that content is the
   ByteRange bytes; for encapsulated signatures it is the eContent bytes. The signed
   `contentType` must also match. Missing/ambiguous attributes are `unreadable`
   (`message-digest-attribute` / `cms-content-mismatch`) and a different digest is
   `digest-mismatch` / `content-digest-mismatch`. Encapsulated SHA-1 / TSTInfo must
   additionally match the document digest / imprint (`document-digest-mismatch`). These are
   separate mandatory checks, following
   [RFC 5652 section 5.4](https://www.rfc-editor.org/rfc/rfc5652#section-5.4).
5. The CMS signer signature does not verify over the signed attributes with the embedded
   certificate's public key -> `integrity: 'signature-invalid'`.
   Without signed attributes, verification operates directly on the CMS content.
   Certificates must match SignerInfo issuer **and** serial, or its subject key identifier
   (SKI extension, with SHA-1 of the subjectPublicKey bits as fallback only when the
   extension is absent). An unmatched identifier is `unreadable` /
   `signer-certificate-missing`; certificate order never determines signer identity.
6. Everything verifies but the ByteRange does not reach the end of the file: the file was
   extended after this signature was applied.
   - If the added bytes are themselves covered by a *verified intact later signature* in the same document
     (the normal case for the first signature of a multi-signature document), the content
     this signature protected is still byte-for-byte intact: `integrity: 'intact'` with
     `coversWholeFile: false`, `integrityCode: 'extended-by-later-signature'` and an
     `integrityReason` saying the file was extended by later signature(s).
     Verification runs from the last revision backwards. The later range must start at
     zero, its first segment must include the entire earlier revision, and its end must
     reach EOF. An unreadable or invalid later CMS cannot authorize an extension.
   - If the extension is **not** covered by any later signature, the revision classifier
     (`src/utils/pdfSignatureRevisions.js`, see "Appended revisions" below) decides what the
     unsigned update changed: validation data or metadata only is `intact` /
     `extended-with-validation-data`; a content change is `modified-after-signing` /
     `content-changed-after-signing`; anything it cannot classify with certainty is
     `modified-after-signing` / `unclassified-change-after-signing`.
7. Everything verifies and the range reaches EOF -> `integrity: 'intact'`,
   `coversWholeFile: true`.

Signature algorithms are mapped to WebCrypto: RSA PKCS#1 v1.5 (`RSASSA-PKCS1-v1_5`),
RSA-PSS (`RSA-PSS`, salt length from the PSS parameters when present, otherwise the digest
length), and ECDSA (`ECDSA`, DER signature converted to the raw `r||s` form WebCrypto
expects). The curve must be one of the named curves P-256, P-384 or P-521 in the
certificate; it is never guessed from the key length. A hash, signature algorithm or curve
that WebCrypto lacks (for example SHA-224 or brainpool) is `not-checked-in-viewer` /
`algorithm-unsupported`; a missing `crypto.subtle` is `not-checked-in-viewer` /
`viewer-error`; a public key the browser rejects is `indeterminate` / `key-import-failed`.
These decisions use typed errors and `err.name`, never message text.

### Status model

The viewer warns only when it finds a real problem. What it cannot check is shown as
information in the details dialog. Issuer trust and revocation are never checked in the
viewer; every signature carries that information line.

| Situation | `integrity` | `integrityCode` | Severity |
| --- | --- | --- | --- |
| Covered bytes and CMS signature verify; the range reaches the end of the file | `intact` | – | OK |
| As above; the file was extended afterwards only with DSS/VRI, document timestamps, `/Info`, XMP `/Metadata`, or an xref/trailer rewrite without object changes | `intact` | `extended-with-validation-data` | OK + info |
| As above; the extension is covered by later verified signature(s) and changes no signed content | `intact` | `extended-by-later-signature` | OK + info |
| `/SubFilter` the viewer cannot check | `not-checked-in-viewer` | `format-unsupported` | OK + info (¹) |
| Hash/signature algorithm or curve not available in WebCrypto | `not-checked-in-viewer` | `algorithm-unsupported` | OK + info (¹) |
| Size, count or complexity budget exceeded | `not-checked-in-viewer` | `inspection-limit` | OK + info (¹) |
| Inspection time limit exceeded | `not-checked-in-viewer` | `timeout` | OK + info (¹) |
| Structural stream filter the parser cannot decode | `not-checked-in-viewer` | `structure-unsupported` | OK + info (¹) |
| Encrypted PDF | `not-checked-in-viewer` | `encrypted` | OK + info (¹) |
| Signature worker/library/WebCrypto/read failure, worker budget exhausted | `not-checked-in-viewer` | `viewer-error` | OK + info (¹) |
| A later unsigned revision changes pages, content streams, annotations, form fields or the catalog | `modified-after-signing` | `content-changed-after-signing` | Warning |
| A later revision exists but cannot be proven harmless | `modified-after-signing` | `unclassified-change-after-signing` | Warning |
| Unexpected condition that cannot be classified | `indeterminate` | `unexpected-error` / `key-import-failed` | Warning |
| Signing time inside the certificate's notBefore..notAfter window (inclusive) | (any) | `signingTimeCheck: within-validity` | OK |
| Signing time before the certificate's notBefore | (any) | `signingTimeCheck: outside-validity` / `signed-before-certificate-valid` | Warning |
| Signing time after the certificate's notAfter | (any) | `signingTimeCheck: outside-validity` / `signed-after-certificate-expired` | Warning |
| Signature timestamp token does not match or does not verify | (any) | `signingTimeCheck: timestamp-invalid` / `timestamp-invalid` | Warning |
| Signature timestamp uses an algorithm the viewer cannot check | (any) | `signatureTimestampCheck: not-checked`; the fallback time source is used | OK + info |
| No signing time is available | (any) | `signingTimeCheck: not-checked` / `signing-time-unknown` | OK + info |
| Certificate validity dates are unreadable | (any) | `signingTimeCheck: not-checked` / `certificate-dates-unreadable` | OK + info |
| No certificate can be read | (any) | `signingTimeCheck: not-checked` / `no-certificate` | OK + info |
| Certificate expired *since* signing, but the selected signing time is inside its window | (any) | `signingTimeCheck: within-validity` | OK; never a warning |
| `/Contents` missing or empty | `unreadable` | `contents-missing` | Error |
| ByteRange malformed, outside the file, or not excluding exactly `/Contents` | `unreadable` | `byte-range-invalid` | Error |
| CMS/TSTInfo not decodable or structurally invalid (incl. not exactly one SignerInfo) | `unreadable` | `cms-malformed` | Error |
| CMS content or signed contentType does not match | `unreadable` | `cms-content-mismatch` | Error |
| messageDigest attribute missing or duplicated | `unreadable` | `message-digest-attribute` | Error |
| No certificate matches the signer identifier | `unreadable` | `signer-certificate-missing` | Error |
| Covered bytes do not match the signed digest | `digest-mismatch` | `content-digest-mismatch` | Error |
| Timestamp imprint / embedded SHA-1 does not match the document | `digest-mismatch` | `document-digest-mismatch` | Error |
| CMS signature does not verify | `signature-invalid` | `signature-invalid` | Error |
| Missing or unknown `integrity` value | treated as `unreadable` | – | Error (fail closed) |

(¹) Runtime config `pdfSignatures.uncheckedSeverity: 'warning'` shows these as warnings
instead. It never lowers an error or warning, and unknown integrity values stay errors.

#### Signing time and certificate validity

The signing time is selected in exactly this priority order: verified RFC 3161 `genTime`,
else the signed CMS `signingTime` attribute, else the PDF signature dictionary `/M`.
`signingTimeSource: 'timestamp'` is emitted only after the timestamp actually verified.

For an approval or certification signature, the unsigned attribute
`id-aa-signatureTimeStampToken` (`1.2.840.113549.1.9.16.2.14`) is parsed when present. Its
TSA CMS is verified by the same `verifySignedDataStructure` helper as the PDF CMS, and its
TSTInfo `messageImprint` must equal the hash of the outer signature value OCTET STRING
contents (RFC 3161 Appendix A). A wrong imprint or an invalid TSA signature gives
`signingTimeCheck: 'timestamp-invalid'` (warning); the next time source is then used for the
window comparison. An unsupported timestamp algorithm is a viewer limitation, not a defect:
the token is ignored, `signatureTimestampCheck: 'not-checked'` produces neutral information,
and the fallback time is used without a warning.

For an `ETSI.RFC3161` document timestamp, verified TSTInfo `genTime` always wins, including
when `/M` or a CMS `signingTime` attribute is also present. The previous implementation could
accidentally prefer `/M`; that priority bug is covered by a dedicated fixture.

The selected time is compared only with the signer certificate's `notBefore..notAfter`
window, inclusively. The current clock is never consulted: a certificate that expired after
signing is normal for an archived document. There is deliberately no clock-skew tolerance on
`notBefore`. Missing time, unreadable certificate dates and a missing certificate are green
`not-checked` results with their respective information codes.

Unless the source is a verified timestamp, the dialog states as neutral information that the
signing time is the signer's own claim. This is the residual backdating risk: a signer can
choose a `signingTime` attribute or `/M` inside the certificate window even when the actual
signing happened later. Only a verified RFC 3161 timestamp provides independent time proof;
the viewer does not treat a signer-asserted time as such proof.

`unsupported` is accepted only as a legacy alias from older caches and is normalized to
`not-checked-in-viewer`; the parser never produces it.

#### Appended revisions

When a verified signature's ByteRange ends at E before the end of the file and no later
verified signature covers the rest, `classifyAppendedRevisions`
(`src/utils/pdfSignatureRevisions.js`) compares the final document NET against the state at
E. Several appended revisions are compared together; a change that a later revision undoes
byte for byte counts as unchanged, because the viewer shows the final state. The rules, in
order:

1. **Revision structure.** At least one cross-reference section (table or xref stream) must
   follow E. Each appended revision ends with exactly one `startxref` that points at its own
   section, the first appended trailer's `/Prev` points at the signed revision's section and
   every later `/Prev` at the previous appended section. An appended trailer without its own
   table, `/XRefStm` (hybrid cross-reference) or `/Encrypt` in an appended trailer, or a
   cross-reference stream that cannot be decoded (anything other than no predictor or a PNG
   predictor with 1 colour and 8 bits) makes the result unclassified.
2. **Cross-reference consistency (mandatory).** pdf-lib keeps the last physical definition
   of an object, pdf.js follows the cross-reference offsets. Every appended in-use entry must
   point at an appended definition of that object at exactly that offset (or, for a type-2
   entry, at an appended object stream that holds the object exactly once), or at the same
   offset as the last entry before E. Every appended definition must be listed, and the
   newest entry for an object must point at its last definition, and an appended object
   stream may not reuse the number of an object or object stream in use at E (pdf.js
   resolves compressed objects through the newest entry for the stream number). Otherwise
   the result is unclassified. A deleted entry (`f` / type 0) for an object in use at E is a content
   change; pdf-lib does not model deletions, so they are read from the recorded entries.
3. **Changed set.** An object is unchanged when its final definition is byte-identical to the
   definition at E (dictionary text, plus the raw bytes for streams). Generations are
   ignored. Object and xref streams are structural and never compared themselves.
4. **Trailer.** `/Root` must stay the same object; `/Info`, `/ID`, `/Size` and `/Prev` may
   change.
5. **Exempt items.** The catalog may add or change only `/DSS`, `/Metadata` and
   `/Extensions` (every other catalog entry must stay equal). The AcroForm may change only
   `/SigFlags` and append to `/Fields`; each appended field must be a new invisible document
   timestamp: `/FT /Sig`, `/V` a new dictionary with `/Type /DocTimeStamp` and
   `/SubFilter /ETSI.RFC3161`, and widgets with a zero-area `/Rect` or the Hidden/NoView flag,
   no `/AP` and only the field/widget keys listed in `DTS_FIELD_KEYS` / `DTS_WIDGET_KEYS`.
   A page may change only by appending those widgets to `/Annots`. Everything else that
   changed on a page, the AcroForm or the catalog is a content change.
6. **Reachability.** Every other changed object is classified by what reaches it in the
   final state. Reachable from the catalog other than through `/DSS`, `/Metadata` and
   `/Extensions` (pages, content streams, resources, annotations, form fields, outlines,
   names, actions) is content, and content wins: an object shared by `/DSS` and a page is a
   content change. Reachable only from `/DSS`, `/Metadata`, `/Extensions` or the trailer
   `/Info` is validation data or metadata. Reachable from nothing (an orphan) is
   unclassified. A new object that a reference already pointed at in the signed revision
   (a dangling reference filled in later) is a content change.
7. **Result.** Any content change gives `content-changed-after-signing`, otherwise any
   unclassified point gives `unclassified-change-after-signing`, otherwise
   `intact` / `extended-with-validation-data` ("the file was extended after signing with
   validation data/metadata only").

The classifier is conservative by construction: whatever it cannot classify with certainty
is a warning, never green. Its parser hooks are installed on the pdf-lib parser instance
only when every expected method exists (the same guard as the indirect-object header
probe); a different pdf-lib build, an unattributed object, an unexpected parser shape or
any exception inside the classifier yields `unclassified-change-after-signing`. An invalid
object in the file already makes the whole report `indeterminate` (pdf-lib parses with
`throwOnInvalidObject`). The branch where a later verified signature covers the tail is
unchanged; it only carries the `extended-by-later-signature` code. Revisions covered by a
later signature are not classified (outside this campaign's scope), so a DSS revision after
the last of several approval signatures leaves the earlier approval signatures amber, as
before.

#### The one site switch: `pdfSignatures.uncheckedSeverity`

`pdfSignatures.uncheckedSeverity` (runtime config, see `docs-src/runtime-configuration.md`)
is the only site setting for signature colours. `'ok'` (default) shows `not-checked-in-viewer`
signatures green with an information line; exactly `'warning'` shows them amber. It is read
once in `DocumentViewer` and passed as `{ uncheckedSeverity }` to `buildSignatureDocuments` /
`summarizeSignatureDocuments`, the badges, the overview and the details dialog. Severity is
presentation and is never stored in the per-`sourceKey` report cache. Fail-closed guarantee
(`getSignatureSeverity` in `src/utils/pdfSignatureStatus.js`): the switch is consulted only
after normalization and only for exactly `not-checked-in-viewer`, so a missing or unknown
`integrity` is `unreadable` -> error whichever way it is set, and it can never lower an error
or a warning. The label ranks `not-checked-in-viewer` above `intact`, so a badge says "Not
checked in the viewer" whenever any signature is unchecked, even while it is green.

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
`Worker` API is available. Worker construction/execution errors return a document-level
`not-checked-in-viewer` / `viewer-error` entry and timeouts a `not-checked-in-viewer` /
`timeout` entry (typed rejection codes, never message parsing); they never start inline
parsing. A source that cannot be read (a failing Blob, a wrong type) is also
`viewer-error`, never an empty "no signatures" report. A timeout terminates
the worker and settles all pending requests. Later documents may recreate a failed worker
up to three times per viewer session (including construction failures); successful requests
do not reset this budget. The failed document remains not checked. Disposal also settles
requests and resets the budget for a fresh session. Inline parsing is allowed only without a Worker API
and for inputs at most 256 KiB. It never rejects for document reasons: a PDF with no signatures, a
corrupt CMS blob, or an unsupported environment all resolve to a report (an empty
`signatures` list or per-signature entries following the status model). Callers should fetch
it once per document and cache the report next to the document state.

Inspection budgets are 64 MiB input (checked before worker cloning or reading a Blob),
256 signatures, 1 MiB per CMS, ASN.1 depth 64 / 100,000 nodes, and PDF object depth 128.
Structural streams (ObjStm/XRef) have an 8 MiB decoded limit each and 32 MiB total;
multiple structural stream filters or a filter pdf-lib cannot decode are reported as
`not-checked-in-viewer` / `structure-unsupported`. Page and image streams are not decoded
by signature inspection. Worker execution has a default 30-second deadline. Exceeding a
budget returns `not-checked-in-viewer` / `inspection-limit` (or `timeout`), never an
unsigned verdict. Because pdf-lib wraps errors thrown while parsing an indirect object, the
first structural limit is remembered and rethrown as such. The CMS ASN.1 depth/node limit is
the exception: no legitimate CMS gets near it, so it counts as `cms-malformed`.

Discovery parses PDF objects rather than relying on raw ASCII name searches: escaped
names, object streams, nested dictionaries and signatures superseded in later revisions
remain discoverable. Unsigned documents avoid importing the CMS stack, but still pay
for PDF structure parsing. If structure/discovery cannot complete, a document-level
placeholder with null identity fields communicates the incomplete inspection
(`notCheckedSignatureReport(code, detail)` for viewer limits, otherwise
`indeterminateSignatureReport('unexpected-error', detail)`); it is not evidence that a
particular signature exists.

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
  reported as `not-checked-in-viewer` / `viewer-error` rather than unsigned. The disposable
  source-store copy is
  transferred to the worker with `{ transfer: true }`; other inspector callers retain
  their buffers by default. No document bytes are retained in the report cache.
- `src/utils/pdfSignatureStatus.js` maps the contract to presentation (see "Status model"):
  the badge colour and icon follow the *worst severity* of a document's signatures
  (`getSignatureSeverity(signature, { uncheckedSeverity })` over integrity and the
  signing-time check), and the label follows the worst integrity status
  (`INTEGRITY_WORST_FIRST`, where `not-checked-in-viewer` outranks `intact`).
  Every signature is normalized before selecting the worst status, so mixing an intact
  signature with a missing or unexpected status still yields unreadable. Tooltip and
  dialog labels use the same normalization and translation helper. `getIntegrityCodeText`
  maps the closed `INTEGRITY_CODES` set to `signatures.integrityCode.<code>` (unknown codes
  -> no text), and `getSigningTimeCheckLabel` does the same for the signing-time check.
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
  file it is a plain list. Each signature first lists what was checked and passed (for an
  intact signature: the content is unchanged and the signature matches the certificate; plus
  a signing time within the certificate validity when the parser reports it), then the
  information lines, then signer and organisation, issuer, signing time and its source,
  reason, location, kind, integrity in plain words (severity icon, the localized
  `integrityCode` text for a warning or error, and `integrityReason` as the English detail
  line), whole-document coverage, certificate validity period and format. A signer name that
  is not backed by a verified signature is marked: "Name from the PDF, not verified" when it
  comes from the self-declared `/Name` (`signerSource: 'pdf-name'`), or "Name from the
  certificate; the signature was not confirmed" for a certificate name on a signature that is
  not intact. This keeps a forced "not checked" from reading as a verified signature.
  All times in the dialog and the overview (signing time and certificate validity) are shown as
  local time, "2022-04-27 19:55", in both languages, with the exact UTC ISO value in the `title`
  attribute and `<time dateTime>` (`formatSignatureTime()` in `pdfSignatureStatus.js`, rendered by
  `SignatureTime.jsx`). Its accessibility mirrors `DocumentMetadataOverlayDialog`: focus moves into
  the dialog, Tab is trapped inside, Escape closes, and focus returns to the symbol that opened it.
  Unsupported formats are shown as "Not checked in the viewer" with the format named, never
  hidden.
- The information block (`role="note"`, neutral styling, never a warning colour or badge
  severity) always starts with `signatures.notCheckedInViewer`: English "Not checked in the
  viewer: issuer trust and revocation status", Swedish "Inte kontrollerat i visaren:
  utfärdarens förtroende och spärrstatus". For an intact or not-checked signature it then
  says in plain words what was not checked (`signatures.integrityCode.<code>`), a signing-time
  check that was not performed, an embedded timestamp the browser could not check, and—when
  the selected time is not a verified timestamp—that the time is the signer's own claim.
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
  signerSource: 'certificate' | 'pdf-name' | null; // where signer came from; /Name is never verified
  signerOrganization: string | null;     // certificate subject O, else null
  issuer: string | null;                 // certificate issuer CN (else issuer DN)
  serial: string | null;                 // certificate serial, colon-separated hex (DER sign padding removed)
  notBefore: string | null;              // ISO 8601, certificate validity start
  notAfter: string | null;               // ISO 8601, certificate validity end
  signingTime: string | null;            // ISO 8601 signing time (see signingTimeSource)
  signingTimeSource: 'timestamp' | 'signed-attribute' | 'pdf-M' | 'none';
  signingTimeCheck: 'within-validity' | 'outside-validity' | 'timestamp-invalid' | 'not-checked';
  signingTimeCode: 'signed-before-certificate-valid' | 'signed-after-certificate-expired'
    | 'timestamp-invalid' | 'signing-time-unknown' | 'certificate-dates-unreadable'
    | 'no-certificate' | null;
  signatureTimestampCheck: 'verified' | 'invalid' | 'not-checked' | null; // null = no embedded token
  reason: string | null;                 // signature dictionary /Reason
  location: string | null;               // signature dictionary /Location
  subFilter: string | null;              // raw /SubFilter value, e.g. "adbe.pkcs7.detached"
  kind: 'approval' | 'certification' | 'timestamp';
  integrity:
    | 'intact'
    | 'not-checked-in-viewer'
    | 'indeterminate'
    | 'modified-after-signing'
    | 'digest-mismatch'
    | 'signature-invalid'
    | 'unreadable';                      // 'unsupported' is a legacy alias only, never produced
  integrityCode: string | null;          // closed kebab-case set (Status model); null only for a plain intact
  integrityReason: string | null;        // English detail line; null when there is nothing to explain
  coversWholeFile: boolean | null;       // false = file extended after signing
}
```

Notes:

- Every field is `null` when it cannot be read; the parser never omits a key, so the UI can
  rely on the shape.
- `signer` prefers the certificate subject CN because the PDF `/Name` string is
  self-declared; `/Name` is only used when no certificate could be read.
- `integrityCode` drives the localized text (`signatures.integrityCode.<code>`); every
  non-intact signature carries one (tested as a guard). `integrityReason` stays a short
  English detail line that may carry OIDs or exception text for support staff.
- The parser always produces `signingTimeCheck` and `signingTimeCode`; older cached reports may
  omit them, which the status helpers normalize to `not-checked` (never a warning). An unknown
  check value fails closed to a warning. `signatureTimestampCheck` is `null` when no embedded
  signature timestamp is present, `verified` only after both the TSA CMS and imprint verify,
  `invalid` for a defective token and `not-checked` for a viewer algorithm limitation.
- Timestamp fields (`ETSI.RFC3161` document timestamps) appear as normal entries with
  `kind: 'timestamp'`, so a document's signature chain (approval signatures plus their
  long-term timestamps) is visible in one list, ordered by ByteRange position.

## Fixtures

`scripts/generate-signature-fixtures.mjs` is the committed generator. It creates a throwaway
test CA and signer certificates (fixed dates and serial numbers, generated keys - never
committed, never real-world identities) and signs synthetic one-page PDFs that cover every
integrity status and format branch (the appended-revision fixtures are described after the
table):

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
| `unsupported-subfilter.pdf` | `/SubFilter /ICVN.SADES` -> `not-checked-in-viewer` / `format-unsupported`, never hidden |
| `corrupt-contents.pdf` | invalid CMS bytes (`deadbeef`) -> `unreadable` / `cms-malformed` |
| `signature-invalid.pdf` | CMS signed with a foreign key, correct digests -> `signature-invalid` |
| `unsigned.pdf` | no signature fields -> empty list fast path |
| `visible-appearance.pdf` | signed widget with a blue `/AP /N` appearance stream |
| `invisible-appearance.pdf` | signed widget with a non-zero rectangle but no appearance stream |

`createSigningTimeFixtures` in the same generator covers before/after/inside the certificate
window, a certificate that expired years after signing, no time source, a valid embedded
signature timestamp, genTime controlling the window, wrong imprint, bad TSA signature,
unsupported imprint algorithm and the DocTimeStamp `/M` priority regression. The fixture PKI
`leaf` helper accepts `notBefore`/`notAfter`; `addSignatureTimestamp(cms, tsa, genTime)` builds
the token over the signature value OCTET STRING contents and adds it to `unsignedAttrs`.
`src/utils/__tests__/pdfSignatureSigningTime.test.js` asserts the source, check, code and
severity for every row, including that an unverified token can never produce source `timestamp`.

`scripts/signature-revision-fixtures.mjs` appends synthetic unsigned revisions to these
fixtures for the appended-revision classifier (`createRevisionFixtures`, exposed as
`createSecurityFixtures().revisions`). `appendRevision` writes object definitions followed
by a classic xref table or an xref stream (optionally Flate + PNG predictor, optionally
with an object stream), with negative knobs `free`, `prevOverride`, `xrefPoint`,
`offsetShift` and `trailerExtras`. `appendDssRevision` adds DSS/VRI, `appendDocTimestamp`
adds a signed (or unsigned) document timestamp after the approval signature. Names starting
with `ok` (DSS, `/Info`, XMP `/Metadata`, byte-identical rewrite, each also with an xref
stream tail, DSS in an object stream, timestamp then DSS, a reverted change) must be
`extended-with-validation-data`; the content-change fixtures (annotation, page content,
page entry, form field value, `/OpenAction`, `/NeedAppearances`, visible timestamp widget,
widget with `/AP`, object shared by DSS and content, dangling reference, deleted live
object) must be `content-changed-after-signing`; the structural fixtures (shadow object,
broken `/Prev`, `/XRefStm`, patched xref offset, an object stream reusing a signed object
number, objects without xref) must be
`unclassified-change-after-signing`.

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
certificate identifiers, SKI signatures, and escaped/compressed dictionaries. For the
status model it also rewrites OIDs inside the CMS without touching the signed bytes
(`patchContentsHex`: unknown digest, SHA-224, unmapped signature algorithm, an unknown
named curve), corrupts an EC public key, writes a timestamp with an unknown imprint
algorithm, an over-budget CMS gap, an encrypted trailer, undecodable structural stream
filters and more than 256 signature dictionaries; each row asserts `integrity`,
`integrityCode` and both switch settings. A guard test runs every fixture and requires a
non-null `integrityCode` for every non-intact signature. The
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
mutation groups are detected. Run the unmodified suite again afterwards. Status-model
groups: re-adding the curve guess, ignoring typed viewer limits, losing a structural limit in
pdf-lib's error wrapping, an inspector read error failing open, and losing the timeout code.
The signing-time group accepts a timestamp with a wrong imprint as the signing time and must
be caught. Appended-revision groups: removing the cross-reference consistency check, ignoring deleted
entries, allowing a reused object stream number, letting validation data win over content,
allowing a visible timestamp widget,
accepting orphan objects, trusting an unhooked parser, and skipping the `/Prev` chain.

For UI regression proofs, run `node scripts/test-signature-ui-mutations.mjs`.
It checks the reviewed hook baseline and individually breaks result retention, queue
concurrency, buffer transfer, mixed-status handling, worker disposal, provider
report/disposal wiring, and the status model: swapping not checked and intact (colour and
label ranking), letting `uncheckedSeverity` affect errors or unknown values, and dropping the
switch from the document aggregation. Each selected test must fail with an assertion (exit 1);
the runner restores sources and exits 0 only when every mutation is detected.
The provider integration test uses real React scheduling, ViewerProvider, context and
badges, with storage/rendering/inspection I/O mocked.

The mutation runner additionally checks that renamed/minified PDF classes cannot hide
signatures. After `npm run build`, run `node scripts/test-built-signature-worker.mjs`
to inspect 24 generated signed PDFs (positive, defect and not-checked rows, embedded/document
timestamp rows, plus appended-revision rows that prove the pdf-lib parser hooks survive
minification, asserting `integrity`, `integrityCode` and the signing-time fields) through the
actual minified worker artifact.
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
