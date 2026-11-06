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
  let runtimeConfig;
  let requestedUrls;

  beforeEach(() => {
    onClose = vi.fn();
    manualHtml = MANUAL_HTML;
    runtimeConfig = {};
    requestedUrls = [];
    mockManualModules.failSwedishChunk = false;
    mockManualModules.failEnglishChunk = false;
    mockI18n.language = 'sv';
    mockI18n.resolvedLanguage = 'sv';
    window.__ODV_GET_CONFIG__ = () => runtimeConfig;
    vi.stubGlobal('fetch', async (url) => {
      requestedUrls.push(String(url));
      const html = typeof manualHtml === 'function' ? manualHtml(String(url)) : manualHtml;
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
    delete window.__ODV_GET_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function openManual(html = MANUAL_HTML) {
    manualHtml = html;
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    for (let attempt = 0; attempt < 20 && !container.querySelector('.odv-manual-content'); attempt += 1) {
      await flush(50);
    }
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

  // The bundled manuals open images in a script-free lightbox: the thumbnail links to "#lb-x",
  // `.lb` is display:none until it is the fragment target, and "#lb-stang" (no element) closes it.
  const LIGHTBOX_HTML = [
    '<p>Intro</p><style>.lb { display: none; } .lb:target { display: block; }</style>',
    '<h2 id="start">1. Kom igång</h2><p><a href="#lb-bild"><img alt="thumb"></a></p>',
    '<h2>2. Skriva ut</h2><p>text</p>',
    '<div class="lb" id="lb-bild"><a href="#lb-stang"><img alt=""></a></div>',
  ].join('');

  it('lets lightbox links set the URL fragment so :target applies, without scrolling the pane', async () => {
    window.history.replaceState(null, '', '/viewer?bundle=1');
    await openManual(LIGHTBOX_HTML);
    fakeLayout();
    pane().scrollTop = 120;
    const lightbox = content().querySelector('#lb-bild');
    expect(window.getComputedStyle(lightbox).display).toBe('none');

    act(() => { content().querySelector('a[href="#lb-bild"]').click(); });
    expect(window.location.hash).toBe('#lb-bild');
    expect(window.location.search).toBe('?bundle=1');
    // jsdom does not recompute styles for :target; the Playwright spec checks the real rendering.
    expect(lightbox.matches(':target')).toBe(true);
    expect(pane().scrollTop).toBe(120);
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#start']);

    act(() => { content().querySelector('a[href="#lb-stang"]').click(); });
    expect(window.location.hash).toBe('#lb-stang');
    expect(lightbox.matches(':target')).toBe(false);
    expect(pane().scrollTop).toBe(120);
    expect(current().map((node) => node.getAttribute('href'))).toEqual(['#start']);

    // A heading link still scrolls only the pane and puts the viewer's URL back.
    act(() => { linkByHref('#skriva-ut').click(); });
    expect(pane().scrollTop).toBe(800 - 8);
    expect(window.location.hash).toBe('');
    expect(window.location.href.endsWith('/viewer?bundle=1')).toBe(true);
  });

  it('puts the viewer URL back when the dialog closes with a lightbox open', async () => {
    window.history.replaceState(null, '', '/viewer#keep');
    await openManual(LIGHTBOX_HTML);
    act(() => { content().querySelector('a[href="#lb-bild"]').click(); });
    expect(window.location.hash).toBe('#lb-bild');
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: false, onClose }));
    });
    expect(window.location.hash).toBe('#keep');
    window.history.replaceState(null, '', '/');
  });

  it('returns focus to the opener when the dialog closes', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const returnFocusRef = { current: opener };
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose, returnFocusRef }));
    });
    await flush(50);
    expect(document.activeElement).not.toBe(opener);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: false, onClose, returnFocusRef }));
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps forward and reverse Tab navigation inside the modal dialog', async () => {
    await openManual();
    const first = container.querySelector('button[aria-label="Reload manual from server"]');
    const last = container.querySelector('.odv-help-footer button');
    last.focus();
    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    first.focus();
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it('rewrites responsive srcset candidates against the resolved manual URL', async () => {
    const resolvedUrl = 'https://manual.example.test/help/site/manual.sv.html';
    vi.stubGlobal('fetch', async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        url: resolvedUrl,
        text: async () => [
          '<picture>',
          '<source id="responsive-source" srcset="img/manual-480.png 480w, img/manual-960.png 960w">',
          '<img id="responsive-image" src="img/fallback.png" alt="Responsive" ',
          'srcset="img/manual-small.png 1x, https://cdn.example.test/manual@2x.png 2x, data:image/png;base64,AAAA 3x">',
          '</picture>',
        ].join(''),
      };
    });
    await openManual();

    expect(content().querySelector('#responsive-source').getAttribute('srcset')).toBe(
      'https://manual.example.test/help/site/img/manual-480.png 480w, '
      + 'https://manual.example.test/help/site/img/manual-960.png 960w'
    );
    expect(content().querySelector('#responsive-image').getAttribute('srcset')).toBe(
      'https://manual.example.test/help/site/img/manual-small.png 1x, '
      + 'https://cdn.example.test/manual@2x.png 2x, data:image/png;base64,AAAA 3x'
    );
    expect(content().querySelector('#responsive-image').getAttribute('src'))
      .toBe('https://manual.example.test/help/site/img/fallback.png');
  });

  it('never gives a manual heading one of the dialog\'s own ids', async () => {
    await openManual('<h2 id="odv-manual-contents">Innehåll</h2><h2>Mer</h2>');
    expect(document.querySelectorAll('#odv-manual-contents')).toHaveLength(1);
    expect(nav().id).toBe('odv-manual-contents');
    expect(toggle().getAttribute('aria-controls')).toBe('odv-manual-contents');
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

  it('prefers an existing site manual in auto mode', async () => {
    runtimeConfig = { help: { manual: { source: 'auto' } } };
    await openManual((url) => (url.includes('help/site/')
      ? '<h2 id="site-manual">Site-owned manual</h2>'
      : '<h2 id="default-manual">Default manual</h2>'));

    expect(content().querySelector('#site-manual')).not.toBeNull();
    expect(content().querySelector('#default-manual')).toBeNull();
    expect(requestedUrls[0]).toContain('help/site/manual.sv.html');
  });

  it.each([
    ['omitted', {}],
    ['invalid', { source: 'unexpected-mode' }],
  ])('uses filtered generated standard content with an %s source when no site manual exists', async (_label, manual) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runtimeConfig = {
      help: { manual },
      compare: { overlay: { enabled: false } },
    };
    vi.stubGlobal('fetch', async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.includes('help/site/')) return { ok: false, url: target, text: async () => '' };
      return { ok: true, url: target, text: async () => '<h2 id="default-manual">Unfiltered default</h2>' };
    });
    await openManual();

    expect(content().querySelector('#urval-oppna')).not.toBeNull();
    expect(content().querySelector('#default-manual')).toBeNull();
    expect(content().querySelector('#jmf-overlagring')).toBeNull();
    expect(linkByHref('#jmf-overlagring')).toBeUndefined();
    expect(requestedUrls).toEqual(['help/site/manual.sv.html']);
    if (manual.source) expect(warning).toHaveBeenCalledWith(expect.stringContaining('unexpected-mode'));

    act(() => { container.querySelector('button[aria-label="Reload manual from server"]').click(); });
    await flush(50);
    expect(content().querySelector('#urval-oppna')).not.toBeNull();
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toBe('help/site/manual.sv.html');
    expect(requestedUrls[1]).toContain('/help/site/manual.sv.html?odvManualRefresh=');
    expect(requestedUrls.some((url) => url.includes('help/default/manual.'))).toBe(false);
  });

  it('loads preferred-language standard content before trying the fallback-language site', async () => {
    runtimeConfig = {
      help: { manual: { source: 'auto', fallbackLanguage: 'en' } },
      compare: { overlay: { enabled: false } },
    };
    vi.stubGlobal('fetch', async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target === 'help/site/manual.sv.html') return { ok: false, url: target, text: async () => '' };
      return { ok: true, url: target, text: async () => '<h2 id="wrong-source">Wrong source</h2>' };
    });
    await openManual();

    expect(content().querySelector('#urval-oppna')).not.toBeNull();
    expect(content().querySelector('#wrong-source')).toBeNull();
    expect(content().querySelector('#jmf-overlagring')).toBeNull();
    expect(requestedUrls).toEqual(['help/site/manual.sv.html']);
  });

  it('lets the fallback-language site win after an unsupported language and its HTML fallback fail', async () => {
    mockI18n.language = 'de';
    mockI18n.resolvedLanguage = 'de';
    runtimeConfig = {
      help: { manual: { source: 'auto', fallbackLanguage: 'en' } },
      compare: { overlay: { enabled: false } },
    };
    vi.stubGlobal('fetch', async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target === 'help/site/manual.en.html') {
        return {
          ok: true,
          url: target,
          text: async () => '<h2 id="fallback-site">Fallback site</h2><h2 id="jmf-overlay">Site overlay</h2>',
        };
      }
      return { ok: false, url: target, text: async () => '' };
    });
    await openManual();

    expect(content().querySelector('#fallback-site')).not.toBeNull();
    expect(content().querySelector('#jmf-overlay')).not.toBeNull();
    expect(requestedUrls).toEqual([
      'help/site/manual.de.html',
      'help/default/manual.de.html',
      'help/site/manual.en.html',
    ]);
  });

  it('never filters arbitrary site HTML from a configurable site template', async () => {
    runtimeConfig = {
      help: { manual: { source: 'auto', sitePathTemplate: 'organization/help.{{lng}}.html' } },
      compare: { overlay: { enabled: false } },
    };
    await openManual([
      '<h2 id="jmf-avstangt">Site switch notes</h2><p>Site-owned switch text</p>',
      '<h2 id="jmf-overlay">Site overlay</h2><p>Site-owned overlay text</p>',
    ].join(''));

    expect(content().querySelector('#jmf-avstangt')).not.toBeNull();
    expect(content().querySelector('#jmf-overlay')).not.toBeNull();
    expect(content().textContent).toContain('Site-owned switch text');
    expect(content().textContent).toContain('Site-owned overlay text');
    expect(requestedUrls).toEqual(['organization/help.sv.html']);
  });

  it('ignores site files and fetches nothing on the normal standard path', async () => {
    runtimeConfig = { help: { manual: { source: 'standard' } } };
    await openManual('<h2 id="site-manual">Site manual must not load</h2>');

    expect(content().querySelector('#urval-oppna')).not.toBeNull();
    expect(content().querySelector('#site-manual')).toBeNull();
    expect(requestedUrls).toEqual([]);
  });

  it('warns and uses auto for an invalid manual source', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runtimeConfig = { help: { manual: { source: 'unexpected-mode' } } };
    await openManual('<h2 id="site-manual">Site manual after warning</h2>');

    expect(content().querySelector('#site-manual')).not.toBeNull();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('help.manual.source'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('unexpected-mode'));
    expect(requestedUrls[0]).toContain('help/site/manual.sv.html');
  });

  it('filters standard headings before building contents and restores them when enabled', async () => {
    const title = 'Lägg sidorna på varandra (överlagring)';
    runtimeConfig = {
      help: { manual: { source: 'standard' } },
      compare: { overlay: { enabled: false } },
    };
    await openManual();

    expect(content().querySelector('#jmf-overlagring')).toBeNull();
    expect(content().querySelector('#jmf-gardin')).not.toBeNull();
    expect(links().some((node) => node.textContent.includes(title))).toBe(false);
    expect(requestedUrls).toEqual([]);

    runtimeConfig.compare.overlay.enabled = true;
    act(() => { container.querySelector('button[aria-label="Reload manual from server"]').click(); });
    await flush(50);
    expect(content().querySelector('#jmf-overlagring')).not.toBeNull();
    expect(links().some((node) => node.textContent.includes(title))).toBe(true);
    expect(requestedUrls).toEqual([]);
  });

  it.each(['standard', 'auto'])('filters configured fallback HTML after a chunk failure in %s mode', async (source) => {
    vi.resetModules();
    mockManualModules.failEnglishChunk = true;
    mockI18n.language = 'en';
    mockI18n.resolvedLanguage = 'en';
    runtimeConfig = {
      help: { manual: { source, fallbackPathTemplate: 'custom-fallback/manual.{{lng}}.html' } },
      compare: { overlay: { enabled: false } },
    };
    vi.stubGlobal('fetch', async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.includes('help/site/')) return { ok: false, url: target, text: async () => '' };
      return {
        ok: true,
        url: 'http://localhost:3000/custom-fallback/manual.en.html',
        text: async () => [
          '<h2 id="jmf-overlay">Hidden fallback overlay</h2><p>Hidden fallback body</p>',
          '<h2 id="following">Visible fallback section</h2><p>Visible fallback body</p>',
          '<img id="fallback-image" src="img/fallback.png" alt="Fallback">',
        ].join(''),
      };
    });
    await openManual();

    expect(content().querySelector('#jmf-overlay')).toBeNull();
    expect(content().querySelector('#following')).not.toBeNull();
    expect(content().textContent).not.toContain('Hidden fallback body');
    expect(content().querySelector('#fallback-image').getAttribute('src'))
      .toBe('http://localhost:3000/custom-fallback/img/fallback.png');
    expect(requestedUrls).toEqual(source === 'standard'
      ? ['custom-fallback/manual.en.html']
      : ['help/site/manual.en.html', 'custom-fallback/manual.en.html']);
  });

  it('uses the standard fallback language when the UI language has no generated manual', async () => {
    mockI18n.language = 'de';
    mockI18n.resolvedLanguage = 'de';
    runtimeConfig = { help: { manual: { source: 'standard', fallbackLanguage: 'en' } } };
    await openManual();

    expect(content().querySelector('#urval-open')).not.toBeNull();
    expect(content().querySelector('#urval-oppna')).toBeNull();
    expect(requestedUrls).toEqual([]);
  });

  it.each(['standard', 'auto'])('resolves healthy %s module images and lightboxes against help/default with a custom HTML fallback', async (source) => {
    runtimeConfig = {
      help: { manual: { source, fallbackPathTemplate: 'custom-fallback/manual.{{lng}}.html' } },
    };
    vi.stubGlobal('fetch', async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      return { ok: false, url: target, text: async () => '' };
    });
    await openManual();

    const image = content().querySelector('img[src*="help/default/img/"]');
    expect(image).not.toBeNull();
    expect(new URL(image.getAttribute('src')).pathname).toContain('/help/default/img/');
    expect(image.getAttribute('src')).not.toContain('custom-fallback');
    const lightboxLink = content().querySelector('a[href^="#lb-"]:not([href="#lb-stang"])');
    expect(lightboxLink).not.toBeNull();
    act(() => { lightboxLink.click(); });
    expect(window.location.hash).toBe(lightboxLink.getAttribute('href'));
    expect(requestedUrls).toEqual(source === 'auto' ? ['help/site/manual.sv.html'] : []);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: false, onClose }));
    });
  });

  it.each(['auto', 'standard'])('renders %s mode without reading an unrelated throwing manual getter', async (source) => {
    runtimeConfig = {
      help: {
        manual: {
          source,
          get hostOnlySetting() { throw new Error('Unrelated host getter must not be read'); },
        },
      },
    };
    await openManual('<h2 id="loaded-manual">Loaded manual</h2>');

    expect(content()).not.toBeNull();
    expect(container.querySelector('.odv-help-placeholder.is-error')).toBeNull();
    expect(container.querySelector('button[aria-label="Reload manual from server"]').disabled).toBe(false);
    if (source === 'auto') expect(content().querySelector('#loaded-manual')).not.toBeNull();
    else expect(content().querySelector('#urval-oppna')).not.toBeNull();
  });

  it('uses existing defaults when optional standard-manual settings cannot be read', async () => {
    runtimeConfig = {
      help: {
        manual: {
          source: 'standard',
          get fallbackLanguage() { throw new Error('Unreadable fallback language'); },
          get fallbackPathTemplate() { throw new Error('Unreadable fallback path'); },
        },
      },
    };
    await openManual();

    expect(content().querySelector('#urval-oppna')).not.toBeNull();
    expect(requestedUrls).toEqual([]);
  });

  it('settles a non-abort standard load failure to a visible error', async () => {
    runtimeConfig = {
      help: {
        manual: {
          source: 'standard',
          fallbackPathTemplate: { toString() { throw new Error('Invalid fallback path'); } },
        },
      },
    };
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    for (let attempt = 0; attempt < 20 && !container.querySelector('.odv-help-placeholder.is-error'); attempt += 1) {
      await flush(50);
    }

    expect(container.querySelector('.odv-help-placeholder.is-error')?.textContent)
      .toContain('No manual file could be loaded for this language.');
    expect(container.querySelector('.odv-help-placeholder')?.textContent).not.toContain('Loading manual');
    expect(container.querySelector('button[aria-label="Reload manual from server"]').disabled).toBe(false);
  });

  it('does not apply an aborted Swedish load after switching to English', async () => {
    vi.stubGlobal('fetch', (url, options) => new Promise((resolve, reject) => {
      if (String(url).includes('manual.sv.html')) {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
        return;
      }
      resolve({
        ok: true,
        url: String(url),
        text: async () => '<h2 id="english-manual">English manual</h2>',
      });
    }));
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    await flush(0);

    mockI18n.language = 'en';
    mockI18n.resolvedLanguage = 'en';
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    await flush(50);

    expect(content().querySelector('#english-manual')).not.toBeNull();
    expect(container.querySelector('.odv-help-placeholder.is-error')).toBeNull();
  });

  it('aborts a pending source fetch when the dialog closes', async () => {
    let aborted = false;
    vi.stubGlobal('fetch', (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
    await flush(0);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: false, onClose }));
    });
    await flush(20);

    expect(aborted).toBe(true);
    expect(content()).toBeNull();
  });
});
