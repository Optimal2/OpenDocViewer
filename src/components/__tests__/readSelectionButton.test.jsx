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
    getVoices: () => [{ name: 'Svenska', lang: 'sv-SE', localService: true }],
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
