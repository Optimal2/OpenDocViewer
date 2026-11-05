// @vitest-environment jsdom
// File: src/components/__tests__/ocrToolbarActions.test.jsx
/**
 * The toolbar's OCR group (DocumentToolbar/OcrToolbarActions.jsx): the read-aloud button is
 * mounted only while `ocr.speech.enabled` is not the literal false, and the search gets
 * `searchEnabled` from `ocr.search.enabled`, each switch on its own. The children are stubs
 * here; their own behaviour has its own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const config = { current: {} };
vi.mock('../../utils/runtimeConfig.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isOcrSearchEnabled: (cfg) => actual.isOcrSearchEnabled(cfg === undefined ? config.current : cfg),
    isReadAloudEnabled: (cfg) => actual.isReadAloudEnabled(cfg === undefined ? config.current : cfg),
  };
});
vi.mock('../DocumentToolbar/ReadSelectionButton.jsx', () => ({
  default: () => createElement('button', { type: 'button', 'data-odv-ocr': 'read' }, 'read'),
}));
vi.mock('../DocumentToolbar/OcrSearchBar.jsx', () => ({
  default: ({ searchEnabled, pageNumber }) => createElement('div', { 'data-odv-ocr': 'search', 'data-search-enabled': String(searchEnabled), 'data-page': String(pageNumber) }),
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

  it('mounts both with the shipped defaults, the search enabled', () => {
    config.current = { ocr: { enabled: true } };
    render();
    const group = container.querySelector('.toolbar-ocr-actions');
    expect(group.getAttribute('data-ocr-read-aloud')).toBe('on');
    expect(group.getAttribute('data-ocr-search')).toBe('on');
    expect(container.querySelector('[data-odv-ocr="read"]')).not.toBeNull();
    const search = container.querySelector('[data-odv-ocr="search"]');
    expect(search.getAttribute('data-search-enabled')).toBe('true');
    expect(search.getAttribute('data-page')).toBe('3');
  });

  it('leaves the read-aloud button out for ocr.speech.enabled: false and keeps the search', () => {
    config.current = { ocr: { enabled: true, speech: { enabled: false } } };
    render();
    expect(container.querySelector('.toolbar-ocr-actions').getAttribute('data-ocr-read-aloud')).toBe('off');
    expect(container.querySelector('[data-odv-ocr="read"]')).toBeNull();
    expect(container.querySelector('[data-odv-ocr="search"]').getAttribute('data-search-enabled')).toBe('true');
  });

  it('hands the search its off switch for ocr.search.enabled: false and keeps the read-aloud button', () => {
    config.current = { ocr: { enabled: true, search: { enabled: false } } };
    render();
    expect(container.querySelector('.toolbar-ocr-actions').getAttribute('data-ocr-search')).toBe('off');
    expect(container.querySelector('[data-odv-ocr="read"]')).not.toBeNull();
    expect(container.querySelector('[data-odv-ocr="search"]').getAttribute('data-search-enabled')).toBe('false');
  });

  it('turns off only for the literal false, so a string or a number keeps both', () => {
    config.current = { ocr: { enabled: true, search: { enabled: 'false' }, speech: { enabled: 0 } } };
    render();
    expect(container.querySelector('[data-odv-ocr="read"]')).not.toBeNull();
    expect(container.querySelector('[data-odv-ocr="search"]').getAttribute('data-search-enabled')).toBe('true');
  });
});
