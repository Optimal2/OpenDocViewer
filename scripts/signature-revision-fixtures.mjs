// Synthetic incremental updates for the appended-revision classifier
// (src/utils/pdfSignatureRevisions.js). Every update is appended to a fixture
// signed with the throwaway PKI; no real documents, certificates or names.
//
// appendRevision() writes one unsigned revision after `base`: the given object
// definitions in physical order, then a classic xref table (default) or an
// xref stream (`xrefStream`), a trailer chained with /Prev, and startxref.
// Negative knobs: `free` (f / type-0 entries), `prevOverride`, `xrefPoint`
// (point an entry at an earlier duplicate definition), `offsetShift` (patch an
// xref offset), `trailerExtras` (e.g. /XRefStm), `objStm` (pack objects in
// an object stream, xref stream only), `xrefTrailingData` (bytes after the
// entries of an uncompressed xref stream), `xrefNum` (number of the appended xref
// stream), `root` and `size` (the trailer /Root and /Size, for bases not
// numbered like BASE).
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import {
  baseSignedPdf, buildSignedData, buildTstToken, signFile, sigDictBody, latin1, latin1Text, concatBytes, findStartxrefOffset
} from './generate-signature-fixtures.mjs';

// Fake validation material: fixed filler bytes, never a real certificate or OCSP response.
const FAKE_CERT = 'ODV-FIXTURE-NOT-A-CERTIFICATE-'.repeat(8);
const FAKE_OCSP = 'ODV-FIXTURE-NOT-AN-OCSP-RESPONSE-'.repeat(4);
const XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>ODV signature fixtures</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/** Objects of the base fixture (baseSignedPdf), so updates can rewrite them. */
export const BASE = Object.freeze({
  catalog: '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
  page: (annots = '[7 0 R]', contents = '6 0 R', mediaBox = '[0 0 595 842]') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 4 0 R >> >> /Contents ${contents} /Annots ${annots} >>`,
  font: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  acroForm: (fields = '[7 0 R]', extra = '') => `<< /Fields ${fields} /SigFlags 3${extra} >>`,
  info: '<< /Producer (ODV signature fixtures) /CreationDate (D:20260305123000Z) >>'
});

export const stream = (body, dict = '') => `<< ${dict}/Length ${body.length} >>\nstream\n${body}\nendstream`;
const catalogWith = (extra) => BASE.catalog.replace(' >>', ` ${extra} >>`);
const docTimestampDict = () => sigDictBody({ subFilter: 'ETSI.RFC3161', nameLiteral: 'ODV Fixture Timestamping TSA' })
  .replace('/Type /Sig ', '/Type /DocTimeStamp ');

/** DSS (with VRI) + its catalog entry: objects 1, 20, 21, 22. */
export function dssObjects({ certs = '[21 0 R]' } = {}) {
  return [
    { num: 1, body: catalogWith('/DSS 20 0 R /Extensions << /ESIC << /BaseVersion /1.7 /ExtensionLevel 1 >> >>') },
    { num: 20, body: `<< /Type /DSS /Certs ${certs} /OCSPs [22 0 R] /VRI << /0123456789ABCDEF0123456789ABCDEF01234567 << /Cert ${certs} /OCSP [22 0 R] >> >> >>` },
    { num: 21, body: stream(FAKE_CERT) },
    { num: 22, body: stream(FAKE_OCSP) }
  ];
}

/**
 * Append one unsigned revision. Returns the new file bytes and the absolute
 * offset of every definition (in `defs` order).
 */
export function appendRevision(base, defs, {
  xrefStream = false, compress = false, objStm = [], free = [], prevOverride = null,
  xrefPoint = {}, preXrefPoint = {}, offsetShift = {}, trailerExtras = '', info = '/Info 9 0 R', objStmNum = null,
  xrefNum: xrefNumOverride = null, root = '1 0 R', size = null, xrefTrailingData = ''
} = {}) {
  const prev = prevOverride ?? findStartxrefOffset(base);
  let text = '\n';
  const offsets = [];
  const at = () => base.length + text.length;
  const inStream = defs.filter((d) => objStm.includes(d.num));
  const direct = defs.filter((d) => !objStm.includes(d.num));
  for (const d of direct) {
    offsets.push(at());
    text += `${d.num} ${d.gen ?? 0} obj\n${d.body}\nendobj\n`;
  }
  const entries = new Map(); // num -> {type, a, b}
  direct.forEach((d, i) => entries.set(d.num, { type: 1, a: offsets[i], b: d.gen ?? 0 }));
  for (const [num, index] of Object.entries(xrefPoint)) entries.set(Number(num), { type: 1, a: offsets[index], b: 0 });
  for (const [num, offset] of Object.entries(preXrefPoint)) entries.set(Number(num), { type: 1, a: offset, b: 0 });
  // Applied last, so it can also patch the object stream or the xref stream entry.
  const shiftOffsets = () => {
    for (const [num, delta] of Object.entries(offsetShift)) entries.get(Number(num)).a += delta;
  };
  const maxNum = Math.max(9, ...defs.map((d) => d.num));
  let streamNum = maxNum + 1;
  if (inStream.length) {
    if (!xrefStream) throw new Error('fixture bug: object streams need an xref stream');
    const containerNum = objStmNum ?? streamNum;
    let header = '';
    let body = '';
    inStream.forEach((d, i) => {
      header += `${d.num} ${body.length} `;
      body += `${d.body}\n`;
      entries.set(d.num, { type: 2, a: containerNum, b: i });
    });
    entries.set(containerNum, { type: 1, a: at(), b: 0 });
    text += `${containerNum} 0 obj\n${stream(header + body, `/Type /ObjStm /N ${inStream.length} /First ${header.length} `)}\nendobj\n`;
    streamNum += 1;
  }
  for (const num of free) entries.set(num, { type: 0, a: 0, b: 1 });
  const extras = trailerExtras ? ` ${trailerExtras.trim()}` : '';
  if (!xrefStream) {
    shiftOffsets();
    const xrefOffset = at();
    text += 'xref\n0 1\n0000000000 65535 f \n';
    for (const num of [...entries.keys()].sort((a, b) => a - b)) {
      const e = entries.get(num);
      text += `${num} 1\n${String(e.a).padStart(10, '0')} ${String(e.b).padStart(5, '0')} ${e.type === 0 ? 'f' : 'n'} \n`;
    }
    text += `trailer\n<< /Size ${size ?? maxNum + 1} /Root ${root} ${info}${extras} /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return { bytes: concatBytes(base, latin1(text)), offsets };
  }
  const xrefNum = xrefNumOverride ?? streamNum;
  const xrefOffset = at();
  entries.set(xrefNum, { type: 1, a: xrefOffset, b: 0 });
  shiftOffsets();
  const nums = [...entries.keys()].sort((a, b) => a - b);
  const rows = nums.map((num) => {
    const e = entries.get(num);
    return [e.type, (e.a >>> 24) & 255, (e.a >>> 16) & 255, (e.a >>> 8) & 255, e.a & 255, (e.b >>> 8) & 255, e.b & 255];
  });
  const index = nums.map((n) => `${n} 1`).join(' ');
  let data;
  let filter = '';
  if (compress) {
    // PNG "Up" predictor (12) per row, then Flate - the shape common writers emit.
    const raw = [];
    rows.forEach((row, r) => { raw.push(2, ...row.map((v, i) => (v - (r ? rows[r - 1][i] : 0)) & 255)); });
    data = deflateSync(Buffer.from(raw));
    filter = '/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> ';
  } else data = Buffer.concat([Buffer.from(rows.flat()), Buffer.from(xrefTrailingData, 'latin1')]);
  const binary = String.fromCharCode(...data);
  text += `${xrefNum} 0 obj\n<< /Type /XRef /Size ${nums.at(-1) + 1} /W [1 4 2] /Index [${index}] /Root ${root} ${info}${extras} /Prev ${prev} ${filter}/Length ${data.length} >>\nstream\n${binary}\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { bytes: concatBytes(base, latin1(text)), offsets };
}

/** §7 appendDssRevision: DSS/VRI (+ catalog /DSS, /Extensions) after `signed`. */
export function appendDssRevision(signed, options = {}) {
  return appendRevision(signed, dssObjects(), options).bytes;
}

/** New invisible document timestamp field 25 / sig dict 26 (page 3, AcroForm 5). */
function timestampFieldObjects({ widget = '/Rect [0 0 0 0] /F 132', extra = '' } = {}) {
  return [
    { num: 3, body: BASE.page('[7 0 R 25 0 R]') },
    { num: 5, body: BASE.acroForm('[7 0 R 25 0 R]') },
    { num: 25, body: `<< /Type /Annot /Subtype /Widget /FT /Sig /T (DocTimeStamp1) /V 26 0 R /P 3 0 R ${widget}${extra} >>` },
    { num: 26, body: docTimestampDict() }
  ];
}

/**
 * §7 DTS-after-approval: append a document timestamp revision to `signed` and
 * sign it (RFC 3161 token over the whole file). `sign: false` leaves the
 * placeholder /Contents (an unverifiable timestamp).
 */
export async function appendDocTimestamp(signed, pki, { sign = true, ...fieldOptions } = {}) {
  const { bytes, offsets } = appendRevision(signed, timestampFieldObjects(fieldOptions));
  if (!sign) return bytes;
  return signFile(bytes, offsets[3], (docBytes) => buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert], docBytes }));
}

/** Sign an arbitrary base builder (objects 1..9 as baseSignedPdf, plus extras). */
async function signBuilder(pki, builder) {
  const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
  return signFile(rev.bytes, rev.offsets.get(8), (signedOverBytes) =>
    buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes }));
}

/**
 * Sign a file whose active xref points at the original object 6 while an
 * unlinked decoy section points at a later, different definition of object 6.
 * The decoy and both definitions are inside the real CMS signature's range.
 */
async function signWithUnlinkedDecoy(pki, kind, content) {
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
  const maliciousOffset = rev.bytes.length + 1;
  const withShadow = concatBytes(rev.bytes, latin1(`\n6 0 obj\n${stream(content)}\nendobj\n`));
  let decoy;
  if (kind === 'table') {
    decoy = latin1(`\nxref\n6 1\n${String(maliciousOffset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 10 /Root 1 0 R >>\n`);
  } else {
    const row = [1, (maliciousOffset >>> 24) & 255, (maliciousOffset >>> 16) & 255,
      (maliciousOffset >>> 8) & 255, maliciousOffset & 255, 0, 0];
    const binary = String.fromCharCode(...row);
    decoy = latin1(`\n30 0 obj\n<< /Type /XRef /Size 31 /W [1 4 2] /Index [6 1] /Root 1 0 R /Length 7 >>\nstream\n${binary}\nendstream\nendobj\n`);
  }
  const bytes = await signFile(concatBytes(withShadow, decoy), rev.offsets.get(8), (signedOverBytes) =>
    buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes }));
  return { bytes, maliciousOffset, prev: rev.xrefOffset };
}

/**
 * Status-model fixtures whose signed revision ends in an xref stream. The
 * appended revisions use classic xref tables so the signed structural stream
 * is the variable under test.
 */
export async function createSignedXrefStreamFixtures(pki) {
  const original = 'BT /F1 20 Tf 60 780 Td (ODV SIGNATURE FIXTURE SAMPLE TEXT 0123456789) Tj ET';
  const changed = 'BT /F1 20 Tf 60 780 Td (CHANGED AFTER SIGNING) Tj ET';
  // The signed xref stream is object 10, or 11 behind object stream 10 when `objStm` is set.
  async function signed({ wrongKey = null, objStm = [], compress = false, offsetShift = {}, extra = [] } = {}) {
    const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
    const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const pre = appendRevision(rev.bytes, [
      { num: 4, body: BASE.font }, { num: 6, body: stream(original) }, ...extra
    ], { xrefStream: true, objStm, compress, offsetShift });
    return signFile(pre.bytes, rev.offsets.get(8), (signedOverBytes) =>
      buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes, wrongKey }));
  }
  const intact = await signed();
  const digestMismatch = intact.slice();
  const textAt = latin1Text(digestMismatch).indexOf('SAMPLE TEXT');
  if (textAt < 0) throw new Error('fixture bug: missing signed text');
  digestMismatch[textAt] = 0x73;
  const compressed = await signed({ compress: true });
  const withObjectStream = await signed({ objStm: [4] });
  const lastObjectAt = (bytes, num) => latin1Text(bytes).lastIndexOf(`\n${num} 0 obj\n`) + 1;
  return {
    intact,
    dssOnly: appendDssRevision(intact),
    dssObjectStream: appendDssRevision(await signed({ objStm: [4] })),
    dssCompressed: appendDssRevision(compressed),
    contentChangedCompressed: appendRevision(compressed, [{ num: 6, body: stream(changed) }, ...dssObjects()]).bytes,
    // The signed entry for a structural stream is one byte off its definition:
    // pdf.js would not find the stream there, so the exemption must not apply.
    objectStreamOffsetOffByOne: appendDssRevision(await signed({ objStm: [4], offsetShift: { 10: 1 } })),
    xrefStreamOffsetOffByOne: appendDssRevision(await signed({ offsetShift: { 10: 1 } })),
    // The unsigned tail reuses the number of the signed xref stream 10.
    objectStreamReusesSignedXrefNumber: appendDssRevision(intact, { xrefStream: true, objStm: [20, 21], objStmNum: 10 }),
    objectReusesSignedXrefNumber: appendRevision(intact, [
      ...dssObjects({ certs: '[21 0 R 10 0 R]' }), { num: 10, body: stream('ODV-FIXTURE-NOT-A-CERTIFICATE') }
    ]).bytes,
    // The unsigned tail frees the number of the signed xref stream 10 / object stream 10.
    freeSignedXrefStream: appendRevision(intact, dssObjects(), { free: [10] }).bytes,
    freeSignedObjectStream: appendRevision(withObjectStream, dssObjects(), { free: [10] }).bytes,
    // A signed object (/Info) references the signed xref stream 10: that is not a
    // reference filled in after signing, so a DSS-only append stays green.
    dssOnlySignedStructuralReference: appendDssRevision(await signed({
      extra: [{ num: 9, body: BASE.info.replace(' >>', ' /ODVFixtureRef 10 0 R >>') }]
    })),
    // A full xref rewrite re-lists the signed object stream 10 and xref stream 11
    // at exactly their signed offsets: the entries resolve to the signed streams.
    dssOnlyRelistsSignedStructural: appendDssRevision(withObjectStream, {
      preXrefPoint: { 10: lastObjectAt(withObjectStream, 10), 11: lastObjectAt(withObjectStream, 11) }
    }),
    contentChanged: appendRevision(intact, [{ num: 6, body: stream(changed) }, ...dssObjects()]).bytes,
    shadowObject: appendRevision(intact, [
      { num: 6, body: stream(changed) }, { num: 6, body: stream(original) }, ...dssObjects()
    ], { xrefPoint: { 6: 0 } }).bytes,
    digestMismatch,
    invalidSignature: await signed({ wrongKey: pki.rsa2.keys })
  };
}

/**
 * All classifier fixtures. Names starting with `ok` must classify as
 * validation data only; every other name must stay non-green.
 */
export async function createRevisionFixtures(normal, pki) {
  const signed = normal['valid-rsa.pdf'];
  const content = 'BT /F1 20 Tf 60 780 Td (CHANGED AFTER SIGNING) Tj ET';
  const original6 = 'BT /F1 20 Tf 60 780 Td (ODV SIGNATURE FIXTURE SAMPLE TEXT 0123456789) Tj ET';
  const dss = dssObjects();
  const xs = { xrefStream: true };
  const f = {};

  // --- validation data / metadata only (green with information) ---------------
  f.okDss = appendDssRevision(signed);
  f.okInfo = appendRevision(signed, [{ num: 9, body: BASE.info.replace(' >>', ' /ModDate (D:20260306120000Z) >>') }]).bytes;
  f.okMetadata = appendRevision(signed, [
    { num: 1, body: catalogWith('/Metadata 23 0 R') },
    { num: 23, body: stream(XMP, '/Type /Metadata /Subtype /XML ') }
  ]).bytes;
  f.okXrefOnly = appendRevision(signed, [{ num: 4, body: BASE.font }]).bytes;
  f.okDssXrefStream = appendDssRevision(signed, xs);
  f.okDssXrefStreamCompressed = appendDssRevision(signed, { ...xs, compress: true });
  f.okDssObjectStream = appendDssRevision(signed, { ...xs, compress: true, objStm: [20, 1] });
  f.okInfoXrefStream = appendRevision(signed, [{ num: 9, body: BASE.info.replace(' >>', ' /ModDate (D:20260306120000Z) >>') }], xs).bytes;
  f.okMetadataXrefStream = appendRevision(signed, [
    { num: 1, body: catalogWith('/Metadata 23 0 R') }, { num: 23, body: stream(XMP, '/Type /Metadata /Subtype /XML ') }
  ], xs).bytes;
  f.okXrefOnlyXrefStream = appendRevision(signed, [{ num: 4, body: BASE.font }], xs).bytes;
  // Document timestamp after the approval signature, then DSS (the LTA shape):
  // the approval's tail is a timestamp field + DSS, the timestamp's tail is DSS.
  f.okDocTimestamp = await appendDocTimestamp(signed, pki); // covered by the timestamp
  f.okDocTimestampThenDss = appendDssRevision(f.okDocTimestamp);
  f.okUnverifiedDocTimestamp = await appendDocTimestamp(signed, pki, { sign: false });
  // Net comparison: a revision changes the content stream, a later one restores it byte for byte.
  {
    const changed = appendRevision(signed, [{ num: 6, body: stream(content) }]).bytes;
    f.okRevertedChange = appendRevision(changed, [{ num: 6, body: stream(original6) }, ...dss]).bytes;
  }

  // --- content changes (warning) --------------------------------------------------
  f.annotation = appendRevision(signed, [
    { num: 3, body: BASE.page('[7 0 R 24 0 R]') },
    { num: 24, body: '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (Added after signing) /P 3 0 R >>' }
  ]).bytes;
  f.annotationXrefStream = appendRevision(signed, [
    { num: 3, body: BASE.page('[7 0 R 24 0 R]') },
    { num: 24, body: '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (Added after signing) /P 3 0 R >>' }
  ], xs).bytes;
  f.pageContent = appendRevision(signed, [{ num: 6, body: stream(content) }, ...dss]).bytes;
  f.pageContentXrefStream = appendRevision(signed, [{ num: 6, body: stream(content) }], { ...xs, compress: true }).bytes;
  f.pageKey = appendRevision(signed, [{ num: 3, body: BASE.page('[7 0 R]', '6 0 R', '[0 0 842 595]') }]).bytes;
  f.openAction = appendRevision(signed, [{ num: 1, body: catalogWith('/OpenAction [3 0 R /Fit]') }]).bytes;
  f.needAppearances = appendRevision(signed, [{ num: 5, body: BASE.acroForm('[7 0 R]', ' /NeedAppearances true') }]).bytes;
  f.visibleTimestampWidget = await appendDocTimestamp(signed, pki, { sign: false, widget: '/Rect [60 60 200 100]' });
  f.timestampWidgetWithAppearance = await appendDocTimestamp(signed, pki, { sign: false, extra: ' /AP << /N 27 0 R >>' });
  f.dssSharedWithContent = appendRevision(signed, [
    ...dssObjects({ certs: '[21 0 R 6 0 R]' }), { num: 6, body: stream(content) }
  ]).bytes;
  f.laterRevisionAddsAnnotation = appendRevision(appendDssRevision(signed), [
    { num: 3, body: BASE.page('[7 0 R 24 0 R]') },
    { num: 24, body: '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (Added after signing) /P 3 0 R >>' }
  ]).bytes;
  {
    // A text field whose value is changed after signing.
    const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
    builder.set(3, BASE.page('[7 0 R 12 0 R]'));
    builder.set(5, BASE.acroForm('[7 0 R 12 0 R]'));
    builder.set(12, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Amount) /V (100) /Rect [60 500 300 520] /P 3 0 R >>');
    const withField = await signBuilder(pki, builder);
    f.fieldValue = appendRevision(withField, [
      { num: 12, body: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Amount) /V (900) /Rect [60 500 300 520] /P 3 0 R >>' }
    ]).bytes;
  }
  {
    // A reference that dangled at signing time is filled in afterwards.
    const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
    builder.set(3, BASE.page('[7 0 R]', '[6 0 R 13 0 R]'));
    const dangling = await signBuilder(pki, builder);
    f.danglingReferenceFilled = appendRevision(dangling, [{ num: 13, body: stream(content) }, ...dss]).bytes;
    // The same, filled with an empty /Type /ObjStm: pdf-lib never assigns a
    // structural stream, but pdf.js still draws its data as page content.
    f.danglingReferenceFilledByObjectStream = appendRevision(dangling, [
      { num: 13, body: stream(content, '/Type /ObjStm /N 0 /First 0 ') }, ...dss
    ]).bytes;
    // The same, filled by the appended /Type /XRef stream itself: pdf.js
    // resolves the signed reference to the xref stream and draws its data.
    f.danglingReferenceFilledByXrefStream = appendRevision(dangling, dss, { ...xs, xrefNum: 13 }).bytes;
    // The same, with drawing operators after the xref entries: pdf.js reads only
    // the entries it needs and draws the rest of the data as page content.
    f.danglingReferenceFilledByDrawingXrefStream = appendRevision(dangling, dss, {
      ...xs, xrefNum: 13, xrefTrailingData: `\n${content}\n`
    }).bytes;
  }
  // Deleted live object (f entry / type-0 entry) next to an otherwise harmless DSS update.
  f.freeLiveObject = appendRevision(signed, dss, { free: [6] }).bytes;
  f.freeLiveObjectXrefStream = appendRevision(signed, dss, { ...xs, free: [6] }).bytes;

  // --- unclassifiable (warning) ------------------------------------------------------
  // No object definitions are appended in these two attacks: only the xref entry
  // changes which already-signed definition pdf.js resolves for object 6.
  const decoyTable = await signWithUnlinkedDecoy(pki, 'table', content);
  f.unlinkedDecoyXrefTable = appendRevision(decoyTable.bytes, [], {
    preXrefPoint: { 6: decoyTable.maliciousOffset }, prevOverride: decoyTable.prev
  }).bytes;
  const decoyStream = await signWithUnlinkedDecoy(pki, 'stream', content);
  f.unlinkedDecoyXrefStream = appendRevision(decoyStream.bytes, [], {
    preXrefPoint: { 6: decoyStream.maliciousOffset }, prevOverride: decoyStream.prev
  }).bytes;
  // Even a harmless DSS tail must fail closed when a pre-E section is unlinked.
  f.unlinkedPreSection = appendDssRevision(decoyTable.bytes, { prevOverride: decoyTable.prev });
  // Shadow object: the xref points at a changed definition of 6, pdf-lib keeps the later
  // byte-identical one. Without the xref consistency check this would look like DSS only.
  f.shadowObject = appendRevision(signed, [
    { num: 6, body: stream(content) }, { num: 6, body: stream(original6) }, ...dss
  ], { xrefPoint: { 6: 0 } }).bytes;
  // An orphan duplicate is signed but never listed by the active xref chain.
  // The unsigned tail then points object 6 at byte-identical content; the
  // baseline must still come from the active chain, not the orphan definition.
  {
    const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
    const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const shadowBody = stream(content);
    const withShadow = concatBytes(rev.bytes, latin1(`\n6 0 obj\n${shadowBody}\nendobj\n`));
    const orphanSigned = await signFile(withShadow, rev.offsets.get(8), (signedOverBytes) =>
      buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes }));
    f.orphanShadowObject = appendRevision(orphanSigned, [{ num: 6, body: shadowBody }], {
      prevOverride: rev.xrefOffset
    }).bytes;
  }
  f.prevOverride = appendRevision(signed, dss, { prevOverride: 17 }).bytes;
  f.xrefStmInTail = appendRevision(signed, dss, { trailerExtras: '/XRefStm 0' }).bytes;
  // The object stream reuses the number of the signed font object 4: pdf.js would resolve 4 to it.
  f.reusedStreamNumber = appendDssRevision(signed, { ...xs, objStm: [20, 21], objStmNum: 4 });
  f.patchedXrefOffset = appendRevision(signed, dss, { offsetShift: { 20: 1 } }).bytes;
  f.invalidObjectInTail = appendRevision(signed, [...dss, { num: 24, body: '<< /Broken [ 1 2 >> ]' }]).bytes;
  {
    const missingXref = appendDssRevision(signed);
    const text = Buffer.from(missingXref).toString('latin1');
    f.tailWithoutXref = latin1(text.slice(0, text.lastIndexOf('\nxref\n') + 1));
  }
  return f;
}

// --- linearized files (ISO 32000-1 Annex F) ------------------------------------------
const LINEARIZATION = 10;
const HINT = 11;
const GAP = 12;
const FIRST_PAGE = new Set([1, 3, 4, 6, LINEARIZATION, HINT, GAP]);
const pad10 = (n) => String(n).padStart(10, '0');

/**
 * Write `objects` (Map num -> body) in the qpdf layout of a linearized file:
 * the linearization dictionary first, then the first-page xref table whose
 * trailer /Prev points FORWARD to the main table at the end of the file, the
 * hint stream and first-page objects, the other objects and the main table.
 * Numbers are zero-padded, so a second pass fills in the final offsets.
 * Knobs break exactly one part of the shape: `linearized: false` (no
 * /Linearized key), `hint: false` (/H names a dictionary, not a stream),
 * `mainPrev` (the main trailer links back to the first-page table) and
 * `gapObject` (an object between the linearization dictionary and the table).
 * Exploit knobs: `length` (the /L value instead of the real length),
 * `escapedLength` (a short /L plus a duplicate lowercase-escaped /#4c),
 * `linExtra` (appended to the linearization dictionary) and `prefix` (bytes
 * before the %PDF- header); both strings must keep their length across passes.
 */
function linearizedFile(objects, {
  linearized = true, hint = true, mainPrev = false, gapObject = false, length = null, linExtra = '', prefix = '', escapedLength = false
} = {}) {
  const render = (v) => {
    let text = `${prefix}%PDF-1.7\n%\xE2\xE3\xCF\xD3\n`;
    const offsets = new Map();
    const add = (num, body) => { offsets.set(num, text.length); text += `${num} 0 obj\n${body}\nendobj\n`; };
    const table = (nums) => nums.map((n) => `${n} 1\n${pad10(v.offsets.get(n) ?? 0)} 00000 n \n`).join('');
    const marker = linearized ? '/Linearized 1' : '/ODVFixture 1';
    const lengthKeys = escapedLength ? `/L 0000000005 /#4c ${pad10(length ?? v.length)}` : `/L ${pad10(length ?? v.length)}`;
    add(LINEARIZATION, `<< ${marker} ${lengthKeys} /H [${pad10(v.hint)} 0000000016] /O 3 /E ${pad10(v.end)} /N 1 /T ${pad10(v.main)}${linExtra} >>`);
    if (gapObject) add(GAP, '<< /ODVFixtureGap true >>');
    const nums = [...offsets.keys(), HINT, ...objects.keys()].sort((a, b) => a - b);
    const firstXref = text.length;
    text += `xref\n${table(nums.filter((n) => FIRST_PAGE.has(n)))}`;
    text += `trailer\n<< /Size ${GAP + 1} /Root 1 0 R /Info 9 0 R /Prev ${pad10(v.main)} >>\nstartxref\n0\n%%EOF\n`;
    add(HINT, stream('\0'.repeat(16), '/S 36 '));
    for (const [num, body] of objects) if (FIRST_PAGE.has(num)) add(num, body);
    const end = text.length;
    for (const [num, body] of objects) if (!FIRST_PAGE.has(num)) add(num, body);
    const main = text.length;
    text += `xref\n0 1\n0000000000 65535 f \n${table(nums.filter((n) => !FIRST_PAGE.has(n)))}`;
    text += `trailer\n<< /Size ${GAP + 1}${mainPrev ? ` /Prev ${firstXref}` : ''} >>\nstartxref\n${firstXref}\n%%EOF\n`;
    return { text, offsets, values: { length: text.length, hint: offsets.get(hint ? HINT : 1), end, main, offsets } };
  };
  const first = render({ length: 0, hint: 0, end: 0, main: 0, offsets: new Map() });
  const { text, offsets, values } = render(first.values);
  if (JSON.stringify([...values.offsets]) !== JSON.stringify([...first.values.offsets]) || values.length !== first.values.length) {
    throw new Error('fixture bug: linearized layout is not stable');
  }
  return { bytes: latin1(text), offsets };
}

/**
 * The base fixture written as a linearized file. `incremental` (the common
 * real-world shape) signs it with an incremental update; otherwise the
 * signature dictionary is inside the linearized file itself.
 */
async function signLinearized(pki, { incremental = true, ...shape } = {}) {
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const objects = new Map([...builder.objects].map(([num, o]) => [num, o.body]));
  const cms = (signedOverBytes) => buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes });
  if (!incremental) {
    const { bytes, offsets } = linearizedFile(objects, shape);
    return signFile(bytes, offsets.get(8), cms);
  }
  const signing = [1, 3, 5, 7, 8].map((num) => ({ num, body: objects.get(num) }));
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, BASE.page().replace(' /Annots [7 0 R]', ''));
  for (const num of [5, 7, 8]) objects.delete(num);
  const { bytes, offsets } = appendRevision(linearizedFile(objects, shape).bytes, signing, { size: GAP + 1 });
  return signFile(bytes, offsets[4], cms);
}

