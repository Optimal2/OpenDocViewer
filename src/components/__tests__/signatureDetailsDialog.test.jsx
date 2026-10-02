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

  it('shows the trust-not-checked line for every report', async () => {
    const report = await inspect('valid-rsa.pdf');
    const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
    expect(container.textContent).toContain('Trust not checked');
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

  it('renders the trust field generically for all level-2 values', async () => {
    for (const trust of ['not-checked', 'valid', 'invalid', 'unknown']) {
      const report = { signatures: [{ integrity: 'intact', signer: 'A', trust, trustReason: 'reason text' }] };
      const { container, root } = await renderDialog({ isOpen: true, onClose: () => {}, report });
      expect(container.textContent).toContain('reason text');
      await act(() => root.unmount());
      container.remove();
    }
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
