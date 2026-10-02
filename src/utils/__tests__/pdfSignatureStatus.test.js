// File: src/utils/__tests__/pdfSignatureStatus.test.js
/**
 * Level-1 signature UI status helpers: worst-integrity rule and severity
 * (colour) mapping used by the thumbnail/toolbar badge and the details dialog.
 */

import { describe, it, expect } from 'vitest';
import {
  getSignatureSeverity,
  getWorstSignatureIntegrity,
  getSignatureCount,
  reportHasSignatures,
} from '../pdfSignatureStatus.js';

function sig(integrity) {
  return { integrity };
}

describe('getSignatureSeverity', () => {
  it('maps intact to ok', () => {
    expect(getSignatureSeverity('intact')).toBe('ok');
  });

  it('maps modified-after-signing and unsupported to warning', () => {
    expect(getSignatureSeverity('modified-after-signing')).toBe('warning');
    expect(getSignatureSeverity('unsupported')).toBe('warning');
  });

  it('maps digest-mismatch, signature-invalid and unreadable to error', () => {
    expect(getSignatureSeverity('digest-mismatch')).toBe('error');
    expect(getSignatureSeverity('signature-invalid')).toBe('error');
    expect(getSignatureSeverity('unreadable')).toBe('error');
  });

  it('maps unknown values to error (fail safe)', () => {
    expect(getSignatureSeverity('something-else')).toBe('error');
    expect(getSignatureSeverity(null)).toBe('error');
    expect(getSignatureSeverity(undefined)).toBe('error');
  });
});

describe('getWorstSignatureIntegrity', () => {
  it.each(['future-status', undefined, null, '', 'toString', 'constructor', 42, {}])('F3 fails safe for mixed known and unexpected integrity %s', (value) => {
    for (const known of ['intact', 'unsupported', 'signature-invalid']) {
      expect(getWorstSignatureIntegrity([sig(known), sig(value)])).toBe('unreadable');
      expect(getWorstSignatureIntegrity([sig(value), sig(known)])).toBe('unreadable');
    }
    expect(getSignatureSeverity(value)).toBe('error');
  });

  it('returns null for empty or invalid input', () => {
    expect(getWorstSignatureIntegrity([])).toBe(null);
    expect(getWorstSignatureIntegrity(null)).toBe(null);
    expect(getWorstSignatureIntegrity(undefined)).toBe(null);
  });

  it('returns the only status for a single signature', () => {
    expect(getWorstSignatureIntegrity([sig('intact')])).toBe('intact');
    expect(getWorstSignatureIntegrity([sig('unsupported')])).toBe('unsupported');
  });

  it('any error status beats warning and ok statuses', () => {
    expect(getWorstSignatureIntegrity([sig('intact'), sig('unsupported'), sig('digest-mismatch')])).toBe('digest-mismatch');
    expect(getWorstSignatureIntegrity([sig('intact'), sig('signature-invalid')])).toBe('signature-invalid');
    expect(getWorstSignatureIntegrity([sig('modified-after-signing'), sig('unreadable')])).toBe('unreadable');
  });

  it('any warning status beats intact', () => {
    expect(getWorstSignatureIntegrity([sig('intact'), sig('modified-after-signing')])).toBe('modified-after-signing');
    expect(getWorstSignatureIntegrity([sig('intact'), sig('unsupported')])).toBe('unsupported');
  });

  it('modified-after-signing beats unsupported within warning', () => {
    expect(getWorstSignatureIntegrity([sig('unsupported'), sig('modified-after-signing')])).toBe('modified-after-signing');
  });

  it('all intact stays intact', () => {
    expect(getWorstSignatureIntegrity([sig('intact'), sig('intact')])).toBe('intact');
  });
});

describe('getSignatureCount / reportHasSignatures', () => {
  it('counts signatures and tolerates malformed reports', () => {
    expect(getSignatureCount(null)).toBe(0);
    expect(getSignatureCount({})).toBe(0);
    expect(getSignatureCount({ signatures: [] })).toBe(0);
    expect(getSignatureCount({ signatures: [sig('intact'), sig('intact')] })).toBe(2);
  });

  it('reports whether a report has at least one signature', () => {
    expect(reportHasSignatures(null)).toBe(false);
    expect(reportHasSignatures({ signatures: [] })).toBe(false);
    expect(reportHasSignatures({ signatures: [sig('intact')] })).toBe(true);
  });
});