/**
 * The /L exploit: before signing, a linearization dictionary gets an /L equal
 * to the length the file will have after an appended "DSS" revision, and a
 * literal string holding `endobj` and then a forged xref table. Once the length
 * matches, pdf.js accepts the linearization and starts reading right after the
 * first `endobj` in the file: at the forged table, which points page content 6
 * at a definition hidden in the appended certificate stream data (pdf-lib
 * skips stream data via /Length, so the append looks DSS-only). The forged
 * trailer /Prev links to the real first-page table for every other object;
 * `startxref 0` feeds the parser's two-token lookahead before the string ends.
 * `beforeHeader` puts that dictionary in a first object more than 1024 bytes
 * before the %PDF- header: pdf.js then finds no header and lexes from byte 0,
 * while pdf-lib skips to the header and sees an honest linearized file.
 */
async function linearizedLengthExploit(pki, { beforeHeader = false, escapedLength = false } = {}) {
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const objects = new Map([...builder.objects].map(([num, o]) => [num, o.body]));
  const cms = (signedOverBytes) => buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes });
  const hidden = `\n6 0 obj\n${stream('BT /F1 20 Tf 60 780 Td (EXPLOIT CHANGED CONTENT AFTER SIGNING) Tj ET')}\nendobj\n`;
  const dss = dssObjects();
  dss[2] = { num: 21, body: stream(`${FAKE_CERT}${hidden}%${FAKE_CERT}`) };
  let v = { length: 0, hidden: 0, firstXref: 0 };
  for (let pass = 0; pass < 3; pass += 1) {
    const forged = ` /ODVFixtureX (endobj\nxref\n6 1\n${pad10(v.hidden)} 00000 n \ntrailer\n<< /Size ${GAP + 1} /Root 1 0 R /Prev ${pad10(v.firstXref)} >>\nstartxref 0\n)`;
    const shape = beforeHeader
      ? { prefix: `${LINEARIZATION} 0 obj\n<< /Linearized 1 /L ${pad10(v.length)} /H [1 1] /O 3 /E 1 /N 1 /T 1${forged} >>\nendobj\n%${'-'.repeat(1100)}\n` }
      : { length: v.length, linExtra: forged, escapedLength };
    const { bytes, offsets } = linearizedFile(objects, shape);
    const signed = await signFile(bytes, offsets.get(8), cms);
    const exploit = appendRevision(signed, dss).bytes;
    const text = latin1Text(exploit);
    const next = { length: exploit.length, hidden: text.indexOf(hidden, signed.length) + 1,
      firstXref: text.indexOf('\nendobj\nxref\n') + '\nendobj\n'.length };
    if (JSON.stringify(next) === JSON.stringify(v)) return { signed, exploit };
    v = next;
  }
  throw new Error('fixture bug: the /L exploit layout is not stable');
}

