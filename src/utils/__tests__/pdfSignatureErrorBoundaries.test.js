/** @vitest-environment node */
// Error-versus-information boundaries of the status model (docs-src/pdf-signatures.md):
// where a defect must stay an error and a viewer limit must stay information.
// Synthetic fixtures only; rows a real CMS cannot reach use a focused pkijs mock (marked "mock").
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as pkijs from 'pkijs';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';
import { createBoundaryFixtures } from '../../../scripts/signature-security-fixtures.mjs';

let f;
beforeAll(async () => { f = await createBoundaryFixtures(); }, 180000);

async function only(bytes) {
  const report = await collectPdfSignatures(bytes);
  expect(report.signatures).toHaveLength(1);
  return report.signatures[0];
}

/** Assert integrity, code and both severities (default switch / 'warning' switch) of one signature. */
function expectStatus(sig, integrity, code, severity, severityWithWarningSwitch = severity) {
  expect([sig.integrity, sig.integrityCode]).toEqual([integrity, code]);
  expect(getSignatureSeverity(sig)).toBe(severity);
  expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe(severityWithWarningSwitch);
}

/** Run `body` with `Class.prototype.fromSchema` followed by `after(instance)`. */
async function withParsed(Class, after, body) {
  const original = Class.prototype.fromSchema;
  const spy = vi.spyOn(Class.prototype, 'fromSchema').mockImplementation(function (schema) {
    original.call(this, schema);
    after(this);
  });
  try {
    return await body();
  } finally {
    spy.mockRestore();
  }
}

describe('row 12 digest algorithm: missing is an error, unknown is information', () => {
  it('row 12 missing digest algorithm OID -> unreadable / cms-malformed (error)', async () => {
    const sig = await only(f.missingDigestOid);
    expectStatus(sig, 'unreadable', 'cms-malformed', 'error');
    expect(sig.integrityReason).toMatch(/digest algorithm missing/);
    expect(sig.signer).toBe('ODV Fixture Signer'); // the certificate was matched first
  });
  it('row 12 present but unknown digest algorithm OID -> not checked / algorithm-unsupported', async () => {
    const sig = await only(f.unknownDigest);
    expectStatus(sig, 'not-checked-in-viewer', 'algorithm-unsupported', 'ok', 'warning');
    expect(sig.integrityReason).toMatch(/digest algorithm not supported: 2\.16\.840\.1\.101\.3\.4\.2\.8/);
  });
});

