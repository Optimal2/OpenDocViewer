// Hostile PDFs generated from the same throwaway PKI as the positive fixtures.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import {
  createSignatureFixtures, createFixturePki, buildSignedData, baseSignedPdf,
  PdfBuilder, signFile, sigDictBody, latin1, latin1Text, concatBytes,
  digestBytes, patchContents, patchByteRange, findStartxrefOffset
} from './generate-signature-fixtures.mjs';

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

  return { normal, noDigest, direct, wrongIssuer, unknownSerial, serialCollision, fakeLater, maliciousLater, wide, decoy,
    ski: await skiFixture(), skiExtension: await skiFixture(false, true), wrongSki: await skiFixture(true),
    escaped: await escapedOrCompressed(false), compressed: await escapedOrCompressed(true) };
}