/** A first-object xref stream: structurally logged, but absent from log.records. */
function linearizedXrefFile(objects, { length = null, linExtra = '' } = {}) {
  const render = (v) => {
    let text = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
    const offsets = new Map([[LINEARIZATION, text.length]]);
    const nums = [LINEARIZATION, HINT, ...objects.keys()].sort((a, b) => a - b);
    const index = nums.map((n) => `${n} 1`).join(' ');
    const rows = nums.map((num) => {
      const offset = v.offsets.get(num) ?? 0;
      return [1, (offset >>> 24) & 255, (offset >>> 16) & 255, (offset >>> 8) & 255, offset & 255, 0, 0];
    });
    const binary = String.fromCharCode(...rows.flat());
    const xrefOffset = offsets.get(LINEARIZATION);
    text += `${LINEARIZATION} 0 obj\n<< /Type /XRef /Linearized 1 /L ${pad10(length ?? v.length)} /H [${pad10(v.hint)} 0000000016] /O 3 /E ${pad10(v.end)} /N 1 /T ${pad10(xrefOffset)} /Size ${GAP + 1} /W [1 4 2] /Index [${index}] /Root 1 0 R /Info 9 0 R ${linExtra} /Length ${rows.length * 7} >>\nstream\n${binary}\nendstream\nendobj\n`;
    const add = (num, body) => { offsets.set(num, text.length); text += `${num} 0 obj\n${body}\nendobj\n`; };
    add(HINT, stream('\0'.repeat(16), '/S 36 '));
    for (const [num, body] of objects) add(num, body);
    const end = text.length;
    text += `startxref\n${xrefOffset}\n%%EOF\n`;
    return { text, offsets, values: { length: text.length, hint: offsets.get(HINT), end, offsets } };
  };
  const first = render({ length: 0, hint: 0, end: 0, offsets: new Map() });
  const { text, offsets, values } = render(first.values);
  if (JSON.stringify([...values.offsets]) !== JSON.stringify([...first.values.offsets]) || values.length !== first.values.length) {
    throw new Error('fixture bug: linearized xref layout is not stable');
  }
  return { bytes: latin1(text), offsets };
}

