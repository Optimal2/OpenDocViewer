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
These decisions use typed errors and `err.name`, never message text. An ECDSA signature
value that is not a DER SEQUENCE of two INTEGERs, or whose INTEGER is longer than the
curve's point size, is `unreadable` / `cms-malformed`; an unsupported curve is checked first
and stays `not-checked-in-viewer`.

### Status model

The viewer warns only when it finds a real problem. What it cannot check is shown as
information in the details dialog. Issuer trust and revocation are never checked in the
viewer; every signature carries that information line.

| Situation | `integrity` | `integrityCode` | Severity |
| --- | --- | --- | --- |
| Covered bytes and CMS signature verify; the range reaches the end of the file | `intact` | – | OK |
| As above; the file was extended afterwards only with DSS/VRI, document timestamps, `/Info`, XMP `/Metadata`, or an xref/trailer rewrite without object changes, and pdf.js shows the same document for the signed revision and the full file | `intact` | `extended-with-validation-data` | OK + info |
| As above, but the pdf.js comparison of the signed revision and the full file could not be completed (pdf.js failed to load or threw, time or page budget) | `indeterminate` | `viewer-error` / `timeout` / `inspection-limit` | Warning (neutral text) |
| As above; the extension is covered by later verified signature(s) and changes no signed content | `intact` | `extended-by-later-signature` | OK + info |
| `/SubFilter` the viewer cannot check | `not-checked-in-viewer` | `format-unsupported` | OK + info (¹) |
| Hash/signature algorithm or curve not available in WebCrypto | `not-checked-in-viewer` | `algorithm-unsupported` | OK + info (¹) |
| Size, count or complexity budget exceeded | `not-checked-in-viewer` | `inspection-limit` | OK + info (¹) |
| Inspection time limit exceeded | `not-checked-in-viewer` | `timeout` | OK + info (¹) |
| Structural stream filter the parser cannot decode | `not-checked-in-viewer` | `structure-unsupported` | OK + info (¹) |
| Encrypted PDF | `not-checked-in-viewer` | `encrypted` | OK + info (¹) |
| Signature worker/library/WebCrypto/read failure, worker budget exhausted | `not-checked-in-viewer` | `viewer-error` | OK + info (¹) |
| A later unsigned revision changes pages, content streams, annotations, form fields or the catalog, or pdf.js shows a different document than the signed revision | `modified-after-signing` | `content-changed-after-signing` | Warning |
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

The `signingTime` attribute is read as the signer stated it. With several `signingTime`
attributes (RFC 5652 allows one) or several values in one, the first in encoded order is used.
A value without a usable time (no value, or a string that is not a date) is ignored and the
next source is used; a string that does read as a date is used as that date. All of these
are signed by the signer, so they carry the same backdating caveat as a regular attribute.

Unless the source is a verified timestamp, the dialog states as neutral information that the
signing time is the signer's own claim. This is the residual backdating risk: a signer can
choose a `signingTime` attribute or `/M` inside the certificate window even when the actual
signing happened later. Only a verified RFC 3161 timestamp provides independent time proof;
the viewer does not treat a signer-asserted time as such proof.

`unsupported` is accepted only as a legacy alias from older caches and is normalized to
`not-checked-in-viewer`; the parser never produces it.

#### Appended revisions

When a verified signature's ByteRange ends at E before the end of the file and no later
verified signature covers the rest, two independent checks decide. First,
`classifyAppendedRevisions` (`src/utils/pdfSignatureRevisions.js`) compares the final
document NET against the state at E in pdf-lib's object graph. Second, when the classifier
would answer green, the **pdf.js differential confirmation** (next section) loads the signed
revision and the full file with pdf.js, the engine that renders, and the result is green
only when pdf.js shows the same document for both. The classifier is defense in depth: three
review rounds in a row found files where pdf-lib and pdf.js read different objects (objects
pdf-lib never assigns, names pdf-lib decodes differently, bytes pdf-lib skips by `/Length`),
so a green verdict never rests on the pdf-lib model alone.

Several appended revisions are compared together; a change that a later revision undoes
byte for byte counts as unchanged, because the viewer shows the final state. The classifier
rules, in order:

