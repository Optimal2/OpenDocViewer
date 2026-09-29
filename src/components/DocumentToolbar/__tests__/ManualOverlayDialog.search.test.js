// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/ManualOverlayDialog.search.test.js
//
// The manual overlay shows a search bar in the dialog chrome (never inside the
// sanitized manual HTML, where DOMPurify strips input/button elements). Search
// highlights every hit, counts "N of M", moves with previous/next buttons and
// Enter/Shift+Enter, clears with Escape, opens collapsed <details> holding the
// current hit, and keeps the manual sanitization unchanged. Most tests run the
// <mark> fallback because jsdom has no CSS Custom Highlight API; the
// "CSS Custom Highlight path" block stubs CSS.highlights/Highlight to cover the
// path modern browsers take. Plain createElement: the repo's ESLint setup does
// not parse JSX in test files.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTranslate, mockI18n } = vi.hoisted(() => ({
  // Stable identities: the dialog re-fetches the manual whenever the `t`
  // function identity changes, so a fresh closure per render would loop.
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
  '<h1>Viewer manual</h1>',
  '<p>The manual explains the viewer. Read this manual page first.</p>',
  '<p>&Auml;pplen och p&auml;ron v&auml;xer i tr&auml;dg&aring;rden. &Auml;PPLE &auml;r gott.</p>',
  '<details><summary>Advanced</summary><p>Hidden manual text about printing.</p></details>',
  '<script>window.__odvManualPwned = true;</script>',
  '<form action="/collect"><input type="text" name="q"><button type="submit">Send</button></form>',
].join('');

function flush(ms = 0) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function typeSearch(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function pressKey(target, key, options = {}) {
  act(() => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, ...options,
    }));
  });
}

