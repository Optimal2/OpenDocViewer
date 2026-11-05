// @vitest-environment jsdom
// File: src/components/__tests__/languageMenuReadAloud.test.jsx
/**
 * The toolbar's language menu (DocumentToolbar/LanguageMenuButton.jsx) with and without the
 * read-aloud state: without it, the plain language list; with it, two titled sections,
 * "Interface language" and "Reading language", each its own radio group, where a reading
 * choice is kept without touching the UI language and the button's tooltip names both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const changeLanguage = vi.fn(() => Promise.resolve());
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      let text = (options && options.defaultValue) || key;
      for (const [name, value] of Object.entries(options || {})) text = text.replace(`{${name}}`, String(value));
      return text;
    },
    i18n: { language: 'sv', resolvedLanguage: 'sv', options: { supportedLngs: ['en', 'sv', 'cimode'] }, changeLanguage },
  }),
}));

const { default: LanguageMenuButton } = await import('../DocumentToolbar/LanguageMenuButton.jsx');
const { default: ReadAloudContext } = await import('../../contexts/readAloudContext.js');

const readAloudState = (overrides = {}) => ({
  languageTitle: 'Reading language',
  entries: [
    { value: '', label: 'Auto (svenska)', disabled: false },
    { value: 'sv', label: 'Svenska', disabled: false },
    { value: 'en', label: 'Engelska (no local voice installed)', disabled: true },
    { value: 'ui', label: 'Follow the interface language (svenska)', disabled: false },
  ],
  selectedValue: '',
  currentLabel: 'Auto (svenska)',
  chooseLanguage: vi.fn(),
  ...overrides,
});

describe('LanguageMenuButton with read-aloud', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    changeLanguage.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (state) => {
    act(() => {
      root.render(createElement(ReadAloudContext.Provider, { value: state }, createElement(LanguageMenuButton)));
    });
  };
  const button = () => container.querySelector('button[aria-haspopup="menu"]');
  const open = () => act(() => button().click());
  const menu = () => container.querySelector('[role="menu"]');

  it('is the plain language list without the read-aloud state', () => {
    render(null);
    expect(button().title).toBe('Language: Svenska');
    open();
    expect(menu().classList.contains('toolbar-split-menu')).toBe(false);
    expect(menu().querySelectorAll('.toolbar-split-menu-section')).toHaveLength(0);
    expect([...menu().querySelectorAll('[role="menuitemradio"]')].map((item) => item.textContent.replace(/^check/, ''))).toEqual(['English', 'Svenska']);
    expect(menu().querySelector('[data-odv-ocr="read-menu"]')).toBeNull();
  });

  it('adds a titled "Reading language" section as its own group, and names both in the tooltip', () => {
    const state = readAloudState();
    render(state);
    expect(button().title).toBe('Language: Svenska · Reading language: Auto (svenska)');
    open();
    expect(menu().classList.contains('toolbar-split-menu')).toBe(true);
    const sections = [...menu().querySelectorAll('.toolbar-split-menu-section')];
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.getAttribute('role'))).toEqual(['group', 'group']);
    expect(sections[0].querySelector('.toolbar-split-menu-title').textContent).toBe('Interface language');
    expect(sections[0].getAttribute('aria-labelledby')).toBe(sections[0].querySelector('.toolbar-split-menu-title').id);
    expect([...sections[0].querySelectorAll('[role="menuitemradio"]')].map((item) => item.textContent.replace(/^check/, ''))).toEqual(['English', 'Svenska']);
    expect(sections[1].getAttribute('data-odv-ocr')).toBe('read-menu');
    expect(sections[1].querySelector('.toolbar-split-menu-title').textContent).toBe('Reading language');
    const entries = [...sections[1].querySelectorAll('[role="menuitemradio"]')];
    expect(entries.map((item) => item.getAttribute('data-speech-language'))).toEqual(['', 'sv', 'en', 'ui']);
    expect(entries.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    expect(entries[2].disabled).toBe(true);
    expect(entries[0].textContent).toBe('checkAuto (svenska)');

    // A reading choice is kept and closes the menu; the UI language is untouched.
    act(() => entries[1].click());
    expect(state.chooseLanguage).toHaveBeenCalledWith('sv');
    expect(changeLanguage).not.toHaveBeenCalled();
    expect(menu()).toBeNull();

    // An interface-language choice changes the UI language, never the reading choice.
    open();
    act(() => [...menu().querySelectorAll('.toolbar-split-menu-section')][0].querySelectorAll('[role="menuitemradio"]')[0].click());
    expect(changeLanguage).toHaveBeenCalledWith('en');
    expect(state.chooseLanguage).toHaveBeenCalledTimes(1);
  });
});
