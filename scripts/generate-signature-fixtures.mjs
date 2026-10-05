// Fixture generator for PDF signature parser tests.
//
// Creates a THROWAWAY test CA and signer certificates (fake names, generated keys,
// nothing committed) and signs synthetic one-page PDFs so every integrity branch of
// src/utils/pdfSignatures.js has a real CMS payload to verify. No real certificates,
// no real names, no customer material.
//
// Usage in tests:  const fixtures = await createSignatureFixtures();
// Usage by hand:   node scripts/generate-signature-fixtures.mjs --out tmp/fixtures
//
// Third-party: pkijs + asn1js (BSD-3-Clause, runtime deps reused here) and
// @peculiar/x509 (MIT, devDependency) for certificate creation. Licences recorded
// in THIRD-PARTY-NOTICES.md.

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import * as x509 from '@peculiar/x509';

// ---------------------------------------------------------------------------
// Fixed identity material (deterministic shapes; keys are generated per run).
// ---------------------------------------------------------------------------

export const FIXTURE_NOT_BEFORE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
export const FIXTURE_NOT_AFTER = new Date(Date.UTC(2030, 0, 1, 0, 0, 0));
export const FIXTURE_SIGNING_TIME = new Date(Date.UTC(2026, 2, 5, 12, 30, 0));

export const FIXTURE_NAMES = [
  'unsigned.pdf',
  'valid-rsa.pdf',
  'cades-ecdsa-invisible.pdf',
  'pss-rsa-no-signing-time-attr.pdf',
  'two-signatures.pdf',
  'two-signatures-generation-bumped.pdf',
  'extended-after-signing.pdf',
  'digest-mismatch.pdf',
  'signature-invalid.pdf',
  'unsupported-subfilter.pdf',
  'corrupt-contents.pdf',
  'certified-docmdp.pdf',
  'doc-timestamp-rfc3161.pdf',
  'pkcs7-sha1.pdf',
  'visible-appearance.pdf',
  'invisible-appearance.pdf'
];

const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_ATTR_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_ATTR_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_ATTR_SIGNING_TIME = '1.2.840.113549.1.9.5';

