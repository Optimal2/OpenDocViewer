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
  ['not-checked-in-viewer', 'ok'],
  ['unsupported', 'ok'],
  ['indeterminate', 'warning'],
  ['modified-after-signing', 'warning'],
  ['future-status', 'error'],
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

it.each(['en', 'sv'])('dialog lists what was checked and passed, then the information lines (%s)', async (language) => {
  await i18n.changeLanguage(language);
  const r = (language === 'sv' ? sv : en).signatures;
  await render(SignatureDetailsDialog, [
    { integrity: 'intact', integrityCode: 'extended-by-later-signature', signer: 'Cert Name', signerSource: 'certificate' },
    { integrity: 'not-checked-in-viewer', integrityCode: 'format-unsupported', signer: 'Self Declared', signerSource: 'pdf-name' },
    { integrity: 'not-checked-in-viewer', integrityCode: 'algorithm-unsupported', signer: 'Cert Name', signerSource: 'certificate' },
    { integrity: 'digest-mismatch', integrityCode: 'content-digest-mismatch', signer: 'Cert Name', signerSource: 'certificate' },
  ]);
  const [intact, format, algorithm, mismatch] = container.querySelectorAll('.odv-signature-entry');
  const lines = (entry) => [...entry.querySelectorAll('.odv-signature-info[role="note"] p')].map((p) => p.textContent);
  const checks = (entry) => [...entry.querySelectorAll('.odv-signature-checks li')].map((li) => li.textContent.replace(/^check/, ''));
  const signerNote = (entry) => entry.querySelector('.odv-signature-signer-note')?.textContent ?? null;

  // Checked and passed come first, then the always-on line and the code line.
  expect(intact.firstElementChild.nextElementSibling.className).toBe('odv-signature-checks');
  expect(checks(intact)).toEqual([r.checks.contentUnchanged, r.checks.signatureMatches]);
  expect(lines(intact)).toEqual([r.notCheckedInViewer, r.integrityCode['extended-by-later-signature']]);
  expect(signerNote(intact)).toBeNull();

  expect(checks(format)).toEqual([]);
  expect(lines(format)).toEqual([r.notCheckedInViewer, r.integrityCode['format-unsupported']]);
  expect(signerNote(format)).toBe(r.signerSource.pdfName);
  expect(format.textContent).toContain(r.integrity.notCheckedInViewer);

  expect(lines(algorithm)).toEqual([r.notCheckedInViewer, r.integrityCode['algorithm-unsupported']]);
  expect(signerNote(algorithm)).toBe(r.signerSource.unverifiedCertificate);

  // A problem is explained next to the status, not as information.
  expect(lines(mismatch)).toEqual([r.notCheckedInViewer]);
  expect(mismatch.querySelector('.odv-signature-problem').textContent).toBe(r.integrityCode['content-digest-mismatch']);
  expect(mismatch.querySelector('.odv-signature-status').className).toContain('odv-signature-status--error');
});

it('dialog status colour follows the site switch for not-checked signatures only', async () => {
  await i18n.changeLanguage('en');
  const signatures = [{ integrity: 'not-checked-in-viewer', integrityCode: 'timeout' }, { integrity: 'future-status' }];
  await act(async () => { root.render(createElement(I18nextProvider, { i18n }, createElement(SignatureDetailsDialog, {
    report: { signatures }, isOpen: true, onClose: () => {}, uncheckedSeverity: 'warning',
  }))); });
  const statuses = [...container.querySelectorAll('.odv-signature-status')].map((dd) => dd.className);
  expect(statuses[0]).toContain('odv-signature-status--warning');
  expect(statuses[1]).toContain('odv-signature-status--error');
  await render(SignatureDetailsDialog, signatures);
  expect(container.querySelector('.odv-signature-status').className).toContain('odv-signature-status--ok');
});

it('dialog shows signing-time results only when the parser provides them', async () => {
  await i18n.changeLanguage('en');
  const r = en.signatures;
  await render(SignatureDetailsDialog, [
    { integrity: 'intact' },
    { integrity: 'intact', signingTimeCheck: 'within-validity' },
    { integrity: 'intact', signingTimeCheck: 'not-checked', signingTimeCode: 'signing-time-unknown' },
    { integrity: 'intact', signingTimeCheck: 'outside-validity', signingTimeCode: 'signed-before-certificate-valid' },
  ]);
  const [plain, within, unknown, outside] = container.querySelectorAll('.odv-signature-entry');
  expect(plain.textContent).not.toContain(r.signingTimeCheck.notChecked);
  expect(plain.querySelectorAll('.odv-signature-checks li')).toHaveLength(2);
  expect(within.querySelectorAll('.odv-signature-checks li')).toHaveLength(3);
  expect(within.textContent).toContain(r.signingTimeCheck.withinValidity);
  expect([...unknown.querySelectorAll('.odv-signature-info p')].map((p) => p.textContent))
    .toEqual([r.notCheckedInViewer, r.signingTimeCode['signing-time-unknown']]);
  expect(unknown.querySelector('.odv-signature-status').className).toContain('--ok');
  expect(outside.querySelector('.odv-signature-problem').textContent).toBe(r.signingTimeCode['signed-before-certificate-valid']);
  expect(outside.querySelector('.odv-signature-status').className).toContain('--warning');
});

it.each(['en', 'sv'])('dialog explains claimed times and unchecked timestamps as neutral information (%s)', async (language) => {
  await i18n.changeLanguage(language);
  const r = (language === 'sv' ? sv : en).signatures;
  await render(SignatureDetailsDialog, [
    {
      integrity: 'intact', signingTime: '2026-04-05T12:30:00.000Z', signingTimeSource: 'timestamp',
      signingTimeCheck: 'within-validity', signatureTimestampCheck: 'verified',
    },
    {
      integrity: 'intact', signingTime: '2026-03-05T12:30:00.000Z', signingTimeSource: 'signed-attribute',
      signingTimeCheck: 'within-validity', signatureTimestampCheck: 'not-checked',
    },
  ]);
  const [verified, claimed] = container.querySelectorAll('.odv-signature-entry');
  const lines = (entry) => [...entry.querySelectorAll('.odv-signature-info[role="note"] p')].map((p) => p.textContent);
  expect(lines(verified)).toEqual([r.notCheckedInViewer]);
  expect(verified.textContent).toContain(r.timeSource.timestamp);
  expect(lines(claimed)).toEqual([r.notCheckedInViewer, r.timestampNotChecked, r.signerClaimedSigningTime]);
  expect(claimed.querySelector('.odv-signature-info').className).not.toMatch(/warning|error/);
  expect(claimed.querySelector('.odv-signature-status').className).toContain('--ok');
});