1. **Revision structure.** At least one cross-reference section (table or xref stream) must
   follow E. Each appended revision ends with exactly one `startxref` that points at its own
   section, the first appended trailer's `/Prev` points at the signed revision's section and
   every later `/Prev` at the previous appended section. An appended trailer without its own
   table, `/XRefStm` (hybrid cross-reference) or `/Encrypt` in an appended trailer, or a
   cross-reference stream that cannot be decoded (anything other than no predictor or a PNG
   predictor with 1 colour and 8 bits) makes the result unclassified. pdf.js starts at the
   LAST `startxref` it finds in the raw bytes, including bytes inside stream data that
   pdf-lib skips by `/Length`; every textual `startxref` after E must therefore be one the
   parser validated as the end of an appended revision, otherwise the result is
   unclassified (a forged xref table hidden in DSS certificate data, round 7).
2. **Cross-reference consistency (mandatory).** pdf-lib keeps the last physical definition
   of an object, while pdf.js follows the signed revision's active `/Prev` chain and keeps
   the nearest section's entry per object. Every parsed pre-E section must belong to that
   chain; an unlinked decoy table or xref stream makes the result unclassified. Every `/Prev`
   in the chain must point backwards; a forward link or a cycle is unclassified. The one
   exception is the first-page-to-main forward link of a linearized file (ISO 32000-1
   Annex F) in its exact shape: the file's first object is a signed `/Linearized`
   dictionary whose `/H` names a signed hint stream, the first-page section is the
   physically first section with no other object before it, and the main section ends the
   chain. A green verdict on that path, like every other, still needs the pdf.js
   differential confirmation; with it, an honest DSS-only append to a linearized file is
   green again (it was a deliberate false warning while no rendering comparison existed).

   The length of the file is not a safety argument on its own. pdf.js treats a file as
   linearized when its first object is a dictionary with `/Linearized` > 0 and an `/L` equal
   to the length it measures from the `%PDF-` header. It then starts reading
   cross-reference data right after the first `endobj` in the file, an offset the file's
   author chooses (it can sit inside a string), not at the last `startxref`. A signer can
   set `/L` to the length the file will have after a later append and hide a forged xref
   table there, so the classifier and pdf.js would see different content. Three rules close
   this for every file, linearized or not:
   - the file must start with `%PDF-`. Bytes before the header change the length pdf.js
     measures, and a first object more than 1024 bytes before the header is read by pdf.js
     but skipped by pdf-lib. Both engines can search beyond byte zero, so requiring the
     header at byte zero is deliberately stricter: a BOM-prefixed file gets a warning after
     an unsigned append (known limitation, fail closed);
   - `allDicts(log, pdfLib)` is the only dictionary-enumeration point for revision rules. It
     includes ordinary and nested dictionaries, ObjStm members, the ObjStm/XRef stream
     dictionaries from `log.structural` and the classic trailer dictionaries from
     `log.trailers`, none of which may be skipped by assuming they are in `log.records`.
     Every dictionary with a `/Linearized` key must have a direct numeric `/L` of at most E.
     Appended data makes the final file longer than E, so pdf.js does not accept that
     linearization for the final file and reads the cross-reference data from the last
     `startxref` instead. That alone does not prove pdf.js reads the chain the classifier
     checked (pdf.js can also fall back to reconstructing the cross-reference table, or find a
     `startxref` inside stream data); the raw `startxref` rule above and the pdf.js
     differential confirmation close that gap. An `/L` larger than E (for example the final
     length after the append) is unclassified;
   - security-key spelling is checked in the raw source bytes, not through pdf-lib's name
     decoder (pdf-lib decodes only uppercase `#xx` escapes, pdf.js both cases). The raw
     source of EVERY dictionary the classifier decides from (objects, ObjStm members, xref
     streams and trailers) is tokenized; a dictionary KEY that is a `#`-escaped spelling of
     `/Root`, `/Prev`, `/Size`, `/Linearized`, `/L`, `/Encrypt`, `/XRefStm`, `/Type`,
     `/Length`, `/W`, `/Index`, `/N`, `/First` or `/Extends` is unclassified (round 7 found an
     appended trailer whose `/R#6fot` key was `/Root` to pdf.js and an unknown key to pdf-lib).
     The rule applies to keys only: `/L` as a value or a Line annotation's `/L` key next to an
     unrelated escaped name such as `/My#20Key` stays green (a false warning in round 7).

   Two rules then pin the state at E to what pdf.js reads:
   - every object pdf-lib holds at E must be the definition the active chain's entry names
     (a type-1 entry at exactly that offset, a type-2 entry in that object stream), so an
     orphan duplicate signed outside the chain never becomes the baseline;
   - every in-use entry of the active chain must have a definition pdf-lib used. Object and
     xref streams have no parser record of their own, so the only exemption is the logged
     structural stream at exactly the entry's object number AND offset; one byte off, or a
     number without a definition, is unclassified.

   Every appended in-use entry must point at an appended definition of that object at exactly
   that offset (or, for a type-2 entry, at an appended object stream that holds the object
   exactly once), or at the same offset as the entry reached through the active chain.
   Every appended definition must be listed, and the newest entry for an object must point
   at its last definition. An appended object stream or xref stream may not reuse the number
   of an object, object stream or xref stream in use at E, nor the number of an appended
   object, and an appended object may not reuse the number of a signed object stream or xref
   stream (pdf.js resolves compressed objects through the newest entry for the stream
   number). An appended ordinary object may redefine a signed ordinary object; step 3 then
   compares the two definitions. Otherwise the result is unclassified. A
   deleted entry (`f` / type 0) for an object, object stream or xref stream in use at E is a
   content change; pdf-lib does not model deletions, so they are read from the recorded
   entries.
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
   (a dangling reference filled in later) is a content change. This includes an appended
   object or xref stream with that number: pdf-lib does not record structural streams as
   objects, but pdf.js resolves the signed reference to the stream and draws its data.