describe('row 17 document timestamp TSTInfo', () => {
  it.each([
    ['TSTInfo is not BER', 'timestampTstNotBer', /document timestamp not parseable/],
    ['TSTInfo does not match the schema', 'timestampTstWrongSchema', /document timestamp not parseable/],
    ['imprint hashedMessage empty', 'timestampEmptyImprint', /messageImprint incomplete/],
    ['imprint algorithm OID empty', 'timestampEmptyImprintOid', /messageImprint incomplete/],
  ])('row 17 %s -> unreadable / cms-malformed (error)', async (_case, name, reason) => {
    const sig = await only(f[name]);
    expect(sig.kind).toBe('timestamp');
    expectStatus(sig, 'unreadable', 'cms-malformed', 'error');
    expect(sig.integrityReason).toMatch(reason);
    expect(sig.signingTimeSource).not.toBe('timestamp');
  });
  it('row 17 unknown imprint algorithm OID -> not checked / algorithm-unsupported', async () => {
    const sig = await only(f.timestampUnknownImprint);
    expectStatus(sig, 'not-checked-in-viewer', 'algorithm-unsupported', 'ok', 'warning');
    expect(sig.integrityReason).toMatch(/imprint algorithm not supported/);
  });
  it('row 17 crypto.subtle missing at the imprint check -> not checked / viewer-error', async () => {
    // Mock: crypto.subtle disappears once the CMS signature has verified, so only the imprint digest lacks it.
    const real = globalThis.crypto.subtle;
    let gone = false;
    const subtle = {
      digest: (...args) => real.digest(...args),
      importKey: (...args) => real.importKey(...args),
      verify: async (...args) => {
        const ok = await real.verify(...args);
        gone = true;
        return ok;
      },
    };
    vi.stubGlobal('crypto', { get subtle() { return gone ? undefined : subtle; } });
    try {
      const sig = await only(f.normal['doc-timestamp-rfc3161.pdf']);
      expect(gone).toBe(true);
      expectStatus(sig, 'not-checked-in-viewer', 'viewer-error', 'ok', 'warning');
      expect(sig.integrityReason).toMatch(/crypto\.subtle/);
      expect(sig.signingTimeSource).not.toBe('timestamp');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('rows 21 and 22 signer info', () => {
  it('row 21 signedAttrs without an encoded signature input -> indeterminate / unexpected-error (mock)', async () => {
    // Mock: pkijs always records encodedValue when it parses signed attributes, so drop it after parsing.
    const sig = await withParsed(pkijs.SignedAndUnsignedAttributes, (attrs) => {
      if (attrs.type === 0) attrs.encodedValue = new ArrayBuffer(0);
    }, () => only(f.normal['valid-rsa.pdf']));
    expectStatus(sig, 'indeterminate', 'unexpected-error', 'warning');
    expect(sig.integrityReason).toMatch(/no encoded signature input/);
  });
  it('row 22 signer info without a signature value -> unreadable / cms-malformed (error)', async () => {
    const sig = await only(f.missingSignatureValue);
    expectStatus(sig, 'unreadable', 'cms-malformed', 'error');
    expect(sig.integrityReason).toMatch(/no signature value/);
  });
});

describe('row 24 ECDSA: malformed value is an error, unsupported curve is information', () => {
  it.each(['ecdsaTruncatedDer', 'ecdsaNotSequence'])('row 24 malformed ECDSA signature value (%s) -> unreadable / cms-malformed (error)', async (name) => {
    const sig = await only(f[name]);
    expectStatus(sig, 'unreadable', 'cms-malformed', 'error');
    expect(sig.integrityReason).toMatch(/not a valid ECDSA DER signature/);
  });
  it('row 24 ECDSA INTEGER longer than the curve size -> unreadable / cms-malformed (error)', async () => {
    const sig = await only(f.ecdsaOversizedInteger);
    expectStatus(sig, 'unreadable', 'cms-malformed', 'error');
    expect(sig.integrityReason).toMatch(/not a valid ECDSA DER signature/);
  });
  it('row 24 unsupported curve stays not checked / algorithm-unsupported', async () => {
    const sig = await only(f.unknownCurve);
    expectStatus(sig, 'not-checked-in-viewer', 'algorithm-unsupported', 'ok', 'warning');
  });
});

describe('row 33 signature discovery throwing', () => {
  it('row 33 discovery beyond 100,000 objects -> not checked / inspection-limit, never "unsigned"', async () => {
    const sig = await only(f.discoveryLimit);
    expectStatus(sig, 'not-checked-in-viewer', 'inspection-limit', 'ok', 'warning');
    expect(sig.integrityReason).toMatch(/cannot be discovered: PDF object inspection limit exceeded/);
  });
  it('row 33 any other discovery error -> indeterminate / unexpected-error, never "unsigned"', async () => {
    const sig = await only(f.discoveryError);
    expectStatus(sig, 'indeterminate', 'unexpected-error', 'warning');
    expect(sig.integrityReason).toMatch(/cannot be discovered/);
  });
});

describe('row 35 dictionaryInfo throwing for one signature', () => {
  it('row 35 unreadable signature dictionary -> indeterminate / unexpected-error', async () => {
    const sig = await only(f.dictionaryError);
    expectStatus(sig, 'indeterminate', 'unexpected-error', 'warning');
    expect(sig.integrityReason).toMatch(/Signature dictionary cannot be inspected/);
    expect(sig.fieldName).toBe('Boundary');
  });
});

describe('signing-time edge cases', () => {
  it('certificate validity dates unreadable -> not-checked / certificate-dates-unreadable (mock)', async () => {
    // Mock: asn1js rolls an impossible date over or rejects the certificate, so drop notBefore after parsing.
    const sig = await withParsed(pkijs.Certificate, (cert) => { cert.notBefore = undefined; },
      () => only(f.normal['valid-rsa.pdf']));
    expectStatus(sig, 'intact', null, 'ok');
    expect(sig.notBefore).toBeNull();
    expect([sig.signingTimeCheck, sig.signingTimeCode]).toEqual(['not-checked', 'certificate-dates-unreadable']);
  });
  // Pinned current behaviour: the first signingTime attribute (and its first value) is selected.
  it.each([
    ['two attributes, inside window first', 'signingTimeFirstOfTwo', '2026-03-05T12:30:00.000Z', 'within-validity', null, 'ok'],
    ['two attributes, outside window first', 'signingTimeOutsideFirst', '2031-01-01T00:00:00.000Z', 'outside-validity', 'signed-after-certificate-expired', 'warning'],
    ['one attribute with two values', 'signingTimeTwoValues', '2031-01-01T00:00:00.000Z', 'outside-validity', 'signed-after-certificate-expired', 'warning'],
  ])('several signing-time values (%s): the first is used', async (_case, name, time, check, code, severity) => {
    const sig = await only(f[name]);
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', null]);
    expect([sig.signingTime, sig.signingTimeSource]).toEqual([time, 'signed-attribute']);
    expect([sig.signingTimeCheck, sig.signingTimeCode]).toEqual([check, code]);
    expect(getSignatureSeverity(sig)).toBe(severity);
    expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe(severity);
  });
  it.each(['signingTimeNotATime', 'signingTimeNoValue'])('malformed signing-time attribute (%s) falls back to /M', async (name) => {
    const sig = await only(f[name]);
    expect([sig.integrity, sig.integrityCode]).toEqual(['intact', null]);
    expect([sig.signingTime, sig.signingTimeSource]).toEqual(['2026-03-05T12:30:00.000Z', 'pdf-M']);
    expect([sig.signingTimeCheck, sig.signingTimeCode]).toEqual(['within-validity', null]);
    expect(getSignatureSeverity(sig, { uncheckedSeverity: 'warning' })).toBe('ok');
  });
  it('a signing-time attribute holding a digit string instead of a time is read as that time', async () => {
    const sig = await only(f.signingTimeDigitString);
    expect([sig.signingTime, sig.signingTimeSource]).toEqual(['2031-01-01T00:00:00.000Z', 'signed-attribute']);
    expect([sig.signingTimeCheck, sig.signingTimeCode]).toEqual(['outside-validity', 'signed-after-certificate-expired']);
    expect(getSignatureSeverity(sig)).toBe('warning');
  });
});
