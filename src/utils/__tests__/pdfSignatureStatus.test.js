// File: src/utils/__tests__/pdfSignatureStatus.test.js
/**
 * Signature UI status helpers: the status model (integrity -> severity), the
 * fail-closed `uncheckedSeverity` switch, the signing-time dimension, the
 * worst-integrity rule, and the closed integrity-code / signing-time-code sets
 * with their locale completeness (en + sv).
 */

import { describe, it, expect } from 'vitest';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';
import {
  INTEGRITY_CODES,
  SIGNING_TIME_CODES,
  getIntegrityCodeText,
  getIntegrityLabel,
  getReportSignatureSeverity,
  getSignatureSeverity,
  getSigningTimeCheckLabel,
  getSigningTimeWarningSignature,
  getWorstSignatureIntegrity,
  getSignatureCount,
  normalizeSignatureIntegrity,
  normalizeSigningTimeCheck,
  normalizeUncheckedSeverity,
  reportHasSignatures,
} from '../pdfSignatureStatus.js';

function sig(integrity, extra = {}) {
  return { integrity, ...extra };
}

/** Minimal i18next-like t(): resolves dotted keys in a locale file, else the default value. */
function tFor(locale) {
  return (key, options = {}) => {
    const value = key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), locale);
    return typeof value === 'string' ? value : options.defaultValue;
  };
}

const UNKNOWN_VALUES = ['future-status', undefined, null, '', 'toString', 'constructor', '__proto__', 42, {}];
const ERROR_STATES = ['digest-mismatch', 'signature-invalid', 'unreadable'];
const WARNING_STATES = ['indeterminate', 'modified-after-signing'];

describe('getSignatureSeverity (status model)', () => {
  it('maps intact to ok', () => {
    expect(getSignatureSeverity(sig('intact'))).toBe('ok');
  });

  it('maps not-checked-in-viewer to ok by default and the legacy unsupported alias the same way', () => {
    expect(getSignatureSeverity(sig('not-checked-in-viewer'))).toBe('ok');
    expect(getSignatureSeverity(sig('unsupported'))).toBe('ok');
    expect(normalizeSignatureIntegrity('unsupported')).toBe('not-checked-in-viewer');
  });

  it.each(WARNING_STATES)('maps %s to warning', (integrity) => {
    expect(getSignatureSeverity(sig(integrity))).toBe('warning');
  });

  it.each(ERROR_STATES)('maps %s to error', (integrity) => {
    expect(getSignatureSeverity(sig(integrity))).toBe('error');
  });

  it.each(UNKNOWN_VALUES)('fail-closed: unknown integrity %s is an error', (value) => {
    expect(normalizeSignatureIntegrity(value)).toBe('unreadable');
    expect(getSignatureSeverity(sig(value))).toBe('error');
  });

  it('fail-closed: a missing signature object or a bare string is an error', () => {
    expect(getSignatureSeverity(undefined)).toBe('error');
    expect(getSignatureSeverity(null)).toBe('error');
    expect(getSignatureSeverity('intact')).toBe('error');
  });
});

describe('uncheckedSeverity switch', () => {
  it('normalizes only exactly "warning" to warning', () => {
    expect(normalizeUncheckedSeverity('warning')).toBe('warning');
    for (const value of ['ok', 'Warning', ' warning', 'error', 'warn', '', null, undefined, 1, {}]) {
      expect(normalizeUncheckedSeverity(value)).toBe('ok');
    }
  });

  it('raises not-checked-in-viewer (and the legacy alias) to warning', () => {
    expect(getSignatureSeverity(sig('not-checked-in-viewer'), { uncheckedSeverity: 'warning' })).toBe('warning');
    expect(getSignatureSeverity(sig('unsupported'), { uncheckedSeverity: 'warning' })).toBe('warning');
    expect(getSignatureSeverity(sig('not-checked-in-viewer'), { uncheckedSeverity: 'ok' })).toBe('ok');
    expect(getSignatureSeverity(sig('not-checked-in-viewer'), { uncheckedSeverity: 'error' })).toBe('ok');
  });

  it('fail-closed: never changes intact, warning or error states', () => {
    for (const uncheckedSeverity of ['ok', 'warning', 'bogus', undefined]) {
      expect(getSignatureSeverity(sig('intact'), { uncheckedSeverity })).toBe('ok');
      for (const integrity of WARNING_STATES) {
        expect(getSignatureSeverity(sig(integrity), { uncheckedSeverity })).toBe('warning');
      }
      for (const integrity of ERROR_STATES) {
        expect(getSignatureSeverity(sig(integrity), { uncheckedSeverity })).toBe('error');
      }
    }
  });

  it.each(UNKNOWN_VALUES)('fail-closed: the switch never affects unknown integrity %s', (value) => {
    for (const uncheckedSeverity of ['ok', 'warning']) {
      expect(getSignatureSeverity(sig(value), { uncheckedSeverity })).toBe('error');
    }
  });

  it('getReportSignatureSeverity passes the option through', () => {
    const signatures = [sig('intact'), sig('not-checked-in-viewer')];
    expect(getReportSignatureSeverity(signatures)).toBe('ok');
    expect(getReportSignatureSeverity(signatures, { uncheckedSeverity: 'warning' })).toBe('warning');
    expect(getReportSignatureSeverity([...signatures, sig('digest-mismatch')], { uncheckedSeverity: 'warning' })).toBe('error');
    expect(getReportSignatureSeverity([sig('intact'), sig(undefined)], { uncheckedSeverity: 'ok' })).toBe('error');
  });
});

