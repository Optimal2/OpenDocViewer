// @vitest-environment jsdom
// File: src/components/__tests__/ocrSearchBarTextOnly.test.jsx
/**
 * The toolbar's search while nothing is recognised (`recognition` false: `pdfTextLayer.enabled`
 * with OCR off). The words follow what happens: the button is named after the document's text,
 * the status speaks of reading and of a page that has no text of its own, the count is the
 * pages that have text, and the details name no page "not recognised", no time left and no
 * worker, even with `ocr.recognizeWholeDocument` on. The search itself works as ever. With
 * `recognition` left out, or true, every word is as before.
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

const PAGES = Array.from({ length: 5 }, (_, index) => ({ sourceKey: 'doc', pageIndex: index }));
const KEY = (index) => makeOcrPageKey('doc', index);
const ownText = (texts) => ({
  status: 'done',
  source: 'pdf-text',
  words: texts.map((text, i) => ({ text, bbox: { x0: i * 100, y0: 0, x1: i * 100 + 80, y1: 20 } })),
  imageWidth: 595,
  imageHeight: 842,
});
const noOwnText = { status: 'skipped', reason: 'recognition-off' };

describe('OcrSearchBar without recognition', () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.__ODV_CONFIG__;
  });

  /** `recognition` is false unless the options name it; named as undefined, the prop is left out. */
  const render = (options = {}) => {
    const { ocrPages = {}, pageNumber = 1, setOcrSearch = vi.fn(), setPageNumber = vi.fn() } = options;
    const recognition = 'recognition' in options ? options.recognition : false;
    act(() => {
      root.render(createElement(
        ViewerContext.Provider,
        { value: { ocrPages, ocrEngineFailure: null, setOcrSearch } },
        createElement(OcrSearchBar, { pageNumber, setPageNumber, allPages: PAGES, ...(recognition === undefined ? {} : { recognition }) })
      ));
    });
    return { setOcrSearch, setPageNumber };
  };
  const button = () => container.querySelector('[data-odv-ocr="status"]');
  const statusText = () => container.querySelector('[data-odv-ocr="status-text"]')?.textContent ?? null;
  const detail = (name) => container.querySelector(`[data-odv-ocr="details"] [data-odv-ocr="${name}"]`)?.textContent ?? null;
  const described = () => container.querySelector('[data-odv-ocr="coverage-text"]')?.textContent ?? null;

  it('names the button after the document\'s text and counts the pages that have text', () => {
    render({ ocrPages: { [KEY(0)]: ownText(['Provbolaget', 'AB']), [KEY(1)]: ownText(['sida', 'två']), [KEY(2)]: noOwnText, [KEY(3)]: noOwnText, [KEY(4)]: noOwnText } });
    expect(button().getAttribute('title')).toBe('Search in the document’s text');
    expect(button().getAttribute('data-ocr-state')).toBe('pdfText');
    expect(statusText()).toBe('The page has its own text');
    expect(button().disabled).toBe(false);
    expect(detail('count')).toBe('2/5');
    expect(described()).toBe('2 of 5 pages have text');
  });

  it('names no page "not recognised", no time left and no worker, whatever the pages are', () => {
    window.__ODV_CONFIG__ = { ocr: { recognizeWholeDocument: true } };
    render({
      ocrPages: {
        [KEY(0)]: ownText(['ord']),
        [KEY(1)]: noOwnText,
        [KEY(2)]: { status: 'skipped', reason: 'failed-page' },
        [KEY(3)]: { status: 'failed', reason: 'Invalid PDF structure' },
        [KEY(4)]: { status: 'probing' },
      },
    });
    expect(detail('count')).toBe('1/5');
    expect(detail('not-recognised')).toBeNull();
    expect(detail('time-left')).toBeNull();
    expect(detail('workers')).toBeNull();
    expect(described()).toBe('1 of 5 pages have text');
  });

  it('says a page without text of its own is just that, in the status and in the tooltip', () => {
    render({ ocrPages: { [KEY(0)]: noOwnText, [KEY(1)]: ownText(['ord']) } });
    expect(button().getAttribute('data-ocr-state')).toBe('noOwnText');
    expect(statusText()).toBe('The page has no text of its own');
    expect(button().getAttribute('title')).toBe('Search in the document’s text · The page has no text of its own');
    // Another page has text, so the search is still offered.
    expect(button().disabled).toBe(false);
  });

  it('is disabled while no page has text, and speaks of reading while a page is read', () => {
    render({ ocrPages: {} });
    expect(button().getAttribute('data-ocr-state')).toBe('notStarted');
    expect(statusText()).toBe('The page’s text has not been read yet');
    expect(button().disabled).toBe(true);

    render({ ocrPages: { [KEY(0)]: { status: 'probing' } } });
    expect(button().getAttribute('data-ocr-state')).toBe('readingText');
    expect(statusText()).toBe('Reading the page’s text…');

    render({ ocrPages: { [KEY(0)]: { status: 'failed', reason: 'Invalid PDF structure' } } });
    expect(button().getAttribute('data-ocr-state')).toBe('textUnreadable');
    expect(statusText()).toBe('The page’s text could not be read');
  });

  it('searches the pages\' own text and publishes the match as with recognised text', () => {
    const { setOcrSearch } = render({ ocrPages: { [KEY(0)]: ownText(['Provbolaget', 'AB']), [KEY(1)]: ownText(['Provbolaget', 'igen']), [KEY(2)]: noOwnText } });
    act(() => { button().click(); });
    const input = container.querySelector('[data-odv-ocr="search"] input[type="search"], [data-odv-ocr="search"] input[type="text"]');
    expect(input).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    act(() => {
      setValue.call(input, 'provbolaget');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(setOcrSearch).toHaveBeenLastCalledWith({ term: 'provbolaget', current: { pageKey: KEY(0), ordinal: 0 }, onlyPageKey: null });
  });

  it('keeps every word as before with recognition on or not said', () => {
    for (const recognition of [true, undefined]) {
      render({ recognition, ocrPages: { [KEY(0)]: ownText(['ord']), [KEY(1)]: noOwnText } });
      expect(button().getAttribute('title')).toBe('Search in the recognised text');
      expect(detail('not-recognised')).toBe('1 not recognised');
      expect(described()).toBe('1 of 5 pages ready · 1 page was not recognised');
      render({ recognition, ocrPages: {} });
      expect(statusText()).toBe('Text recognition has not started on this page');
    }
  });
});
