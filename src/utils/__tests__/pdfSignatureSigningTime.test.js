/**
 * Signing-time source priority, RFC 3161 signature timestamps and certificate
 * validity-window checks. All PDFs and certificates are synthetic and generated
 * in memory; no real document or identity material is committed.
 *
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFixturePki,
  createSigningTimeFixtures,
  FIXTURE_SIGNING_TIME,
  SIGNING_TIME_FIXTURE_TIMES,
} from '../../../scripts/generate-signature-fixtures.mjs';
import { collectPdfSignatures } from '../pdfSignatures.js';
import { getSignatureSeverity } from '../pdfSignatureStatus.js';

let fixtures;

beforeAll(async () => {
  fixtures = await createSigningTimeFixtures(await createFixturePki());
}, 120000);

async function one(name) {
  const report = await collectPdfSignatures(fixtures[name]);
  expect(report.signatures).toHaveLength(1);
  return report.signatures[0];
}

describe('signing time against the certificate validity window', () => {
  it.each([
    ['signing-before-certificate.pdf', 'signed-before-certificate-valid'],
    ['signing-after-certificate.pdf', 'signed-after-certificate-expired'],
  ])('%s is a warning with %s', async (name, code) => {
    const sig = await one(name);
    expect(sig.integrity).toBe('intact');
    expect(sig.signingTimeCheck).toBe('outside-validity');
    expect(sig.signingTimeCode).toBe(code);
    expect(sig.signingTimeSource).toBe('signed-attribute');
    expect(getSignatureSeverity(sig)).toBe('warning');
  });

  it('a signing time inside the certificate window is ok', async () => {
    const sig = await one('signing-within-certificate.pdf');
    expect(sig.signingTimeCheck).toBe('within-validity');
    expect(sig.signingTimeCode).toBeNull();
    expect(getSignatureSeverity(sig)).toBe('ok');
  });

  it('a certificate that expired years AFTER signing stays green with a clock well past notAfter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
    try {
      const sig = await one('certificate-expired-after-signing.pdf');
      expect(Date.now()).toBeGreaterThan(Date.parse(sig.notAfter) + 14 * 365 * 24 * 60 * 60 * 1000);
      expect(sig.signingTime).toBe(SIGNING_TIME_FIXTURE_TIMES.expiredSigning.toISOString());
      expect(sig.signingTimeCheck).toBe('within-validity');
      expect(sig.signingTimeCode).toBeNull();
      expect(getSignatureSeverity(sig)).toBe('ok');
      expect(sig.integrity).toBe('intact');
    } finally {
      vi.useRealTimers();
    }
  });

  it('no signing time anywhere is green and not checked with signing-time-unknown', async () => {
    const sig = await one('no-signing-time.pdf');
    expect(sig.signingTime).toBeNull();
    expect(sig.signingTimeSource).toBe('none');
    expect(sig.signingTimeCheck).toBe('not-checked');
    expect(sig.signingTimeCode).toBe('signing-time-unknown');
    expect(getSignatureSeverity(sig)).toBe('ok');
  });
});

describe('embedded RFC 3161 signature timestamps', () => {
  it('a valid timestamp wins over signingTime and /M and stays within validity', async () => {
    const sig = await one('valid-signature-timestamp.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.signatureTimestampCheck).toBe('verified');
    expect(sig.signingTimeSource).toBe('timestamp');
    expect(sig.signingTime).toBe(SIGNING_TIME_FIXTURE_TIMES.timestamp.toISOString());
    expect(sig.signingTime).not.toBe(FIXTURE_SIGNING_TIME.toISOString());
    expect(sig.signingTimeCheck).toBe('within-validity');
    expect(getSignatureSeverity(sig)).toBe('ok');
  });

  it('verified genTime, not the fallback signingTime, drives the window check', async () => {
    const sig = await one('signature-timestamp-controls-window.pdf');
    expect(sig.signatureTimestampCheck).toBe('verified');
    expect(sig.signingTimeSource).toBe('timestamp');
    expect(sig.signingTime).toBe(SIGNING_TIME_FIXTURE_TIMES.after.toISOString());
    expect(sig.signingTimeCheck).toBe('outside-validity');
    expect(sig.signingTimeCode).toBe('signed-after-certificate-expired');
    expect(getSignatureSeverity(sig)).toBe('warning');
  });

  it.each([
    ['signature-timestamp-wrong-imprint.pdf', 'wrong imprint'],
    ['signature-timestamp-bad-authority.pdf', 'bad authority signature'],
  ])('%s (%s) is timestamp-invalid and falls back to the signed attribute', async (name) => {
    const sig = await one(name);
    expect(sig.integrity).toBe('intact');
    expect(sig.signatureTimestampCheck).toBe('invalid');
    expect(sig.signingTimeCheck).toBe('timestamp-invalid');
    expect(sig.signingTimeCode).toBe('timestamp-invalid');
    expect(sig.signingTimeSource).toBe('signed-attribute');
    expect(sig.signingTime).toBe(FIXTURE_SIGNING_TIME.toISOString());
    expect(getSignatureSeverity(sig)).toBe('warning');
  });

  it('an unsupported timestamp algorithm is ignored as green information, never a warning', async () => {
    const sig = await one('signature-timestamp-unsupported.pdf');
    expect(sig.integrity).toBe('intact');
    expect(sig.signatureTimestampCheck).toBe('not-checked');
    expect(sig.signingTimeSource).toBe('signed-attribute');
    expect(sig.signingTimeCheck).toBe('within-validity');
    expect(getSignatureSeverity(sig)).toBe('ok');
  });

  it('a DocTimeStamp with /M and a different signingTime always prefers verified genTime', async () => {
    const sig = await one('document-timestamp-gen-time-priority.pdf');
    expect(sig.kind).toBe('timestamp');
    expect(sig.integrity).toBe('intact');
    expect(sig.signingTimeSource).toBe('timestamp');
    expect(sig.signingTime).toBe(SIGNING_TIME_FIXTURE_TIMES.timestamp.toISOString());
    expect(sig.signingTime).not.toBe(FIXTURE_SIGNING_TIME.toISOString());
    expect(sig.signingTimeCheck).toBe('within-validity');
  });

  it('timestamp source is impossible without verification for every approval fixture', async () => {
    for (const name of Object.keys(fixtures)) {
      const sig = await one(name);
      if (sig.kind !== 'timestamp' && sig.signatureTimestampCheck !== 'verified') {
        expect(sig.signingTimeSource, name).not.toBe('timestamp');
      }
    }
  });
});