7. **Result.** Any content change gives `content-changed-after-signing`, otherwise any
   unclassified point gives `unclassified-change-after-signing`, otherwise the classifier
   proposes `intact` / `extended-with-validation-data` ("the file was extended after signing
   with validation data/metadata only"), which the pdf.js differential confirmation must
   then confirm.

The classifier is conservative by construction: whatever it cannot classify with certainty
is a warning, never green. Known false warnings, kept on purpose: a validly signed hybrid
file (a signed trailer with `/XRefStm`) stays a warning after a DSS append, because the
hybrid section is not part of the modelled `/Prev` chain; a BOM-prefixed file is a warning
because the classifier requires `%PDF-` at byte zero; an appended revision that frees or
reuses the number of a signed xref stream is a warning even though no writer needs to; and
structural changes that pdf.js happens to draw identically (an xref stream filling a
dangling content reference without drawable data, a zero-area timestamp widget with an
`/AP` reference) stay warnings because the classifier rules see them. Its parser hooks
are installed on the pdf-lib parser instance
only when every expected method exists (the same guard as the indirect-object header
probe); a different pdf-lib build, an unattributed object, an unexpected parser shape or
any exception inside the classifier yields `unclassified-change-after-signing`. An invalid
object in the file already makes the whole report `indeterminate` (pdf-lib parses with
`throwOnInvalidObject`). The branch where a later verified signature covers the tail is
unchanged; it only carries the `extended-by-later-signature` code. Revisions covered by a
later signature are not classified (outside this campaign's scope), so a DSS revision after
the last of several approval signatures leaves the earlier approval signatures amber, as
before.

#### pdf.js differential confirmation

`createRenderComparator` (`src/utils/pdfSignatureRenderCheck.js`) is the safety mechanism
for appended revisions. Whenever the classifier would return green for a signature whose
signed range ends at E before the end of the file, it loads BOTH the signed revision (bytes
0..E, exactly what the signer signed) and the full file with the viewer's bundled pdf.js
(the same `pdfjs-dist` legacy build, with the page worker's document options from
`withPdfJsDocumentOptions`, `disableFontFace` and no system fonts) and compares what pdf.js
produces:

- page count;
- per page: view box, rotation and user unit; the display operator list (`fnArray` and
  `argsArray`, the operator list the viewer renders); `getAnnotations()` (all fields,
  including type, rectangle, flags, contents and appearance-relevant data);
  `getTextContent()`; page JavaScript actions;
- per document: `getFieldObjects()`, `getJSActions()`, `getOpenAction()`,
  `getAttachments()` (including the file data), `getOutline()`, `getDestinations()`,
  `getPageLabels()` and the optional-content configuration (group names, intents and
  default visibility).

pdf.js names fonts, images and patterns with per-document ids (`g_d0_f1`, `img_p0_1`). The
comparison replaces every such id with its order of first use on the page and appends the
resolved object (decoded image pixels, the font program and its glyph-relevant properties,
pattern data), so a renumbered but identical resource does not differ while a swapped image
or font does. For this the comparison asks pdf.js for readable image data and font programs
(`isOffscreenCanvasSupported: false`, `isImageDecoderSupported: false`,
`fontExtraProperties: true`); that changes how pdf.js hands data to the caller, not what it
parses or draws. Each section is encoded deterministically and compared by SHA-256; the
first difference becomes the detail line ("page 3 operator list", "document open action").

The only differences a validation-data append may add are an invisible document-timestamp
signature widget (a `/Sig` widget that is Hidden/NoView or has a zero-area rectangle, without
actions or links) and its signature field. Such widgets and signature-typed form fields are
left out on BOTH sides; whatever a signature widget draws is still in the operator list, and
a visible one is still compared through `getAnnotations()`. DSS/VRI, `/Metadata`,
`/Extensions` and `/Info` are not part of anything above, so honest appends compare equal.

Results: `same` keeps the classifier's green verdict (the detail line adds "pdf.js shows the
same document as the signed revision"); `different` is `modified-after-signing` /
`content-changed-after-signing`. **Fail closed:** when pdf.js cannot load either revision,
throws, exceeds the time budget or the per-page watchdog (below), exceeds the page budget
(1,000 pages), or returns data the comparison cannot encode, the signature is
`indeterminate` with the neutral code `viewer-error`, `timeout` or `inspection-limit`: amber
with a "could not be checked" explanation, never green and never an error. The site switch
`uncheckedSeverity` does not affect it.

| Cause | Code |
| --- | --- |
| pdf.js cannot be imported, cannot load a revision, throws, or returns data that cannot be encoded | `viewer-error` |
| A large blob changed length or its buffer was detached between being encoded and being hashed | `viewer-error` |
| Opening both revisions takes longer than the startup allowance (5 s) | `timeout` |
| One page (or the document-level sections) takes longer than the watchdog (15 s) | `timeout` |
| The whole comparison takes longer than its work-scaled budget, or this file's 300 s cap is used up | `timeout` |
| More than 1,000 pages | `inspection-limit` |

**Time budget.** The budget scales with the work the document requires
(`renderCheckBudgetMs` in `src/utils/pdfSignatureRenderCheck.js`): until both revisions are
open only the startup allowance applies; once the page count n is known the deadline is
`min(5 s + n x 2.5 s, 300 s)` from the start of the comparison, and every step (the
document-level sections, then each page) is additionally bounded by a 15 s watchdog. The
numbers come from the page-form measurements below:

- **startup 5 s:** pdf.js import plus opening both revisions measured 0.36-1.5 s cold
  (fixed term up to 267 ms warm); 5 s leaves more than 3x for a slower machine;
- **per page 2.5 s:** more than 3x the slowest measured form (JPEG scan with text
  strokes, 800 ms/page in the step-1 fit, 732 ms/page after this change), because real scans
  carry more detail than the fixtures and slower hardware exists;
- **total cap 300 s,** shared by all comparisons of one file: 200 pages of the slowest
  measured form need about 160 s, so an ordinary large scanned journal with a DSS/LTV
  append completes with almost 2x to spare. Beyond 118 pages the cap, not the per-page
  allowance, binds;
- **per-page watchdog 15 s:** about 19x the slowest measured page and 1/20 of the cap, so
  a stalled page fails closed in seconds instead of consuming the whole budget.

The signature worker's 30 s main-thread deadline is re-armed by a heartbeat after every
compared page (see "Where it runs"), so a long comparison that still makes progress is not
cut short by the worker deadline, while a worker that stops progressing still ends after
30 s.

**Memory.** `page.objs` holds a page's images and `page.commonObjs` the document-wide `g_*`
objects (fonts, globally cached images). The comparison waits for each object only on the
container that receives it. It used to register a callback on both; the callback left on
`commonObjs` kept every decoded page image alive until the document was destroyed. Large
blobs (64 KiB or more, i.e. decoded pixels and font programs) are no longer copied into the
encoding buffer: they stand in it as a fixed-size record (tag, exact length, the blob's own
SHA-256) at their label position, so the encoding stays self-delimiting and bytes cannot be
moved between resources without a SHA-256 collision. The record keeps a live reference to the
blob and is hashed last, so it is re-validated first: a blob whose length no longer equals the
recorded length, or whose buffer was detached, fails closed (`viewer-error`) instead of hashing
to the SHA-256 of empty input, which would make two different revisions look alike.

The comparison runs only for signed files with an appended revision the classifier accepts
(rare), inside the signature worker, off the main thread. The worker loads pdf.js on first
use with a dynamic import and sets its worker source exactly like the page worker; pdf.js
then starts a nested worker or uses its in-thread loopback. The full file is loaded once per
inspection and its fingerprints are reused for every signature. Measured with
`node scripts/measure-signature-render-check.mjs` (Node 22, the same code the worker runs; the
first comparison also pays for loading pdf.js):

| File | Pages | Size | Outcome | Comparison | Whole inspection |
| --- | --- | --- | --- | --- | --- |
| Largest appended-revision fixture (`okDocTimestampThenDss`, two signatures) | 1 | 35 KB | same | 439 ms (first, includes pdf.js load) | 96 ms |
| Synthetic signed report, DSS-only append | 20 | 273 KB | same | 496 ms | 447 ms |
| The same, content change on page 17 | 20 | 278 KB | different | 395 ms | 15 ms (classifier) |
| Synthetic signed report, DSS-only append | 50 | 380 KB | same | 1,073 ms | 1,184 ms |
| The same, content change on page 47 | 50 | 384 KB | different | 1,060 ms | 21 ms (classifier) |

Each page carries 45 text lines, vector graphics and one shared 256x256 RGB image. A content
change the classifier already detects never reaches the comparison, which is why the whole
inspection of the changed files is fast.

**Per page form.** Scanned pages cost far more than text pages. Synthetic A4 300 dpi pages
(`scripts/signature-page-form-fixtures.mjs`: one distinct 2480x3508 image per page), DSS-only
append (the path that must compare every page), Node 22.23.3, linear fit over 1, 2, 4 and 8
pages. "Amber at" is the page count at which the fitted comparison time exceeds the
work-scaled budget; for text and Flate pages the 1,000-page limit (`inspection-limit`)
comes first, and for this Flate fixture (0.65 MB per page) so does the inspector's 64 MiB
file limit at about 100 pages.

| Form | Before (constant 20 s): ms/page + fixed ms | Amber before | After: ms/page + fixed ms | pdf.js's own share after | Amber now (step-1 fit / after fit) |
| --- | --- | --- | --- | --- | --- |
| text (45 lines, shared 256x256 image) | 25.5 + 159 | ~778 pages | 20.8 + 62 | 41% | never (1,000-page limit) |
| flate-rgb, 8.7 MP | 225.5 + 94 | ~88 pages | 147.4 + 29 | 70% | never (1,000-page and 64 MiB limits) |
| jpeg, 8.7 MP | 684.6 + 267 | ~29 pages | 601.2 + 67 | 98% | ~438 / ~499 pages |
| smask (RGB + gray mask) | 516.8 + 35 | ~39 pages | 490.4 - 116 | 76% | ~581 / ~613 pages |
| jpeg-text (gradient + text strokes) | 799.6 + 105 | ~25 pages | 731.6 + 22 | ~100% | ~376 / ~411 pages |

Large documents, one run each, before and after this change on the same machine:

| Fixture | Before: outcome, compare time, peak RSS, verdict | After: outcome, compare time, peak RSS, verdict |
| --- | --- | --- |
| jpeg, 60 pages, DSS-only append | unavailable (time budget of 20000 ms exceeded), 20.3 s, 804 MiB, `indeterminate` / `timeout` | same, 36.4 s, 806 MiB, `intact` / `extended-with-validation-data` |
| jpeg, 60 pages, image changed on page 57 | unavailable (timeout), 20.6 s; classifier `modified-after-signing` | different (page 57 operator list), 34.0 s; `modified-after-signing` / `content-changed-after-signing` |
| flate-rgb, 60 pages, DSS-only append | same, 12.5 s, 4,656 MiB, `intact` | same, 9.8 s, 1,701 MiB, `intact` / `extended-with-validation-data` |
| flate-rgb, 96 pages (59 MiB), DSS-only append | same, 19.6 s (0.4 s under the ceiling), 7,281 MiB | same, 14.9 s, 2,530 MiB, `intact` / `extended-with-validation-data` |
| flate-rgb, 96 pages, image changed on page 93 | different (page 93 operator list), 17.4 s | different (page 93 operator list), 14.8 s; `modified-after-signing` / `content-changed-after-signing` |

Memory, `--only=compare`, flate-rgb, one process per point: 407 MiB at 2 pages and 1,428 MiB
at 16 pages before (73 MiB per page), 379 MiB and 662 MiB after (20 MiB per page). The
remaining growth is pdf.js's own: the pdf.js-only baseline grows 23 MiB per page in the same
run (292 / 617 MiB), and neither a forced GC nor `PDFDocumentProxy.cleanup()` after every
page lowers it. JPEG pages stay flat (about 800 MiB at 60 pages).

**Why the comparison stays on decoded pixels.** pdf.js decodes an image while it builds the
operator list (`getOperatorList()` starts the decode), whether or not anyone reads the
pixels, so for JPEG pages 91-98% of the comparison time is pdf.js's own work. Comparing the
image's raw stream data and decode parameters instead would only save the check's own
overhead (for JPEG it would have moved the old ceiling from about 29 to about 32 pages)
while giving up the premise that the comparison covers what pdf.js shows. It was rejected;
the work-scaled budget addresses the cost instead. pdf.js also resolves `getOperatorList()`
before the page's images have arrived in `page.objs` and keeps decoding after a document is
destroyed, so a measurement or a test that does not wait for the decoded objects reports far
too little work.

Reproduce (Node 22; the page-form mode is opt-in and does not change the default lines):

```powershell
node scripts/measure-signature-render-check.mjs
node --expose-gc --max-old-space-size=8192 scripts/measure-signature-render-check.mjs --forms=text,flate-rgb,jpeg,smask,jpeg-text --pages=1,2,4,8
node --expose-gc --max-old-space-size=8192 scripts/measure-signature-render-check.mjs --forms=jpeg,flate-rgb --pages=60,96
node --expose-gc --max-old-space-size=8192 scripts/measure-signature-render-check.mjs --forms=flate-rgb --pages=16 --only=compare
```

The fit line per form prints the page count at which the work-scaled budget is exceeded and,
for comparison, where the former constant 20 s budget was reached.

Limits. The comparison proves what pdf.js shows, nothing more:

- it describes pdf.js 6.4 as bundled; another reader (Acrobat, a printer driver, an archive
  tool) can resolve a crafted file differently and show content pdf.js does not. The
  verdict is "OpenDocViewer shows what was signed", not a statement about other software;
- it compares the display intent the viewer renders. Print-only annotation appearances,
  XFA forms (pdf.js renders them only when XFA is enabled, which the viewer does not do) and
  JavaScript behaviour beyond the compared action lists are not rendered and therefore not
  compared;
- metadata (`/Info`, XMP), the DSS itself and anything else that does not change what pdf.js
  produces may differ by design;
- a change that pdf.js draws identically is, for the differential, no change. The pdf-lib
  classifier still warns about the structural cases it recognises (defense in depth).

`src/utils/__tests__/pdfSignatureRenderCheckGuardsDisabled.test.js` mocks the classifier
to always answer green and proves that every known attack file is still a warning through
the differential alone, while every honest DSS-only append (all chain forms) stays green.

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
  document bytes and posts the report back. It passes the viewer's pdf.js build (loaded on
  first use) and document options for the pdf.js differential confirmation. The inline
  fallback without a Worker API loads the same build without a worker source; if pdf.js
  cannot start there, the comparison fails closed (`indeterminate`).
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
by signature inspection. Worker execution has a default 30-second deadline without
progress: the pdf.js differential confirmation posts a `pdfSignaturesProgress` heartbeat
after every compared page, and each heartbeat re-arms the deadline of its own request only
(matched by `requestId`; a heartbeat for an unknown id is ignored), never beyond 30 s plus
the comparison's 300 s total cap (`RENDER_CHECK_MAX_TOTAL_MS`). Exceeding a
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
widget with `/AP`, object shared by DSS and content, dangling reference, dangling
reference filled with a `/Type /ObjStm` stream or with the appended `/Type /XRef` stream,
deleted live object) must be
`content-changed-after-signing`; the structural fixtures (shadow object, broken `/Prev`,
`/XRefStm`, patched xref offset, an object stream reusing a signed object number, objects
without xref) must be `unclassified-change-after-signing`.

