// @vitest-environment jsdom
// File: src/components/__tests__/signatureDetailsDialog.test.jsx
/**
 * Signature details dialog: per-status content built from the phase 1 fixture
 * generator, plus the accessibility behaviour shared with the metadata overlay
 * dialog (focus on open, Escape closes, focus returns to the opener).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, createElement, Fragment, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SignatureDetailsDialog from '../SignatureDetailsDialog.jsx';
import { collectPdfSignatures } from '../../utils/pdfSignatures.js';
import { createSignatureFixtures } from '../../../scripts/generate-signature-fixtures.mjs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

let fixtures;

beforeAll(async () => {
  fixtures = await createSignatureFixtures();
}, 180000);

async function inspect(name) {
  return collectPdfSignatures(fixtures[name]);
}

async function renderDialog(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(createElement(SignatureDetailsDialog, props)));
  return { container, root };
}

describe('SignatureDetailsDialog content', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('renders nothing when closed', async () => {
    const { container, root } = await renderDialog({ isOpen: false, onClose: () => {}, report: null });
    expect(container.querySelector('[role="dialog"]')).toBe(null);
    await act(() => root.unmount());
    container.remove();
  });

  it('explains why trust is not checked when the viewer has no gateway', async () => {
    const report = await inspect('valid-rsa.pdf');
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const note = container.querySelector('.odv-signature-trust');
    expect(note.className).toContain('odv-signature-trust--unavailable');
    expect(note.textContent).toContain('can only be checked when the document is opened through ODVGateway');
    await act(() => root.unmount());
    container.remove();
  });

  it('lists signer, organisation, issuer, reason, location, kind and integrity for an intact signature', async () => {
    const report = await inspect('valid-rsa.pdf');
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const text = container.textContent;
    expect(text).toContain('ODV Fixture Signer');
    expect(text).toContain('ODV Fixture Users');
    expect(text).toContain('ODV Fixture Signing CA');
    expect(text).toContain('Approved fixture document');
    expect(text).toContain('Local test environment');
    expect(text).toContain('Approval');
    expect(text).toContain('Intact');
    await act(() => root.unmount());
    container.remove();
  });

  it('states the digest-mismatch status in plain words with its reason', async () => {
    const report = await inspect('digest-mismatch.pdf');
    expect(report.signatures[0]?.integrity).toBe('digest-mismatch');
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const text = container.textContent;
    expect(text).toContain('Digest mismatch');
    expect(text).toContain(String(report.signatures[0].integrityReason));
    await act(() => root.unmount());
    container.remove();
  });

  it('shows unsupported formats as signature present, format not supported (never hidden)', async () => {
    const report = await inspect('unsupported-subfilter.pdf');
    expect(report.signatures).toHaveLength(1);
    expect(report.signatures[0]?.integrity).toBe('unsupported');
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const text = container.textContent;
    expect(text).toContain('Signature present, format not supported');
    expect(text).toContain('ICVN.SADES');
    await act(() => root.unmount());
    container.remove();
  });

  it('lists every signature of a multi-signature document in order', async () => {
    const report = await inspect('two-signatures.pdf');
    expect(report.signatures.length).toBe(2);
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const text = container.textContent;
    expect(text).toContain('Signature 1');
    expect(text).toContain('Signature 2');
    expect(text).toContain('First signature');
    expect(text).toContain('Second approval');
    await act(() => root.unmount());
    container.remove();
  });

  it('renders a state-specific trust explanation for every trust state', async () => {
    const cases = [
      [{ trust: 'not-checked' }, 'unavailable', 'opened through ODVGateway'],
      [{ trust: 'not-checked', serverValidationDisabled: true }, 'not-checked', 'signatures.enabled is off'],
      [{ trust: 'not-checked', serverValidationUnavailable: true, trustReason: 'server validation unavailable' }, 'server-error', 'did not answer'],
      [{ trust: 'valid' }, 'valid', 'The signature is valid'],
      [{ trust: 'invalid', trustReason: 'revoked' }, 'invalid', 'The certificate has been revoked'],
      [{ trust: 'unknown', trustReason: 'timestamp-responder-not-trusted' }, 'unknown', 'The timestamp issuer is not trusted on the server'],
      [{ trust: 'unknown', trustReason: 'reason text' }, 'unknown', 'reason text'],
    ];
    for (const [fields, state, text] of cases) {
      const report = { signatures: [{ integrity: 'intact', signer: 'A', ...fields }] };
      const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
      const note = container.querySelector('.odv-signature-trust');
      expect(note.className).toContain(`odv-signature-trust--${state}`);
      expect(note.textContent).toContain(text);
      await act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the raw gateway code on a secondary line and says what unknown does not mean', async () => {
    const report = { signatures: [{ integrity: 'intact', trust: 'unknown', trustReason: 'revocation-unavailable' }] };
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    expect(container.querySelector('.odv-signature-trust-title').textContent).toBe('Could not determine whether the signature is valid');
    expect(container.querySelector('.odv-signature-trust-reason').textContent).toBe('The revocation list could not be retrieved');
    expect(container.querySelector('.odv-signature-trust-code').textContent).toBe('Code: revocation-unavailable');
    expect(container.querySelector('.odv-signature-trust').textContent).toContain('does not mean');
    await act(() => root.unmount());
    container.remove();
  });

  it('shows signing, validation and certificate times as local time with the UTC value in the title', async () => {
    const report = { signatures: [{
      integrity: 'intact', trust: 'valid', signingTime: '2022-04-27T17:55:43.000Z', signingTimeSource: 'signed-attribute',
      validationTime: '2026-10-01T12:00:00Z', notBefore: '2022-01-01T00:00:00Z', notAfter: '2025-01-01T00:00:00Z',
    }] };
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    const times = Array.from(container.querySelectorAll('time'));
    expect(times.map((node) => node.getAttribute('datetime'))).toEqual([
      '2022-04-27T17:55:43.000Z', '2022-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2026-10-01T12:00:00.000Z',
    ]);
    for (const node of times) {
      expect(node.title).toBe(node.getAttribute('datetime'));
      expect(node.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
    const local = new Date('2022-04-27T17:55:43.000Z');
    const pad = (value) => String(value).padStart(2, '0');
    expect(times[0].textContent).toBe(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`);
    expect(container.textContent).not.toContain('T17:55:43');
    await act(() => root.unmount());
    container.remove();
  });
});

describe('SignatureDetailsDialog keyboard behaviour', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('opens from the symbol, traps focus inside, closes on Escape and returns focus to the symbol', async () => {
    const report = await inspect('valid-rsa.pdf');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe() {
      const [open, setOpen] = useState(false);
      const openerRef = useRef(null);
      return createElement(Fragment, null,
        createElement('button', {
          type: 'button',
          ref: openerRef,
          onClick: () => setOpen(true),
        }, 'open signatures'),
        createElement(SignatureDetailsDialog, {
          isOpen: open,
          onClose: () => setOpen(false),
          report,
          returnFocusRef: openerRef,
        }));
    }

    await act(() => root.render(createElement(Probe)));
    const opener = container.querySelector('button');
    opener.focus();
    expect(document.activeElement).toBe(opener);

    // Open via the symbol (a native button: Enter/Space/click all activate it).
    await act(() => {
      opener.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBe(null);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Escape closes the dialog and focus returns to the symbol.
    await act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(document.activeElement).toBe(opener);

    await act(() => root.unmount());
    container.remove();
  });
});