const CONTENTS_CAPACITY_HEX = 16384; // hex chars reserved for /Contents (8192 bytes)
const BYTE_RANGE_DIGITS = 10; // each ByteRange value is zero-padded to 10 digits
const BYTE_RANGE_PLACEHOLDER = `${'0'.repeat(BYTE_RANGE_DIGITS)} ${'0'.repeat(BYTE_RANGE_DIGITS)} ${'0'.repeat(BYTE_RANGE_DIGITS)} ${'0'.repeat(BYTE_RANGE_DIGITS)}`;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function latin1Text(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function indexOfAscii(bytes, ascii, from = 0) {
  const needle = latin1(ascii);
  outer: for (let i = from; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function bufferOf(view) {
  return view.slice().buffer;
}

async function digestBytes(alg, data) {
  return new Uint8Array(await crypto.subtle.digest(alg, bufferOf(data)));
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function pdfDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function escapePdfLiteral(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function utf16Hex(str) {
  let hex = 'feff';
  for (let i = 0; i < str.length; i += 1) hex += str.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

function findStartxrefOffset(bytes) {
  const idx = indexOfAscii(bytes, 'startxref', Math.max(0, bytes.length - 64));
  if (idx === -1) throw new Error('fixture bug: startxref not found');
  const m = /startxref\s+(\d+)/.exec(latin1Text(bytes.subarray(idx)));
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// Minimal PDF writer (classic xref table, correct subsection grouping)
// ---------------------------------------------------------------------------

class PdfBuilder {
  constructor() {
    this.objects = new Map(); // number -> { gen, body }
  }

  set(number, body, gen = 0) {
    this.objects.set(number, { gen, body });
    return number;
  }

  /**
   * Serialize the given objects (or all) as a PDF revision.
   * prevStartxref: { offset, fileLength } for an incremental update.
   */
  serialize({ trailerExtras = '', prevStartxref = null, only = null } = {}) {
    const numbers = [...this.objects.keys()]
      .filter((n) => (only ? only.includes(n) : true))
      .sort((a, b) => a - b);
    const baseLength = prevStartxref ? prevStartxref.fileLength : 0;
    let text = prevStartxref ? '' : '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
    const offsets = new Map();
    for (const n of numbers) {
      offsets.set(n, baseLength + text.length);
      text += `${n} ${this.objects.get(n).gen} obj\n${this.objects.get(n).body}\nendobj\n`;
    }
    const xrefOffset = baseLength + text.length;
    text += 'xref\n0 1\n0000000000 65535 f \n';
    let i = 0;
    while (i < numbers.length) {
      let j = i;
      while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j += 1;
      text += `${numbers[i]} ${j - i + 1}\n`;
      for (let k = i; k <= j; k += 1) {
        const o = offsets.get(numbers[k]);
        text += `${String(o).padStart(10, '0')} ${String(this.objects.get(numbers[k]).gen).padStart(5, '0')} n \n`;
      }
      i = j + 1;
    }
    const size = Math.max(...this.objects.keys()) + 1;
    const prev = prevStartxref ? ` /Prev ${prevStartxref.offset}` : '';
    const extras = trailerExtras ? ` ${trailerExtras.trim()}` : '';
    text += `trailer\n<< /Size ${size} /Root 1 0 R${extras}${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return { bytes: latin1(text), xrefOffset, fileLength: baseLength + text.length, offsets };
  }
}

function sigDictBody({ subFilter, nameHex, nameLiteral, m, reason, location, extra }) {
  const parts = [`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${subFilter} `];
  if (nameHex) parts.push(`/Name ${nameHex} `);
  if (nameLiteral) parts.push(`/Name (${escapePdfLiteral(nameLiteral)}) `);
  if (m) parts.push(`/M (${m}) `);
  if (reason) parts.push(`/Reason (${escapePdfLiteral(reason)}) `);
  if (location) parts.push(`/Location (${escapePdfLiteral(location)}) `);
  if (extra) parts.push(extra);
  parts.push(`/ByteRange [${BYTE_RANGE_PLACEHOLDER}] /Contents <${'0'.repeat(CONTENTS_CAPACITY_HEX)}> >>`);
  return parts.join('');
}

const SAMPLE_CONTENT_STREAM = 'BT /F1 20 Tf 60 780 Td (ODV SIGNATURE FIXTURE SAMPLE TEXT 0123456789) Tj ET';

/**
 * Appearance stream (/AP /N) for the visible-signature fixture: a solid blue
 * banner with white text, sized to match the widget rect [60 640 320 700]
 * (260x60 user units). The colour is deliberately distinct so rendering tests
 * can count "signature blue" pixels in the rasterized page.
 */
export const SIGNATURE_APPEARANCE_STREAM = '0.12 0.31 0.85 rg\n0 0 260 60 re f\n1 1 1 rg\nBT /F1 16 Tf 12 24 Td (Signed by ODV Fixture Signer) Tj ET';

/** Widget rect shared by the appearance fixtures, in PDF user units. */
export const SIGNATURE_APPEARANCE_RECT = [60, 640, 320, 700];

function baseSignedPdf({ fieldName, visible, appearance = false, sigOptions }) {
  const builder = new PdfBuilder();
  builder.set(1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>');
  builder.set(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.set(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R /Annots [7 0 R] >>');
  builder.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  builder.set(5, '<< /Fields [7 0 R] /SigFlags 3 >>');
  builder.set(6, `<< /Length ${SAMPLE_CONTENT_STREAM.length} >>\nstream\n${SAMPLE_CONTENT_STREAM}\nendstream`);
  const rect = visible ? `[${SIGNATURE_APPEARANCE_RECT.join(' ')}]` : '[0 0 0 0]';
  const flags = visible ? '' : ' /F 128';
  const appearanceRef = appearance ? ' /AP << /N 10 0 R >>' : '';
  builder.set(7, `<< /Type /Annot /Subtype /Widget /FT /Sig /T (${escapePdfLiteral(fieldName)}) /V 8 0 R /P 3 0 R /Rect ${rect}${flags}${appearanceRef} >>`);
  builder.set(8, sigDictBody(sigOptions));
  if (appearance) {
    builder.set(10, `<< /Type /XObject /Subtype /Form /BBox [0 0 ${SIGNATURE_APPEARANCE_RECT[2] - SIGNATURE_APPEARANCE_RECT[0]} ${SIGNATURE_APPEARANCE_RECT[3] - SIGNATURE_APPEARANCE_RECT[1]}] /Matrix [1 0 0 1 0 0] /Resources << /Font << /F1 4 0 R >> >> /Length ${SIGNATURE_APPEARANCE_STREAM.length} >>\nstream\n${SIGNATURE_APPEARANCE_STREAM}\nendstream`);
  }
  builder.set(9, `<< /Producer (ODV signature fixtures) /CreationDate (${pdfDateString(FIXTURE_SIGNING_TIME)}) >>`);
  return builder;
}

// ---------------------------------------------------------------------------
// Signing plumbing: write /ByteRange first, digest the covered bytes, then
// write the CMS into the reserved /Contents gap.
// ---------------------------------------------------------------------------

function sigGap(fileBytes, sigObjOffset) {
  const regionStart = indexOfAscii(fileBytes, '/Contents <', sigObjOffset);
  if (regionStart === -1) throw new Error('fixture bug: /Contents placeholder missing');
  const hexStart = regionStart + '/Contents <'.length;
  return { hexStart, gapEnd: hexStart + CONTENTS_CAPACITY_HEX };
}

function patchByteRange(fileBytes, sigObjOffset) {
  const { hexStart, gapEnd } = sigGap(fileBytes, sigObjOffset);
  const brIdx = indexOfAscii(fileBytes, `/ByteRange [${BYTE_RANGE_PLACEHOLDER}]`, sigObjOffset);
  if (brIdx === -1) throw new Error('fixture bug: /ByteRange placeholder missing');
  const values = [
    0,
    hexStart - 1,
    gapEnd + 1,
    fileBytes.length - gapEnd - 1
  ];
  const digits = values.map((v) => String(v).padStart(BYTE_RANGE_DIGITS, '0')).join(' ');
  const out = fileBytes.slice();
  const at = brIdx + '/ByteRange ['.length;
  for (let i = 0; i < digits.length; i += 1) out[at + i] = digits.charCodeAt(i);
  return { bytes: out, hexStart, gapEnd };
}

function extractSignedBytes(fileBytes, hexStart, gapEnd) {
  return concatBytes(fileBytes.subarray(0, hexStart), fileBytes.subarray(gapEnd));
}

function patchContents(fileBytes, hexStart, cmsBytes) {
  if (cmsBytes.length * 2 > CONTENTS_CAPACITY_HEX) {
    throw new Error('fixture bug: CMS larger than reserved /Contents space');
  }
  const out = fileBytes.slice();
  const hex = toHex(cmsBytes).padEnd(CONTENTS_CAPACITY_HEX, '0');
  for (let i = 0; i < hex.length; i += 1) out[hexStart + i] = hex.charCodeAt(i);
  return out;
}

/**
 * Sign the file: patches /ByteRange, computes CMS over the covered bytes, writes
 * the CMS into the /Contents gap. `sigObjOffset` is the absolute offset of the
 * signature dictionary object inside `fileBytes`.
 */
async function signFile(fileBytes, sigObjOffset, buildCms) {
  const patched = patchByteRange(fileBytes, sigObjOffset);
  const signedBytes = extractSignedBytes(patched.bytes, patched.hexStart - 1, patched.gapEnd + 1);
  const cms = await buildCms(signedBytes);
  return patchContents(patched.bytes, patched.hexStart, cms);
}

async function signBasePdf(pki, { cmsSigner, sigOptions, cmsOptions = {} }) {
  const builder = baseSignedPdf(sigOptions);
  const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
  return signFile(rev1.bytes, rev1.offsets.get(8), (signedBytes) =>
    buildSignedData({ signer: cmsSigner, certificates: [pki.ca.cert], ...cmsOptions, signedOverBytes: signedBytes })
  );
}

// ---------------------------------------------------------------------------
// Certificate material
// ---------------------------------------------------------------------------

async function createRsaKeyPair(name = 'RSASSA-PKCS1-v1_5', hash = 'SHA-256') {
  return crypto.subtle.generateKey(
    { name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash },
    true,
    ['sign', 'verify']
  );
}

async function createFixturePki() {
  const caKeys = await createRsaKeyPair();
  const caCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    notBefore: FIXTURE_NOT_BEFORE,
    notAfter: FIXTURE_NOT_AFTER,
    name: 'CN=ODV Fixture Signing CA, O=ODV Fixtures',
    keys: caKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.crlSign, true)
    ]
  });

  async function leaf(subject, serial, keys, { tsa = false } = {}) {
    const extensions = [new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true)];
    if (tsa) extensions.push(new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.8'], true));
    return x509.X509CertificateGenerator.create({
      serialNumber: serial,
      notBefore: FIXTURE_NOT_BEFORE,
      notAfter: FIXTURE_NOT_AFTER,
      subject,
      issuer: caCert.subject,
      publicKey: keys.publicKey,
      signingKey: caKeys.privateKey,
      extensions
    });
  }

  const ecKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const [rsaKeys, rsa2Keys, pssKeys, sha1Keys, tsaKeys] = await Promise.all([
    createRsaKeyPair(),
    createRsaKeyPair(),
    createRsaKeyPair('RSA-PSS'),
    createRsaKeyPair('RSASSA-PKCS1-v1_5', 'SHA-1'),
    createRsaKeyPair()
  ]);

  return {
    ca: { cert: caCert },
    rsa: { keys: rsaKeys, cert: await leaf('CN=ODV Fixture Signer, O=ODV Fixture Users', '11', rsaKeys) },
    ec: { keys: ecKeys, cert: await leaf('CN=ODV Fixture Signer EC, O=ODV Fixture Users', '12', ecKeys) },
    rsa2: { keys: rsa2Keys, cert: await leaf('CN=ODV Fixture Approver, O=ODV Fixture Users', '13', rsa2Keys) },
    pss: { keys: pssKeys, cert: await leaf('CN=ODV Fixture Signer PSS, O=ODV Fixture Users', '14', pssKeys) },
    sha1: { keys: sha1Keys, cert: await leaf('CN=ODV Fixture Signer SHA1, O=ODV Fixture Users', '15', sha1Keys) },
    tsa: { keys: tsaKeys, cert: await leaf('CN=ODV Fixture Timestamping TSA, O=ODV Fixtures', '16', tsaKeys, { tsa: true }) }
  };
}

function toPkiCertificate(x509Cert) {
  const parsed = asn1js.fromBER(x509Cert.rawData);
  if (parsed.offset === -1) throw new Error(`fixture certificate parse failed: ${parsed.result.error}`);
  return new pkijs.Certificate({ schema: parsed.result });
}

// ---------------------------------------------------------------------------
// CMS (PKCS#7) builders
// ---------------------------------------------------------------------------

async function buildSignedData({
  signer,
  certificates = [],
  hashAlg = 'SHA-256',
  signingTime = FIXTURE_SIGNING_TIME,
  eContentType = OID_DATA,
  eContentBytes = null,
  signedOverBytes,
  wrongKey = null,
  omitMessageDigest = false,
  noSignedAttrs = false,
  configure = null
}) {
  const pkiCert = toPkiCertificate(signer.cert);
  const contentForDigest = eContentBytes ?? signedOverBytes;
  const contentDigest = await digestBytes(hashAlg, contentForDigest);
  const attributes = [
    new pkijs.Attribute({ type: OID_ATTR_CONTENT_TYPE, values: [new asn1js.ObjectIdentifier({ value: eContentType })] }),
    new pkijs.Attribute({ type: OID_ATTR_MESSAGE_DIGEST, values: [new asn1js.OctetString({ valueHex: bufferOf(contentDigest) })] })
  ];
  if (signingTime) {
    attributes.push(new pkijs.Attribute({
      type: OID_ATTR_SIGNING_TIME,
      values: [new asn1js.GeneralizedTime({ valueDate: signingTime })]
    }));
  }
  if (omitMessageDigest) attributes.splice(1, 1);
  const encapParams = { eContentType };
  if (eContentBytes) encapParams.eContent = new asn1js.OctetString({ valueHex: bufferOf(eContentBytes) });
  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo(encapParams),
    certificates: [pkiCert, ...certificates.map(toPkiCertificate)],
    crls: [],
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: pkiCert.issuer, serialNumber: pkiCert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes })
      })
    ]
  });
  if (noSignedAttrs) delete signedData.signerInfos[0].signedAttrs;
  if (configure) await configure(signedData, pkiCert);
  await signedData.sign((wrongKey ?? signer.keys).privateKey, 0, hashAlg, signedOverBytes);
  const contentInfo = new pkijs.ContentInfo({ contentType: OID_SIGNED_DATA, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

async function buildTstToken({ signer, certificates = [], docBytes, hashAlg = 'SHA-256', genTime = FIXTURE_SIGNING_TIME }) {
  const imprint = await digestBytes(hashAlg, docBytes);
  const tstInfo = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }), // version
      new asn1js.ObjectIdentifier({ value: '1.2.840.113730.1.99999.1' }), // policy (fake, local)
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.ObjectIdentifier({ value: '2.16.840.1.101.3.4.2.1' }), // sha-256
              new asn1js.Null()
            ]
          }),
          new asn1js.OctetString({ valueHex: bufferOf(imprint) })
        ]
      }),
      new asn1js.Integer({ valueHex: bufferOf(new Uint8Array([0x00, 0x53, 0x9a, 0x1f])) }), // serial
      new asn1js.GeneralizedTime({ valueDate: genTime }),
      new asn1js.Boolean({ value: true }) // ordering
    ]
  });
  const tstInfoDer = new Uint8Array(tstInfo.toBER(false));
  return buildSignedData({
    signer,
    certificates,
    hashAlg,
    signingTime: genTime,
    eContentType: OID_TST_INFO,
    eContentBytes: tstInfoDer,
    signedOverBytes: tstInfoDer
  });
}

// ---------------------------------------------------------------------------
// Fixture assembly
// ---------------------------------------------------------------------------

function unsignedPdfBytes() {
  const builder = new PdfBuilder();
  builder.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.set(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.set(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 4 0 R >>');
  const stream = 'BT /F1 20 Tf 60 780 Td (ODV fixture without any signature) Tj ET';
  builder.set(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.set(5, '<< /Producer (ODV signature fixtures) >>');
  return builder.serialize({ trailerExtras: '/Info 5 0 R' }).bytes;
}

/**
 * Two signatures: sig1 over revision 1, sig2 appended via an incremental update
 * that rewrites the page (3) and AcroForm (5) and covers the whole file.
 *
 * Per ISO 32000-1 7.5.6 a rewritten object keeps its object AND generation
 * number (the generation only increases when a freed number is reused), so the
 * update writes `3 0 obj` / `5 0 obj` with `00000 n` xref entries, matching the
 * `3 0 R` / `5 0 R` references. `bumpRewrittenGeneration: true` reproduces the
 * out-of-spec shape some writers emit (`3 1 obj`, `00001 n`, references still
 * `0 R`); it only feeds the negative fixture `two-signatures-generation-bumped.pdf`.
 */
async function twoSignaturesPdf(pki, { bumpRewrittenGeneration = false } = {}) {
  const builder = baseSignedPdf({
    fieldName: 'Signature1',
    visible: true,
    sigOptions: {
      subFilter: 'adbe.pkcs7.detached',
      nameLiteral: 'ODV Fixture Signer',
      m: pdfDateString(FIXTURE_SIGNING_TIME),
      reason: 'First signature',
      location: 'Test'
    }
  });
  const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
  const file1 = await signFile(rev1.bytes, rev1.offsets.get(8), (signedBytes) =>
    buildSignedData({ signer: pki.rsa, certificates: [pki.ca.cert], signedOverBytes: signedBytes })
  );

  const rewrittenGen = bumpRewrittenGeneration ? 1 : 0;
  const upd = new PdfBuilder();
  upd.set(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R /Annots [7 0 R 10 0 R] >>', rewrittenGen);
  upd.set(5, '<< /Fields [7 0 R 10 0 R] /SigFlags 3 >>', rewrittenGen);
  upd.set(10, '<< /Type /Annot /Subtype /Widget /FT /Sig /T (ApprovalTwo) /V 11 0 R /P 3 0 R /Rect [340 640 560 700] >>');
  upd.set(11, sigDictBody({
    subFilter: 'adbe.pkcs7.detached',
    nameLiteral: 'ODV Fixture Approver',
    m: pdfDateString(FIXTURE_SIGNING_TIME),
    reason: 'Second approval',
    location: 'Test'
  }));
  const rev2 = upd.serialize({
    trailerExtras: '/Info 9 0 R',
    only: [3, 5, 10, 11],
    prevStartxref: { offset: findStartxrefOffset(file1), fileLength: file1.length }
  });
  const file2 = concatBytes(file1, rev2.bytes);
  return signFile(file2, rev2.offsets.get(11), (signedBytes) =>
    buildSignedData({ signer: pki.rsa2, certificates: [pki.ca.cert], signedOverBytes: signedBytes })
  );
}

export async function createSignatureFixtures() {
  const pki = await createFixturePki();
  const fixtures = {};

  fixtures['unsigned.pdf'] = unsignedPdfBytes();

  // 1. adbe.pkcs7.detached, RSA PKCS#1 v1.5 SHA-256, visible widget, full attrs.
  fixtures['valid-rsa.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.rsa,
    sigOptions: {
      fieldName: 'Signature1',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameHex: utf16Hex('ODV Fixture Signer'),
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Approved fixture document',
        location: 'Local test environment'
      }
    }
  });

  // 2. ETSI.CAdES.detached, ECDSA P-256, invisible widget.
  fixtures['cades-ecdsa-invisible.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.ec,
    sigOptions: {
      fieldName: 'Sign2',
      visible: false,
      sigOptions: {
        subFilter: 'ETSI.CAdES.detached',
        nameLiteral: 'ODV Fixture Signer EC',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Granskad',
        location: 'Kontoret'
      }
    }
  });

  // 3. RSA-PSS, CMS without a signingTime attribute -> /M fallback.
  fixtures['pss-rsa-no-signing-time-attr.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.pss,
    sigOptions: {
      fieldName: 'PssSig',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameLiteral: 'ODV Fixture Signer PSS',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'PSS fixture'
      }
    },
    cmsOptions: { signingTime: null }
  });

  // 4. Two signatures: sig1 over revision 1, sig2 appended via incremental
  //    update and covering the whole file including sig1's CMS.
  fixtures['two-signatures.pdf'] = await twoSignaturesPdf(pki);

  // 4b. NEGATIVE fixture: same document, but the incremental update bumps the
  //     generation of the rewritten objects (out of spec, see twoSignaturesPdf).
  //     Keeps the parser's tolerance for such writers under test.
  fixtures['two-signatures-generation-bumped.pdf'] = await twoSignaturesPdf(pki, { bumpRewrittenGeneration: true });

  // 5. Plain incremental update appended after signing, not covered by any
  //    later signature: modified-after-signing.
  {
    const signed = await signBasePdf(pki, {
      cmsSigner: pki.rsa,
      sigOptions: {
        fieldName: 'Signature1',
        visible: true,
        sigOptions: {
          subFilter: 'adbe.pkcs7.detached',
          nameLiteral: 'ODV Fixture Signer',
          m: pdfDateString(FIXTURE_SIGNING_TIME),
          reason: 'Before update',
          location: 'Test'
        }
      }
    });
    const note = '<< /FixtureNote (post-signing incremental update) >>';
    const upd = new PdfBuilder();
    upd.set(10, note);
    const rev2 = upd.serialize({
      trailerExtras: '/Info 9 0 R',
      only: [10],
      prevStartxref: { offset: findStartxrefOffset(signed), fileLength: signed.length }
    });
    fixtures['extended-after-signing.pdf'] = concatBytes(signed, rev2.bytes);
  }

  // 6. Content byte changed inside the first signed range after signing.
  {
    const signed = await signBasePdf(pki, {
      cmsSigner: pki.rsa,
      sigOptions: {
        fieldName: 'Signature1',
        visible: true,
        sigOptions: {
          subFilter: 'adbe.pkcs7.detached',
          nameLiteral: 'ODV Fixture Signer',
          m: pdfDateString(FIXTURE_SIGNING_TIME),
          reason: 'Will be tampered',
          location: 'Test'
        }
      }
    });
    const idx = indexOfAscii(signed, 'SAMPLE TEXT');
    const tampered = signed.slice();
    tampered[idx] = 's'.charCodeAt(0); // SAMPLE -> sAMPLE inside the signed range
    fixtures['digest-mismatch.pdf'] = tampered;
  }

  // 7. CMS signed with a different key than the embedded certificate.
  {
    const builder = baseSignedPdf({
      fieldName: 'Signature1',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameLiteral: 'ODV Fixture Signer',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Wrong signer key',
        location: 'Test'
      }
    });
    const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const signed = await signFile(rev1.bytes, rev1.offsets.get(8), (signedBytes) =>
      buildSignedData({
        signer: pki.rsa,
        certificates: [pki.ca.cert],
        wrongKey: pki.rsa2.keys,
        signedOverBytes: signedBytes
      })
    );
    fixtures['signature-invalid.pdf'] = signed;
  }

  // 8. A signature format this viewer does not support.
  fixtures['unsupported-subfilter.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.rsa,
    sigOptions: {
      fieldName: 'GostSig',
      visible: true,
      sigOptions: {
        subFilter: 'ICVN.SADES',
        nameLiteral: 'ODV Fixture Signer',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Unsupported format fixture',
        location: 'Test'
      }
    }
  });

  // 9. Garbage /Contents (not a parseable CMS).
  {
    const builder = baseSignedPdf({
      fieldName: 'BadSig',
      visible: true,
      sigOptions: { subFilter: 'adbe.pkcs7.detached' }
    });
    const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const { hexStart, bytes: patched } = patchByteRange(rev1.bytes, rev1.offsets.get(8));
    const garbage = 'deadbeef'.repeat(CONTENTS_CAPACITY_HEX / 8);
    for (let i = 0; i < garbage.length; i += 1) patched[hexStart + i] = garbage.charCodeAt(i);
    fixtures['corrupt-contents.pdf'] = patched;
  }

  // 10. Certification signature with DocMDP /Reference.
  fixtures['certified-docmdp.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.rsa,
    sigOptions: {
      fieldName: 'Certification',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameLiteral: 'ODV Fixture Signer',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Document certified',
        location: 'Test',
        extra: '/Reference [ << /Type /SigRef /TransformParams << /Type /TransformParams /P 2 /S /DocMDP /V 2 >> >> ] '
      }
    }
  });

  // 11. ETSI.RFC3161 document timestamp.
  {
    const builder = baseSignedPdf({
      fieldName: 'DocTS',
      visible: false,
      sigOptions: {
        subFilter: 'ETSI.RFC3161',
        nameLiteral: 'ODV Fixture Timestamping TSA',
        m: pdfDateString(FIXTURE_SIGNING_TIME)
      }
    });
    const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const signed = await signFile(rev1.bytes, rev1.offsets.get(8), (signedBytes) =>
      buildTstToken({ signer: pki.tsa, certificates: [pki.ca.cert], docBytes: signedBytes })
    );
    fixtures['doc-timestamp-rfc3161.pdf'] = signed;
  }

  // 12. Legacy adbe.pkcs7.sha1 with the SHA-1 document digest embedded.
  {
    const builder = baseSignedPdf({
      fieldName: 'LegacySig',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.sha1',
        nameLiteral: 'ODV Fixture Signer SHA1',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Legacy sha1 fixture',
        location: 'Test'
      }
    });
    const rev1 = builder.serialize({ trailerExtras: '/Info 9 0 R' });
    const signed = await signFile(rev1.bytes, rev1.offsets.get(8), async (signedBytes) => {
      const sha1 = await digestBytes('SHA-1', signedBytes);
      return buildSignedData({
        signer: pki.sha1,
        certificates: [pki.ca.cert],
        hashAlg: 'SHA-1',
        eContentBytes: sha1,
        signedOverBytes: signedBytes
      });
    });
    fixtures['pkcs7-sha1.pdf'] = signed;
  }

  // 13. Visible signature appearance: the widget carries an /AP form XObject
  //     (blue banner, SIGNATURE_APPEARANCE_STREAM) inside the signed revision.
  //     The display layer must paint it when rendering with pdfjs' default
  //     annotation mode; rendering tests count the blue pixels.
  fixtures['visible-appearance.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.rsa,
    sigOptions: {
      fieldName: 'VisibleSig',
      visible: true,
      appearance: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameLiteral: 'ODV Fixture Signer',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Visible appearance fixture',
        location: 'Test'
      }
    }
  });

  // 14. Invisible signature: the widget has a non-zero rect (same rect as the
  //     visible fixture) but NO /AP appearance stream, so the display layer
  //     must paint nothing in the rect. Complements cades-ecdsa-invisible.pdf,
  //     which covers the classic zero-rect + hidden-flag shape.
  fixtures['invisible-appearance.pdf'] = await signBasePdf(pki, {
    cmsSigner: pki.rsa,
    sigOptions: {
      fieldName: 'InvisibleSig',
      visible: true,
      sigOptions: {
        subFilter: 'adbe.pkcs7.detached',
        nameLiteral: 'ODV Fixture Signer',
        m: pdfDateString(FIXTURE_SIGNING_TIME),
        reason: 'Invisible signature fixture (no appearance)',
        location: 'Test'
      }
    }
  });

  return fixtures;
}

// Reusable test-only primitives for adversarial fixtures, with fresh keys per run.
export { createFixturePki, buildSignedData, baseSignedPdf, PdfBuilder, signFile,
  sigDictBody, latin1, latin1Text, concatBytes, digestBytes, patchContents,
  patchByteRange, findStartxrefOffset, CONTENTS_CAPACITY_HEX };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('scripts/generate-signature-fixtures');
if (isMain) {
  const outIdx = process.argv.indexOf('--out');
  if (outIdx === -1) {
    console.error('usage: node scripts/generate-signature-fixtures.mjs --out <dir>');
    process.exit(1);
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = process.argv[outIdx + 1];
  await mkdir(dir, { recursive: true });
  const fixtures = await createSignatureFixtures();
  for (const name of FIXTURE_NAMES) {
    const bytes = fixtures[name];
    await writeFile(`${dir}/${name}`, bytes);
    console.log(`wrote ${dir}/${name} (${bytes.length} bytes)`);
  }
}
