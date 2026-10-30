// Hostile PDFs generated from the same throwaway PKI as the positive fixtures.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import {
  createSignatureFixtures, createFixturePki, buildSignedData, buildTstToken, baseSignedPdf,
  PdfBuilder, signFile, sigDictBody, latin1, latin1Text, concatBytes,
  digestBytes, patchContents, patchByteRange, findStartxrefOffset
} from './generate-signature-fixtures.mjs';
import { createLinearizedFixtures, createRevisionFixtures, createSignedXrefStreamFixtures } from './signature-revision-fixtures.mjs';

// DER encodings (tag, length, value) of the OIDs the status-model fixtures rewrite.
export const OID_DER = Object.freeze({
  sha256: '0609608648016503040201',
  sha224: '0609608648016503040204',
  sha3_256: '0609608648016503040208', // a real hash the viewer does not map
  sha256WithRsa: '06092a864886f70d01010b',
  sha512_224WithRsa: '06092a864886f70d01010f', // a real RSA algorithm the viewer does not map
  p256: '06082a8648ce3d030107',
  prime239v3: '06082a8648ce3d030106' // a real named curve WebCrypto does not implement
});

/**
 * Rewrite hex inside the first signature's /Contents gap. The replacement must
 * have the same length, so the ByteRange and the signed bytes stay valid: only
 * the CMS (which is outside the signed range) changes.
 * @param {Uint8Array} bytes
 * @param {string} fromHex
 * @param {string} toHex
 * @param {'all'|'last'|'first'} [which]
 */
export function patchContentsHex(bytes, fromHex, toHex, which = 'all') {
  if (fromHex.length !== toHex.length) throw new Error('fixture bug: replacement must keep the length');
  const copy = bytes.slice();
  const br = byteRange(copy);
  const start = br[1] + 1;
  const hex = latin1Text(copy.subarray(start, br[2] - 1)).toLowerCase();
  const positions = [];
  for (let i = hex.indexOf(fromHex); i >= 0; i = hex.indexOf(fromHex, i + 1)) positions.push(i);
  if (!positions.length) throw new Error(`fixture bug: ${fromHex} not found in /Contents`);
  const chosen = which === 'last' ? [positions.at(-1)] : which === 'first' ? [positions[0]] : positions;
  for (const at of chosen) copy.set(latin1(toHex), start + at);
  return copy;
}

export function byteRange(bytes, last = false) {
  const matches = [...latin1Text(bytes).matchAll(/\/ByteRange\s*\[([^\]]+)\]/g)];
  return matches[last ? matches.length - 1 : 0][1].trim().split(/\s+/).map(Number);
}
export function covered(bytes, br) {
  return concatBytes(bytes.subarray(0, br[1]), bytes.subarray(br[2], br[2] + br[3]));
}
export function tamper(bytes) {
  const copy = bytes.slice();
  const at = latin1Text(copy).indexOf('SAMPLE TEXT');
  if (at < 0) throw new Error('missing fixture text');
  copy[at] = 0x73;
  return copy;
}
export function replaceRange(bytes, values) {
  const copy = bytes.slice();
  const match = /\/ByteRange\s*\[([^\]]+)\]/.exec(latin1Text(copy));
  const text = values.join(' ').padEnd(match[1].length, ' ');
  if (text.length !== match[1].length) throw new Error('range too long');
  copy.set(latin1(text), match.index + match[0].indexOf('[') + 1);
  return copy;
}
export async function swapEncapsulatedDigest(bytes, algorithm) {
  const br = byteRange(bytes);
  const original = await digestBytes(algorithm, covered(bytes, br));
  const copy = tamper(bytes);
  const replacement = await digestBytes(algorithm, covered(copy, br));
  const hex = (v) => Buffer.from(v).toString('hex');
  const content = latin1Text(copy.subarray(br[1] + 1, br[2] - 1));
  const at = content.indexOf(hex(original));
  if (at < 0) throw new Error('missing digest');
  copy.set(latin1(hex(replacement)), br[1] + 1 + at);
  return copy;
}

/**
 * Re-encode the first signature's CMS after `mutate(signedData, signerInfo)`.
 * Only the CMS inside the /Contents gap changes, so ByteRange and signed bytes
 * stay valid; fields outside the signed attributes keep the signature verifiable.
 * @param {Uint8Array} bytes
 * @param {(signedData: any, signerInfo: any) => (void|Promise<void>)} mutate
 */