`createSignedXrefStreamFixtures` (exposed as `createSecurityFixtures().signedXrefStream`)
signs a revision that itself ends in an xref stream (object 10, or object stream 10 plus
xref stream 11). Its `offsetShift` patches a signed entry, including the object or xref
stream's own entry. DSS-only appends (plain, with a signed object stream, and after a Flate
+ PNG predictor signed xref stream) must be `extended-with-validation-data`; content
changes (plain and compressed) must be `content-changed-after-signing`; a signed
structural entry one byte off its stream, and an appended object stream or DSS object that
reuses the signed xref stream number 10, must be `unclassified-change-after-signing`.
Freeing the signed xref or object stream number is `content-changed-after-signing`; a
signed `/Info` that references the signed xref stream, and a tail xref that re-lists the
signed object and xref streams at their exact signed offsets, stay green after a DSS
append.

`createLinearizedFixtures` (exposed as `createSecurityFixtures().linearized`) covers the
forward `/Prev` of linearized files. `linearizedFile` writes the base fixture in the qpdf
layout (signed by an incremental update, or with the signature inside the linearized file);
`qpdfLinearized` signs and extends two small UNSIGNED one-page bases written by a real
linearizer, qpdf 12.3.2 through pikepdf (`scripts/fixtures/linearized-qpdf-table.pdf` with
xref tables, `scripts/fixtures/linearized-qpdf-objstm.pdf` with xref and object streams;
regenerate with `python scripts/generate-linearized-fixture-bases.py`). For every shape an
intact signed file is green. A DSS-only append is green with the information line once the
pdf.js comparison confirms it, and pdf.js must draw the same page text before and after; a
content change must warn and pdf.js must draw the changed text. A shadow object appended to a linearized file
stays unclassified, and so does a forward `/Prev` when the first object is not a
linearization dictionary, `/H` does not name a hint stream, the main section links back, or
an object sits between the linearization dictionary and the first-page section.
Four `/L` exploits carry a forged xref table after a literal `endobj` and set `/L` before
signing to the length after a "DSS" append whose certificate stream data hides a new page
content object: a plain signed linearization dictionary, a duplicate lowercase-escaped
`/#4c` key, a first-object `/Type /XRef` stream dictionary, and a first object more than 1024
bytes before the `%PDF-` header. The signed file is green and pdf.js draws the signed text;
after every append the classifier must warn while pdf.js draws
`EXPLOIT CHANGED CONTENT AFTER SIGNING`. The plain form was green at 5c4636f; the escaped-name and xref-stream forms
were both green at b11fa15.

