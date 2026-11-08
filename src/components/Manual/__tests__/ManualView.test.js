// @vitest-environment jsdom
// File: src/components/Manual/__tests__/ManualView.test.js
//
// The shared manual view renders on its own, outside any dialog, as the stand-alone manual page
// will use it: it loads the generated standard manual, filters it by enabled features, builds the
// contents tree, runs the in-manual search, reports the current section and scrolls to an initial
// section. Plain createElement: the repo's ESLint setup does not parse JSX in tests.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate, mockI18n } = vi.hoisted(() => ({
  mockTranslate: (key, options) => options?.defaultValue ?? key,
  mockI18n: { language: 'sv', resolvedLanguage: 'sv' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: mockI18n }),
}));

import ManualView from '../ManualView.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

/** @param {number} [ms] */
function flush(ms = 0) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('ManualView outside a dialog', () => {
  let container;
  let root;
  let runtimeConfig;
  let requestedUrls;

  beforeEach(() => {
    runtimeConfig = { help: { manual: { source: 'standard' } } };
    requestedUrls = [];
    window.__ODV_GET_CONFIG__ = () => runtimeConfig;
    vi.stubGlobal('fetch', async (url) => {
      requestedUrls.push(String(url));
      return { ok: false, status: 404, url: String(url), text: async () => '' };
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('main');
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
  });

  /** @param {Object} [props] */
  async function renderView(props = {}) {
    act(() => {
      root.render(h(ManualView, props));
    });
    await flush(50);
    expect(container.querySelector('.odv-manual-content')).not.toBeNull();
  }

  function content() {
    return container.querySelector('.odv-manual-content');
  }

  function contentsLinks() {
    return Array.from(container.querySelectorAll('nav#odv-manual-contents a.odv-manual-toc-link'));
  }

  function searchInput() {
    return container.querySelector('[data-odv-manual-search="input"]');
  }

  function typeSearch(value) {
    act(() => {
      const input = searchInput();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  it('renders the standard manual with a contents tree and search, without dialog chrome', async () => {
    const documentStates = [];
    const activeSections = [];
    await renderView({
      onDocumentStateChange: (state) => documentStates.push(state),
      onActiveSectionChange: (id) => activeSections.push(id),
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.odv-help-body-manual.has-contents')).not.toBeNull();
    expect(requestedUrls).toEqual([]);
    expect(content().querySelector('h2#utseende')).not.toBeNull();

    const links = contentsLinks();
    expect(links.length).toBeGreaterThan(5);
    expect(links[0].getAttribute('href')).toBe('#utseende');
    expect(links[0].getAttribute('aria-current')).toBe('true');
    expect(activeSections.at(-1)).toBe('utseende');

    const finalState = documentStates.at(-1);
    expect(finalState.loading).toBe(false);
    expect(finalState.error).toBe('');
    expect(finalState.resolvedUrl).toContain('help/default/');

    expect(searchInput()).not.toBeNull();
    typeSearch('zooma');
    await flush(260);
    const counter = container.querySelector('.odv-manual-searchbar-count');
    expect(counter.textContent).toMatch(/^1 of [1-9]\d*$/);
    expect(content().querySelectorAll('mark[data-odv-manual-mark]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.odv-manual-toc-hits').length).toBeGreaterThan(0);
  });

  it('applies the same feature filtering as the overlay', async () => {
    runtimeConfig.compare = { overlay: { enabled: false } };
    await renderView();

    expect(content().querySelector('#jmf-overlagring')).toBeNull();
    expect(content().querySelector('#jmf-gardin')).not.toBeNull();
  });

  it('scrolls to and reports an initial section given as a location hash', async () => {
    const activeSections = [];
    await renderView({
      initialSectionId: '#zoom',
      onActiveSectionChange: (id) => activeSections.push(id),
    });

    const heading = content().querySelector('h2#zoom');
    expect(document.activeElement).toBe(heading);
    expect(activeSections.at(-1)).toBe('zoom');
    const current = container.querySelector('a.odv-manual-toc-link[aria-current="true"]');
    expect(current.getAttribute('href')).toBe('#zoom');
  });

  it('clears the search on Escape and leaves other Escape presses to the page without onEscape', async () => {
    await renderView();
    typeSearch('zooma');
    await flush(260);

    const escape = () => new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const first = escape();
    act(() => { searchInput().dispatchEvent(first); });
    expect(first.defaultPrevented).toBe(true);
    expect(searchInput().value).toBe('');

    const second = escape();
    act(() => { searchInput().dispatchEvent(second); });
    expect(second.defaultPrevented).toBe(false);
  });

  it('requests the site manual once when mounted on demand under StrictMode', async () => {
    runtimeConfig = { help: { manual: { sitePathTemplate: 'help/site/manual.{{lng}}.html' } } };
    act(() => {
      root.render(h(React.StrictMode, null, h(ManualView)));
    });
    await flush(50);
    expect(requestedUrls.filter((url) => url.includes('help/site/'))).toHaveLength(1);
    expect(content().querySelector('h2#utseende')).not.toBeNull();
  });

  it('calls onEscape when nothing in the view consumes Escape', async () => {
    const onEscape = vi.fn();
    await renderView({ onEscape });
    act(() => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
