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
      { signatures: [sig('intact'), sig('unsupported')], cls: 'odv-signature-badge--warning', icon: 'warning' },
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