`createMultiPageFixtures(pki, pageCount)` writes a realistic signed report (45 text lines,
vector graphics and one shared Flate image per page) with a DSS-only append, a content
change on a late page, and a replaced image behind unchanged drawing operators; the tests
use 6 pages and the timing script 20 and 50. `appendRevision`'s `xrefTrailingData` puts bytes
after the entries of an uncompressed xref stream:
`danglingReferenceFilledByDrawingXrefStream` fills a signed dangling content reference with
an xref stream whose trailing data pdf.js draws as text.

The pdf.js differential tests (`src/utils/__tests__/pdfSignatureRenderCheck.test.js`, with
the shared case list `pdfSignatureRenderCheck.cases.js`) take TWO measurements for every
known attack: the full pipeline gives a warning, and pdf.js draws the changed text in the
final file but not in the signed revision. The attacks: the two round-7 files, shadow objects
(plain, on a signed xref stream, on a linearized file), unlinked decoy xref table and stream,
dangling references filled by an object, an object stream and a drawing xref stream, the four
linearized `/L` exploits (plain, `#4c`-escaped duplicate, `/Linearized` in an xref stream,
before the header), a replaced content stream, a linearized content change and a late-page
change in the multi-page document. Every honest DSS-only append (all chain forms, linearized,
multi-page, and the two round-7 false-warning files) must compare `same` and stay green;
the fail-closed paths (pdf.js does not load, cannot load a revision, throws, time budget, page
budget) must be `indeterminate` with the matching code.
`src/utils/__tests__/pdfSignatureRenderCheckBudget.test.js` binds the work-scaled budget with
a fake pdf.js under fake timers that, like pdf.js, delivers each page's image after the
operator list: 30 pages of 1 s each (past the former constant 20 s) compare `same`; an image
that differs only after its operator list resolved is `different` on that page; a stalled
page is `timeout` after the 15 s watchdog, not after the 80 s budget; pages that each stay
under the watchdog but together exceed the scaled budget are `timeout`; the 300 s cap is
shared by all comparisons of one file; bytes shifted between two large images on one page
differ; a large image detached or shrunk after it was encoded but before it was hashed is
`unavailable` / `viewer-error`, not `same`. It also pins that a page-local id waits only on
`page.objs` and a `g_*` id only on `commonObjs`. `pdfSignatureWorkerSecurity.test.js` checks
that heartbeats extend the worker deadline only up to 30 s plus the 300 s cap, and only for
the request that sent them.