/** F2: the linearization dictionary is the first object's /Type /XRef stream. */
async function linearizedXrefLengthExploit(pki) {
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const objects = new Map([...builder.objects].map(([num, o]) => [num, o.body]));
  const signing = [1, 3, 5, 7, 8].map((num) => ({ num, body: objects.get(num) }));
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, BASE.page().replace(' /Annots [7 0 R]', ''));
  for (const num of [5, 7, 8]) objects.delete(num);
  const cms = (signedOverBytes) => buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes });
  const hidden = `\n6 0 obj\n${stream('BT /F1 20 Tf 60 780 Td (EXPLOIT CHANGED CONTENT AFTER SIGNING) Tj ET')}\nendobj\n`;
  const dss = dssObjects();
  dss[2] = { num: 21, body: stream(`${FAKE_CERT}${hidden}%${FAKE_CERT}`) };
  let v = { length: 0, hidden: 0 };
  for (let pass = 0; pass < 3; pass += 1) {
    const firstXref = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'.length;
    const forged = ` /ODVFixtureX (endobj\nxref\n6 1\n${pad10(v.hidden)} 00000 n \ntrailer\n<< /Size ${GAP + 1} /Root 1 0 R /Prev ${pad10(firstXref)} >>\nstartxref 0\n)`;
    const { bytes } = linearizedXrefFile(objects, { length: v.length, linExtra: forged });
    const rev = appendRevision(bytes, signing, { size: GAP + 1 });
    const signed = await signFile(rev.bytes, rev.offsets[4], cms);
    const exploit = appendRevision(signed, dss).bytes;
    const text = latin1Text(exploit);
    const next = { length: exploit.length, hidden: text.indexOf(hidden, signed.length) + 1 };
    if (JSON.stringify(next) === JSON.stringify(v)) return { signed, exploit };
    v = next;
  }
  throw new Error('fixture bug: the xref /L exploit layout is not stable');
}

