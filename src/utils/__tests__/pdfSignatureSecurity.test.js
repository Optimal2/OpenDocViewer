/** @vitest-environment node */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFDict, PDFHexString, PDFString, PDFName } from 'pdf-lib';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';
import { createSecurityFixtures, swapEncapsulatedDigest, tamper, replaceRange, byteRange } from '../../../scripts/signature-security-fixtures.mjs';

let f;
beforeAll(async () => { f = await createSecurityFixtures(); }, 120000);
async function first(bytes) {
  const report = await collectPdfSignatures(bytes);
  expect(report.signatures.length).toBeGreaterThan(0);
  return report.signatures[0];
}
describe('security regression proofs', () => {
  it('production minification cannot hide signatures or break PDF type decoding', async () => {
    const classes = [PDFDict, PDFHexString, PDFString, PDFName];
    const descriptors = classes.map((type) => Object.getOwnPropertyDescriptor(type, 'name'));
    try {
      classes.forEach((type, i) => Object.defineProperty(type, 'name', { value: `minified${i}`, configurable: true }));
      const sig = await first(f.normal['valid-rsa.pdf']);
      expect(sig.integrity).toBe('intact');
      expect(sig.fieldName).toBe('Signature1');
      expect(sig.subFilter).toBe('adbe.pkcs7.detached');
      expect(sig.reason).toBe('Approved fixture document');
    } finally {
      classes.forEach((type, i) => Object.defineProperty(type, 'name', descriptors[i]));
    }
  });
  it.each([['doc-timestamp-rfc3161.pdf', 'SHA-256'], ['pkcs7-sha1.pdf', 'SHA-1']])('F1 eContent swap: %s', async (name, hash) => {
    const sig = await first(await swapEncapsulatedDigest(f.normal[name], hash));
    expect(sig.integrity).toBe('digest-mismatch');
    expect(sig.integrityCode).toBe('content-digest-mismatch');
  });
  it.each(['doc-timestamp-rfc3161.pdf', 'pkcs7-sha1.pdf'])('row 18/20 tampered document under an intact CMS: %s -> document-digest-mismatch', async (name) => {
    const sig = await first(tamper(f.normal[name]));
    expect(sig.integrity).toBe('digest-mismatch');
    expect(sig.integrityCode).toBe('document-digest-mismatch');
  });
  it('F2 signed attributes require messageDigest even with signingTime', async () => {
    for (const bytes of [f.noDigest, tamper(f.noDigest)]) {
      const sig = await first(bytes);
      expect(sig.integrity).toBe('unreadable');
      expect(sig.integrityCode).toBe('message-digest-attribute');
      expect(sig.integrityReason).toMatch(/messageDigest/);
    }
  });
  it('direct signatures verify the document when signed attributes are absent', async () => {
    expect((await first(f.direct)).integrity).toBe('intact');
    const tampered = await first(tamper(f.direct));
    expect(tampered.integrity).toBe('signature-invalid');
    expect(tampered.integrityCode).toBe('signature-invalid');
  });
  it.each(['fakeLater', 'maliciousLater'])('F3 invalid later signature cannot launder an extension: %s', async (name) => {
    const report = await collectPdfSignatures(f[name]);
    expect(report.signatures).toHaveLength(2);
    expect(report.signatures[0].integrity).toBe('modified-after-signing');
    // fakeLater adds an approval signature field, maliciousLater replaces the page content stream.
    expect(report.signatures[0].integrityCode).toBe('content-changed-after-signing');
    expect(report.signatures[1].integrity).toBe('unreadable');
    expect(report.signatures[1].integrityCode).toBe('cms-malformed');
  });
  it('F4 widened gap cannot hide a visible content rewrite', async () => {
    const sig = await first(f.wide);
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityCode).toBe('byte-range-invalid');
    expect(sig.integrityReason).toMatch(/Contents|ByteRange/);
    expect(sig.coversWholeFile).not.toBe(true);
  });
  it('F4 gap must belong to this signature dictionary', async () => {
    const sig = await first(f.decoy);
    expect(sig.integrityReason).toMatch(/Contents|ByteRange/);
    expect(sig.integrityCode).toBe('byte-range-invalid');
  });
  it.each([[-1, -2, -3, -4], [0, 2147483647, 4294967296, 99999999999], [0, 100, 50, 100], [1, 100, 200, 100], [0, 1.5, 200, 100]])('F4 rejects malformed ranges %j', async (...range) => {
    const sig = await first(replaceRange(f.normal['valid-rsa.pdf'], range));
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityCode).toBe('byte-range-invalid');
  });
  it.each(['wrongIssuer', 'unknownSerial', 'wrongSki'])('F5 no certificate fallback: %s', async (name) => {
    const sig = await first(f[name]);
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityCode).toBe('signer-certificate-missing');
    expect(sig.integrityReason).toMatch(/certificate/);
    expect(sig.issuer).toBeNull();
  });
  it.each(['ski', 'skiExtension', 'serialCollision'])('F5 identifier finds the signer after the unrelated first certificate: %s', async (name) => {
    const sig = await first(f[name]);
    expect(sig.integrity).toBe('intact');
    expect(sig.signer).toBe('ODV Fixture Signer');
  });
  it.each(['escaped', 'compressed'])('F7 does not hide signatures: %s', async (name) => {
    const sig = await first(f[name]);
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityCode).toBe('byte-range-invalid');
    expect(sig.subFilter).toBe('adbe.pkcs7.detached');
    expect(sig.integrityReason).toMatch(/ByteRange/);
  });
  it('unsigned object-stream PDFs remain unsigned after structural parsing', async () => {
    const doc = await PDFDocument.load(f.normal['unsigned.pdf']);
    expect(await collectPdfSignatures(await doc.save({ useObjectStreams: true }))).toEqual({ signatures: [] });
  });
  it('hostile deeply nested ASN.1 returns unreadable', async () => {
    const bytes = f.normal['valid-rsa.pdf'].slice();
    const br = byteRange(bytes);
    bytes.set(new TextEncoder().encode('30'.repeat(8191)), br[1] + 1);
    const sig = await first(bytes);
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityCode).toBe('cms-malformed');
  });
  it('50 MB appended outside the range never passes integrity', async () => {
    const base = f.normal['valid-rsa.pdf'];
    const bytes = new Uint8Array(base.length + 50 * 1024 * 1024);
    bytes.set(base);
    const sig = await first(bytes);
    expect(sig.integrity).not.toBe('intact');
    expect(sig.integrityCode).toBe('unclassified-change-after-signing');
  }, 15000);
  it('50k nested PDF dictionaries cannot become an unsigned report', async () => {
    const base = f.normal['unsigned.pdf'];
    const tail = new TextEncoder().encode(`\n9 0 obj\n<< /A ${'<< /A '.repeat(50000)}(x)${' >>'.repeat(50001)}\nendobj\n`);
    const bytes = new Uint8Array(base.length + tail.length);
    bytes.set(base); bytes.set(tail, base.length);
    const sig = await first(bytes);
    expect(sig.integrity).toBe('not-checked-in-viewer');
    expect(sig.integrityCode).toBe('inspection-limit');
  });
  it('measures unsigned PDF inspection without loading the CMS stack', async () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) expect(await collectPdfSignatures(f.normal['unsigned.pdf'])).toEqual({ signatures: [] });
    console.info(`Unsigned PDF: 100 inspections in ${(performance.now() - start).toFixed(1)} ms`);
  });
});

