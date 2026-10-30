// @vitest-environment jsdom
// File: src/components/__tests__/signatureStatusBadge.test.jsx
/**
 * Signature status badge: appears only for signed documents, carries an
 * accessible name and tooltip, and colours/icons by the worst integrity
 * status of the document's signatures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import SignatureStatusBadge from '../SignatureStatusBadge.jsx';
import SignatureDetailsDialog from '../SignatureDetailsDialog.jsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

function sig(integrity) {
  return { integrity };
}

async function renderBadge(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(createElement(SignatureStatusBadge, props)));
  return { container, root };
}

describe('SignatureStatusBadge', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it.each(['future', undefined, null, 'constructor'])('F3 shares fail-safe status between badge tooltip and dialog for %s', async (integrity) => {
    const report = { signatures: [sig('intact'), sig(integrity)] };
    const { container, root } = await renderBadge({ report, onOpen: () => {} });
    const badge = container.querySelector('button');
    expect(badge.className).toContain('odv-signature-badge--error');
    expect(badge.title).toContain('Signature data is damaged');
    await act(() => root.render(createElement(SignatureDetailsDialog, { isOpen: true, report, onClose: () => {} })));
    expect(container.textContent).toContain('Signature data is damaged');
    await act(() => root.unmount());
    container.remove();
  });

  it('renders nothing without a report or without signatures', async () => {
    for (const report of [null, undefined, {}, { signatures: [] }]) {
      const { container, root } = await renderBadge({ report, onOpen: () => {} });
      expect(container.querySelector('button')).toBe(null);
      await act(() => root.unmount());
      container.remove();
    }
  });

  it('renders a button with an accessible name and tooltip for a signed document', async () => {
    const { container, root } = await renderBadge({
      report: { signatures: [sig('intact')] },
      onOpen: () => {},
    });
    const button = container.querySelector('button');
    expect(button).not.toBe(null);
    expect(button.getAttribute('type')).toBe('button');
    const label = button.getAttribute('aria-label') || '';
    expect(label).toContain('Signed document');
    expect(label).toContain('1');
    expect(button.getAttribute('title')).toBeTruthy();
    await act(() => root.unmount());
    container.remove();
  });

  it('uses the ok severity for an intact signature', async () => {
    const { container, root } = await renderBadge({
      report: { signatures: [sig('intact')] },
      onOpen: () => {},
    });
    const button = container.querySelector('button');
    expect(button.className).toContain('odv-signature-badge--ok');
    expect(button.querySelector('.material-icons')?.textContent).toBe('verified');
    await act(() => root.unmount());
    container.remove();
  });

  it('colours by the worst status: error beats warning beats ok', async () => {
    const cases = [
      { signatures: [sig('intact'), sig('digest-mismatch')], cls: 'odv-signature-badge--error', icon: 'error' },
      { signatures: [sig('intact'), sig('signature-invalid')], cls: 'odv-signature-badge--error', icon: 'error' },
      { signatures: [sig('intact'), sig('unreadable')], cls: 'odv-signature-badge--error', icon: 'error' },
      { signatures: [sig('intact'), sig('modified-after-signing')], cls: 'odv-signature-badge--warning', icon: 'warning' },
      { signatures: [sig('intact'), sig('indeterminate')], cls: 'odv-signature-badge--warning', icon: 'warning' },
      { signatures: [sig('intact'), sig('not-checked-in-viewer')], cls: 'odv-signature-badge--ok', icon: 'verified' },
      { signatures: [sig('intact'), sig('unsupported')], cls: 'odv-signature-badge--ok', icon: 'verified' },
      { signatures: [sig('intact'), sig('intact')], cls: 'odv-signature-badge--ok', icon: 'verified' },
    ];
    for (const testCase of cases) {
      const { container, root } = await renderBadge({
        report: { signatures: testCase.signatures },
        onOpen: () => {},
      });
      const button = container.querySelector('button');
      expect(button.className).toContain(testCase.cls);
      expect(button.querySelector('.material-icons')?.textContent).toBe(testCase.icon);
      await act(() => root.unmount());
      container.remove();
    }
  });

  it('calls onOpen with the badge element when clicked', async () => {
    const onOpen = vi.fn();
    const { container, root } = await renderBadge({
      report: { signatures: [sig('intact')] },
      onOpen,
    });
    const button = container.querySelector('button');
    await act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe(button);
    await act(() => root.unmount());
    container.remove();
  });

  it('applies the variant class for thumbnail and toolbar placement', async () => {
    const { container, root } = await renderBadge({
      report: { signatures: [sig('intact')] },
      onOpen: () => {},
      variant: 'thumbnail',
    });
    expect(container.querySelector('button').className).toContain('odv-signature-badge--thumbnail');
    await act(() => root.unmount());
    container.remove();
  });
});

describe('SignatureStatusBadge status model', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  async function badgeFor(props) {
    const { container, root } = await renderBadge({ onOpen: () => {}, ...props });
    const button = container.querySelector('button');
    const result = {
      cls: button.className,
      icon: button.querySelector('.material-icons')?.textContent,
      label: button.getAttribute('aria-label'),
      title: button.title,
    };
    await act(() => root.unmount());
    container.remove();
    return result;
  }

  it.each([
    ['intact', 'OK'],
    ['modified-after-signing', 'Warning'],
    ['digest-mismatch', 'Error'],
  ])('the accessible name states the severity for %s', async (integrity, severityLabel) => {
    const result = await badgeFor({ report: { signatures: [sig(integrity)] } });
    expect(result.label).toBe(`Signed document, 1 signature — ${severityLabel}`);
  });

  it('not checked is green with the label "Not checked in the viewer", warning with the site switch', async () => {
    const report = { signatures: [sig('intact'), { integrity: 'not-checked-in-viewer', integrityCode: 'format-unsupported' }] };
    const ok = await badgeFor({ report });
    expect(ok.cls).toContain('odv-signature-badge--ok');
    expect(ok.icon).toBe('verified');
    expect(ok.label).toContain('OK — Not checked in the viewer');
    expect(ok.title).toContain('Not checked in the viewer');
    const warn = await badgeFor({ report, uncheckedSeverity: 'warning' });
    expect(warn.cls).toContain('odv-signature-badge--warning');
    expect(warn.icon).toBe('warning');
    expect(warn.label).toContain('Warning — Not checked in the viewer');
  });

  it('the switch never lowers an error and never applies to unknown statuses', async () => {
    for (const integrity of ['digest-mismatch', 'future-status', undefined]) {
      const result = await badgeFor({ report: { signatures: [sig(integrity)] }, uncheckedSeverity: 'warning' });
      expect(result.cls).toContain('odv-signature-badge--error');
    }
  });

  it('uses a precomputed severity only when it is one of the three classes', async () => {
    const report = { signatures: [sig('not-checked-in-viewer')] };
    expect((await badgeFor({ report, severity: 'warning' })).cls).toContain('odv-signature-badge--warning');
    expect((await badgeFor({ report: { signatures: [sig('digest-mismatch')] }, severity: 'bogus' })).cls)
      .toContain('odv-signature-badge--error');
  });

  it('adds a signing-time warning to the tooltip and colours it as a warning', async () => {
    const report = { signatures: [{ integrity: 'intact', signingTimeCheck: 'outside-validity', signingTimeCode: 'signed-after-certificate-expired' }] };
    const result = await badgeFor({ report });
    expect(result.cls).toContain('odv-signature-badge--warning');
    expect(result.title).toContain('signed-after-certificate-expired');
  });

  it('signatures without signing-time fields keep today\'s tooltip and colour', async () => {
    const result = await badgeFor({ report: { signatures: [sig('intact')] } });
    expect(result.cls).toContain('odv-signature-badge--ok');
    expect(result.title).toBe('Signed document, 1 signature – show signature details — Intact');
  });
});
