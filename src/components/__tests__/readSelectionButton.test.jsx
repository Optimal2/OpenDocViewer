// @vitest-environment jsdom
// File: src/components/__tests__/readSelectionButton.test.jsx
/**
 * The read-aloud button (DocumentToolbar/ReadSelectionButton.jsx): nothing without speech
 * synthesis; shown only while the selection lies in an OCR text layer; a click speaks the
 * selection as it reads on the page in the UI language and turns the button into a stop
 * button, which stays until the reading ends or is stopped; the selection survives the click.
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

const { default: ReadSelectionButton } = await import('../DocumentToolbar/ReadSelectionButton.jsx');

class FakeUtterance {
  constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null; }
}

function installSynthesis() {
  const spoken = [];
  const synthesis = {
    spoken,
    cancel: vi.fn(),
    getVoices: () => [
      { name: 'Svenska', lang: 'sv-SE', localService: true },
      { name: 'English US', lang: 'en-US', localService: true },
      { name: 'English GB', lang: 'en-GB', localService: false },
    ],
    speak: vi.fn((utterance) => { spoken.push(utterance); }),
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
  return synthesis;
}

function layerWithText() {
  const layer = document.createElement('div');
  layer.className = 'ocr-text-layer';
  layer.innerHTML = '<div class="ocr-text-layer-flow">'
    + '<span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Hej</span><span class="ocr-text-layer-gap"> </span><span class="ocr-text-layer-word">världen</span></span>'
    + ' <span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Rad</span><span class="ocr-text-layer-gap"> </span><span class="ocr-text-layer-word">två</span></span>'
    + '</div>';
  document.body.appendChild(layer);
  return layer;
}

function select(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => { document.dispatchEvent(new Event('selectionchange')); });
}

describe('ReadSelectionButton', () => {
  let container;
  let root;
  let synthesis;

  beforeEach(() => {
    synthesis = installSynthesis();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('.ocr-text-layer').forEach((node) => node.remove());
    window.getSelection().removeAllRanges();
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    window.localStorage.clear();
    document.cookie = 'ODV_USER_PREFERENCES=; Max-Age=0; Path=/';
  });

  const render = () => act(() => { root.render(createElement(ReadSelectionButton)); });
  const button = () => container.querySelector('[data-odv-ocr="read"]');

  it('renders nothing without a selection, and nothing at all without speech synthesis', () => {
    render();
    expect(button()).toBeNull();
    const outside = document.createElement('p');
    outside.textContent = 'utanför lagret';
    document.body.appendChild(outside);
    select(outside);
    expect(button()).toBeNull();
    outside.remove();

    delete window.speechSynthesis;
    act(() => root.unmount());
    root = createRoot(container);
    render();
    select(layerWithText());
    expect(button()).toBeNull();
  });

  it('appears while recognised text is selected and speaks it line by line in the UI language', () => {
    render();
    const layer = layerWithText();
    select(layer);
    expect(button()).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Read the selected text aloud');
    expect(button().getAttribute('aria-pressed')).toBe('false');

    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { button().dispatchEvent(mousedown); });
    expect(mousedown.defaultPrevented).toBe(true);

    act(() => button().click());
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['Hej världen', 'Rad två']);
    expect(synthesis.spoken[0].lang).toBe('sv-SE');
    expect(synthesis.spoken[0].voice.name).toBe('Svenska');
    expect(button().getAttribute('aria-label')).toBe('Stop reading aloud');
    expect(button().getAttribute('data-speaking')).toBe('true');
    expect(button().getAttribute('aria-pressed')).toBe('true');

    // The button stays while speaking even after the selection is gone.
    window.getSelection().removeAllRanges();
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(button()).not.toBeNull();

    act(() => { synthesis.spoken[0].onend(); synthesis.spoken[1].onend(); });
    expect(button()).toBeNull();
  });

  it('offers the installed voices\' languages in a menu on hover; the choice is kept and spoken, without touching the UI language', () => {
    render();
    select(layerWithText());
    const shell = () => container.querySelector('.toolbar-ocr-read-shell');
    const menu = () => container.querySelector('[data-odv-ocr="read-menu"]');
    expect(menu()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');

    act(() => { shell().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); });
    // React's onMouseEnter listens to mouseover; fire that too for jsdom.
    act(() => { shell().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(menu()).not.toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    const items = () => [...menu().querySelectorAll('[role="menuitemradio"]')];
    expect(items().map((item) => item.getAttribute('data-speech-locale'))).toEqual(['', 'en-GB', 'en-US', 'sv-SE']);
    expect(items()[0].textContent).toMatch(/Follow the interface language \(Svenska/);
    expect(items()[0].getAttribute('aria-checked')).toBe('true');
    // The menu keeps the selection: its mousedown is cancelled like the button's.
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { menu().dispatchEvent(mousedown); });
    expect(mousedown.defaultPrevented).toBe(true);

    act(() => items()[2].click());
    expect(menu()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('ODV_USER_PREFERENCES'))).toEqual({ speechLanguage: 'en-US' });
    // Named in the UI language (Swedish): "Amerikansk engelska".
    expect(button().title).toMatch(/Reading language: .*engelska/i);
    act(() => button().click());
    expect(synthesis.spoken[0].lang).toBe('en-US');
    expect(synthesis.spoken[0].voice.name).toBe('English US');
    act(() => { synthesis.spoken[0].onend(); synthesis.spoken[1].onend(); });

    // Back to the interface language: the preference is cleared and Swedish is spoken again.
    act(() => { shell().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => items()[0].click());
    expect(JSON.parse(window.localStorage.getItem('ODV_USER_PREFERENCES') || '{}')).toEqual({});
    act(() => button().click());
    expect(synthesis.spoken[2].lang).toBe('sv-SE');
  });

  it('opens the language menu from the keyboard, keeps the viewer shortcuts off there, and gives the focus back on Escape', () => {
    render();
    select(layerWithText());
    const menu = () => container.querySelector('[data-odv-ocr="read-menu"]');
    // The viewer's arrow-key navigation stays out while the focus is in the button or the menu.
    expect(button().closest('[data-odv-shortcuts="off"]')).not.toBeNull();
    button().focus();
    act(() => { button().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    expect(menu()).not.toBeNull();
    const item = menu().querySelector('[role="menuitemradio"]');
    item.focus();
    expect(document.activeElement).toBe(item);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('a click while speaking stops the reading', () => {
    render();
    select(layerWithText());
    act(() => button().click());
    expect(button().getAttribute('data-speaking')).toBe('true');
    act(() => button().click());
    expect(synthesis.cancel).toHaveBeenCalled();
    expect(button().getAttribute('data-speaking')).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Read the selected text aloud');
  });

  it('stops the reading when unmounted', () => {
    render();
    select(layerWithText());
    act(() => button().click());
    synthesis.cancel.mockClear();
    act(() => root.unmount());
    root = createRoot(container);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  });
});