/** Assert integrity, code and both severities (default switch / 'warning' switch) of one signature. */
function expectStatus(sig, integrity, code, severity, severityWithWarningSwitch = severity) {
  expect([sig.integrity, sig.integrityCode]).toEqual([integrity, code]);
  expect(getSignatureSeverity(sig)).toBe(severity);
  expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe(severityWithWarningSwitch);
}

describe('status model rows (design table: viewer limits are information, defects are errors)', () => {
  it.each([
    ['row 12 unknown digest algorithm OID', 'unknownDigest', /digest algorithm not supported/],
    ['row 14b SHA-224 digest (no WebCrypto SHA-224)', 'sha224Digest', /SHA-224/],
    ['row 24 unmapped signature algorithm', 'unknownSignatureAlgorithm', /not verifiable/],
    ['row 24b unknown ECDSA curve is never guessed from the key length', 'unknownCurve', /curve/],
    ['row 17 document timestamp imprint algorithm unknown', 'timestampUnknownImprint', /imprint algorithm/],
  ])('%s -> not checked / algorithm-unsupported (ok + info)', async (_row, name, reason) => {
    const sig = await first(f[name]);
    expectStatus(sig, 'not-checked-in-viewer', 'algorithm-unsupported', 'ok', 'warning');
    expect(sig.integrityReason).toMatch(reason);
  });
  it('row 24b keeps the certificate identity but marks the name as not verified by a signature', async () => {
    const sig = await first(f.unknownCurve);
    expect(sig.signer).toBe('ODV Fixture Signer EC');
    expect(sig.signerSource).toBe('certificate');
  });
  it('row 23 a key the browser rejects (DataError) is indeterminate / key-import-failed (warning)', async () => {
    expectStatus(await first(f.badEcKey), 'indeterminate', 'key-import-failed', 'warning');
  });
  it('row 6 CMS over the 1 MiB budget -> not checked / inspection-limit', async () => {
    expectStatus(await first(f.oversizedCms), 'not-checked-in-viewer', 'inspection-limit', 'ok', 'warning');
  });
  it('row 30 PDF over 64 MiB -> not checked / inspection-limit', async () => {
    const report = await collectPdfSignatures(new Uint8Array(64 * 1024 * 1024 + 1));
    expectStatus(report.signatures[0], 'not-checked-in-viewer', 'inspection-limit', 'ok', 'warning');
  });
  it('row 31 encrypted PDF -> not checked / encrypted', async () => {
    expectStatus(await first(f.encrypted), 'not-checked-in-viewer', 'encrypted', 'ok', 'warning');
  });
  it.each(['structureFilterChain', 'structureFilterUnknown'])('row 32 structural stream filter the parser cannot decode (%s) -> structure-unsupported', async (name) => {
    expectStatus(await first(f[name]), 'not-checked-in-viewer', 'structure-unsupported', 'ok', 'warning');
  });
  it('row 34 more than 256 signatures -> not checked / inspection-limit', async () => {
    expectStatus(await first(f.tooManySignatures), 'not-checked-in-viewer', 'inspection-limit', 'ok', 'warning');
  });
  it('row 14b missing crypto.subtle -> not checked / viewer-error', async () => {
    vi.stubGlobal('crypto', {});
    try {
      expectStatus(await first(f.normal['valid-rsa.pdf']), 'not-checked-in-viewer', 'viewer-error', 'ok', 'warning');
      expectStatus(await first(f.direct), 'not-checked-in-viewer', 'viewer-error', 'ok', 'warning');
    } finally { vi.unstubAllGlobals(); }
  });
  it('the warning switch never changes a defect row (errors stay errors, warnings stay warnings)', async () => {
    expectStatus(await first(f.wide), 'unreadable', 'byte-range-invalid', 'error');
    expectStatus(await first(f.noDigest), 'unreadable', 'message-digest-attribute', 'error');
    expectStatus(await first(f.wrongIssuer), 'unreadable', 'signer-certificate-missing', 'error');
    expectStatus(await first(tamper(f.direct)), 'signature-invalid', 'signature-invalid', 'error');
    expectStatus(await first(f.badEcKey), 'indeterminate', 'key-import-failed', 'warning');
    expectStatus((await collectPdfSignatures(f.fakeLater)).signatures[0], 'modified-after-signing', 'content-changed-after-signing', 'warning');
    expectStatus(await first(f.normal['extended-after-signing.pdf']), 'modified-after-signing', 'unclassified-change-after-signing', 'warning');
  });
});
