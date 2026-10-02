/** @vitest-environment node */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFHexString, PDFString, PDFName } from 'pdf-lib';
import { collectPdfSignatures } from '../pdfSignatures.js';
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
    expect((await first(await swapEncapsulatedDigest(f.normal[name], hash))).integrity).toBe('digest-mismatch');
  });
  it('F2 signed attributes require messageDigest even with signingTime', async () => {
    for (const bytes of [f.noDigest, tamper(f.noDigest)]) {
      const sig = await first(bytes);
      expect(sig.integrity).toBe('unreadable');
      expect(sig.integrityReason).toMatch(/messageDigest/);
    }
  });
  it('direct signatures verify the document when signed attributes are absent', async () => {
    expect((await first(f.direct)).integrity).toBe('intact');
    expect((await first(tamper(f.direct))).integrity).toBe('signature-invalid');
  });
  it.each(['fakeLater', 'maliciousLater'])('F3 invalid later signature cannot launder an extension: %s', async (name) => {
    const report = await collectPdfSignatures(f[name]);
    expect(report.signatures).toHaveLength(2);
    expect(report.signatures[0].integrity).toBe('modified-after-signing');
    expect(report.signatures[1].integrity).toBe('unreadable');
  });
  it('F4 widened gap cannot hide a visible content rewrite', async () => {
    const sig = await first(f.wide);
    expect(sig.integrity).toBe('unreadable');
    expect(sig.integrityReason).toMatch(/Contents|ByteRange/);
    expect(sig.coversWholeFile).not.toBe(true);
  });
  it('F4 gap must belong to this signature dictionary', async () => {
    expect((await first(f.decoy)).integrityReason).toMatch(/Contents|ByteRange/);
  });
  it.each([[-1, -2, -3, -4], [0, 2147483647, 4294967296, 99999999999], [0, 100, 50, 100], [1, 100, 200, 100], [0, 1.5, 200, 100]])('F4 rejects malformed ranges %j', async (...range) => {
    expect((await first(replaceRange(f.normal['valid-rsa.pdf'], range))).integrity).toBe('unreadable');
  });
  it.each(['wrongIssuer', 'unknownSerial', 'wrongSki'])('F5 no certificate fallback: %s', async (name) => {
    const sig = await first(f[name]);
    expect(sig.integrity).toBe('unreadable');
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
    expect((await first(bytes)).integrity).toBe('unreadable');
  });
  it('50 MB appended outside the range never passes integrity', async () => {
    const base = f.normal['valid-rsa.pdf'];
    const bytes = new Uint8Array(base.length + 50 * 1024 * 1024);
    bytes.set(base);
    expect((await first(bytes)).integrity).not.toBe('intact');
  }, 15000);
  it('50k nested PDF dictionaries cannot become an unsigned report', async () => {
    const base = f.normal['unsigned.pdf'];
    const tail = new TextEncoder().encode(`\n9 0 obj\n<< /A ${'<< /A '.repeat(50000)}(x)${' >>'.repeat(50001)}\nendobj\n`);
    const bytes = new Uint8Array(base.length + tail.length);
    bytes.set(base); bytes.set(tail, base.length);
    expect((await first(bytes)).integrity).toBe('unreadable');
  });
  it('measures unsigned PDF inspection without loading the CMS stack', async () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) expect(await collectPdfSignatures(f.normal['unsigned.pdf'])).toEqual({ signatures: [] });
    console.info(`Unsigned PDF: 100 inspections in ${(performance.now() - start).toFixed(1)} ms`);
  });
});
