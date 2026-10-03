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
