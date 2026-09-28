// @vitest-environment jsdom
// File: src/components/DocumentToolbar/__tests__/ManualOverlayDialog.search.test.js
//
// The manual overlay shows a search bar in the dialog chrome (never inside the
// sanitized manual HTML, where DOMPurify strips input/button elements). Search
// highlights every hit, counts "N of M", moves with previous/next buttons and
// Enter/Shift+Enter, clears with Escape, opens collapsed <details> holding the
// current hit, and keeps the manual sanitization unchanged. Plain
// createElement: the repo's ESLint setup does not parse JSX in test files.
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
    vi.stubGlobal('fetch', async (url) => ({
      ok: true,
      url: String(url),
      text: async () => MANUAL_HTML,
    }));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(h(ManualOverlayDialog, { isOpen: true, onClose }));
    });
  });

  afterEach(() => {
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
});
