// @vitest-environment jsdom
// File: src/components/__tests__/readAloudProvider.test.jsx
/**
 * The read-aloud state (hooks/useReadAloud.js through components/ReadAloudProvider.jsx):
 * follows the selection in the OCR text layers, speaks it line by line in the reading
 * language with a voice that runs on the machine (never an online one), reports why it cannot
 * read, keeps the reading-language choice in the viewer preferences without touching the UI
 * language, lists the choices ("Auto" first while the guess is on), and stops on Escape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      let text = (options && options.defaultValue) || key;
      for (const [name, value] of Object.entries(options || {})) text = text.replace(`{${name}}`, String(value));
      return text;
    },
    i18n: { language: 'sv', changeLanguage: () => Promise.resolve() },
  }),
}));

const { default: ReadAloudProvider } = await import('../ReadAloudProvider.jsx');
const { default: ReadAloudContext } = await import('../../contexts/readAloudContext.js');

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

function layerWithText(lang = '') {
  const layer = document.createElement('div');
  layer.className = 'ocr-text-layer';
  layer.innerHTML = `<div class="ocr-text-layer-flow"${lang ? ` lang="${lang}"` : ''}>`
    + '<span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Hej</span><span class="ocr-text-layer-gap"> </span><span class="ocr-text-layer-word">världen</span></span>'
    + ' <span class="ocr-text-layer-line"><span class="ocr-text-layer-word">Rad</span><span class="ocr-text-layer-gap"> </span><span class="ocr-text-layer-word">två</span></span>'
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

/** Exposes the provided state to the test. */
const latest = { current: null };
function Probe() {
  latest.current = useContext(ReadAloudContext);
  return null;
}

