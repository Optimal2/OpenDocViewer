// @vitest-environment jsdom
// File: src/components/__tests__/ocrToolbarActions.test.jsx
/**
 * The toolbar's OCR group (DocumentToolbar/OcrToolbarActions.jsx): a separator first, then the
 * search with `searchEnabled` from `ocr.search.enabled` and `ctrlFOverride` from
 * `ocr.search.overridesCtrlF`, each switch on its own. Read-aloud is no toolbar button any more
 * (it lives in the page's context menu and the language menu). The search is a stub here; its
 * own behaviour has its own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const config = { current: {} };
vi.mock('../../utils/runtimeConfig.js', async (importOriginal) => {
  const actual = await importOriginal();
  const withConfig = (name) => (cfg) => actual[name](cfg === undefined ? config.current : cfg);
  return {
    ...actual,
    isOcrSearchEnabled: withConfig('isOcrSearchEnabled'),
    isOcrSearchCtrlFOverrideEnabled: withConfig('isOcrSearchCtrlFOverrideEnabled'),
  };
});
vi.mock('../DocumentToolbar/OcrSearchBar.jsx', () => ({
  default: ({ searchEnabled, ctrlFOverride, pageNumber }) => createElement('div', {
    'data-odv-ocr': 'search',
    'data-search-enabled': String(searchEnabled),
    'data-ctrl-f': String(ctrlFOverride),
    'data-page': String(pageNumber),
  }),
}));

const { default: OcrToolbarActions } = await import('../DocumentToolbar/OcrToolbarActions.jsx');

describe('OcrToolbarActions', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    config.current = {};
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => {
    act(() => {
      root.render(createElement(OcrToolbarActions, { pageNumber: 3, setPageNumber: vi.fn(), allPages: [{}, {}, {}] }));
    });
  };
  const group = () => container.querySelector('.toolbar-ocr-actions');
  const search = () => container.querySelector('[data-odv-ocr="search"]');

  it('mounts a separator and the search with the shipped defaults, enabled and with Ctrl+F left to the browser', () => {
    config.current = { ocr: { enabled: true } };
    render();
    expect(group().getAttribute('data-ocr-search')).toBe('on');
    expect(group().getAttribute('data-ocr-search-ctrl-f')).toBe('off');
    // The separator comes first, as between the toolbar's other groups.
    expect(group().firstElementChild.classList.contains('separator')).toBe(true);
    // No read-aloud button: that entry lives in the page's context menu.
    expect(container.querySelector('[data-odv-ocr="read"]')).toBeNull();
    expect(group().children.length).toBe(2);
    expect(search().getAttribute('data-search-enabled')).toBe('true');
    expect(search().getAttribute('data-ctrl-f')).toBe('false');
    expect(search().getAttribute('data-page')).toBe('3');
  });


  it('hands the search its off switch for ocr.search.enabled: false', () => {
    config.current = { ocr: { enabled: true, search: { enabled: false } } };
    render();
    expect(group().getAttribute('data-ocr-search')).toBe('off');
    expect(search().getAttribute('data-search-enabled')).toBe('false');
  });

  it('hands Ctrl+F to the search for ocr.search.overridesCtrlF: true, but never while the search is off', () => {
    config.current = { ocr: { enabled: true, search: { overridesCtrlF: true } } };
    render();
    expect(group().getAttribute('data-ocr-search-ctrl-f')).toBe('on');
    expect(search().getAttribute('data-ctrl-f')).toBe('true');

    config.current = { ocr: { enabled: true, search: { enabled: false, overridesCtrlF: true } } };
    render();
    expect(group().getAttribute('data-ocr-search-ctrl-f')).toBe('off');
    expect(search().getAttribute('data-ctrl-f')).toBe('false');
  });

  it('turns the search off only for the literal false, so a string keeps it', () => {
    config.current = { ocr: { enabled: true, search: { enabled: 'false' } } };
    render();
    expect(search().getAttribute('data-search-enabled')).toBe('true');
  });
});
