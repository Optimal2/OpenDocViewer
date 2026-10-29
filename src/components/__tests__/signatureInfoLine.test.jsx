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

it.each([
  ['intact', 'ok'],
  ['modified-after-signing', 'warning'],
  ['unsupported', 'warning'],
  ['digest-mismatch', 'error'],
  ['signature-invalid', 'error'],
  ['unreadable', 'error'],
])('badge maps %s integrity to %s', async (integrity, severity) => {
  await render(SignatureStatusBadge, [{ integrity }]);
  expect(container.querySelector('button').className).toContain(`--${severity}`);
});

it('badge never hides an integrity failure', async () => {
  await render(SignatureStatusBadge, [{ integrity: 'intact' }, { integrity: 'digest-mismatch' }]);
  expect(container.querySelector('button').className).toContain('--error');
});

it.each(['en', 'sv'])('dialog shows the localized information line for every signature in %s', async (language) => {
  await i18n.changeLanguage(language);
  const resources = language === 'sv' ? sv : en;
  await render(SignatureDetailsDialog, [{ integrity: 'intact' }, { integrity: 'digest-mismatch' }]);
  const entries = container.querySelectorAll('.odv-signature-entry');
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    const note = entry.querySelector('.odv-signature-info[role="note"]');
    expect(note.textContent).toBe(resources.signatures.notCheckedInViewer);
    expect(note.className).not.toMatch(/warning|error/);
  }
});
