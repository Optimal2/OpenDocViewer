// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/ManualOverlayDialog.newTabLink.test.js
//
// The manual dialog's title bar offers an "Open in new tab" link next to the reload and close
// buttons. The link points at the stand-alone manual page (`manual/` relative to the viewer
// bundle, so deployments under a subpath keep working) and carries the section being read as the
// fragment once the shared manual view reports one. Plain createElement: the repo's ESLint setup
// does not parse JSX in tests.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate, mockI18n, mockManualModules } = vi.hoisted(() => ({
  mockTranslate: (key, options) => options?.defaultValue ?? key,
  mockI18n: { language: 'sv', resolvedLanguage: 'sv' },
  mockManualModules: { failSwedishChunk: false, failEnglishChunk: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: mockI18n }),
}));

vi.mock('../../../generated/standard-manual/manual.sv.js', async (importOriginal) => {
  if (mockManualModules.failSwedishChunk) throw new Error('Simulated Swedish manual chunk failure');
  return importOriginal();
});

vi.mock('../../../generated/standard-manual/manual.en.js', async (importOriginal) => {
  if (mockManualModules.failEnglishChunk) throw new Error('Simulated English manual chunk failure');
  return importOriginal();
});

import ManualOverlayDialog from '../ManualOverlayDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

/** @param {number} [ms] */
function flush(ms = 0) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('ManualOverlayDialog open-in-new-tab link', () => {
  let container;
  let root;
  let onClose;
  let manualHtml;

  beforeEach(() => {
    onClose = vi.fn();
    manualHtml = '';
    mockI18n.language = 'sv';
    mockI18n.resolvedLanguage = 'sv';
    window.__ODV_GET_CONFIG__ = () => ({});
    vi.stubGlobal('fetch', async () => ({ ok: true, url: 'https://host/help/site/manual.sv.html', text: async () => manualHtml }));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete window.__ODV_GET_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function openManual(html) {
    manualHtml = html;
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    for (let attempt = 0; attempt < 20 && !container.querySelector('.odv-manual-content'); attempt += 1) {
      await flush(50);
    }
    expect(container.querySelector('.odv-manual-content')).not.toBeNull();
    // Let the reported active section round-trip back into the dialog chrome.
    await flush(50);
  }

  const newTabLink = () => container.querySelector('a[aria-label="Open in new tab"]');

  it('sits next to the reload and close controls and opens in a new tab without opener access', async () => {
    await openManual('<h1>Manual</h1><p>Plain text, no sections.</p>');
    const link = newTabLink();
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.getAttribute('title')).toBe('Open the manual in a new browser tab');
    const actions = link.parentElement;
    expect(actions.querySelector('button[aria-label="Reload manual from server"]')).not.toBeNull();
    expect(actions.querySelector('button[aria-label="Close"]')).not.toBeNull();
  });

  it('points at the stand-alone page without a fragment when the manual has no current section', async () => {
    await openManual('<h1>Manual</h1><p>Plain text, no sections.</p>');
    expect(newTabLink().getAttribute('href')).toBe('manual/');
  });

  it('carries the reported section as the fragment', async () => {
    await openManual('<h1>Manual</h1><h2 id="start">Start</h2><p>Text.</p><h2>Next</h2><p>More.</p>');
    expect(newTabLink().getAttribute('href')).toBe('manual/#start');
  });

  it('URL-encodes the section fragment', async () => {
    await openManual('<h1>Manual</h1><h2 id="avsnitt 1">Start</h2><p>Text.</p>');
    expect(newTabLink().getAttribute('href')).toBe('manual/#avsnitt%201');
  });
});