describe('signing-time dimension', () => {
  it('normalizes missing values to not-checked and unknown strings to outside-validity', () => {
    expect(normalizeSigningTimeCheck(undefined)).toBe('not-checked');
    expect(normalizeSigningTimeCheck(null)).toBe('not-checked');
    expect(normalizeSigningTimeCheck('within-validity')).toBe('within-validity');
    expect(normalizeSigningTimeCheck('future-check')).toBe('outside-validity');
    expect(normalizeSigningTimeCheck('constructor')).toBe('outside-validity');
    expect(normalizeSigningTimeCheck(7)).toBe('outside-validity');
  });

  it('signatures without the fields behave exactly as before (no new warning)', () => {
    expect(getSignatureSeverity({ integrity: 'intact' })).toBe('ok');
    expect(getSignatureSeverity({ integrity: 'intact', signingTimeCheck: null })).toBe('ok');
  });

  it.each([
    ['within-validity', 'ok'],
    ['not-checked', 'ok'],
    ['outside-validity', 'warning'],
    ['timestamp-invalid', 'warning'],
    ['unknown-check', 'warning'],
  ])('%s on an intact signature is %s', (signingTimeCheck, severity) => {
    expect(getSignatureSeverity(sig('intact', { signingTimeCheck }))).toBe(severity);
  });

  it('takes the worse of integrity and signing time, and never lowers an error', () => {
    expect(getSignatureSeverity(sig('digest-mismatch', { signingTimeCheck: 'within-validity' }))).toBe('error');
    expect(getSignatureSeverity(sig('not-checked-in-viewer', { signingTimeCheck: 'outside-validity' }))).toBe('warning');
  });

  it('labels the check, refined by a known code, and returns null without a check', () => {
    const t = tFor(en);
    expect(getSigningTimeCheckLabel(t, undefined)).toBeNull();
    expect(getSigningTimeCheckLabel(t, null, 'signed-before-certificate-valid')).toBeNull();
    expect(getSigningTimeCheckLabel(t, 'within-validity')).toBe('Signed while the certificate was valid');
    expect(getSigningTimeCheckLabel(t, 'outside-validity', 'signed-after-certificate-expired'))
      .toBe('Signed after the certificate had expired');
    expect(getSigningTimeCheckLabel(t, 'outside-validity', 'not-a-code')).toBe("Signed outside the certificate's validity period");
    expect(getSigningTimeCheckLabel(tFor(sv), 'not-checked', 'signing-time-unknown'))
      .toBe('Ingen signeringstid finns, så den kontrollerades inte mot certifikatets giltighetstid');
  });

  it('finds the first signature whose signing-time check is a warning', () => {
    const warn = sig('intact', { signingTimeCheck: 'outside-validity' });
    expect(getSigningTimeWarningSignature([sig('intact'), warn])).toBe(warn);
    expect(getSigningTimeWarningSignature([sig('intact', { signingTimeCheck: 'not-checked' })])).toBeNull();
    expect(getSigningTimeWarningSignature(null)).toBeNull();
  });
});

