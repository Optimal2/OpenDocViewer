// File: src/utils/__tests__/speech.test.js
/**
 * Reading aloud (utils/speech.js) against a fake synthesiser: chunking by line, sentence and
 * length, the voice choice per locale, the utterances queued with the locale and voice, the end
 * callback once, and cancel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSpeechSynthesisAvailable,
  listSpeechLocales,
  pickSpeechVoice,
  resolveSpeechLanguage,
  SPEECH_MAX_CHUNK_LENGTH,
  speakText,
  speechLocaleLabel,
  splitSpeechChunks,
} from '../speech.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}

function fakeSynthesis(voices = []) {
  const spoken = [];
  return {
    spoken,
    cancel: vi.fn(),
    getVoices: () => voices,
    speak: vi.fn((utterance) => { spoken.push(utterance); }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('splitSpeechChunks', () => {
  it('splits at line breaks and sentence ends and drops blank lines', () => {
    expect(splitSpeechChunks('Hej världen. Andra meningen!\n\nNy rad: med kolon; och mer\r\nSista')).toEqual([
      'Hej världen.', 'Andra meningen!', 'Ny rad:', 'med kolon;', 'och mer', 'Sista',
    ]);
  });

  it('cuts a long sentence at word boundaries within the limit', () => {
    const words = Array.from({ length: 60 }, (_, i) => `ord${i}`).join(' ');
    const chunks = splitSpeechChunks(words, 50);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
    expect(chunks.join(' ')).toBe(words);
  });

  it('cuts inside a word only when a word alone exceeds the limit', () => {
    expect(splitSpeechChunks('a'.repeat(45), 20)).toEqual(['a'.repeat(20), 'a'.repeat(20), 'aaaaa']);
    expect(SPEECH_MAX_CHUNK_LENGTH).toBe(200);
    expect(splitSpeechChunks('', 20)).toEqual([]);
  });
});

describe('resolveSpeechLanguage', () => {
  it('maps the viewer languages to locales and passes other codes through', () => {
    expect(resolveSpeechLanguage('sv')).toBe('sv-SE');
    expect(resolveSpeechLanguage('sv-SE')).toBe('sv-SE');
    expect(resolveSpeechLanguage('en')).toBe('en-US');
    expect(resolveSpeechLanguage('en-GB')).toBe('en-GB');
    expect(resolveSpeechLanguage('de-DE')).toBe('de-DE');
    expect(resolveSpeechLanguage(undefined)).toBe('en-US');
  });
});

describe('pickSpeechVoice', () => {
  const voices = [
    { name: 'Remote Swedish', lang: 'sv-SE', localService: false },
    { name: 'Local Swedish', lang: 'sv-SE', localService: true },
    { name: 'Finland Swedish', lang: 'sv-FI', localService: true },
    { name: 'English', lang: 'en-US', localService: true, default: true },
  ];

  it('prefers the exact locale, local over remote', () => {
    expect(pickSpeechVoice(voices, 'sv-SE').name).toBe('Local Swedish');
  });

  it('falls back to the same base language, then to nothing', () => {
    expect(pickSpeechVoice(voices, 'sv').name).toBe('Local Swedish');
    expect(pickSpeechVoice(voices.filter((voice) => voice.lang !== 'sv-SE'), 'sv-SE').name).toBe('Finland Swedish');
    expect(pickSpeechVoice(voices, 'de-DE')).toBeNull();
    expect(pickSpeechVoice([], 'sv-SE')).toBeNull();
    expect(pickSpeechVoice(voices, '')).toBeNull();
  });
});

describe('speakText', () => {
  it('cancels what was speaking, queues one utterance per chunk with locale and voice, ends once', () => {
    const synthesis = fakeSynthesis([{ name: 'Local Swedish', lang: 'sv-SE', localService: true }]);
    const onEnd = vi.fn();
    const controller = speakText('Första raden.\nAndra raden', { lang: 'sv-SE', onEnd, synthesis, Utterance: FakeUtterance });

    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(controller.chunkCount).toBe(2);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['Första raden.', 'Andra raden']);
    expect(synthesis.spoken.every((utterance) => utterance.lang === 'sv-SE')).toBe(true);
    expect(synthesis.spoken.every((utterance) => utterance.voice?.name === 'Local Swedish')).toBe(true);

    synthesis.spoken[0].onend();
    expect(onEnd).not.toHaveBeenCalled();
    synthesis.spoken[1].onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('finished');
    controller.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('cancel stops the synthesiser and reports cancelled once, also when the engine then errors', () => {
    const synthesis = fakeSynthesis();
    const onEnd = vi.fn();
    const controller = speakText('Hej', { lang: 'sv-SE', onEnd, synthesis, Utterance: FakeUtterance });
    controller.cancel();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledWith('cancelled');
    synthesis.spoken[0].onerror({ error: 'interrupted' });
    synthesis.spoken[0].onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reports an engine error once, drops the rest of the queue, and an interruption as cancelled', () => {
    const synthesis = fakeSynthesis();
    const onEnd = vi.fn();
    speakText('Hej. Då.', { lang: 'sv-SE', onEnd, synthesis, Utterance: FakeUtterance });
    synthesis.spoken[0].onerror({ error: 'synthesis-failed' });
    // The rest of the queue is dropped with the failed chunk (cancel: once at start, once now).
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    synthesis.spoken[1].onerror({ error: 'synthesis-failed' });
    synthesis.spoken[1].onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('error');

    const other = fakeSynthesis();
    const onEnd2 = vi.fn();
    speakText('Hej', { lang: 'sv-SE', onEnd: onEnd2, synthesis: other, Utterance: FakeUtterance });
    other.spoken[0].onerror({ error: 'interrupted' });
    expect(onEnd2).toHaveBeenCalledWith('cancelled');
  });

  it('speaks nothing for empty text or without a synthesiser, and still ends', () => {
    const synthesis = fakeSynthesis();
    const onEnd = vi.fn();
    expect(speakText('   \n ', { lang: 'sv-SE', onEnd, synthesis, Utterance: FakeUtterance }).chunkCount).toBe(0);
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('finished');
    const onEnd2 = vi.fn();
    expect(speakText('Hej', { lang: 'sv-SE', onEnd: onEnd2, synthesis: null, Utterance: null }).chunkCount).toBe(0);
    expect(onEnd2).toHaveBeenCalledWith('finished');
  });
});

describe('isSpeechSynthesisAvailable', () => {
  it('needs speechSynthesis.speak and the utterance constructor on window', () => {
    vi.stubGlobal('window', { speechSynthesis: { speak() {} }, SpeechSynthesisUtterance: FakeUtterance });
    expect(isSpeechSynthesisAvailable()).toBe(true);
    vi.stubGlobal('window', { speechSynthesis: { speak() {} } });
    expect(isSpeechSynthesisAvailable()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isSpeechSynthesisAvailable()).toBe(false);
  });
});

describe('listSpeechLocales', () => {
  it('lists each locale of the installed voices once, in canonical form, sorted', () => {
    const voices = [
      { name: 'A', lang: 'sv-SE' }, { name: 'B', lang: 'sv_se' }, { name: 'C', lang: 'en-GB' },
      { name: 'D', lang: 'en-US' }, { name: 'E', lang: 'EN-us' }, { name: 'F', lang: '' }, null,
    ];
    expect(listSpeechLocales(voices)).toEqual(['en-GB', 'en-US', 'sv-SE']);
    expect(listSpeechLocales(null)).toEqual([]);
  });
});

describe('speechLocaleLabel', () => {
  it('names a locale in the UI language, capitalised, and falls back to the code', () => {
    expect(speechLocaleLabel('sv-SE', 'sv')).toMatch(/^Svenska/);
    expect(speechLocaleLabel('sv-SE', 'en')).toMatch(/^Swedish/);
    expect(speechLocaleLabel('en-US', 'sv')).toMatch(/^[A-ZÅÄÖ].*engelska/);
    // A code Intl rejects (a one-letter language) falls back to the code itself.
    expect(speechLocaleLabel('x', 'sv')).toBe('x');
    expect(speechLocaleLabel('', 'sv')).toBe('');
  });
});