describe('ManualOverlayDialog manual search', () => {
  let container;
  let root;
  let onClose;
  let manualHtml;

  function marks() {
    return Array.from(container.querySelectorAll('.odv-manual-content mark[data-odv-manual-mark]'));
  }

  function currentMark() {
    return container.querySelector('.odv-manual-content mark[data-odv-manual-mark].is-current');
  }

  function searchInput() {
    return container.querySelector('[data-odv-manual-search="input"]');
  }

  function counter() {
    return container.querySelector('.odv-manual-searchbar-count');
  }

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
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
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

  async function waitForManual() {
    await flush(50);
    expect(searchInput()).not.toBeNull();
  }

  async function searchFor(value) {
    typeSearch(searchInput(), value);
    await flush(260);
  }

  function content() {
    return container.querySelector('.odv-manual-content');
  }

  function button(label) {
    return container.querySelector(`button[aria-label="${label}"]`);
  }

  /** Swap the served manual and reload it through the dialog's refresh button. */
  async function loadManual(html) {
    manualHtml = html;
    act(() => {
      button('Reload manual from server').click();
    });
    await flush(50);
    expect(searchInput()).not.toBeNull();
  }

  function stubCustomHighlight() {
    const registry = new Map();
    class FakeHighlight {
      constructor(...ranges) {
        this.ranges = ranges;
      }
    }
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', FakeHighlight);
    return registry;
  }

  it('shows a search field once the manual is loaded', async () => {
    await waitForManual();
    const input = searchInput();
    expect(input.getAttribute('placeholder')).toBe('Search the manual…');
    expect(input.getAttribute('aria-label')).toBe('Search the manual');
  });

  it('counts every hit and highlights the first one', async () => {
    await waitForManual();
    await searchFor('manual');
    expect(marks()).toHaveLength(4);
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('0');
    expect(counter().textContent).toBe('1 of 4');
  });

  it('ignores queries shorter than two characters', async () => {
    await waitForManual();
    await searchFor('m');
    expect(marks()).toHaveLength(0);
    expect(counter().textContent).toBe('');
  });

  it('moves between hits with the next/previous buttons and Enter/Shift+Enter', async () => {
    await waitForManual();
    await searchFor('manual');
    act(() => {
      container.querySelector('button[aria-label="Next match"]').click();
    });
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('1');
    expect(counter().textContent).toBe('2 of 4');
    pressKey(searchInput(), 'Enter');
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('2');
    pressKey(searchInput(), 'Enter', { shiftKey: true });
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('1');
    act(() => {
      container.querySelector('button[aria-label="Previous match"]').click();
    });
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('0');
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('clears the highlights with Escape without closing the dialog', async () => {
    await waitForManual();
    await searchFor('manual');
    expect(marks()).toHaveLength(4);
    pressKey(searchInput(), 'Escape');
    await flush(260);
    expect(searchInput().value).toBe('');
    expect(marks()).toHaveLength(0);
    expect(counter().textContent).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    // Escape with an empty search still closes the dialog.
    pressKey(searchInput(), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the highlights with the clear button', async () => {
    await waitForManual();
    await searchFor('manual');
    expect(marks()).toHaveLength(4);
    act(() => {
      container.querySelector('button[aria-label="Clear search"]').click();
    });
    await flush(260);
    expect(searchInput().value).toBe('');
    expect(marks()).toHaveLength(0);
  });

  it('matches Swedish characters case-insensitively', async () => {
    await waitForManual();
    await searchFor('äpple');
    // "Äpplen" and "ÄPPLE" in the same paragraph.
    expect(marks()).toHaveLength(2);
    expect(counter().textContent).toBe('1 of 2');
  });

  it('opens a collapsed details section holding the current hit', async () => {
    await waitForManual();
    const details = container.querySelector('.odv-manual-content details');
    expect(details.open).toBe(false);
    await searchFor('printing');
    expect(marks()).toHaveLength(1);
    expect(details.open).toBe(true);
    expect(currentMark()?.textContent).toBe('printing');
  });

  it('keeps the manual sanitization unchanged', async () => {
    await waitForManual();
    const content = container.querySelector('.odv-manual-content');
    expect(content.querySelector('script')).toBeNull();
    expect(content.querySelector('form')).toBeNull();
    expect(content.querySelector('input')).toBeNull();
    expect(content.querySelector('button')).toBeNull();
    // The search box itself is dialog chrome, not manual content.
    expect(searchInput()).not.toBeNull();
    expect(window.__odvManualPwned).toBeUndefined();
  });

  it('keeps hits aligned with the original text when lower-casing changes its length', async () => {
    await waitForManual();
    // U+0130 lower-cases to two code units ("i" + combining dot above).
    await loadManual('<p>\u0130\u0130 manual \u0130 manual</p>');
    await searchFor('manual');
    expect(counter().textContent).toBe('1 of 2');
    expect(marks()).toHaveLength(2);
    expect(marks().map((mark) => mark.textContent)).toEqual(['manual', 'manual']);
    expect(currentMark()?.getAttribute('data-odv-manual-mark')).toBe('0');
  });

  it('matches a query that itself contains a length-changing capital', async () => {
    await waitForManual();
    await loadManual('<p>\u0130stanbul and \u0130STANBUL are the same word.</p>');
    await searchFor('\u0130stanbul');
    expect(counter().textContent).toBe('1 of 2');
    expect(marks().map((mark) => mark.textContent)).toEqual(['\u0130stanbul', '\u0130STANBUL']);
  });

  it('still folds \u00e5/\u00e4/\u00f6 and \u00df case-insensitively', async () => {
    await waitForManual();
    await loadManual('<p>Stra\u00dfe, STRA\u1e9eE och stra\u00dfe. \u00c5\u00c4\u00d6 och \u00e5\u00e4\u00f6.</p>');
    await searchFor('stra\u00dfe');
    expect(counter().textContent).toBe('1 of 3');
    expect(marks()).toHaveLength(3);
    await searchFor('\u00e5\u00e4\u00f6');
    expect(counter().textContent).toBe('1 of 2');
    expect(marks().map((mark) => mark.textContent)).toEqual(['\u00c5\u00c4\u00d6', '\u00e5\u00e4\u00f6']);
  });

  it('searches text inside the manual\'s own <mark> elements', async () => {
    await waitForManual();
    await loadManual('<p>Use the <mark>highlighted term</mark> in the manual.</p>');
    await searchFor('highlighted');
    expect(counter().textContent).toBe('1 of 1');
    expect(marks()).toHaveLength(1);
    expect(marks()[0].parentElement.tagName).toBe('MARK');
    act(() => {
      button('Clear search').click();
    });
    await flush(260);
    expect(marks()).toHaveLength(0);
    // The manual's own mark is untouched by the cleanup.
    expect(content().querySelectorAll('mark:not([data-odv-manual-mark])')).toHaveLength(1);
    expect(content().querySelector('mark').textContent).toBe('highlighted term');
  });

  it('clears the search with Escape while focus is on a search navigation button', async () => {
    await waitForManual();
    await searchFor('manual');
    const next = button('Next match');
    next.focus();
    pressKey(next, 'Escape');
    await flush(260);
    expect(onClose).not.toHaveBeenCalled();
    expect(searchInput().value).toBe('');
    expect(marks()).toHaveLength(0);
    expect(document.activeElement).toBe(searchInput());
    // The next Escape closes the dialog as usual.
    pressKey(document.activeElement, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the search with Escape while focus is on the clear button', async () => {
    await waitForManual();
    await searchFor('manual');
    const clear = button('Clear search');
    clear.focus();
    pressKey(clear, 'Escape');
    await flush(260);
    expect(onClose).not.toHaveBeenCalled();
    expect(searchInput().value).toBe('');
  });

  it('waits 200 ms after the last keystroke before searching', async () => {
    await waitForManual();
    vi.useFakeTimers();
    typeSearch(searchInput(), 'man');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    typeSearch(searchInput(), 'manual');
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(marks()).toHaveLength(0);
    expect(counter().textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(marks()).toHaveLength(4);
    expect(counter().textContent).toBe('1 of 4');
  });

  it('removes the marks and restores the text nodes when the manual is swapped', async () => {
    await waitForManual();
    await searchFor('manual');
    expect(marks()).toHaveLength(4);
    await loadManual('<p>Another manual text.</p><p>No hits here.</p>');
    // The still-active query runs against the new manual only.
    expect(counter().textContent).toBe('1 of 1');
    expect(marks()).toHaveLength(1);
    const [withHit, withoutHit] = content().querySelectorAll('p');
    expect(withoutHit.childNodes).toHaveLength(1);
    act(() => {
      button('Clear search').click();
    });
    await flush(260);
    expect(marks()).toHaveLength(0);
    expect(withHit.childNodes).toHaveLength(1);
    expect(withHit.textContent).toBe('Another manual text.');
  });

  it('removes the marks and restores the text nodes when the dialog closes', async () => {
    await waitForManual();
    await searchFor('manual');
    const manual = content();
    const paragraph = manual.querySelector('p');
    expect(paragraph.querySelectorAll('mark[data-odv-manual-mark]')).toHaveLength(2);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: false, onClose }));
    });
    expect(container.querySelector('.odv-manual-content')).toBeNull();
    expect(manual.querySelectorAll('mark[data-odv-manual-mark]')).toHaveLength(0);
    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.textContent).toBe('The manual explains the viewer. Read this manual page first.');
  });

  describe('CSS Custom Highlight path', () => {
    function rangeText(range) {
      return range ? range.toString() : null;
    }

    it('highlights through CSS.highlights without touching the manual DOM', async () => {
      const registry = stubCustomHighlight();
      await waitForManual();
      const before = content().innerHTML;
      await searchFor('manual');
      expect(marks()).toHaveLength(0);
      expect(content().innerHTML).toBe(before);
      expect(counter().textContent).toBe('1 of 4');
      const all = registry.get('odv-manual-search');
      expect(all.ranges).toHaveLength(4);
      expect(all.ranges.map(rangeText)).toEqual(['manual', 'manual', 'manual', 'manual']);
      const current = () => registry.get('odv-manual-search-current').ranges[0];
      expect(current()).toBe(all.ranges[0]);
      act(() => {
        button('Next match').click();
      });
      expect(counter().textContent).toBe('2 of 4');
      expect(current()).toBe(all.ranges[1]);
      pressKey(searchInput(), 'Enter', { shiftKey: true });
      pressKey(searchInput(), 'Enter', { shiftKey: true });
      expect(counter().textContent).toBe('4 of 4');
      expect(current()).toBe(all.ranges[3]);
    });

    it('keeps the current range in step with the counter when lower-casing changes the length', async () => {
      const registry = stubCustomHighlight();
      await waitForManual();
      await loadManual('<p>\u0130\u0130 manual \u0130 manual</p>');
      await searchFor('manual');
      expect(counter().textContent).toBe('1 of 2');
      const all = registry.get('odv-manual-search');
      expect(all.ranges.map(rangeText)).toEqual(['manual', 'manual']);
      act(() => {
        button('Next match').click();
      });
      expect(counter().textContent).toBe('2 of 2');
      const current = registry.get('odv-manual-search-current').ranges[0];
      expect(current).toBe(all.ranges[1]);
      expect(current.startOffset).toBe(12);
    });

    it('removes both highlights when the search is cleared', async () => {
      const registry = stubCustomHighlight();
      await waitForManual();
      await searchFor('manual');
      expect(registry.size).toBe(2);
      pressKey(searchInput(), 'Escape');
      await flush(260);
      expect(registry.size).toBe(0);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('removes both highlights when the dialog closes', async () => {
      const registry = stubCustomHighlight();
      await waitForManual();
      await searchFor('manual');
      expect(registry.size).toBe(2);
      act(() => {
        root.render(h(ManualOverlayDialog, { isOpen: false, onClose }));
      });
      expect(registry.size).toBe(0);
    });

    it('replaces the highlights when the manual is swapped', async () => {
      const registry = stubCustomHighlight();
      await waitForManual();
      await searchFor('manual');
      expect(registry.get('odv-manual-search').ranges).toHaveLength(4);
      await loadManual('<p>Another manual text.</p>');
      expect(counter().textContent).toBe('1 of 1');
      const all = registry.get('odv-manual-search');
      expect(all.ranges).toHaveLength(1);
      expect(all.ranges[0].startContainer.isConnected).toBe(true);
    });
  });
});