export async function rewriteCms(bytes, mutate) {
  const br = byteRange(bytes);
  const der = new Uint8Array(Buffer.from(latin1Text(bytes.subarray(br[1] + 1, br[2] - 1)), 'hex'));
  const parsed = asn1js.fromBER(der.buffer); // the zero padding after the CMS is ignored
  if (parsed.offset === -1) throw new Error('fixture CMS parse failed');
  const contentInfo = new pkijs.ContentInfo({ schema: parsed.result });
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  await mutate(signedData, signedData.signerInfos[0]);
  contentInfo.content = signedData.toSchema(true);
  return patchContents(bytes, br[1] + 1, new Uint8Array(contentInfo.toSchema().toBER(false)));
}

/** A UTF-16BE PDF hex string long enough that pdf-lib's text decoding throws a RangeError. */
const OVERSIZED_TEXT_HEX = `<FEFF${'0041'.repeat(1000000)}>`;

/**
 * Fixtures for the error-versus-information boundaries of the status model
 * (docs-src/pdf-signatures.md, design rows 12, 17, 21, 22, 24, 33, 35 and the
 * signing-time edge cases). Each one changes exactly the field its row tests.
 */
export async function createBoundaryFixtures() {
  const normal = await createSignatureFixtures();
  const pki = await createFixturePki();
  const valid = normal['valid-rsa.pdf'];
  const ecdsa = normal['cades-ecdsa-invisible.pdf'];
  const signature = (bytes) => async (_sd, signerInfo) => {
    signerInfo.signature = new asn1js.OctetString({ valueHex: new Uint8Array(bytes).buffer });
  };
  async function docTimestamp(buildToken) {
    const builder = baseSignedPdf({ fieldName: 'DocTS', visible: false,
      sigOptions: { subFilter: 'ETSI.RFC3161', nameLiteral: 'ODV Fixture Timestamping TSA' } });
    const rev = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    return signFile(rev.bytes, rev.offsets.get(8), buildToken);
  }
  /** A document timestamp whose encapsulated content is `content` instead of a TSTInfo; the CMS itself verifies. */
  const docTimestampContent = (content) => docTimestamp(() => buildSignedData({ signer: pki.tsa, certificates: [pki.ca.cert],
    eContentType: '1.2.840.113549.1.9.16.1.4', eContentBytes: content, signedOverBytes: content }));
  async function approval({ extra = '', configure = null } = {}) {
    const builder = baseSignedPdf({ fieldName: 'Boundary', visible: false,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', extra } });
    const rev = builder.serialize();
    return signFile(rev.bytes, rev.offsets.get(8), (signedOverBytes) =>
      buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes, configure }));
  }
  const signingTimeAttr = (...values) => new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values });
  const time = (iso) => new asn1js.GeneralizedTime({ valueDate: new Date(iso) });
  /** Insert extra signingTime attributes before or after the builder's own (2026-03-05T12:30:00Z). */
  const withSigningTimes = (before, after = []) => ({ configure(sd) {
    const attrs = sd.signerInfos[0].signedAttrs.attributes;
    const at = attrs.findIndex((attr) => attr.type === '1.2.840.113549.1.9.5');
    attrs.splice(at, 0, ...before);
    attrs.splice(at + before.length + 1, 0, ...after);
  } });
  // The builder's signingTime attribute replaced by `attr` (null removes it).
  const replaceSigningTime = (attr) => ({ configure(sd) {
    const attrs = sd.signerInfos[0].signedAttrs.attributes;
    const at = attrs.findIndex((a) => a.type === '1.2.840.113549.1.9.5');
    attrs.splice(at, 1, ...(attr ? [attr] : []));
  } });
  const mDate = '/M (D:20260305123000Z) ';

  return {
    normal,
    // Row 12: an empty digestAlgorithm OID (06 00) parses to algorithmId ''.
    missingDigestOid: await rewriteCms(valid, (_sd, signerInfo) => {
      signerInfo.digestAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: '' });
    }),
    unknownDigest: patchContentsHex(valid, OID_DER.sha256, OID_DER.sha3_256),
    // Row 17: TSTInfo that is not BER, BER that is not a TSTInfo, an empty imprint, an empty imprint OID.
    timestampTstNotBer: await docTimestampContent(new Uint8Array([0x30, 0x45, 0x02, 0x01])),
    timestampTstWrongSchema: await docTimestampContent(new Uint8Array(new asn1js.Sequence({
      value: [new asn1js.Integer({ value: 1 })] }).toBER(false))),
    timestampEmptyImprint: await docTimestamp((docBytes) => buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert],
      docBytes, imprintBytes: new Uint8Array(0) })),
    timestampEmptyImprintOid: await docTimestamp((docBytes) => buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert],
      docBytes, imprintOid: '' })),
    timestampUnknownImprint: await docTimestamp((docBytes) => buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert],
      docBytes, imprintOid: '2.16.840.1.101.3.4.2.8' })),
    // Row 22: an empty signature OCTET STRING.
    missingSignatureValue: await rewriteCms(valid, signature([])),
    // Row 24: ECDSA signature values that are not a DER SEQUENCE of two INTEGERs.
    ecdsaTruncatedDer: await rewriteCms(ecdsa, signature([0x30, 0x45, 0x02, 0x01])),
    ecdsaNotSequence: await rewriteCms(ecdsa, signature([0x02, 0x01, 0x01])),
    ecdsaOversizedInteger: await rewriteCms(ecdsa, signature([0x30, 0x26, 0x02, 0x21, 0x7f, ...new Array(32).fill(1), 0x02, 0x01, 0x01])),
    unknownCurve: patchContentsHex(ecdsa, OID_DER.p256, OID_DER.prime239v3),
    // Row 33: more than 100,000 objects reach discovery (PDFNumber instances are distinct).
    discoveryLimit: await (async () => {
      const doc = await PDFDocument.load(normal['unsigned.pdf']);
      doc.context.register(doc.context.obj(new Array(100001).fill(0)));
      return doc.save({ useObjectStreams: false });
    })(),
    // Row 33: discovery decodes every /Type; this one makes pdf-lib's UTF-16 decoding throw.
    discoveryError: await (async () => {
      const builder = new PdfBuilder();
      builder.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
      builder.set(2, '<< /Type /Pages /Kids [] /Count 0 >>');
      builder.set(3, `<< /Type ${OVERSIZED_TEXT_HEX} >>`);
      return builder.serialize().bytes;
    })(),
    // Row 35: only dictionaryInfo decodes /Reason; this one makes it throw for this signature.
    dictionaryError: await approval({ extra: `/Reason ${OVERSIZED_TEXT_HEX} ` }),
    // Signing-time attribute edge cases (the signer-chosen attribute order decides).
    signingTimeFirstOfTwo: await approval({ ...withSigningTimes([], [signingTimeAttr(time('2031-01-01T00:00:00Z'))]) }),
    signingTimeOutsideFirst: await approval({ ...withSigningTimes([signingTimeAttr(time('2031-01-01T00:00:00Z'))]) }),
    signingTimeTwoValues: await approval({ ...replaceSigningTime(signingTimeAttr(time('2031-01-01T00:00:00Z'), time('2026-03-05T12:30:00Z'))) }),
    signingTimeNotATime: await approval({ extra: mDate, ...replaceSigningTime(signingTimeAttr(new asn1js.Utf8String({ value: 'not a time' }))) }),
    signingTimeDigitString: await approval({ extra: mDate, ...replaceSigningTime(signingTimeAttr(new asn1js.Utf8String({ value: '20310101000000Z' }))) }),
    signingTimeNoValue: await approval({ extra: mDate, ...replaceSigningTime(signingTimeAttr()) })
  };
}