Committed regression files in `scripts/fixtures/` (synthetic, signed with a throwaway fixture
PKI, no personal data), copied from the round-7 review of e2935c0:

| File | Shape | Before this round | Now |
| --- | --- | --- | --- |
| `attack-escaped-root-key.pdf` | appended trailer `/R#6fot 30 0 R`: `/Root` to pdf.js, an unknown key to pdf-lib; pdf.js draws `CHANGED AFTER SIGNING VIA ESCAPED ROOT` | green | warning (escaped security key; pdf.js: document form fields differ) |
| `attack-startxref-in-stream-data.pdf` | forged xref table and `startxref` inside the data of an appended DSS certificate stream; pdf.js draws `CHANGED AFTER SIGNING VIA TRAILING STARTXREF` | green | warning (raw `startxref`; pdf.js: page 1 operator list differs) |
| `dss-escaped-name-with-line-key.pdf` | DSS-only append; a dictionary with `/My#20Key` and a Line-annotation `/L [...]` key | false warning | green |
| `dss-escaped-name-with-nested-l-value.pdf` | DSS-only append; `/My#20Key` next to `/Inner << /S /L >>` | false warning | green |

The other fixtures are generated in the vitest setup instead of being committed as binary
files: the public repository stays free of binaries that cannot be diff-reviewed, keys are
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
`integrityCode` and both switch settings. `createBoundaryFixtures` (with `rewriteCms`, which
re-encodes a CMS after signing) covers the error-versus-information boundaries in
`pdfSignatureErrorBoundaries.test.js`: a missing versus an unknown digest OID, an unparseable
TSTInfo or empty imprint versus an unknown imprint algorithm, a missing signature value,
malformed versus unsupported-curve ECDSA, the discovery object limit versus any other
discovery error, a signature dictionary that cannot be decoded, and several or malformed
`signingTime` attributes. Two rows cannot be reached through pkijs parsing and use a focused
pkijs mock: signed attributes without an encoded value and unreadable certificate dates. A guard test runs every fixture and requires a
non-null `integrityCode` for every non-intact signature. The
Vitest security suites also cover nested ASN.1/PDF input, a 50 MiB extension, worker
timeouts/errors, bounded worker recreation, bounded fallback and disposal. Parser tests
also generate junk-prefixed signed/tampered PDFs and verify the unsigned fast path.
The only committed binary fixtures are the two unsigned qpdf-linearized bases and the four
round-7 regression files above.

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
be caught. Boundary groups: a missing digest OID or an unparseable TSTInfo falling through to
green `algorithm-unsupported`, and an oversized ECDSA INTEGER reaching the generic error path.
Appended-revision groups: removing the cross-reference consistency check, ignoring deleted
entries, allowing a reused object stream number, letting validation data win over content,
allowing a visible timestamp widget,
accepting orphan objects, trusting an unhooked parser, skipping the `/Prev` chain, allowing
a signed structural stream number to be freed, ignoring an appended xref stream that fills
a dangling reference, counting signed structural streams as filled later, rejecting a tail
entry that re-lists a signed structural stream at its signed offset, accepting a forward
`/Prev` outside the exact linearized shape, rejecting the linearized forward `/Prev` again,
trusting raw escaped security keys, leaving trailer dictionaries out of `allDicts`, applying
the escape rule to values, ignoring raw `startxref` keywords in stream data, skipping
structural linearization dictionaries, not checking a linearization `/L` against E, allowing
bytes before the `%PDF-` header, and not calling the linearization guard at all.
Differential groups: skipping the pdf.js comparison, treating an incomplete comparison as
`same`, dropping visible signature widgets from the comparison, not comparing resolved
resources (a swapped image), and not comparing document-level data (an added `/OpenAction`).
Each classifier content-change test also requires the classifier's own reason, so a
mutation is caught even though the differential would still warn. `--only=<regex>` runs a
subset of mutation ids; all 48 groups were killed at the commit that introduced the
differential.

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
to inspect 35 PDFs (positive, defect and not-checked rows, error boundaries, embedded/document
timestamp rows, appended-revision rows that prove the pdf-lib parser hooks survive
minification, and differential rows - a linearized DSS-only append, a round-7 false-warning
file and both round-7 attacks - that prove the pdf.js comparison runs inside the built worker,
asserting `integrity`, `integrityCode` and the signing-time fields) through the actual
minified worker artifact. Node cannot start pdf.js's worker from the built URL, so the harness
hands pdf.js the built `pdf.worker.min-*.mjs` chunk through pdf.js's `globalThis.pdfjsWorker`
hook.
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
