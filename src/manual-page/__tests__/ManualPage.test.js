// @vitest-environment jsdom
// File: src/manual-page/__tests__/ManualPage.test.js
//
// The stand-alone manual page: header (title, theme and language menus), the shared manual view
// with the viewer's runtime configuration, the URL fragment as initial section, the
// `help.manual.enabled: false` notice, and the mount function main.jsx uses.
// Plain createElement: the repo's ESLint setup does not parse JSX in tests.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate, mockI18n } = vi.hoisted(() => ({
  mockTranslate: (key, options) => options?.defaultValue ?? key,
  mockI18n: {
    language: 'sv',
    resolvedLanguage: 'sv',
    options: { supportedLngs: ['sv', 'en'] },
    changeLanguage: async () => {},
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: mockI18n }),
}));

import ManualPage, { MANUAL_PAGE_TITLE_ID } from '../ManualPage.jsx';
import { mountManualPage } from '../mountManualPage.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

/** @param {number} [ms] */
function flush(ms = 0) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('stand-alone manual page', () => {
  let container;
  let root;
  let runtimeConfig;
  let requestedUrls;
  let initialUrl;

  beforeEach(() => {
    initialUrl = window.location.href;
    runtimeConfig = { help: { manual: { source: 'standard' } } };
    requestedUrls = [];
    window.__ODV_GET_CONFIG__ = () => runtimeConfig;
    vi.stubGlobal('fetch', async (url) => {
      requestedUrls.push(String(url));
      return { ok: false, status: 404, url: String(url), text: async () => '' };
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = null;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    delete window.__ODV_GET_CONFIG__;
    window.history.replaceState(null, '', initialUrl);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderPage(props = {}) {
    root = createRoot(container);
    act(() => {
      root.render(h(ManualPage, props));
    });
    await flush(50);
  }

  it('renders the header with title, theme and language menus, and the manual view', async () => {
    await renderPage();

    const title = container.querySelector(`header h1#${MANUAL_PAGE_TITLE_ID}`);
    expect(title.textContent).toBe('OpenDocViewer – Manual');
    expect(document.title).toBe('OpenDocViewer – Manual');
    const headerButtons = Array.from(container.querySelectorAll('header .toolbar-end-actions button[aria-haspopup="menu"]'));
    expect(headerButtons).toHaveLength(2);

    const main = container.querySelector('main.odv-manual-page-body');
    expect(main.getAttribute('aria-labelledby')).toBe(MANUAL_PAGE_TITLE_ID);
    expect(main.querySelector('.odv-help-body-manual.has-contents')).not.toBeNull();
    expect(main.querySelector('[data-odv-manual-search="input"]')).not.toBeNull();
    expect(main.querySelector('.odv-manual-content h2#utseende')).not.toBeNull();
    expect(container.querySelector('[data-odv-manual-page="disabled"]')).toBeNull();
    // The standard manual comes from the generated bundle; nothing is fetched.
    expect(requestedUrls).toEqual([]);
  });

  it('applies the viewer configuration feature filter', async () => {
    runtimeConfig.compare = { overlay: { enabled: false } };
    await renderPage();
    const content = container.querySelector('.odv-manual-content');
    expect(content.querySelector('#jmf-overlagring')).toBeNull();
    expect(content.querySelector('#jmf-gardin')).not.toBeNull();
  });

  it('opens the section named by the URL fragment and keeps the fragment on the section being read', async () => {
    window.history.replaceState(null, '', '#zoom');
    await renderPage();

    const heading = container.querySelector('.odv-manual-content h2#zoom');
    expect(document.activeElement).toBe(heading);
    expect(window.location.hash).toBe('#zoom');

    const links = Array.from(container.querySelectorAll('a.odv-manual-toc-link'));
    const other = links.find((link) => link.getAttribute('href') !== '#zoom');
    act(() => { other.click(); });
    await flush(20);
    expect(window.location.hash).toBe(other.getAttribute('href'));
  });

  it('resolves manual files and images against the ODV base, not the manual/ folder', async () => {
    window.history.replaceState(null, '', '/odv/manual/');
    runtimeConfig = { baseHref: '/odv/', help: { manual: { source: 'auto' } } };
    await renderPage();

    const origin = window.location.origin;
    // The default (relative) site template is fetched from the base; the generated manual follows.
    expect(requestedUrls[0]).toBe(`${origin}/odv/help/site/manual.sv.html`);
    const image = container.querySelector('.odv-manual-content img[src]');
    expect(image.getAttribute('src').startsWith(`${origin}/odv/help/default/`)).toBe(true);
  });

  it('shows the "not available" notice instead of the manual when help.manual.enabled is false', async () => {
    runtimeConfig = { help: { manual: { enabled: false, source: 'auto', sitePathTemplate: 'help/site/manual.{{lng}}.html' } } };
    await renderPage();

    const notice = container.querySelector('[data-odv-manual-page="disabled"]');
    expect(notice.textContent).toBe('The manual is not available in this installation.');
    expect(notice.getAttribute('role')).toBe('status');
    expect(container.querySelector('.odv-help-body-manual')).toBeNull();
    expect(container.querySelector('header h1').textContent).toBe('OpenDocViewer – Manual');
    expect(requestedUrls).toEqual([]);
  });

  it('honours an explicit config prop over the loaded configuration', async () => {
    await renderPage({ config: { help: { manual: { enabled: false } } } });
    expect(container.querySelector('[data-odv-manual-page="disabled"]')).not.toBeNull();
  });

  it('mounts into a container with the shared theme applied to the document', async () => {
    expect(mountManualPage(null)).toBeNull();
    act(() => {
      root = mountManualPage(container);
    });
    await flush(50);
    expect(['light', 'normal', 'dark']).toContain(document.documentElement.getAttribute('data-theme'));
    expect(document.documentElement.getAttribute('data-theme-mode')).toBeTruthy();
    expect(container.querySelector('[data-odv-manual-page="root"] .odv-manual-content h2#utseende')).not.toBeNull();
  });
});
