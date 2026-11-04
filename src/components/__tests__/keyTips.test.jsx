// @vitest-environment jsdom
// File: src/components/__tests__/keyTips.test.jsx
/**
 * Key tips (components/KeyTips.jsx): nothing in the DOM until `?` is held; then one label per
 * visible, named toolbar button in an overlay on the body; gone on release (of the key or of
 * Shift), on blur and when the page is hidden; not shown from an editable field or a modal
 * dialog; the held key's repeats are ignored.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import KeyTips from '../KeyTips.jsx';

function toolbar() {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.innerHTML = '<button type="button" aria-label="Nästa sida">›</button>'
    + '<button type="button" title="Zooma in">+</button>'
    + '<button type="button">utan namn</button>'
    + '<div aria-hidden="true"><button type="button" aria-label="Dold">x</button></div>'
    + '<button type="button" aria-label="Utanför" data-offscreen="true">…</button>'
    + '<input type="text" aria-label="Sida" />';
  document.body.appendChild(bar);
  let left = 0;
  for (const button of bar.querySelectorAll('button')) {
    // The last button lies beyond the right edge of the window (the toolbar does not wrap).
    const at = button.dataset.offscreen ? window.innerWidth + 100 : left;
    const rect = { left: at, top: 8, width: 32, height: 32, right: at + 32, bottom: 40 };
    button.getBoundingClientRect = () => rect;
    left += 36;
  }
  return bar;
}

const key = (type, init) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(event); });
  return event;
};
const layer = () => document.querySelector('[data-odv-keytips="layer"]');
const labels = () => [...document.querySelectorAll('.odv-keytip:not(.odv-keytip--probe)')].map((tip) => tip.textContent);

describe('KeyTips', () => {
  let container;
  let root;
  let bar;

  beforeEach(() => {
    bar = toolbar();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(createElement(KeyTips)); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    bar.remove();
  });

  it('shows the names of the visible toolbar buttons while ? is held, and nothing before or after', () => {
    expect(layer()).toBeNull();
    const down = key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(down.defaultPrevented).toBe(true);
    expect(layer()).not.toBeNull();
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    expect(labels()).toEqual(['Nästa sida', 'Zooma in']);
    // The held key repeats: nothing changes.
    key('keydown', { key: '?', code: 'Slash', shiftKey: true, repeat: true });
    expect(labels()).toEqual(['Nästa sida', 'Zooma in']);
    // Released with Shift still down, the key reports '?'; the layer goes.
    key('keyup', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).toBeNull();
  });

  it('ends the hold when Shift is released first, on blur, and when the page is hidden', () => {
    key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).not.toBeNull();
    key('keyup', { key: 'Shift', code: 'ShiftLeft' });
    expect(layer()).toBeNull();

    key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(layer()).toBeNull();

    key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).not.toBeNull();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(layer()).toBeNull();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('ends the hold on a pointer press, so a click is never made under the labels', () => {
    key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(layer()).toBeNull();
    key('keyup', { key: '?', code: 'Slash', shiftKey: true });
  });

  it('does nothing from an editable field, inside a modal dialog, with Ctrl, Alt or Meta, or for another key', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      const withModifier = key('keydown', { key: '?', code: 'Slash', shiftKey: true, [modifier]: true });
      expect(withModifier.defaultPrevented).toBe(false);
      expect(layer()).toBeNull();
    }

    const input = bar.querySelector('input');
    input.focus();
    const typed = key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(typed.defaultPrevented).toBe(false);
    expect(layer()).toBeNull();
    input.blur();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    key('keydown', { key: '?', code: 'Slash', shiftKey: true });
    expect(layer()).toBeNull();
    dialog.remove();

    key('keydown', { key: '/', code: 'Slash' });
    expect(layer()).toBeNull();
    key('keyup', { key: '/', code: 'Slash' });
  });
});
