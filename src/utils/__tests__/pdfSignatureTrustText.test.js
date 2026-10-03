// File: src/utils/__tests__/pdfSignatureTrustText.test.js
/**
 * Plain-language trust explanations for the signature details dialog
 * (docs-src/pdf-signatures.md, "Trust explanation"): one state per situation
 * (no gateway, validation disabled, gateway failure, valid, invalid, unknown) and one
 * translated reason per ODVGateway trustReason code, in English and Swedish.
 *
 * GATEWAY_REASON_CODES mirrors ODVGateway's SignatureValidationReasons constants. When the
 * gateway adds a code, add it here: the test then fails until the code has a translation in
 * the mapping and in both locale files, so a new code cannot reach users untranslated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TRUST_REASON_CODES,
  getSignatureTrustState,
  getTrustExplanation,
  getTrustReasonText,
} from '../pdfSignatureStatus.js';

const GATEWAY_REASON_CODES = [
  'byte-range-malformed',
  'byte-range-missing',
  'contents-missing',
  'contents-too-large',
  'subfilter-unsupported',
  'cms-unreadable',
  'digest-algorithm-unsupported',
  'message-digest-attribute-missing',
  'digest-mismatch',
  'signature-invalid',
  'bytes-appended-after-signed-range',
  'signer-certificate-missing',
  'chain-not-anchored',
  'certificate-not-valid-at-validation-time',
  'revoked',
  'revocation-unavailable',
  'revocation-not-checked',
  'weak-signature',
  'chain-policy-violation',
  'modified-after-certification',
  'timestamp-not-verifiable',
  'timestamp-responder-not-anchored',
  'timestamp-responder-not-trusted',
  'key-usage-not-signing',
  'validation-error',
  'validation-timeout',
];

/** Fallback translator: the English default text, as in the other component tests. */
const tDefault = (key, options) => {
  const text = (options && options.defaultValue) || key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (options && name in options ? String(options[name]) : match));
};

/**
 * Translator backed by a real locale file. Missing keys return a marker instead of the default,
 * so a key absent from the locale is visible in the result.
 * @param {string} language
 */
function localeTranslator(language) {
  const resources = JSON.parse(readFileSync(new URL(`../../../public/locales/${language}/common.json`, import.meta.url), 'utf8'));
  return (key, options) => {
    const value = key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), resources);
    if (typeof value !== 'string') return `MISSING:${key}`;
    return value.replace(/\{(\w+)\}/g, (match, name) => (options && name in options ? String(options[name]) : match));
  };
}

describe('trust reason codes', () => {
  it('covers exactly the codes the gateway can emit', () => {
    expect([...TRUST_REASON_CODES].sort()).toEqual([...GATEWAY_REASON_CODES].sort());
  });

  it.each(GATEWAY_REASON_CODES)('translates %s in the mapping, English and Swedish', (code) => {
    const english = getTrustReasonText(tDefault, code);
    expect(english).toBeTruthy();
    expect(english).not.toBe(code);
    expect(english).toMatch(/ /);
    for (const language of ['en', 'sv']) {
      const text = getTrustReasonText(localeTranslator(language), code);
      expect(text, `${language} ${code}`).toBeTruthy();
      expect(text).not.toMatch(/^MISSING:/);
    }
  });

  it('uses the operator wording for the examples', () => {
    const sv = localeTranslator('sv');
    expect(getTrustReasonText(sv, 'timestamp-responder-not-trusted')).toBe('Tidsstämpelns utfärdare är inte betrodd på servern');
    expect(getTrustReasonText(sv, 'revocation-unavailable')).toBe('Spärrlistan kunde inte hämtas');
    expect(getTrustReasonText(sv, 'chain-not-anchored')).toBe('Certifikatkedjan leder inte till en betrodd rot');
  });

  it('returns null for codes it does not know, including inherited names', () => {
    for (const code of ['future-code', '', null, undefined, 'toString', '__proto__', 42]) {
      expect(getTrustReasonText(tDefault, code)).toBe(null);
    }
  });
});

describe('getSignatureTrustState', () => {
  it('separates the three unchecked situations', () => {
    expect(getSignatureTrustState({ trust: 'not-checked' })).toBe('unavailable');
    expect(getSignatureTrustState({ trust: 'not-checked', serverValidationDisabled: true })).toBe('not-checked');
    expect(getSignatureTrustState({ trust: 'not-checked', serverValidationUnavailable: true, trustReason: 'server validation unavailable' }))
      .toBe('server-error');
    expect(getSignatureTrustState({})).toBe('unavailable');
  });

  it('passes gateway verdicts through', () => {
    expect(getSignatureTrustState({ trust: 'valid' })).toBe('valid');
    expect(getSignatureTrustState({ trust: 'invalid' })).toBe('invalid');
    expect(getSignatureTrustState({ trust: 'unknown' })).toBe('unknown');
    expect(getSignatureTrustState({ trust: 'surprise' })).toBe('unavailable');
  });
});

