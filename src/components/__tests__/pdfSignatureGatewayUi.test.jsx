// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../../public/locales/en/common.json';
import sv from '../../../public/locales/sv/common.json';
import SignatureDetailsDialog from '../SignatureDetailsDialog.jsx';
import SignatureStatusBadge from '../SignatureStatusBadge.jsx';
import { mergeGatewaySignatureReport } from '../../utils/pdfSignatureGateway.js';

let root, container, i18n;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { common: en }, sv: { common: sv } } });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });
async function render(component, signatures) {
  await act(async () => { root.render(createElement(I18nextProvider, { i18n }, createElement(component, {
    report: { signatures }, isOpen: true, onClose: () => {}, onOpen: () => {},
  }))); });
}
it.each([['invalid', 'error'], ['unknown', 'warning'], ['valid', 'ok']])('G8 badge accounts for %s trust', async (trust, severity) => {
  await render(SignatureStatusBadge, [{ integrity: 'intact', trust }]);
  expect(container.querySelector('button').className).toContain(`--${severity}`);
  await render(SignatureStatusBadge, [{ integrity: 'digest-mismatch', trust }]);
  expect(container.querySelector('button').className).toContain('--error');
});
it.each([
  ['en', 'Invalid signature', 'Signature trust unknown'],
  ['sv', 'Ogiltig signatur', 'Signaturens tillit är okänd'],
])('G19 tooltip explains invalid and unknown trust in %s', async (language, invalid, unknown) => {
  await i18n.changeLanguage(language);
  for (const [trust, label] of [['invalid', invalid], ['unknown', unknown]]) {
    await render(SignatureStatusBadge, [{ integrity: 'intact', trust }]);
    expect(container.querySelector('button').title).toContain(label);
  }
  await render(SignatureStatusBadge, [
    { integrity: 'intact', trust: 'unknown' }, { integrity: 'intact', trust: 'invalid' },
  ]);
  expect(container.querySelector('button').title).toContain(invalid);
});

it.each([['en', 'Server validation unavailable'], ['sv', 'Servervalidering är inte tillgänglig']])(
  'G20 only client failures use the localized unavailable label in %s', async (language, unavailable) => {
    await i18n.changeLanguage(language);
    const browser = { signatures: [{ fieldName: 'Approval', integrity: 'intact', trust: 'not-checked' }] };
    const failure = mergeGatewaySignatureReport(browser, null);
    expect(failure.signatures[0].serverValidationUnavailable).toBe(true);
    await render(SignatureDetailsDialog, failure.signatures);
    expect(container.textContent).toContain(unavailable);
    const server = { signatures: [{ ...browser.signatures[0], trust: 'unknown',
      trustReason: 'server validation unavailable', serverValidationUnavailable: true,
      validationTime: '2026-10-01T12:00:00Z' }] };
    // A later successful response also clears any earlier client failure marker.
    const result = mergeGatewaySignatureReport(failure, server);
    expect(result.signatures[0].serverValidationUnavailable).toBe(false);
    await render(SignatureDetailsDialog, result.signatures);
    expect(container.textContent).toContain('server validation unavailable');
    expect(container.textContent).not.toContain(unavailable);
  });
it.each([['en', ['Valid', 'Invalid', 'Unknown'], 'Trust not checked', 'Validation time', 'Verified timestamp'],
  ['sv', ['Giltig', 'Ogiltig', 'Okänd'], 'Tillit ej kontrollerad', 'Valideringstid', 'Verifierad tidsstämpel']])(
  'G9 localized dialog in %s shows per-signature trust, timestamp and validation time', async (language, labels, unchecked, timeLabel, timestampLabel) => {
    await i18n.changeLanguage(language);
    for (const [index, trust] of ['valid', 'invalid', 'unknown'].entries()) {
      const signature = { integrity: 'intact', trust, trustReason: 'Certificate chain verified',
        validationTime: '2026-10-01T12:00:00Z', signingTimeSource: 'timestamp', signingTime: '2026-09-01T12:00:00Z' };
      await render(SignatureDetailsDialog, [signature]);
      expect(container.textContent).toContain(labels[index]);
      expect(container.textContent).toContain(timeLabel);
      expect(container.textContent).toContain(signature.validationTime);
      expect(container.textContent).toContain(timestampLabel);
      expect(container.textContent).toContain(signature.trustReason);
      expect(container.textContent).not.toContain(unchecked);
      await render(SignatureDetailsDialog, [signature, { integrity: 'intact', trust: 'not-checked' }]);
      const entries = container.querySelectorAll('section');
      expect(entries[0].textContent).not.toContain(unchecked);
      expect(entries[1].textContent).toContain(unchecked);
    }
  });