describe('ReadAloudProvider', () => {
  let container;
  let root;
  let synthesis;

  beforeEach(() => {
    synthesis = installSynthesis();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest.current = null;
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

  const render = () => act(() => { root.render(createElement(ReadAloudProvider, null, createElement(Probe))); });
  const state = () => latest.current;

  it('follows only selections inside the text layers and says why nothing can be read', () => {
    render();
    expect(state().available).toBe(true);
    expect(state().selection).toBeNull();
    expect(state().reason).toBe("Select text in the page's text layer first");
    const outside = document.createElement('p');
    outside.textContent = 'utanför lagret';
    document.body.appendChild(outside);
    select(outside);
    expect(state().selection).toBeNull();
    outside.remove();
    select(layerWithText());
    expect(state().selection).toEqual({ text: 'Hej världen\nRad två', language: null });
    expect(state().reason).toBeNull();
    expect(state().speak()).toBe(true);
  });

  it('reports a browser without speech synthesis as unavailable and never speaks', () => {
    delete window.speechSynthesis;
    render();
    expect(state().available).toBe(false);
    select(layerWithText());
    expect(state().selection).toBeNull();
    expect(state().reason).toBe('This browser cannot read text aloud');
    expect(state().speak()).toBe(false);
  });

  it('speaks the selection line by line in the UI language, stays speaking until the end, and stops on Escape', () => {
    render();
    select(layerWithText());
    act(() => { state().speak(); });
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['Hej världen', 'Rad två']);
    expect(synthesis.spoken[0].lang).toBe('sv-SE');
    expect(synthesis.spoken[0].voice.name).toBe('Svenska');
    expect(state().speaking).toBe(true);

    // Speaking survives the selection going away.
    window.getSelection().removeAllRanges();
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(state().speaking).toBe(true);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(synthesis.cancel).toHaveBeenCalled();
    // The controller reports the end through the utterances' onend (cancel fires them in
    // browsers); here the test does it.
    act(() => { synthesis.spoken[0].onend?.(); synthesis.spoken[1].onend?.(); });
    expect(state().speaking).toBe(false);
  });

  it('lists Auto and the OCR languages with a local voice, keeps a choice in the preferences and speaks in it, without touching the UI language', () => {
    render();
    select(layerWithText());
    // Auto first, then the OCR languages (swe, eng by default) that have a local voice; the
    // online English GB voice adds nothing, and there is no "follow the interface language".
    expect(state().entries.map((entry) => entry.value)).toEqual(['', 'sv', 'en']);
    expect(state().entries.map((entry) => entry.disabled)).toEqual([false, false, false]);
    // No language guessed for this page: Auto says so and reads in the UI language, the
    // language inside the parenthesis in its own casing and without a region.
    expect(state().entries[0].label).toBe('Auto (language not identified, reads in svenska)');
    expect(state().entries[1].label).toBe('Svenska');
    expect(state().entries[2].label).toBe('Engelska');
    expect(state().selectedValue).toBe('');
    expect(state().languageTitle).toBe('Reading language');

    act(() => { state().chooseLanguage('en'); });
    expect(JSON.parse(window.localStorage.getItem('ODV_USER_PREFERENCES'))).toEqual({ speechLanguage: 'en' });
    expect(state().selectedValue).toBe('en');
    expect(state().currentLabel).toBe('Engelska');
    expect(state().lang).toBe('en-US');
    act(() => { state().speak(); });
    expect(synthesis.spoken[0].lang).toBe('en-US');
    expect(synthesis.spoken[0].voice.name).toBe('English US');
    act(() => { synthesis.spoken[0].onend(); synthesis.spoken[1].onend(); });

    // Back to automatic: the preference is cleared and, with no guess, Swedish is spoken again.
    act(() => { state().chooseLanguage(''); });
    expect(JSON.parse(window.localStorage.getItem('ODV_USER_PREFERENCES') || '{}')).toEqual({});
    act(() => { state().speak(); });
    expect(synthesis.spoken[2].lang).toBe('sv-SE');
  });

  it('automatic reads in the language guessed for the selected page, shown in the entry, until the user picks one', () => {
    render();
    select(layerWithText('en'));
    expect(state().lang).toBe('en-US');
    expect(state().entries[0].label).toBe('Auto (engelska)');
    act(() => { state().speak(); });
    expect(synthesis.spoken[0].lang).toBe('en-US');
    act(() => { synthesis.spoken[0].onend(); synthesis.spoken[1].onend(); });
    // A chosen language overrides the guess.
    act(() => { state().chooseLanguage('sv'); });
    expect(JSON.parse(window.localStorage.getItem('ODV_USER_PREFERENCES'))).toEqual({ speechLanguage: 'sv' });
    expect(state().lang).toBe('sv-SE');
    expect(state().selectedValue).toBe('sv');
  });

  it('with one language installed offers that language alone, no Auto, and reads in it whatever the guess', () => {
    synthesis.getVoices = () => [
      { name: 'Remote Swedish', lang: 'sv-SE', localService: false },
      { name: 'English US', lang: 'en-US', localService: true },
    ];
    render();
    // A Swedish page: Swedish has only an online voice, so English (the one installed) reads.
    select(layerWithText('sv'));
    expect(state().entries.map((entry) => entry.value)).toEqual(['en']);
    expect(state().entries[0].label).toBe('Engelska');
    expect(state().selectedValue).toBe('en');
    expect(state().currentLabel).toBe('Engelska');
    expect(state().lang).toBe('en-US');
    expect(state().voiceMissing).toBe(false);
    expect(state().reason).toBeNull();
    act(() => { state().speak(); });
    expect(synthesis.spoken[0].voice.name).toBe('English US');
    expect(synthesis.spoken[0].lang).toBe('en-US');
  });

  it('never speaks with an online voice: with no local voice for any OCR language it says so, lists one greyed line, and nothing is spoken', () => {
    synthesis.getVoices = () => [
      { name: 'Remote Swedish', lang: 'sv-SE', localService: false },
      { name: 'Remote English', lang: 'en-US', localService: false },
      { name: 'Deutsch', lang: 'de-DE', localService: true },
    ];
    render();
    select(layerWithText());
    expect(state().entries).toEqual([{ value: 'none', label: 'No local voice installed for the recognised languages; online voices are never used', disabled: true }]);
    expect(state().selectedValue).toBe('none');
    expect(state().voiceMissing).toBe(true);
    expect(state().reason).toBe('No local voice installed for the recognised languages; online voices are never used');
    expect(state().speak()).toBe(false);
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it('falls back from a guessed language without a voice to the UI language, then to the first installed one', () => {
    synthesis.getVoices = () => [
      { name: 'Svenska', lang: 'sv-SE', localService: true },
      { name: 'Deutsch', lang: 'de-DE', localService: true },
    ];
    render();
    // English guessed, but only Swedish (the UI language) is installed among the OCR languages.
    select(layerWithText('en'));
    expect(state().entries.map((entry) => entry.value)).toEqual(['sv']);
    expect(state().lang).toBe('sv-SE');
    expect(state().entries[0].label).toBe('Svenska');
  });

  it('reads an older choice stored as a locale as its language, and forgets one that is not offered', () => {
    window.localStorage.setItem('ODV_USER_PREFERENCES', JSON.stringify({ speechLanguage: 'en-US' }));
    render();
    select(layerWithText());
    expect(state().lang).toBe('en-US');
    expect(state().selectedValue).toBe('en');

    act(() => root.unmount());
    root = createRoot(container);
    window.localStorage.setItem('ODV_USER_PREFERENCES', JSON.stringify({ speechLanguage: 'de' }));
    render();
    select(layerWithText());
    // German is no OCR language here: automatic (the UI language without a guess).
    expect(state().lang).toBe('sv-SE');
    expect(state().selectedValue).toBe('');

    // The older "follow the interface language" choice counts as automatic too.
    act(() => root.unmount());
    root = createRoot(container);
    window.localStorage.setItem('ODV_USER_PREFERENCES', JSON.stringify({ speechLanguage: 'ui' }));
    render();
    select(layerWithText('en'));
    expect(state().selectedValue).toBe('');
    expect(state().lang).toBe('en-US');
  });

  it('reads the voice list once the state is provided (a local call) and cancels a reading on unmount', () => {
    const getVoices = vi.spyOn(synthesis, 'getVoices');
    render();
    expect(getVoices).toHaveBeenCalled();
    select(layerWithText());
    act(() => { state().speak(); });
    act(() => root.unmount());
    expect(synthesis.cancel).toHaveBeenCalled();
    root = createRoot(container);
  });
});
