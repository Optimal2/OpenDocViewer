// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/ManualOverlayDialog.contents.test.js
//
// The manual overlay shows a contents tree built at runtime from the loaded, sanitised manual's
// h2/h3 headings (the manual files themselves are never edited). The tree is a labelled <nav> with
// nested lists of real "#id" links; activating an entry scrolls only the content pane, focuses the
// heading and marks the entry aria-current. Search hits are counted per section and a hit jump
// moves the current entry. In narrow dialogs a "Contents" toggle opens the tree as an overlay
// list that closes on selection or Escape (the hiding itself is a CSS container query, so jsdom
// only sees the state). Plain createElement: the repo's ESLint setup does not parse JSX in tests.
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

import ManualOverlayDialog from '../ManualOverlayDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

const MANUAL_HTML = [
  '<h1>Manual</h1>',
  '<p>Intro apple. <a href="#skriva-ut">Jump to printing</a></p>',
  '<h2 id="start">1. Kom igång</h2><p>apple apple</p>',
  '<h3>Öppna dokument</h3><p>pear</p>',
  '<h3>Tips</h3><p>pear</p>',
  '<h2>2. Skriva ut</h2><p>apple</p>',
  '<h3>Tips</h3><p>pear</p>',
].join('');

/** @param {number} [ms] */
function flush(ms = 0) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('ManualOverlayDialog contents tree', () => {
  let container;
  let root;
  let onClose;
  let manualHtml;

  beforeEach(() => {
    onClose = vi.fn();
    manualHtml = MANUAL_HTML;
    vi.stubGlobal('fetch', async (url) => {
      const html = manualHtml;
      return { ok: true, url: String(url), text: async () => html };
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openManual(html = MANUAL_HTML) {
    manualHtml = html;
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    await flush(50);
    expect(container.querySelector('.odv-manual-content')).not.toBeNull();
  }

  const nav = () => container.querySelector('nav.odv-manual-toc');
  const links = () => Array.from(container.querySelectorAll('nav.odv-manual-toc a'));
  const link = (text) => links().find((node) => node.querySelector('.odv-manual-toc-text')?.textContent === text);
  const linkByHref = (href) => links().find((node) => node.getAttribute('href') === href);
  const current = () => links().filter((node) => node.getAttribute('aria-current') === 'true');
  const pane = () => container.querySelector('.odv-manual-scroll');
  const content = () => container.querySelector('.odv-manual-content');
  const toggle = () => container.querySelector('.odv-manual-toc-toggle');

  /** Give the pane a writable scrollTop and the headings fake positions (jsdom has no layout). */
  function fakeLayout() {
    let scrollTop = 0;
    Object.defineProperty(pane(), 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => { scrollTop = value; },
    });
    pane().getBoundingClientRect = () => ({ top: 100, bottom: 700, left: 300, right: 1200, width: 900, height: 600 });
    content().querySelectorAll('h2, h3').forEach((heading, index) => {
      heading.getBoundingClientRect = () => {
        const top = 100 + 400 * (index + 1) - scrollTop;
        return { top, bottom: top + 30, left: 300, right: 1200, width: 900, height: 30 };
      };
    });
    let navScrollTop = 37;
    Object.defineProperty(nav(), 'scrollTop', {
      configurable: true,
      get: () => navScrollTop,
      set: (value) => { navScrollTop = value; },
    });
  }

  it('renders a labelled nav with nested lists of real links built from h2/h3', async () => {
    await openManual();
    expect(nav()).not.toBeNull();
    expect(nav().getAttribute('aria-label')).toBe('Contents of this page');
    expect(links().map((node) => [node.getAttribute('href'), node.textContent])).toEqual([
      ['#start', '1. Kom igång'],
      ['#oppna-dokument', 'Öppna dokument'],
      ['#tips', 'Tips'],
      ['#skriva-ut', '2. Skriva ut'],
      ['#tips-2', 'Tips'],
    ]);
    // Two levels: each h2 is a list item with its h3 entries in a nested list.
    expect(nav().querySelectorAll(':scope > ol > li')).toHaveLength(2);
    expect(nav().querySelectorAll(':scope > ol > li > ol > li')).toHaveLength(3);
    // The generated ids are on the headings, unique even for repeated texts.
    const ids = Array.from(content().querySelectorAll('h2, h3')).map((heading) => heading.id);
    expect(ids).toEqual(['start', 'oppna-dokument', 'tips', 'skriva-ut', 'tips-2']);
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#start']);
    // Focus order header -> search -> tree -> content follows the DOM order.
    const order = [
      container.querySelector('.odv-help-header'),
      container.querySelector('[data-odv-manual-search="input"]'),
      nav(),
      content(),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('renders no column and no toggle for a manual without h2/h3', async () => {
    await openManual('<h1>Only a title</h1><p>Text</p><h4>Small</h4>');
    expect(nav()).toBeNull();
    expect(toggle()).toBeNull();
    expect(container.querySelector('.odv-help-body-manual.has-contents')).toBeNull();
  });

  // <noscript> is left out: jsdom parses its body as elements, a browser with scripting enabled
  // parses it as text, so no heading from it ever reaches the rendered manual.
  it('never lists headings the sanitiser removed', async () => {
    await openManual([
      '<template><h2>From template</h2></template>',
      '<script>document.write("<h2>From script</h2>")</script>',
      '<svg><foreignObject><h2>From svg</h2></foreignObject></svg>',
      '<iframe srcdoc="<h2>From iframe</h2>"></iframe>',
      '<h2>Real section</h2>',
    ].join(''));
    expect(links().map((node) => node.textContent)).toEqual(['Real section']);
  });

  it('scrolls only the content pane to the heading and marks the entry current', async () => {
    await openManual();
    fakeLayout();
    const hashBefore = window.location.hash;
    const entry = link('2. Skriva ut');
    act(() => {
      entry.click();
    });
    // Heading 4 sits 1600 px below the pane top; the pane scrolls it to the top with an 8 px gap.
    expect(pane().scrollTop).toBe(1600 - 8);
    expect(nav().scrollTop).toBe(37);
    expect(entry.getAttribute('aria-current')).toBe('true');
    expect(current()).toHaveLength(1);
    const heading = content().querySelector('#skriva-ut');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(window.location.hash).toBe(hashBefore);
  });

  it('opens a collapsed details section holding the target heading', async () => {
    await openManual('<h2>Visible</h2><details><summary>More</summary><h3>Inside</h3></details>');
    const details = content().querySelector('details');
    expect(details.open).toBe(false);
    act(() => {
      link('Inside').click();
    });
    expect(details.open).toBe(true);
    expect(link('Inside').getAttribute('aria-current')).toBe('true');
  });

  it('routes in-text "#id" links through the content pane', async () => {
    await openManual();
    fakeLayout();
    const hashBefore = window.location.hash;
    act(() => {
      content().querySelector('a[href="#skriva-ut"]').click();
    });
    expect(pane().scrollTop).toBe(1600 - 8);
    expect(linkByHref('#skriva-ut').getAttribute('aria-current')).toBe('true');
    expect(window.location.hash).toBe(hashBefore);
  });

  it('shows hit counts per section and follows search hit navigation', async () => {
    await openManual();
    const input = container.querySelector('[data-odv-manual-search="input"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'apple');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush(260);
    const hits = (href) => linkByHref(href).querySelector('.odv-manual-toc-hits [aria-hidden="true"]')?.textContent || '';
    // The intro hit comes before the first heading, so it belongs to no section.
    expect(hits('#start')).toBe('2');
    expect(hits('#skriva-ut')).toBe('1');
    expect(hits('#tips')).toBe('');
    expect(linkByHref('#start').querySelector('.sr-only').textContent).toBe(', 2 matches');
    // Hit 1 is the intro (before any heading): the first section stays current.
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#start']);
    const next = container.querySelector('button[aria-label="Next match"]');
    act(() => { next.click(); });
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#start']);
    act(() => { next.click(); });
    act(() => { next.click(); });
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#skriva-ut']);
    // Clearing the search removes the counts.
    act(() => {
      container.querySelector('button[aria-label="Clear search"]').click();
    });
    await flush(260);
    expect(container.querySelector('.odv-manual-toc-hits')).toBeNull();
  });

  it('opens the narrow-window list with the toggle and closes it on Escape or selection', async () => {
    await openManual();
    expect(toggle()).not.toBeNull();
    expect(toggle().textContent).toContain('Contents');
    expect(toggle().getAttribute('aria-controls')).toBe(nav().id);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    act(() => { toggle().click(); });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(nav().classList.contains('is-open')).toBe(true);

    link('Tips').focus();
    act(() => {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(nav().classList.contains('is-open')).toBe(false);
    expect(document.activeElement).toBe(toggle());

    act(() => { toggle().click(); });
    expect(nav().classList.contains('is-open')).toBe(true);
    act(() => { link('Öppna dokument').click(); });
    expect(nav().classList.contains('is-open')).toBe(false);
    expect(link('Öppna dokument').getAttribute('aria-current')).toBe('true');

    // With the list closed, Escape closes the dialog as before.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on a navigated heading when the parent re-renders with a new onClose', async () => {
    await openManual();
    act(() => { link('Tips').click(); });
    const heading = content().querySelector('#tips');
    expect(document.activeElement).toBe(heading);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose: vi.fn() }));
    });
    expect(document.activeElement).toBe(heading);
  });

  it('builds the tree for a manual with hundreds of headings', async () => {
    const parts = [];
    for (let index = 0; index < 300; index += 1) {
      parts.push(index % 3 === 0 ? `<h2>Avsnitt ${index}</h2>` : '<h3>Detalj</h3><p>text</p>');
    }
    await openManual(parts.join(''));
    expect(links()).toHaveLength(300);
    expect(new Set(links().map((node) => node.getAttribute('href'))).size).toBe(300);
  });
});
