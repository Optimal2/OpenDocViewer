// Synthetic incremental updates for the appended-revision classifier
// (src/utils/pdfSignatureRevisions.js). Every update is appended to a fixture
// signed with the throwaway PKI; no real documents, certificates or names.
//
// appendRevision() writes one unsigned revision after `base`: the given object
// definitions in physical order, then a classic xref table (default) or an
// xref stream (`xrefStream`), a trailer chained with /Prev, and startxref.
// Negative knobs: `free` (f / type-0 entries), `prevOverride`, `xrefPoint`
// (point an entry at an earlier duplicate definition), `offsetShift` (patch an
// xref offset), `trailerExtras` (e.g. /XRefStm) and `objStm` (pack objects in
// an object stream, xref stream only).
import { deflateSync } from 'node:zlib';
import {
  baseSignedPdf, buildSignedData, buildTstToken, signFile, sigDictBody, latin1, concatBytes, findStartxrefOffset
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
  xrefPoint = {}, preXrefPoint = {}, offsetShift = {}, trailerExtras = '', info = '/Info 9 0 R', objStmNum = null
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
  for (const [num, delta] of Object.entries(offsetShift)) entries.get(Number(num)).a += delta;
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
    const xrefOffset = at();
    text += 'xref\n0 1\n0000000000 65535 f \n';
    for (const num of [...entries.keys()].sort((a, b) => a - b)) {
      const e = entries.get(num);
      text += `${num} 1\n${String(e.a).padStart(10, '0')} ${String(e.b).padStart(5, '0')} ${e.type === 0 ? 'f' : 'n'} \n`;
    }
    text += `trailer\n<< /Size ${maxNum + 1} /Root 1 0 R ${info}${extras} /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return { bytes: concatBytes(base, latin1(text)), offsets };
  }
  const xrefNum = streamNum;
  const xrefOffset = at();
  entries.set(xrefNum, { type: 1, a: xrefOffset, b: 0 });
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
  } else data = Buffer.from(rows.flat());
  const binary = String.fromCharCode(...data);
  text += `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Index [${index}] /Root 1 0 R ${info}${extras} /Prev ${prev} ${filter}/Length ${data.length} >>\nstream\n${binary}\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`;
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