/**
 * Sign a committed qpdf-linearized base (scripts/fixtures, written by
 * scripts/generate-linearized-fixture-bases.py) with an incremental update and
 * return the signed file plus a DSS-only and a content-changing append.
 */
async function qpdfLinearized(pki, file) {
  const base = new Uint8Array(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const root = doc.context.trailerInfo.Root.objectNumber;
  const page = doc.getPage(0);
  const contents = page.node.get(PDFName.of('Contents')).objectNumber;
  const [widget, sig, dss, cert, ocsp] = [0, 1, 2, 3, 4].map((i) => doc.context.largestObjectNumber + 1 + i);
  const extend = (num, extra) => doc.context.lookup(PDFRef.of(num)).toString().replace(/>>\s*$/, ` ${extra} >>`);
  const catalog = extend(root, `/AcroForm << /Fields [${widget} 0 R] /SigFlags 3 >>`);
  const options = { root: `${root} 0 R`, info: '', size: ocsp + 1 };
  const signing = appendRevision(base, [
    { num: root, body: catalog },
    { num: page.ref.objectNumber, body: extend(page.ref.objectNumber, `/Annots [${widget} 0 R]`) },
    { num: widget, body: `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V ${sig} 0 R /P ${page.ref.objectNumber} 0 R /Rect [0 0 0 0] /F 132 >>` },
    { num: sig, body: sigDictBody({ subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' }) }
  ], options);
  const signed = await signFile(signing.bytes, signing.offsets[3], (signedOverBytes) =>
    buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes }));
  const dssDefs = [
    { num: root, body: catalog.replace(/ >>$/, ` /DSS ${dss} 0 R >>`) },
    { num: dss, body: `<< /Type /DSS /Certs [${cert} 0 R] /OCSPs [${ocsp} 0 R] >>` },
    { num: cert, body: stream(FAKE_CERT) },
    { num: ocsp, body: stream(FAKE_OCSP) }
  ];
  return {
    signed,
    dss: appendRevision(signed, dssDefs, options).bytes,
    contentChanged: appendRevision(signed, [
      { num: contents, body: stream('BT /F1 20 Tf 60 780 Td (CHANGED AFTER SIGNING) Tj ET') }, ...dssDefs
    ], options).bytes
  };
}

/**
 * Linearized signed files. In a linearized file the first-page xref section
 * comes first and its trailer /Prev points FORWARD to the main section. Every
 * appended revision of that shape fails closed, including an honest DSS-only
 * append. `qpdf*` are produced by a real linearizer (qpdf 12.3.2 via pikepdf);
 * the rest are written by linearizedFile().
 */
export async function createLinearizedFixtures(pki) {
  const changed = { num: 6, body: stream('BT /F1 20 Tf 60 780 Td (CHANGED AFTER SIGNING) Tj ET') };
  const incremental = await signLinearized(pki);
  const inside = await signLinearized(pki, { incremental: false });
  const qpdfTable = await qpdfLinearized(pki, 'linearized-qpdf-table.pdf');
  const qpdfObjStm = await qpdfLinearized(pki, 'linearized-qpdf-objstm.pdf');
  return {
    signed: { incremental, inside, qpdfTable: qpdfTable.signed, qpdfObjStm: qpdfObjStm.signed },
    dss: {
      incremental: appendDssRevision(incremental),
      inside: appendDssRevision(inside),
      qpdfTable: qpdfTable.dss,
      qpdfObjStm: qpdfObjStm.dss
    },
    contentChanged: {
      incremental: appendRevision(incremental, [changed, ...dssObjects()]).bytes,
      inside: appendRevision(inside, [changed, ...dssObjects()]).bytes,
      qpdfTable: qpdfTable.contentChanged,
      qpdfObjStm: qpdfObjStm.contentChanged
    },
    // The accepted forward link must not reopen the shadow-object path.
    shadowObject: appendRevision(incremental, [
      changed, { num: 6, body: stream('BT /F1 20 Tf 60 780 Td (ODV SIGNATURE FIXTURE SAMPLE TEXT 0123456789) Tj ET') }, ...dssObjects()
    ], { xrefPoint: { 6: 0 } }).bytes,
    // /L set before signing to the final length: pdf.js reads a forged xref table.
    lengthExploit: await linearizedLengthExploit(pki),
    lengthExploitEscapedName: await linearizedLengthExploit(pki, { escapedLength: true }),
    lengthExploitXrefStream: await linearizedXrefLengthExploit(pki),
    lengthExploitBeforeHeader: await linearizedLengthExploit(pki, { beforeHeader: true }),
    // DSS-only appends to signed files with a forward /Prev that is NOT the linearized shape.
    notLinearized: appendDssRevision(await signLinearized(pki, { linearized: false })),
    noHintStream: appendDssRevision(await signLinearized(pki, { hint: false })),
    mainSectionLinksBack: appendDssRevision(await signLinearized(pki, { mainPrev: true })),
    objectBeforeFirstPageXref: appendDssRevision(await signLinearized(pki, { gapObject: true }))
  };
}

/**
 * A realistic multi-page signed document for the pdf.js differential timing:
 * `pageCount` pages of text, vector graphics and one shared Flate image, signed
 * like the base fixture, then a DSS-only append, a content change on a late
 * page and a replaced image (object 11) that leaves every drawing operator
 * unchanged. Pages are objects 3 and 100, 102, ...; their content streams 6 and
 * 101, 103, ...
 */
export async function createMultiPageFixtures(pki, pageCount = 40) {
  const imageObject = (blue) => {
    const pixels = Buffer.alloc(256 * 256 * 3);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) pixels.set([x, y, blue(x, y)], (y * 256 + x) * 3);
    }
    const data = deflateSync(pixels).toString('latin1');
    return `<< /Type /XObject /Subtype /Image /Width 256 /Height 256 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n${data}\nendstream`;
  };
  const pageText = (page, marker = '') => {
    let body = 'q 0.9 0.9 0.95 rg 40 40 515 762 re f Q\nq 0.2 0.3 0.6 RG 2 w 40 800 m 555 800 l S Q\n';
    body += 'q 200 0 0 200 355 60 cm /Im1 Do Q\nBT /F1 10 Tf 50 780 Td 12 TL\n';
    for (let line = 1; line <= 45; line++) {
      body += `(Page ${page} line ${line}: ODV synthetic multi-page signature fixture text ${marker}) '\n`;
    }
    return `${body}ET`;
  };
  const pageNum = (p) => (p === 1 ? 3 : 98 + 2 * p);
  const contentNum = (p) => (p === 1 ? 6 : 99 + 2 * p);
  const page = (p) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 11 0 R >> >> /Contents ${contentNum(p)} 0 R${p === 1 ? ' /Annots [7 0 R]' : ''} >>`;
  const builder = baseSignedPdf({ fieldName: 'Signature1', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', nameLiteral: 'ODV Fixture Signer' } });
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  builder.set(2, `<< /Type /Pages /Kids [${pages.map((p) => `${pageNum(p)} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  builder.set(11, imageObject((x, y) => (x * y) & 255));
  for (const p of pages) {
    builder.set(pageNum(p), page(p));
    builder.set(contentNum(p), stream(pageText(p)));
  }
  const signed = await signBuilder(pki, builder);
  const size = contentNum(pageCount) + 1;
  const late = Math.max(1, pageCount - 3);
  return {
    signed,
    dss: appendDssRevision(signed, { size }),
    contentChanged: appendRevision(signed, [
      { num: contentNum(late), body: stream(pageText(late, 'CHANGED AFTER SIGNING')) }, ...dssObjects()
    ], { size }).bytes,
    // Same object number, same drawing operators: only the decoded pixels differ.
    imageChanged: appendRevision(signed, [{ num: 11, body: imageObject(() => 0) }, ...dssObjects()], { size }).bytes
  };
}
