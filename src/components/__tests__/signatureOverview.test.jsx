// @vitest-environment jsdom
// File: src/components/__tests__/signatureOverview.test.jsx
/**
 * Toolbar overview button and per-document details dialog: no button for
 * unsigned sets, counts in accessible names, file tabs only for documents with
 * several signed files, and the requested file preselected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import SignatureOverviewButton from '../SignatureOverviewButton.jsx';
import SignatureDetailsDialog from '../SignatureDetailsDialog.jsx';
import { buildSignatureDocuments, summarizeSignatureDocuments } from '../../utils/pdfSignatureDocuments.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'en' },
  }),
}));

const PAGES = [
  { sourceKey: 'a1', allPagesIndex: 0, documentId: 'A', documentNumber: 1, totalDocuments: 2 },
  { sourceKey: 'a2', allPagesIndex: 1, documentId: 'A', documentNumber: 1, totalDocuments: 2 },
  { sourceKey: 'b1', allPagesIndex: 2, documentId: 'B', documentNumber: 2, totalDocuments: 2 },
];

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(element));
  return {
    container,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

describe('SignatureOverviewButton', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('renders nothing when no loaded file is signed', async () => {
    const summary = summarizeSignatureDocuments(buildSignatureDocuments(PAGES, { a1: { signatures: [] } }));
    const { container, cleanup } = await render(createElement(SignatureOverviewButton, { summary, onOpen: () => {} }));
    expect(container.querySelector('button')).toBe(null);
    await cleanup();
  });

  it('shows the worst severity and the signed-document count', async () => {
    const summary = summarizeSignatureDocuments(buildSignatureDocuments(PAGES, {
      a1: { signatures: [{ integrity: 'intact' }] },
      b1: { signatures: [{ integrity: 'digest-mismatch' }] },
    }));
    const onOpen = vi.fn();
    const { container, cleanup } = await render(createElement(SignatureOverviewButton, { summary, onOpen }));
    const button = container.querySelector('button');
    expect(button.className).toContain('odv-signature-badge--error');
    expect(button.getAttribute('aria-label')).toContain('2 signed documents');
    expect(button.textContent).toContain('2');
    await act(() => button.click());
    expect(onOpen).toHaveBeenCalledWith(button);
    await cleanup();
  });
});

describe('SignatureDetailsDialog per document', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('shows file tabs for several signed files and preselects the requested file', async () => {
    const [doc] = buildSignatureDocuments(PAGES, {
      a1: { signatures: [{ integrity: 'intact', signer: 'First Signer' }] },
      a2: { signatures: [{ integrity: 'intact', signer: 'Second Signer' }, { integrity: 'intact' }] },
    }, { getFileName: (key) => (key === 'a2' ? 'appendix.pdf' : '') });
    const { container, cleanup } = await render(createElement(SignatureDetailsDialog, {
      isOpen: true, onClose: () => {}, document: doc, initialSourceKey: 'a2',
    }));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.querySelector('.odv-signature-file-tab-label').textContent)).toEqual(['File 1 of 2', 'appendix.pdf']);
    expect(tabs.map((tab) => tab.querySelector('.odv-signature-file-tab-pages').textContent)).toEqual(['Page 1', 'Page 2']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    // The active file is repeated in the group heading with its page range inside the document.
    expect(container.querySelector('.odv-signature-file-heading').textContent).toBe('File 2 of 2: appendix.pdf');
    expect(container.querySelector('.odv-signature-file-pages').textContent).toBe('Page 2');
    expect(container.querySelectorAll('.odv-signature-entry')).toHaveLength(2);
    expect(container.textContent).toContain('Second Signer');
    expect(container.textContent).toContain('Document 1 of 2');
    await act(() => tabs[0].click());
    expect(container.querySelectorAll('.odv-signature-entry')).toHaveLength(1);
    expect(container.textContent).toContain('First Signer');
    await cleanup();
  });

  it('looks like a plain signature list when only one file of the document is signed', async () => {
    const [doc] = buildSignatureDocuments(PAGES, { a2: { signatures: [{ integrity: 'intact' }] } });
    const { container, cleanup } = await render(createElement(SignatureDetailsDialog, {
      isOpen: true, onClose: () => {}, document: doc,
    }));
    expect(container.querySelector('[role="tablist"]')).toBe(null);
    expect(container.querySelector('.odv-signature-file-heading')).toBe(null);
    expect(container.querySelectorAll('.odv-signature-entry')).toHaveLength(1);
    await cleanup();
  });
});
