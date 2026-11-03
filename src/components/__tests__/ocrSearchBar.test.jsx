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

  const render = ({ ocrPages = {}, ocrEngineFailure = null, pageNumber = 1, setPageNumber = vi.fn(), setOcrSearch = vi.fn() }) => {
    act(() => {
      root.render(createElement(
        ViewerContext.Provider,
        { value: { ocrPages, ocrEngineFailure, setOcrSearch } },
        createElement(OcrSearchBar, { pageNumber, setPageNumber, allPages: PAGES })
      ));
    });
    return { setPageNumber, setOcrSearch };
  };
  const button = () => container.querySelector('[data-odv-ocr="status"]');
  const input = () => container.querySelector('.toolbar-ocr-search-input');
  const status = () => container.querySelector('.toolbar-ocr-search-status').textContent;
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
    expect(button().title).toBe('Recognising text…');
    expect(container.querySelector('.odv-status-led--pending')).not.toBeNull();

    render({ ocrPages: { [KEY(0)]: done(['Hej']) } });
    expect(button().getAttribute('data-ocr-state')).toBe('done');
    expect(button().disabled).toBe(false);
    expect(button().title).toBe('Search in the recognised text · Text recognised');
    expect(container.querySelector('.odv-status-led--ready')).not.toBeNull();

    // The engine failed later in the session: the status says so, but text already recognised
    // on this page can still be searched.
    render({ ocrPages: { [KEY(0)]: done(['Hej']) }, ocrEngineFailure: 'csp' });
    expect(button().getAttribute('data-ocr-state')).toBe('unavailable');
    expect(button().disabled).toBe(false);
    expect(container.querySelector('.odv-status-led--error')).not.toBeNull();
    render({ ocrPages: {}, ocrEngineFailure: 'csp' });
    expect(button().disabled).toBe(true);
  });

  it('a text-layer PDF page says so; the search opens from it once another page has text', () => {
    render({ ocrPages: { [KEY(0)]: { status: 'skipped', reason: 'text-layer' } } });
    expect(button().getAttribute('data-ocr-state')).toBe('skippedTextLayer');
    expect(button().title).toBe('Not recognised: the page has its own text');
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
    expect(status()).toBe('1 of 1 · 1 of 3 pages recognised');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 } });
  });

  it('the position is right in the same render as the matches, never "0 of N"', () => {
    render({ ocrPages: { [KEY(0)]: done(['Hej', 'hej']) } });
    act(() => button().click());
    type('hej');
    expect(status()).toBe('1 of 2 · 1 of 3 pages recognised');
    expect(status()).not.toMatch(/^0 /);
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
    expect(status()).toBe('1 of 2 · 2 of 3 pages recognised');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 } });
    expect(setPageNumber).not.toHaveBeenCalled();
  });

  it('Enter walks to the next match, moving to its page; Shift+Enter walks back; wrapping round', () => {
    const pages = { [KEY(0)]: done(['Hej', 'världen']), [KEY(2)]: done(['hej', 'hej']) };
    const { setOcrSearch, setPageNumber } = render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    expect(status()).toBe('1 of 3 · 2 of 3 pages recognised');

    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(3);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 0 } });
    // The viewer shows page 3 now.
    render({ ocrPages: pages, pageNumber: 3, setPageNumber, setOcrSearch });
    expect(status()).toBe('2 of 3 · 2 of 3 pages recognised');

    key('Enter');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 1 } });
    expect(status()).toBe('3 of 3 · 2 of 3 pages recognised');

    key('Enter');
    expect(setPageNumber).toHaveBeenLastCalledWith(1);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 } });

    render({ ocrPages: pages, pageNumber: 1, setPageNumber, setOcrSearch });
    key('Enter', { shiftKey: true });
    expect(setPageNumber).toHaveBeenLastCalledWith(3);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(2), ordinal: 1 } });
  });

  it('a current match on another page is shown first by Enter, before the position moves', () => {
    const pages = { [KEY(0)]: done(['inget']), [KEY(1)]: done(['hej', 'hej']) };
    const { setPageNumber, setOcrSearch } = render({ ocrPages: pages });
    act(() => button().click());
    type('hej');
    // No match on page 1: the first match (page 2) is current, but the page does not change.
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 } });
    expect(setPageNumber).not.toHaveBeenCalled();
    act(() => container.querySelector('[aria-label="Next match"]').click());
    expect(setPageNumber).toHaveBeenLastCalledWith(2);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(1), ordinal: 0 } });
  });

  it('reports no matches, keeps the current match when outcomes arrive, and closes with Escape', () => {
    const pages = { [KEY(0)]: done(['Hej']) };
    const { setOcrSearch } = render({ ocrPages: pages });
    act(() => button().click());
    type('xyz');
    expect(status()).toBe('No matches · 1 of 3 pages recognised');
    expect(container.querySelector('[aria-label="Next match"]').disabled).toBe(true);
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'xyz', current: null });

    type('hej');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 } });
    render({ ocrPages: { ...pages, [KEY(1)]: done(['hej']), [KEY(2)]: done(['hej']) }, setOcrSearch });
    expect(status()).toBe('1 of 3');
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'hej', current: { pageKey: KEY(0), ordinal: 0 } });

    key('Escape');
    expect(container.querySelector('.toolbar-ocr-search').classList.contains('is-open')).toBe(false);
    expect(setOcrSearch).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(button());
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
});
