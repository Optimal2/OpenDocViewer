// File: src/utils/speech.js
/**
 * Reading text aloud with the browser's speech synthesis (Web Speech API, `window.speechSynthesis`).
 *
 * The text is spoken in short chunks (a line, a sentence, at most `maxChunkLength` characters at
 * a word boundary): Chromium stops speaking an utterance that runs longer than about fifteen
 * seconds, so one long utterance would fall silent mid-page, while short ones are read through.
 * Only voices that run on the machine are ever used (`SpeechSynthesisVoice.localService`): the
 * text is document content, and an online voice would send it to the browser vendor's service.
 * The voice follows the requested language: a local voice of that exact locale, else a local
 * one of the same base language; with no local voice for the language nothing is spoken at
 * all, because an utterance without a voice lets the browser pick one, which may be online.
 * Nothing is spoken before the first user gesture (browser policy), which is why the viewer
 * speaks only on a button click. Imported only by the read-aloud button, which the toolbar
 * mounts while OCR is on, so nothing here is called while OCR is off.
 */

/** Longest chunk handed to the synthesiser (characters). */
export const SPEECH_MAX_CHUNK_LENGTH = 200;

/**
 * @returns {boolean} Whether this browser can speak.
 */
export function isSpeechSynthesisAvailable() {
  return typeof window !== 'undefined'
    && !!window.speechSynthesis
    && typeof window.speechSynthesis.speak === 'function'
    && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * The speech locale for a viewer UI language ('sv' → 'sv-SE'); other codes pass through.
 * @param {*} uiLanguage
 * @returns {string}
 */
export function resolveSpeechLanguage(uiLanguage) {
  const code = String(uiLanguage || '').trim();
  const base = code.split(/[-_]/)[0].toLowerCase();
  if (base === 'sv') return 'sv-SE';
  if (base === 'en') return code.includes('-') ? code : 'en-US';
  return code || 'en-US';
}

/**
 * Split text into chunks the synthesiser reads through: lines first, then sentences, then at
 * word boundaries when a sentence is still too long. Blank chunks are dropped.
 *
 * @param {*} text
 * @param {number=} maxLength  Default SPEECH_MAX_CHUNK_LENGTH.
 * @returns {Array<string>}
 */
export function splitSpeechChunks(text, maxLength = SPEECH_MAX_CHUNK_LENGTH) {
  const limit = Math.max(20, Math.floor(Number(maxLength)) || SPEECH_MAX_CHUNK_LENGTH);
  const chunks = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    // Sentence ends: a terminator followed by a space. The terminator stays with its sentence.
    const sentences = trimmed.split(/(?<=[.!?…;:])\s+/);
    for (const sentence of sentences) {
      let rest = sentence.trim();
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(' ', limit);
        if (cut <= 0) cut = limit;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks;
}

/**
 * A voice's locale in canonical form ('sv_se' → 'sv-SE'), or '' for none.
 * @param {*} lang
 * @returns {string}
 */
function canonicalLocale(lang) {
  const parts = String(lang || '').trim().replace('_', '-').split('-').filter(Boolean);
  if (parts.length === 0) return '';
  const [base, ...rest] = parts;
  return [base.toLowerCase(), ...rest.map((part) => (part.length === 2 ? part.toUpperCase() : part))].join('-');
}

/**
 * Whether a voice runs on the machine. Only `localService === true` counts: a voice that does
 * not say so is treated as online.
 *
 * @param {*} voice
 * @returns {boolean}
 */
export function isLocalSpeechVoice(voice) {
  return !!voice && voice.localService === true;
}

/**
 * The name of a locale in the UI language ('sv-SE' in Swedish: "svenska (Sverige)"), through
 * Intl.DisplayNames where the browser has it, else the code itself.
 *
 * @param {string} locale
 * @param {*} uiLanguage
 * @returns {string}
 */
export function speechLocaleLabel(locale, uiLanguage) {
  const code = canonicalLocale(locale);
  if (!code) return '';
  try {
    const names = new Intl.DisplayNames([String(uiLanguage || 'en')], { type: 'language' });
    const label = names.of(code);
    if (label && label !== code) return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    // No display names for this language or browser: the code is the label.
  }
  return code;
}

/**
 * The local voice to use for a locale: exact locale first, then the same base language (the
 * browser's default voice first among equals), else null. An online voice is never returned,
 * whatever the locale.
 *
 * @param {Array<Object>} voices  SpeechSynthesisVoice-like: `{ lang, localService, default }`.
 * @param {string} lang
 * @returns {(Object|null)}
 */
export function pickSpeechVoice(voices, lang) {
  const list = (Array.isArray(voices) ? voices : []).filter(isLocalSpeechVoice);
  const wanted = String(lang || '').toLowerCase().replace('_', '-');
  const base = wanted.split('-')[0];
  if (!base) return null;
  const normalize = (voice) => String(voice?.lang || '').toLowerCase().replace('_', '-');
  const rank = (voice) => (voice.default ? 0 : 1);
  const exact = list.filter((voice) => normalize(voice) === wanted).sort((a, b) => rank(a) - rank(b));
  if (exact.length > 0) return exact[0];
  const sameBase = list.filter((voice) => normalize(voice).split('-')[0] === base).sort((a, b) => rank(a) - rank(b));
  return sameBase.length > 0 ? sameBase[0] : null;
}

/**
 * @typedef {Object} SpeechController
 * @property {function(): void} cancel  Stops speaking; `onEnd` is called once with `cancelled`.
 * @property {number} chunkCount  How many utterances were queued (0 when nothing is spoken,
 *   also when no local voice exists for the language).
 */

/**
 * Speak text aloud with a local voice. Anything the synthesiser was saying is cancelled first.
 * Without a local voice for the language nothing is spoken, nothing already speaking is
 * cancelled, and `onEnd` gets `no-voice`.
 *
 * @param {*} text
 * @param {Object} options
 * @param {string} options.lang  Locale of the text, e.g. 'sv-SE'.
 * @param {function(('finished'|'cancelled'|'error'|'no-voice')): void=} options.onEnd  Called
 *   once when the last chunk has been spoken, on cancel, on the first error, or at once when no
 *   local voice exists.
 * @param {Object=} options.synthesis  `window.speechSynthesis` by default (tests inject a fake).
 * @param {Function=} options.Utterance  `window.SpeechSynthesisUtterance` by default.
 * @param {number=} options.maxChunkLength
 * @returns {SpeechController}
 */
export function speakText(text, { lang, onEnd, synthesis, Utterance, maxChunkLength } = {}) {
  const synth = synthesis || (typeof window !== 'undefined' ? window.speechSynthesis : null);
  const UtteranceClass = Utterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  const chunks = splitSpeechChunks(text, maxChunkLength);
  let ended = false;
  const finish = (reason) => {
    if (ended) return;
    ended = true;
    if (typeof onEnd === 'function') onEnd(reason);
  };
  if (!synth || typeof UtteranceClass !== 'function' || chunks.length === 0) {
    finish('finished');
    return { cancel() {}, chunkCount: 0 };
  }

  const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
  const voice = pickSpeechVoice(voices, lang);
  if (!voice) {
    // No local voice: an utterance without one would let the browser choose, possibly an
    // online voice, so nothing is spoken.
    finish('no-voice');
    return { cancel() {}, chunkCount: 0 };
  }
  try { synth.cancel(); } catch { /* nothing was speaking */ }
  let remaining = chunks.length;
  let cancelled = false;
  for (const chunk of chunks) {
    const utterance = new UtteranceClass(chunk);
    utterance.lang = lang || '';
    utterance.voice = voice;
    utterance.onend = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) finish('finished');
    };
    utterance.onerror = (event) => {
      // A cancel reports as an error ('interrupted'/'canceled') on some engines; keep the
      // cancel's own reason for that.
      if (cancelled) return;
      const code = String(event?.error || '');
      if (code === 'interrupted' || code === 'canceled') { finish('cancelled'); return; }
      // The rest of the queue would still be spoken while the caller shows the reading as
      // ended: drop it with the failed chunk.
      cancelled = true;
      try { synth.cancel(); } catch { /* already stopped */ }
      finish('error');
    };
    synth.speak(utterance);
  }
  return {
    chunkCount: chunks.length,
    cancel() {
      if (ended) return;
      cancelled = true;
      try { synth.cancel(); } catch { /* already stopped */ }
      finish('cancelled');
    },
  };
}
