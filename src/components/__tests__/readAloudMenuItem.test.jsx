// @vitest-environment jsdom
// File: src/components/__tests__/readAloudMenuItem.test.jsx
/**
 * The page context menu's read-aloud entry (components/ReadAloudMenuItem.jsx): nothing without
 * the read-aloud state; "Read the selection aloud", greyed with the reason while nothing can be
 * read; "Stop reading aloud" while a reading runs; a choice closes the menu; the selection
 * survives the click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && options.defaultValue) || key,
    i18n: { language: 'sv', changeLanguage: () => Promise.resolve() },
  }),
}));

const { default: ReadAloudMenuItem } = await import('../ReadAloudMenuItem.jsx');
const { default: ReadAloudContext } = await import('../../contexts/readAloudContext.js');

describe('ReadAloudMenuItem', () => {
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

  const render = (state, onDone = vi.fn()) => {
    act(() => {
      root.render(createElement(ReadAloudContext.Provider, { value: state }, createElement(ReadAloudMenuItem, { onDone })));
    });
    return onDone;
  };
  const item = () => container.querySelector('[data-odv-ocr="read"]');
  const base = { speaking: false, reason: null, speak: vi.fn(() => true), stop: vi.fn() };

  it('renders nothing without the read-aloud state', () => {
    render(null);
    expect(item()).toBeNull();
  });

  it('reads the selection and closes the menu; its mousedown keeps the selection', () => {
    const state = { ...base };
    const onDone = render(state);
    expect(item().textContent).toBe('record_voice_overRead the selection aloud');
    expect(item().disabled).toBe(false);
    expect(item().title).toBe('Read the selected text aloud');
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { item().dispatchEvent(mousedown); });
    expect(mousedown.defaultPrevented).toBe(true);
    act(() => item().click());
    expect(state.speak).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('is greyed with the reason while nothing can be read', () => {
    const state = { ...base, reason: "Select text in the page's text layer first" };
    const onDone = render(state);
    expect(item().disabled).toBe(true);
    expect(item().getAttribute('aria-disabled')).toBe('true');
    expect(item().title).toBe("Read the selection aloud · Select text in the page's text layer first");
    act(() => item().click());
    expect(state.speak).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('becomes "Stop reading aloud" while speaking, whatever the selection, and stops', () => {
    const state = { ...base, speaking: true, reason: "Select text in the page's text layer first" };
    const onDone = render(state);
    expect(item().textContent).toBe('stop_circleStop reading aloud');
    expect(item().getAttribute('data-speaking')).toBe('true');
    expect(item().disabled).toBe(false);
    act(() => item().click());
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.speak).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