describe('getTrustExplanation', () => {
  const sv = localeTranslator('sv');
  const en = localeTranslator('en');

  it('explains a viewer without ODVGateway', () => {
    const result = getTrustExplanation(sv, { trust: 'not-checked' });
    expect(result.state).toBe('unavailable');
    expect(result.title).toBe('Signaturens giltighet kan bara kontrolleras när dokumentet öppnas via ODVGateway. '
      + 'Här visas vem som signerat och om dokumentet är oförändrat sedan signeringen.');
    expect(result.code).toBe(null);
    expect(getTrustExplanation(en, { trust: 'not-checked' }).title).toMatch(/ODVGateway/);
  });

  it('explains disabled server validation with an administrator hint', () => {
    const result = getTrustExplanation(sv, { trust: 'not-checked', serverValidationDisabled: true });
    expect(result.state).toBe('not-checked');
    expect(result.title).toBe('Servern kontrollerar inte certifikatkedja och spärrstatus i den här installationen '
      + '(ODVGateway signatures.enabled är av). Visas: vem som signerat och om dokumentet är oförändrat.');
    expect(result.hint).toMatch(/administratör/);
    expect(getTrustExplanation(en, { trust: 'not-checked', serverValidationDisabled: true }).hint).toMatch(/administrator/);
  });

  it('explains a gateway that did not answer', () => {
    const result = getTrustExplanation(sv, { trust: 'not-checked', serverValidationUnavailable: true, trustReason: 'server validation unavailable' });
    expect(result.state).toBe('server-error');
    expect(result.title).not.toMatch(/^MISSING:/);
    expect(result.code).toBe(null);
  });

  it('explains unknown with reason, raw code and what it does not mean', () => {
    const result = getTrustExplanation(sv, { trust: 'unknown', trustReason: 'timestamp-responder-not-trusted' });
    expect(result.state).toBe('unknown');
    expect(result.title).toBe('Kunde inte avgöra om signaturen är giltig');
    expect(result.reason).toBe('Tidsstämpelns utfärdare är inte betrodd på servern');
    expect(result.notMeaning).toBeTruthy();
    expect(result.notMeaning).not.toMatch(/^MISSING:/);
    expect(result.code).toBe('timestamp-responder-not-trusted');
    expect(result.codeLine).toBe('Kod: timestamp-responder-not-trusted');
  });

  it('explains invalid with the reason in plain language', () => {
    const result = getTrustExplanation(en, { trust: 'invalid', trustReason: 'revoked' });
    expect(result.state).toBe('invalid');
    expect(result.reason).toBe('The certificate has been revoked');
    expect(result.codeLine).toBe('Code: revoked');
  });

  it('keeps valid without a reason', () => {
    const result = getTrustExplanation(sv, { trust: 'valid', trustReason: null });
    expect(result.state).toBe('valid');
    expect(result.title).not.toMatch(/^MISSING:/);
    expect(result.reason).toBe(null);
    expect(result.codeLine).toBe(null);
  });

  it('shows an unrecognised code as a generic reason plus the raw code', () => {
    const result = getTrustExplanation(tDefault, { trust: 'unknown', trustReason: 'brand-new-code' });
    expect(result.reason).toBe('Unknown reason');
    expect(result.codeLine).toBe('Code: brand-new-code');
  });

  it('renders every state in both locales without missing keys', () => {
    const cases = [
      { trust: 'not-checked' },
      { trust: 'not-checked', serverValidationDisabled: true },
      { trust: 'not-checked', serverValidationUnavailable: true },
      { trust: 'valid' },
      ...GATEWAY_REASON_CODES.flatMap((code) => [{ trust: 'invalid', trustReason: code }, { trust: 'unknown', trustReason: code }]),
    ];
    for (const t of [sv, en]) {
      for (const signature of cases) {
        const result = getTrustExplanation(t, signature);
        for (const value of [result.title, result.reason, result.notMeaning, result.hint, result.codeLine]) {
          if (value != null) expect(value).not.toMatch(/MISSING:/);
        }
      }
    }
  });
});
