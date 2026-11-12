// @vitest-environment jsdom
// File: src/components/__tests__/ocrSearchBar.test.jsx
/**
 * The toolbar's OCR search (DocumentToolbar/OcrSearchBar.jsx): the button shows the displayed
 * page's status and is enabled once its text is recognised; the field opens with a term and a
 * position, walks the matches with Enter/Shift+Enter and the arrows (moving to the match's page
 * when it is another one), publishes the term and the current match to the viewer, reports the
 * pages the search covers, and closes with Escape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerContext from '../../contexts/viewerContext.js';
import { makeOcrPageKey } from '../../utils/ocrPageKey.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      let text = (options && options.defaultValue) || key;
      for (const [name, value] of Object.entries(options || {})) text = text.replace(`{${name}}`, String(value));
      return text;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

const { default: OcrSearchBar } = await import('../DocumentToolbar/OcrSearchBar.jsx');

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const PAGES = [
  { sourceKey: 'doc', pageIndex: 0 },
  { sourceKey: 'doc', pageIndex: 1 },
  { sourceKey: 'doc', pageIndex: 2 },
];
const KEY = (index) => makeOcrPageKey('doc', index);
const done = (texts) => ({
  status: 'done',
  words: texts.map((text, i) => ({ text, bbox: box(i * 100, 0, i * 100 + 80, 20) })),
  imageWidth: 1000,
  imageHeight: 1000,
});

describe('OcrSearchBar', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = ({ ocrPages = {}, ocrEngineFailure = null, ocrBoost, pageNumber = 1, setPageNumber = vi.fn(), setOcrSearch = vi.fn(), searchEnabled, ctrlFOverride }) => {
    act(() => {
      root.render(createElement(
        ViewerContext.Provider,
        { value: { ocrPages, ocrEngineFailure, setOcrSearch, ...(ocrBoost === undefined ? {} : { ocrBoost }) } },
        createElement(OcrSearchBar, {
          pageNumber,
          setPageNumber,
          allPages: PAGES,
          ...(searchEnabled === undefined ? {} : { searchEnabled }),
          ...(ctrlFOverride === undefined ? {} : { ctrlFOverride }),
        })
      ));
    });
    return { setPageNumber, setOcrSearch };
  };
  /** A toolbar around the search with a measurable width and spacer (jsdom lays nothing out). */
  const fakeToolbar = ({ width, scrollWidth = width, spacerWidth, anchorRight = 0 }) => {
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    container.className = 'toolbar';
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(container, 'scrollWidth', { configurable: true, value: scrollWidth });
    const spacer = document.createElement('div');
    spacer.className = 'toolbar-spacer';
    spacer.getBoundingClientRect = () => ({ width: spacerWidth, height: 0, top: 0, left: 0, right: spacerWidth, bottom: 0 });
    container.appendChild(spacer);
    const mount = document.createElement('div');
    container.appendChild(mount);
    document.body.appendChild(container);
    root = createRoot(mount);
    if (anchorRight > 0) {
      Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
    }
  };
  const button = () => container.querySelector('[data-odv-ocr="status"]');
  const boostBadge = () => container.querySelector('[data-odv-ocr="boost"]');
  const searchRoot = () => container.querySelector('[data-odv-ocr="search"]');
  const boost = (overrides = {}) => ({
    state: 'cautious', level: 8, cautious: 8, levels: [12, 16, 20, 24], baselineMs: null, probes: [], settledLevel: null, ...overrides,
  });

  it('shows and says nothing about the boost without one: no badge, no attribute, the tooltip as before', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    const plainTitle = button().getAttribute('title');
    expect(boostBadge()).toBeNull();
    expect(searchRoot().hasAttribute('data-ocr-boost')).toBe(false);
    expect(plainTitle).not.toMatch(/boost/i);
    // A boost state without a level above the cautious count is no boost either.
    render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ocrBoost: null });
    expect(button().getAttribute('title')).toBe(plainTitle);
    render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ocrBoost: boost({ levels: [] }) });
    expect(button().getAttribute('title')).toBe(plainTitle);
    expect(searchRoot().hasAttribute('data-ocr-boost')).toBe(false);
  });

  it('with a boost, ends the tooltip with its state and shows the badge only while more engines than the cautious count run', () => {
    const ocrPages = { [KEY(0)]: done(['Hej']) };
    render({ ocrPages, ocrBoost: boost() });
    expect(button().getAttribute('title')).toMatch(/ · OCR boost: ready$/);
    expect(searchRoot().getAttribute('data-ocr-boost')).toBe('cautious');
    expect(boostBadge()).toBeNull();

    render({ ocrPages, ocrBoost: boost({ state: 'rising' }) });
    expect(button().getAttribute('title')).toMatch(/ · OCR boost: measuring the starting point$/);
    expect(boostBadge()).toBeNull();

    render({ ocrPages, ocrBoost: boost({ state: 'rising', level: 12, baselineMs: 2000 }) });
    expect(button().getAttribute('title')).toMatch(/ · OCR boost: trying 12 workers$/);
    expect(searchRoot().getAttribute('data-ocr-boost')).toBe('rising');
    expect(boostBadge().textContent).toBe('bolt12');
    expect(boostBadge().getAttribute('aria-hidden')).toBe('true');

    const probes = [{ level: 12, ms: 2200, slow: false }, { level: 16, ms: 2620, slow: true }];
    render({ ocrPages, ocrBoost: boost({ state: 'boosted', level: 12, baselineMs: 2000, settledLevel: 12, probes }) });
    expect(button().getAttribute('title')).toMatch(/ · OCR boost: 12 workers \(16 workers took 31 % longer\)$/);
    expect(boostBadge().textContent).toBe('bolt12');

    // Input ended it: the badge goes, the tooltip keeps what the climb found.
    render({ ocrPages, ocrBoost: boost({ baselineMs: 2000, settledLevel: 12, probes }) });
    expect(button().getAttribute('title')).toMatch(/ · Last OCR boost: 12 workers \(16 workers took 31 % longer\)$/);
    expect(boostBadge()).toBeNull();
  });

  it('shows the boost on the status-only button too', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej']) }, searchEnabled: false, ocrBoost: boost({ state: 'boosted', level: 16, baselineMs: 2000, settledLevel: 16, probes: [{ level: 16, ms: 2100, slow: false }] }) });
    expect(button().getAttribute('title')).toBe('Text recognised · OCR boost: 16 workers');
    expect(button().getAttribute('aria-label')).toBe('Text recognised');
    expect(boostBadge().textContent).toBe('bolt16');
    expect(searchRoot().getAttribute('data-ocr-boost')).toBe('boosted');
  });
  const input = () => container.querySelector('.toolbar-ocr-search-input');
  const status = () => container.querySelector('.toolbar-ocr-search-status-short').textContent;
  const statusLong = () => container.querySelector('.toolbar-ocr-search-status .sr-only').textContent;
  const type = (value) => act(() => {
    const field = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const key = (name, init = {}) => act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  });

  it('shows the displayed page\'s status on the button and enables it once the text is recognised', () => {
    render({ ocrPages: {} });
    expect(button().getAttribute('data-ocr-state')).toBe('notStarted');
    expect(button().disabled).toBe(true);
    expect(container.querySelector('.odv-status-led--off')).not.toBeNull();

    render({ ocrPages: { [KEY(0)]: { status: 'recognizing' } } });
    expect(button().getAttribute('data-ocr-state')).toBe('working');
    expect(button().disabled).toBe(true);
    expect(container.querySelector('[data-odv-ocr="status-text"]').textContent).toBe('Recognising text…');
    expect(container.querySelector('[data-odv-ocr="status-text"]').getAttribute('aria-live')).toBe('polite');
    expect(button().title).toBe('Recognising text… · 0 of 3 pages ready');
    expect(container.querySelector('.odv-status-led--pending')).not.toBeNull();

    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    expect(button().getAttribute('data-ocr-state')).toBe('done');
    expect(button().disabled).toBe(false);
    expect(button().title).toBe('Search in the recognised text · Text recognised · 1 of 3 pages ready');
    expect(container.querySelector('.odv-status-led--ready')).not.toBeNull();
    // The count on the button: pages with a text layer over all pages, behind a divider.
    const count = () => container.querySelector('[data-odv-ocr="count"]');
    expect(count().textContent).toBe('1/3');
    expect(count().querySelector('.toolbar-ocr-search-count-divider')).not.toBeNull();
    expect(count().getAttribute('aria-hidden')).toBe('true');
    // Assistive technology gets the count as the button's description, spelt out.
    const described = document.getElementById(button().getAttribute('aria-describedby'));
    expect(described.textContent).toBe('1 of 3 pages ready');
    expect(described.getAttribute('data-odv-ocr')).toBe('coverage-text');
    render({ ocrPages: { [KEY(0)]: done(['Hej']), [KEY(2)]: done(['Då']) } });
    expect(count().textContent).toBe('2/3');

    // The engine failed later in the session: a page already done keeps its own status and
    // can still be searched; a page without a final outcome says the engine is unavailable.
    render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ocrEngineFailure: 'csp' });
    expect(button().getAttribute('data-ocr-state')).toBe('done');
    expect(button().disabled).toBe(false);
    expect(container.querySelector('.odv-status-led--ready')).not.toBeNull();
    render({ ocrPages: { [KEY(0)]: { status: 'queued' } }, ocrEngineFailure: 'csp' });
    expect(button().getAttribute('data-ocr-state')).toBe('unavailable');
    expect(container.querySelector('.odv-status-led--error')).not.toBeNull();
    render({ ocrPages: {}, ocrEngineFailure: 'csp' });
    expect(button().getAttribute('data-ocr-state')).toBe('unavailable');
    expect(button().disabled).toBe(true);
  });

  it('a PDF page with its own text says so and is searched like a recognised page', () => {
    const pdfText = { ...done(['diarienummer', '2026-4471']), source: 'pdf-text', imageWidth: 595.28, imageHeight: 841.89 };
    const { setOcrSearch } = render({ ocrPages: { [KEY(0)]: pdfText, [KEY(1)]: done(['diarienummer']) } });
    expect(button().getAttribute('data-ocr-state')).toBe('pdfText');
    expect(button().title).toBe('Search in the recognised text · The page has its own text · 2 of 3 pages ready');
    expect(button().disabled).toBe(false);
    expect(container.querySelector('.odv-status-led--ready')).not.toBeNull();
    act(() => button().click());
    type('diarienummer 2026');
    expect(status()).toBe('1/1 · 2/3 pages searched');
    // Spelt out for assistive technology (and the tooltip).
    expect(statusLong()).toBe('Match 1 of 1 · Searched 2 of 3 pages');
    expect(container.querySelector('.toolbar-ocr-search-status').title).toBe('Match 1 of 1 · Searched 2 of 3 pages');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'diarienummer 2026', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });
    type('diarienummer');
    expect(status()).toBe('1/2 · 2/3 pages searched');
  });

  it('a text-layer PDF page whose text could not be placed says so; the search opens from it once another page has text', () => {
    render({ ocrPages: { [KEY(0)]: { status: 'skipped', reason: 'text-layer' } } });
    expect(button().getAttribute('data-ocr-state')).toBe('skippedTextLayer');
    expect(button().title).toBe('Not recognised: the page has its own text · 0 of 3 pages ready');
    expect(button().disabled).toBe(true);
    render({ ocrPages: { [KEY(0)]: { status: 'skipped', reason: 'text-layer' }, [KEY(2)]: done(['hej']) } });
    expect(button().getAttribute('data-ocr-state')).toBe('skippedTextLayer');
    expect(button().disabled).toBe(false);
  });

  it('works in original session page numbers: a displayed page 3 indexes the third page', () => {
    const pages = { [KEY(2)]: done(['hej']) };
    const { setOcrSearch } = render({ ocrPages: pages, pageNumber: 3 });
    expect(button().getAttribute('data-ocr-state')).toBe('done');
    act(() => button().click());
    type('hej');
    expect(status()).toBe('1/1 · 1/3 pages searched');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
  });

  it('the position is right in the same render as the matches, never "0 of N"', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej', 'hej']) } });
    act(() => button().click());
    // Every text the status node held BEFORE each change while the term is typed (the old
    // values and the removed nodes, not the node's text after the fact): a position chosen in
    // an effect after the render commits "0 of 2" first and replaces it in a second commit.
    const before = [];
    const record = (records) => {
      for (const entry of records) {
        if (entry.type === 'characterData') before.push(entry.oldValue ?? '');
        for (const node of entry.removedNodes) before.push(node.textContent ?? '');
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(container.querySelector('.toolbar-ocr-search-status'), {
      childList: true, characterData: true, characterDataOldValue: true, subtree: true,
    });
    type('hej');
    record(observer.takeRecords());
    observer.disconnect();
    expect(status()).toBe('1/2 · 1/3 pages searched');
    for (const text of before) expect(text).not.toMatch(/^0 /);
  });

  it('a match on a page the print selection hides: the first Enter asks for its page, the next moves on', () => {
    // setPageNumber lands on the nearest shown page: page 2 stays displayed (the viewer renders
    // again with the same pageNumber), as the viewer does for a hidden page.
    const pages = { [KEY(1)]: done(['hej']), [KEY(2)]: done(['hej']) };
    const setPageNumber = vi.fn();
    const { setOcrSearch } = render({ ocrPages: pages, pageNumber: 2, setPageNumber });
    act(() => button().click());
    type('hej');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 }, onlyPageKey: null });
    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(3);
    // The viewer could not show page 3; it is still page 2.
    render({ ocrPages: pages, pageNumber: 2, setPageNumber, setOcrSearch });
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
    key('Enter');
    // Not asked for page 3 again: moved on (wrapping round to the first match, on page 2).
    expect(setPageNumber).toHaveBeenCalledTimes(1);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 }, onlyPageKey: null });
  });

  it('landing on another shown page after asking for a hidden one costs no second request', () => {
    // Pages 1 and 3 shown, page 2 hidden: a match on page 2 is asked for, the viewer lands on
    // page 3 (the nearest shown), and the next Enter moves on instead of asking again.
    const pages = { [KEY(0)]: done(['hej']), [KEY(1)]: done(['hej']), [KEY(2)]: done(['hej']) };
    const setPageNumber = vi.fn();
    const { setOcrSearch } = render({ ocrPages: pages, pageNumber: 1, setPageNumber });
    act(() => button().click());
    type('hej');
    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(2);
    render({ ocrPages: pages, pageNumber: 3, setPageNumber, setOcrSearch });
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 }, onlyPageKey: null });
    key('Enter');
    expect(setPageNumber).toHaveBeenCalledTimes(1);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
  });

  it('a new term forgets the page asked for: the same match is asked for again, not stepped past', () => {
    // Displayed page 1 has no text; page 3 (hidden) holds two matches. After asking for its page
    // the viewer stays on page 1. A new term that keeps the same first match asks for the page
    // again (current stays the first match) instead of moving on to the second.
    const pages = { [KEY(2)]: done(['hej', 'hej']) };
    const setPageNumber = vi.fn();
    const { setOcrSearch } = render({ ocrPages: pages, pageNumber: 1, setPageNumber });
    act(() => button().click());
    type('hej');
    key('Enter');
    expect(setPageNumber).toHaveBeenCalledTimes(1);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
    type('he');
    key('Enter');
    expect(setPageNumber).toHaveBeenCalledTimes(2);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'he', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
    // Still on page 1 (hidden page): the next Enter moves on to the second match.
    key('Enter');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'he', current: { pageKey: KEY(2), ordinal: 1 }, onlyPageKey: null });
  });

  it('limited to the displayed page: its matches only, the steps stay on it, the page\'s status when it has no text', () => {
    const pages = { [KEY(0)]: done(['Hej', 'hej']), [KEY(1)]: { status: 'recognizing' }, [KEY(2)]: done(['hej', 'hej', 'hej']) };
    const { setOcrSearch, setPageNumber } = render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    expect(status()).toBe('1/5 · 2/3 pages searched');
    const scope = () => container.querySelector('.toolbar-ocr-search-scope');
    const checkbox = () => scope().querySelector('input[type="checkbox"]');
    expect(checkbox().checked).toBe(false);
    expect(scope().title).toBe('Search only on this page');
    expect(checkbox().getAttribute('aria-label')).toBe('Search only on this page');
    expect(scope().textContent).toBe('This page');

    act(() => checkbox().click());
    expect(checkbox().checked).toBe(true);
    expect(scope().classList.contains('is-active')).toBe(true);
    // Only page 1's matches, no coverage line, and the page is published with the term.
    expect(status()).toBe('1/2');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: KEY(0) });
    key('Enter');
    expect(status()).toBe('2/2');
    key('Enter');
    expect(status()).toBe('1/2');
    expect(setPageNumber).not.toHaveBeenCalled();

    // The viewer moves to page 3 (the user): the matches are that page's now.
    render({ ocrPages: pages, pageNumber: 3, setPageNumber, setOcrSearch });
    expect(status()).toBe('1/3');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: KEY(2) });
    // Page 2 is still being recognised: its status, not "No matches".
    render({ ocrPages: pages, pageNumber: 2, setPageNumber, setOcrSearch });
    expect(status()).toBe('Recognising text…');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: null, onlyPageKey: KEY(1) });
    expect(container.querySelector('[aria-label="Next match"]').disabled).toBe(true);

    // Off again: the whole document, from the displayed page on.
    act(() => checkbox().click());
    expect(checkbox().checked).toBe(false);
    expect(scope().classList.contains('is-active')).toBe(false);
    expect(status()).toBe('3/5 · 2/3 pages searched');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
  });

  it('a mouse click on the page checkbox leaves the focus in the input, so Enter still steps', () => {
    const pages = { [KEY(0)]: done(['hej', 'hej']) };
    render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    expect(document.activeElement).toBe(input());
    const scope = container.querySelector('.toolbar-ocr-search-scope');
    const checkbox = scope.querySelector('input[type="checkbox"]');
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { checkbox.dispatchEvent(mouseDown); });
    expect(mouseDown.defaultPrevented).toBe(true);
    // The browser gives the checkbox the focus on activation; the change hands it back.
    act(() => { checkbox.focus(); checkbox.click(); });
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(input());
    key('Enter');
    expect(status()).toBe('2/2');
    expect(checkbox.checked).toBe(true);
  });

  it('a keyboard change of the page checkbox leaves the focus on the checkbox', () => {
    const pages = { [KEY(0)]: done(['hej', 'hej']) };
    render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    const checkbox = container.querySelector('.toolbar-ocr-search-scope input[type="checkbox"]');
    act(() => { checkbox.focus(); checkbox.click(); });
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(checkbox);
  });

  it('a right click or a press that never became a change does not hand a later keyboard change\'s focus to the input', () => {
    const pages = { [KEY(0)]: done(['hej', 'hej']) };
    render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    const scope = container.querySelector('.toolbar-ocr-search-scope');
    const checkbox = scope.querySelector('input[type="checkbox"]');
    // A right click: no change follows; the flag is never raised.
    act(() => { scope.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 })); });
    act(() => { checkbox.focus(); checkbox.click(); });
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(checkbox);
    // A left press dragged away (no change), then Space: the key press clears the flag.
    act(() => { scope.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    act(() => { checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); checkbox.click(); });
    expect(checkbox.checked).toBe(false);
    expect(document.activeElement).toBe(checkbox);
  });

  it('Escape closes the field from the step buttons too', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    act(() => button().click());
    const next = container.querySelector('[aria-label="Next match"]');
    act(() => next.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('.toolbar-ocr-search').classList.contains('is-open')).toBe(false);
    expect(document.activeElement).toBe(button());
  });

  it('opens on click, focuses the field, finds matches and publishes the current one on the displayed page', () => {
    const pages = { [KEY(0)]: done(['Hej', 'världen']), [KEY(1)]: done(['hej', 'igen']) };
    const { setOcrSearch, setPageNumber } = render({ ocrPages: pages });
    expect(container.querySelector('.toolbar-ocr-search').classList.contains('is-open')).toBe(false);
    expect(setOcrSearch).toHaveBeenLastCalledWith(null);

    act(() => button().click());
    expect(container.querySelector('.toolbar-ocr-search').classList.contains('is-open')).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(input());

    type('HEJ');
    expect(status()).toBe('1/2 · 2/3 pages searched');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });
    expect(setPageNumber).not.toHaveBeenCalled();
  });

  it('Enter walks to the next match, moving to its page; Shift+Enter walks back; wrapping round', () => {
    const pages = { [KEY(0)]: done(['Hej', 'världen']), [KEY(2)]: done(['hej', 'hej']) };
    const { setOcrSearch, setPageNumber } = render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    expect(status()).toBe('1/3 · 2/3 pages searched');

    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(3);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 }, onlyPageKey: null });
    // The viewer shows page 3 now.
    render({ ocrPages: pages, pageNumber: 3, setPageNumber, setOcrSearch });
    expect(status()).toBe('2/3 · 2/3 pages searched');

    key('Enter');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 1 }, onlyPageKey: null });
    expect(status()).toBe('3/3 · 2/3 pages searched');

    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(1);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });

    render({ ocrPages: pages, pageNumber: 1, setPageNumber, setOcrSearch });
    key('Enter', { shiftKey: true });
    expect(setPageNumber).toHaveBeenLastCalledWith(3);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 1 }, onlyPageKey: null });
  });

  it('a current match on another page is shown first by Enter, before the position moves', () => {
    const pages = { [KEY(0)]: done(['inget']), [KEY(1)]: done(['hej', 'hej']) };
    const { setPageNumber, setOcrSearch } = render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    // No match on page 1: the first match (page 2) is current, but the page does not change.
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 }, onlyPageKey: null });
    expect(setPageNumber).not.toHaveBeenCalled();
    act(() => container.querySelector('[aria-label="Next match"]').click());
    expect(setPageNumber).toHaveBeenLastCalledWith(2);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 }, onlyPageKey: null });
  });

  it('reports no matches, keeps the current match when outcomes arrive, and closes with Escape', () => {
    const pages = { [KEY(0)]: done(['Hej']) };
    const { setOcrSearch } = render({ ocrPages: pages });
    act(() => button().click());
    type('xyz');
    expect(status()).toBe('No matches · 1/3 pages searched');
    expect(container.querySelector('[aria-label="Next match"]').disabled).toBe(true);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'xyz', current: null, onlyPageKey: null });

    type('hej');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });
    render({ ocrPages: { ...pages, [KEY(1)]: done(['hej']), [KEY(2)]: done(['hej']) }, setOcrSearch });
    expect(status()).toBe('1/3');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });

    key('Escape');
    expect(container.querySelector('.toolbar-ocr-search').classList.contains('is-open')).toBe(false);
    expect(setOcrSearch).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(button());
  });

  it('takes the room the toolbar has: the full width, a narrower field, or hanging under the toolbar', () => {
    const panel = () => container.querySelector('.toolbar-ocr-search-panel');
    fakeToolbar({ width: 1400, spacerWidth: 600 });
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    expect(panel().style.width).toBe('0px');
    act(() => button().click());
    // Measured (jsdom: the input's 48 px minimum, nothing else), the field asks for 200 px of
    // input: 220 + 152 = 372 of the 584 px of room.
    expect(panel().style.width).toBe('372px');
    expect(panel().getAttribute('data-placement')).toBe('inline');

    fakeToolbar({ width: 1400, spacerWidth: 250 });
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    act(() => button().click());
    expect(panel().style.width).toBe('234px');
    expect(panel().classList.contains('is-hanging')).toBe(false);

    fakeToolbar({ width: 1400, spacerWidth: 100 });
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    act(() => button().click());
    expect(panel().getAttribute('data-placement')).toBe('hanging');
    expect(panel().classList.contains('is-hanging')).toBe(true);
    expect(panel().style.width).toBe('340px');
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(panel().getAttribute('data-placement')).toBe('hanging');
    expect(panel().style.right).toBe('');
    act(() => container.querySelector('.toolbar-ocr-search-close').click());
    expect(panel().style.width).toBe('0px');

    // The toolbar overflows on its own and the search sits beyond the window: the hanging
    // field is pulled left into it. (The root's rect is read through the mount's: jsdom gives
    // the search's root no layout of its own, so the test lends it the mount's rect.)
    fakeToolbar({ width: 1000, scrollWidth: 1168, spacerWidth: 0, anchorRight: 1168 });
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    // The button is the anchor (the root would also hold an open inline field).
    button().getBoundingClientRect = () => ({ width: 32, height: 32, top: 0, left: 1136, right: 1168, bottom: 32 });
    container.querySelector('.toolbar-ocr-search').getBoundingClientRect = () => ({ width: 376, height: 32, top: 0, left: 1136, right: 1512, bottom: 32 });
    act(() => button().click());
    expect(panel().getAttribute('data-placement')).toBe('hanging');
    expect(panel().style.right).toBe('176px');
    delete document.documentElement.clientWidth;
  });

  it('grows the field for its status and hangs it when the toolbar has no room for that, never cutting the status short', () => {
    const panel = () => container.querySelector('.toolbar-ocr-search-panel');
    const statusBox = () => container.querySelector('.toolbar-ocr-search-status');
    const lend = (element, width) => {
      element.getBoundingClientRect = () => ({ width, height: 28, top: 0, left: 0, right: width, bottom: 28 });
    };
    // 600 px of room: the field opens at its usual 340, and grows for its status from there.
    fakeToolbar({ width: 1400, spacerWidth: 600 });
    // A hanging field is capped to the viewport (jsdom has none: the test lends it one).
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1400 });
    render({ ocrPages: { [KEY(0)]: done(['Hej', 'hej']), [KEY(1)]: { status: 'recognizing' } } });
    // jsdom lays nothing out: the field's checkbox and three buttons are lent 32 px each, its
    // gap 2 px, its input the laid-out minimum of 62 px (48 of content, 12 of padding, 2 of border).
    for (const control of container.querySelectorAll('.toolbar-ocr-search-scope, .toolbar-ocr-search-step, .toolbar-ocr-search-close')) lend(control, 32);
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === panel()) return { columnGap: '2px' };
      if (element === input()) return { minWidth: '48px', boxSizing: 'content-box', paddingLeft: '6px', paddingRight: '6px', borderLeftWidth: '1px', borderRightWidth: '1px' };
      return computed(element, pseudo);
    });
    act(() => button().click());
    // Opened with an empty status (0 px in jsdom): 62 + 128 + 10 = 200 px needed, so the inline
    // minimum of 220, and 358 with the input at its preferred 200 instead of its 62.
    expect(panel().style.width).toBe('358px');
    // 130 px of status: 330 px needed, 468 with the comfortable input, within the 584 px of room.
    lend(statusBox(), 130);
    type('hej');
    expect(status()).toBe('1/2 · 1/3 pages searched');
    expect(panel().getAttribute('data-placement')).toBe('inline');
    expect(panel().style.width).toBe('468px');
    // 250 px of status: 450 px needed, 588 asked for, so the field takes all 584 px of the room.
    lend(statusBox(), 250);
    type('he');
    expect(panel().getAttribute('data-placement')).toBe('inline');
    expect(panel().style.width).toBe('584px');
    // 400 px of status: 600 px needed, more than the room, so the field hangs under the toolbar,
    // 748 wide (738 with the comfortable input, plus its padding and border).
    lend(statusBox(), 400);
    type('hej');
    expect(panel().getAttribute('data-placement')).toBe('hanging');
    expect(panel().style.width).toBe('748px');
    // Hanging, a shorter status brings the field back inline (the room is still there).
    lend(statusBox(), 130);
    type('he');
    expect(panel().getAttribute('data-placement')).toBe('inline');
    expect(panel().style.width).toBe('468px');
    vi.restoreAllMocks();
    delete document.documentElement.clientWidth;
  });

  it('re-places the field when the toolbar\'s contents change while it is open', async () => {
    const panel = () => container.querySelector('.toolbar-ocr-search-panel');
    fakeToolbar({ width: 1400, spacerWidth: 600 });
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    act(() => button().click());
    expect(panel().getAttribute('data-placement')).toBe('inline');
    // A button appears in the toolbar and the room is gone (the spacer now measures 100).
    container.querySelector('.toolbar-spacer').getBoundingClientRect = () => ({ width: 100, height: 0, top: 0, left: 0, right: 100, bottom: 0 });
    await act(async () => {
      container.appendChild(document.createElement('button'));
      await Promise.resolve();
    });
    expect(panel().getAttribute('data-placement')).toBe('hanging');
  });

  it('the field is out of the tab order while closed and marked off for the viewer shortcuts', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    expect(input().tabIndex).toBe(-1);
    expect(container.querySelector('.toolbar-ocr-search-panel').getAttribute('data-odv-shortcuts')).toBe('off');
    expect(container.querySelector('.toolbar-ocr-search-panel').getAttribute('aria-hidden')).toBe('true');
    act(() => button().click());
    expect(input().tabIndex).toBe(0);
    expect(container.querySelector('.toolbar-ocr-search-panel').getAttribute('aria-hidden')).toBe('false');
  });

  it('with searchEnabled false keeps only the status: a never-enabled indicator, no field, nothing published', () => {
    const { setOcrSearch } = render({ ocrPages: { [KEY(0)]: done(['Hej']) }, searchEnabled: false });
    expect(container.querySelector('.toolbar-ocr-search').getAttribute('data-ocr-search')).toBe('off');
    expect(button().disabled).toBe(true);
    expect(button().classList.contains('is-status-only')).toBe(true);
    expect(button().getAttribute('data-ocr-state')).toBe('done');
    // The status is the indicator's own name and tooltip (no "Search in…" label to promise).
    expect(button().getAttribute('aria-label')).toBe('Text recognised');
    expect(button().title).toBe('Text recognised');
    expect(button().hasAttribute('aria-expanded')).toBe(false);
    expect(container.querySelector('.odv-status-led--ready')).not.toBeNull();
    expect(container.querySelector('[data-odv-ocr="status-text"]').textContent).toBe('Text recognised');
    expect(input()).toBeNull();
    expect(container.querySelector('.toolbar-ocr-search-panel')).toBeNull();
    act(() => button().click());
    expect(input()).toBeNull();
    // Nothing but the closed state reaches the viewer, so the layers mark nothing.
    expect(setOcrSearch.mock.calls.every(([value]) => value === null)).toBe(true);

    // The status follows the page as usual.
    render({ ocrPages: { [KEY(0)]: { status: 'recognizing' } }, searchEnabled: false });
    expect(button().getAttribute('data-ocr-state')).toBe('working');
    expect(button().getAttribute('aria-label')).toBe('Recognising text…');
    expect(container.querySelector('.odv-status-led--pending')).not.toBeNull();
  });

  describe('Ctrl+F handed over (ctrlFOverride)', () => {
    const ctrlF = (target, init = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true, ...init });
      act(() => { target.dispatchEvent(event); });
      return event;
    };

    it('is left to the browser without the switch', () => {
      render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
      expect(ctrlF(document.body).defaultPrevented).toBe(false);
      expect(input().tabIndex).toBe(-1);
      expect(button().title).toBe('Search in the recognised text · Text recognised · 1 of 3 pages ready');
    });

    it('opens the field, says so in the tooltip, and puts the cursor back in the open field with its text selected', () => {
      render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ctrlFOverride: true });
      expect(button().title).toBe('Search in the recognised text (Ctrl+F) · Text recognised · 1 of 3 pages ready');
      expect(button().getAttribute('aria-label')).toBe('Search in the recognised text');
      expect(ctrlF(document.body).defaultPrevented).toBe(true);
      expect(input().tabIndex).toBe(0);
      expect(document.activeElement).toBe(input());
      type('hej');
      // Already open, focus elsewhere: the cursor comes back and the text is selected.
      act(() => { button().focus(); });
      expect(ctrlF(button()).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input());
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe(3);
      // From inside the field too (its own panel is marked off for the viewer shortcuts).
      expect(ctrlF(input()).defaultPrevented).toBe(true);
      // Meta (Cmd on a Mac) works the same.
      expect(ctrlF(document.body, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    });

    it('stays the browser\'s with Shift or Alt, in another text field and while a modal dialog is open', () => {
      render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ctrlFOverride: true });
      expect(ctrlF(document.body, { shiftKey: true }).defaultPrevented).toBe(false);
      expect(ctrlF(document.body, { altKey: true }).defaultPrevented).toBe(false);
      expect(input().tabIndex).toBe(-1);

      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();
      expect(ctrlF(other).defaultPrevented).toBe(false);
      expect(input().tabIndex).toBe(-1);
      other.remove();

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      document.body.appendChild(dialog);
      expect(ctrlF(document.body).defaultPrevented).toBe(false);
      expect(input().tabIndex).toBe(-1);
      dialog.remove();
    });

    it('is never taken while the search itself is off', () => {
      render({ ocrPages: { [KEY(0)]: done(['Hej']) }, searchEnabled: false, ctrlFOverride: true });
      expect(ctrlF(document.body).defaultPrevented).toBe(false);
      expect(input()).toBeNull();
    });
  });
});