describe('getWorstSignatureIntegrity', () => {
  it.each(['future-status', undefined, null, '', 'toString', 'constructor', 42, {}])('F3 fails safe for mixed known and unexpected integrity %s', (value) => {
    for (const known of ['intact', 'not-checked-in-viewer', 'unsupported', 'signature-invalid']) {
      expect(getWorstSignatureIntegrity([sig(known), sig(value)])).toBe('unreadable');
      expect(getWorstSignatureIntegrity([sig(value), sig(known)])).toBe('unreadable');
    }
    expect(getSignatureSeverity(sig(value))).toBe('error');
  });

  it('returns null for empty or invalid input', () => {
    expect(getWorstSignatureIntegrity([])).toBe(null);
    expect(getWorstSignatureIntegrity(null)).toBe(null);
    expect(getWorstSignatureIntegrity(undefined)).toBe(null);
  });

  it('returns the only status for a single signature (legacy alias normalized)', () => {
    expect(getWorstSignatureIntegrity([sig('intact')])).toBe('intact');
    expect(getWorstSignatureIntegrity([sig('unsupported')])).toBe('not-checked-in-viewer');
  });

  it('any error status beats warning and ok statuses', () => {
    expect(getWorstSignatureIntegrity([sig('intact'), sig('not-checked-in-viewer'), sig('digest-mismatch')])).toBe('digest-mismatch');
    expect(getWorstSignatureIntegrity([sig('intact'), sig('signature-invalid')])).toBe('signature-invalid');
    expect(getWorstSignatureIntegrity([sig('modified-after-signing'), sig('unreadable')])).toBe('unreadable');
  });

  it('warning statuses beat not-checked, and modified-after-signing beats indeterminate', () => {
    expect(getWorstSignatureIntegrity([sig('not-checked-in-viewer'), sig('indeterminate')])).toBe('indeterminate');
    expect(getWorstSignatureIntegrity([sig('indeterminate'), sig('modified-after-signing')])).toBe('modified-after-signing');
  });

  it('NC outranks intact so the label says "Not checked in the viewer" while the colour stays green', () => {
    const signatures = [sig('intact'), sig('not-checked-in-viewer')];
    expect(getWorstSignatureIntegrity(signatures)).toBe('not-checked-in-viewer');
    expect(getWorstSignatureIntegrity([...signatures].reverse())).toBe('not-checked-in-viewer');
    expect(getReportSignatureSeverity(signatures)).toBe('ok');
    expect(getIntegrityLabel(tFor(en), getWorstSignatureIntegrity(signatures))).toBe('Not checked in the viewer');
  });

  it('all intact stays intact', () => {
    expect(getWorstSignatureIntegrity([sig('intact'), sig('intact')])).toBe('intact');
  });
});

describe('labels and integrity codes', () => {
  it.each([['en', en], ['sv', sv]])('%s: every integrity status has a label and unknown values read as damaged', (_lang, locale) => {
    const t = tFor(locale);
    for (const integrity of ['intact', 'not-checked-in-viewer', 'indeterminate', 'modified-after-signing',
      'digest-mismatch', 'signature-invalid', 'unreadable']) {
      const key = getIntegrityLabel((k) => k, integrity);
      expect(typeof t(key)).toBe('string');
    }
    expect(getIntegrityLabel(t, 'future-status')).toBe(getIntegrityLabel(t, 'unreadable'));
    expect(getIntegrityLabel(t, 'unsupported')).toBe(getIntegrityLabel(t, 'not-checked-in-viewer'));
  });

  it('the code set is closed, kebab-case and has 22 entries', () => {
    expect(INTEGRITY_CODES).toHaveLength(22);
    expect(Object.isFrozen(INTEGRITY_CODES)).toBe(true);
    for (const code of INTEGRITY_CODES) expect(code).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/);
  });

  it.each([['en', en], ['sv', sv]])('%s: every integrity code and signing-time code has a non-empty localized text', (_lang, locale) => {
    const integrityTexts = locale.signatures.integrityCode;
    expect(Object.keys(integrityTexts).sort()).toEqual([...INTEGRITY_CODES].sort());
    for (const code of INTEGRITY_CODES) {
      expect(getIntegrityCodeText(tFor(locale), code)).toBe(integrityTexts[code]);
      expect(integrityTexts[code].trim().length).toBeGreaterThan(10);
    }
    expect(Object.keys(locale.signatures.signingTimeCode).sort()).toEqual([...SIGNING_TIME_CODES].sort());
    for (const key of ['withinValidity', 'outsideValidity', 'timestampInvalid', 'notChecked']) {
      expect(locale.signatures.signingTimeCheck[key].trim()).not.toBe('');
    }
  });

  it('English and Swedish code texts differ (both are really translated)', () => {
    for (const code of INTEGRITY_CODES) {
      expect(sv.signatures.integrityCode[code]).not.toBe(en.signatures.integrityCode[code]);
    }
  });

  it.each([undefined, null, '', 'future-code', 'toString', 'constructor', 42, {}])('unknown code %s has no text', (code) => {
    expect(getIntegrityCodeText(tFor(en), code)).toBeNull();
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