export async function createSecurityFixtures() {
  const normal = await createSignatureFixtures();
  const pki = await createFixturePki();
  async function signed(options = {}, extra = '') {
    const builder = baseSignedPdf({ fieldName: 'Security', visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached', extra } });
    const revision = builder.serialize();
    return signFile(revision.bytes, revision.offsets.get(8), (signedOverBytes) =>
      buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes, ...options }));
  }
  const noDigest = await signed({ omitMessageDigest: true });
  const direct = await signed({ noSignedAttrs: true });
  const wrongIssuer = await signed({ configure(sd) {
    sd.signerInfos[0].sid.issuer = new pkijs.RelativeDistinguishedNames({ typesAndValues: [
      new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'Different issuer' }) })
    ] });
  } });
  const unknownSerial = await signed({ configure(sd) {
    sd.signerInfos[0].sid.serialNumber = new asn1js.Integer({ value: 999 });
  } });
  const serialCollision = await signed({ configure(sd, cert) {
    const other = sd.certificates[1];
    other.serialNumber = cert.serialNumber;
    other.issuer = new pkijs.RelativeDistinguishedNames({ typesAndValues: [
      new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'Other issuer' }) })
    ] });
    sd.certificates.reverse();
  } });
  async function skiFixture(wrong = false, extension = false) {
    return signed({ async configure(sd, cert) {
      const id = await digestBytes('SHA-1', cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
      if (extension) {
        cert.extensions.push(new pkijs.Extension({ extnID: '2.5.29.14',
          extnValue: new asn1js.OctetString({ valueHex: id.slice().buffer }).toBER(false) }));
      }
      if (wrong) id[0] ^= 1;
      sd.version = 3;
      sd.signerInfos[0].version = 3;
      sd.signerInfos[0].sid = new asn1js.Primitive({ idBlock: { tagClass: 3, tagNumber: 0 }, valueHex: id.buffer });
      sd.certificates.reverse(); // First certificate is deliberately not the signer.
    } });
  }
  const fakeLater = normal['two-signatures.pdf'].slice();
  const second = byteRange(fakeLater, true);
  fakeLater.set(latin1('deadbeef'), second[1] + 1);

  // A real CMS over a deliberately widened gap, swallowing a visible stream.
  const builder = baseSignedPdf({ fieldName: 'WideGap', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached' } });
  const stream = 'BT /F1 20 Tf (ORIGINAL VISIBLE TEXT) Tj ET';
  builder.set(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 10 0 R >>');
  builder.set(10, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  const revision = builder.serialize();
  const patched = patchByteRange(revision.bytes, revision.offsets.get(8));
  const textAt = latin1Text(patched.bytes).indexOf('(ORIGINAL VISIBLE TEXT)');
  const gapEnd = textAt + '(ORIGINAL VISIBLE TEXT)'.length;
  const wideBr = [0, patched.hexStart - 1, gapEnd, patched.bytes.length - gapEnd];
  let wide = replaceRange(patched.bytes, wideBr);
  wide = patchContents(wide, patched.hexStart, await buildSignedData({ signer: pki.rsa, signedOverBytes: covered(wide, wideBr) }));
  wide.set(latin1('(HACKED VISIBLE TEXT!!)'), textAt);

  // A correct-sized hex gap belonging to /Decoy rather than this /Contents.
  const decoyBuilder = baseSignedPdf({ fieldName: 'Decoy', visible: true,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', extra: '/Decoy <deadbeef> ' } });
  const decoyRev = decoyBuilder.serialize();
  const decoyPatched = patchByteRange(decoyRev.bytes, decoyRev.offsets.get(8));
  const decoyStart = latin1Text(decoyRev.bytes).indexOf('<deadbeef>');
  const decoyBr = [0, decoyStart, decoyStart + 10, decoyRev.bytes.length - decoyStart - 10];
  const decoy = replaceRange(decoyPatched.bytes, decoyBr);

  async function escapedOrCompressed(compressed) {
    const doc = await PDFDocument.load(normal['unsigned.pdf']);
    doc.context.register(doc.context.obj({ Type: PDFName.of('Sig'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'), ByteRange: [0, 4, 8, 4], Contents: PDFHexString.of('deadbeef') }));
    const bytes = await doc.save({ useObjectStreams: compressed });
    if (compressed) return bytes;
    return latin1(latin1Text(bytes).replace('/ByteRange', '/Byte#52ange').replace('/SubFilter', '/Sub#46ilter').replace('/Sig\n', '/S#69g\n'));
  }
  // A malicious incremental revision replaces the visible stream and adds a bogus CMS.
  const update = new PdfBuilder();
  update.set(6, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  update.set(10, sigDictBody({ subFilter: 'adbe.pkcs7.detached' }));
  const base = normal['valid-rsa.pdf'];
  const tail = update.serialize({ prevStartxref: { offset: findStartxrefOffset(base), fileLength: base.length } });
  const fakeUpdate = patchByteRange(concatBytes(base, tail.bytes), tail.offsets.get(10));
  const maliciousLater = patchContents(fakeUpdate.bytes, fakeUpdate.hexStart, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

  // --- status model: viewer limits (not checked in the viewer), not defects -----
  const valid = normal['valid-rsa.pdf'];
  const ecdsa = normal['cades-ecdsa-invisible.pdf'];
  const unknownDigest = patchContentsHex(valid, OID_DER.sha256, OID_DER.sha3_256);
  const sha224Digest = patchContentsHex(valid, OID_DER.sha256, OID_DER.sha224);
  // The signer's signatureAlgorithm is the last sha256WithRSA OID; the certificates keep theirs.
  const unknownSignatureAlgorithm = patchContentsHex(valid, OID_DER.sha256WithRsa, OID_DER.sha512_224WithRsa, 'last');
  const unknownCurve = patchContentsHex(ecdsa, OID_DER.p256, OID_DER.prime239v3);
  // A P-256 point that is not on the curve: the browser rejects the key (DataError).
  const ecPoint = latin1Text(ecdsa).toLowerCase().indexOf('034200', byteRange(ecdsa)[1]);
  const badEcKey = ecdsa.slice();
  badEcKey[ecPoint + 10] = badEcKey[ecPoint + 10] === 0x30 ? 0x31 : 0x30; // hex digit inside X
  // A document timestamp whose imprint algorithm (SHA3-256 OID) the viewer does not map.
  const dtsBuilder = baseSignedPdf({ fieldName: 'DocTS', visible: false,
    sigOptions: { subFilter: 'ETSI.RFC3161', nameLiteral: 'ODV Fixture Timestamping TSA' } });
  const dtsRev = dtsBuilder.serialize({ trailerExtras: '/Info 9 0 R' });
  const timestampUnknownImprint = await signFile(dtsRev.bytes, dtsRev.offsets.get(8), (docBytes) =>
    buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert], docBytes, imprintOid: '2.16.840.1.101.3.4.2.8' }));
  // A CMS gap over the 1 MiB inspection budget (zero filled; the budget is checked before parsing).
  const bigCapacity = 2 * 1024 * 1024 + 64;
  const bigBuilder = baseSignedPdf({ fieldName: 'Huge', visible: false,
    sigOptions: { subFilter: 'adbe.pkcs7.detached', capacityHex: bigCapacity } });
  const bigRev = bigBuilder.serialize();
  const oversizedCms = patchByteRange(bigRev.bytes, bigRev.offsets.get(8), bigCapacity).bytes;
  // Encrypted document (/Encrypt in the trailer).
  const encBuilder = baseSignedPdf({ fieldName: 'Enc', visible: false, sigOptions: { subFilter: 'adbe.pkcs7.detached' } });
  encBuilder.set(20, '<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>');
  const encrypted = encBuilder.serialize({ trailerExtras: '/Encrypt 20 0 R' }).bytes;
  // Structural (object/xref) streams with a filter chain or a filter the parser cannot decode.
  const compressedText = latin1Text(await escapedOrCompressed(true));
  const structureFilterChain = latin1(compressedText.replace('/Filter /FlateDecode', '/Filter [/FlateDecode /FlateDecode]'));
  const structureFilterUnknown = latin1(compressedText.replace('/Filter /FlateDecode', '/Filter /JBIG2Decode'));
  // More signature dictionaries than the 256 signature budget.
  const manyDoc = await PDFDocument.load(normal['unsigned.pdf']);
  for (let i = 0; i < 257; i++) {
    manyDoc.context.register(manyDoc.context.obj({ Type: PDFName.of('Sig'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'), ByteRange: [0, 4, 8, 4], Contents: PDFHexString.of('deadbeef') }));
  }
  const tooManySignatures = await manyDoc.save({ useObjectStreams: false });
  // The CMS bytes still verify under SHA-256; only the algorithm identifiers differ.
  const pkcs1MismatchedOids = await rewriteCms(valid, (_sd, signerInfo) => {
    signerInfo.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
      algorithmId: '1.2.840.113549.1.1.13', algorithmParams: new asn1js.Null()
    });
  });
  const pkcs1GenericRsa = await rewriteCms(valid, (_sd, signerInfo) => {
    signerInfo.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
      algorithmId: '1.2.840.113549.1.1.1', algorithmParams: new asn1js.Null()
    });
  });

  return { normal, revisions: await createRevisionFixtures(normal, pki), signedXrefStream: await createSignedXrefStreamFixtures(pki),
    linearized: await createLinearizedFixtures(pki),
    noDigest, direct, wrongIssuer, unknownSerial, serialCollision, fakeLater, maliciousLater, wide, decoy,
    unknownDigest, sha224Digest, unknownSignatureAlgorithm, unknownCurve, badEcKey, timestampUnknownImprint,
    oversizedCms, encrypted, structureFilterChain, structureFilterUnknown, tooManySignatures, pkcs1MismatchedOids, pkcs1GenericRsa,
    ski: await skiFixture(), skiExtension: await skiFixture(false, true), wrongSki: await skiFixture(true),
    escaped: await escapedOrCompressed(false), compressed: await escapedOrCompressed(true) };
}
