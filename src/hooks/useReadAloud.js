// File: src/hooks/useReadAloud.js
/**
 * Read the selected recognised text aloud: the state behind the page's context menu entry and
 * the toolbar's "Reading language" section (contexts/readAloudContext.js). Follows the
 * selection inside the OCR text layers (components/OcrTextLayer.jsx), speaks it as it reads
 * on the page, line by line (utils/speech.js), and keeps the reading-language choice in the
 * viewer preferences (utils/viewerPreferences.js): absent for automatic, `ui` for the
 * interface language, or an ISO 639-1 language.
 *
 * Only voices that run on the machine are used: the text is document content and must not
 * reach an online voice service. Without a local voice for the reading language nothing is
 * spoken and `voiceMissing` says so.
 *
 * The reading language is, by default, the language guessed for the selected page's text
 * (`ocr.speech.autoDetectLanguage`, the text flow's `lang`), or the viewer's UI language when
 * the guess is unsure or turned off. Escape stops a reading. Used only by ReadAloudProvider,
 * which is mounted while `ocr.enabled` is the literal true and `ocr.speech.enabled` is not the
 * literal false; on the default code path this hook never runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOcrLayerSelection, ocrSelectionText } from '../utils/ocrTextLayout.js';
import { getOcrLanguages, isSpeechLanguageAutoDetectEnabled } from '../utils/runtimeConfig.js';
import { speechLanguagesForOcr } from '../utils/ocrLanguageCodes.js';
import { isSpeechSynthesisAvailable, pickSpeechVoice, resolveSpeechLanguage, speakText, speechLocaleLabel } from '../utils/speech.js';
import { getSpeechLanguagePreference, setSpeechLanguagePreference } from '../utils/viewerPreferences.js';

/**
 * Preference value an older viewer stored for "follow the interface language"; no longer offered,
 * it counts as automatic.
 */
const LEGACY_FOLLOW_UI = 'ui';

/**
 * The selection inside the text layers: its text as it reads on the page, and the language the
 * text flow of its start was given (the page's guessed language), or null outside the layers.
 * @returns {({ text:string, language:(string|null) }|null)}
 */
export function layerSelection() {
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!selection || selection.isCollapsed || !isOcrLayerSelection(selection)) return null;
  const text = ocrSelectionText(selection).trim();
  if (!text) return null;
  let language = null;
  try {
    const node = selection.getRangeAt(0).startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    // The start lies in the flow's text, or (a selection of the whole layer) on the layer.
    const flow = element?.closest?.('.ocr-text-layer-flow') || element?.closest?.('.ocr-text-layer')?.querySelector('.ocr-text-layer-flow');
    language = flow?.getAttribute('lang') || null;
  } catch {
    // No range: no language.
  }
  return { text, language };
}

/**
 * A stored reading-language choice in today's form: one of the OCR languages, else null
 * (automatic). An older choice stored as a locale ('en-US') counts as its language; the older
 * "follow the interface language" choice counts as automatic.
 * @param {(string|null)} stored
 * @param {Array<string>} languages  The OCR languages (ISO 639-1).
 * @returns {(string|null)}
 */
export function normalizeStoredLanguage(stored, languages) {
  const value = String(stored || '').trim().toLowerCase();
  if (!value || value === LEGACY_FOLLOW_UI) return null;
  const base = value.split(/[-_]/)[0];
  return languages.includes(base) ? base : null;
}

/**
 * @returns {Object}  The read-aloud state (ReadAloudState in contexts/readAloudContext.js).
 */
export default function useReadAloud() {
  const { t, i18n } = useTranslation('common');
  const available = useMemo(() => isSpeechSynthesisAvailable(), []);
  const autoDetect = useMemo(() => isSpeechLanguageAutoDetectEnabled(), []);
  const ocrLanguages = useMemo(() => speechLanguagesForOcr(getOcrLanguages()), []);
  const [selection, setSelection] = useState(/** @type {({ text:string, language:(string|null) }|null)} */ (null));
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState(/** @type {Array<Object>} */ ([]));
  const [preferred, setPreferred] = useState(() => normalizeStoredLanguage(getSpeechLanguagePreference(), ocrLanguages));
  const controllerRef = useRef(/** @type {(Object|null)} */ (null));
  const uiLocale = resolveSpeechLanguage(i18n?.language);
  const uiLanguage = String(uiLocale || '').split(/[-_]/)[0];
  const detected = autoDetect ? selection?.language || null : null;
  // The OCR languages that have a voice installed on the machine: the only ones ever read.
  const installed = ocrLanguages.filter((code) => !!pickSpeechVoice(voices, resolveSpeechLanguage(code)));
  const single = installed.length === 1 ? installed[0] : null;
  // The automatic reading language: the page's guessed language when it has a voice, else the
  // UI language when it has one, else the first language that has one (null: nothing can be read).
  const automatic = (detected && installed.includes(detected) ? detected : null)
    || (installed.includes(uiLanguage) ? uiLanguage : null)
    || installed[0]
    || null;
  // The user's choice counts while it is offered; with one installed language that one is read.
  const chosen = single || (preferred && installed.includes(preferred) ? preferred : null);
  const lang = resolveSpeechLanguage(chosen || automatic || uiLanguage);

  // The selection is kept by value: a selectionchange that leaves the text and language as they
  // were (the caret moving within a word during a drag) sets no new state, so the consumers of
  // the provided state do not re-render for it.
  useEffect(() => {
    if (!available || typeof document === 'undefined') return undefined;
    const update = () => setSelection((previous) => {
      const next = layerSelection();
      if (previous === next) return previous;
      if (previous && next && previous.text === next.text && previous.language === next.language) return previous;
      return next;
    });
    document.addEventListener('selectionchange', update);
    update();
    return () => { document.removeEventListener('selectionchange', update); };
  }, [available]);

  // The installed voices (Chromium lists them only after `voiceschanged` the first time). Read
  // while the state is provided, so the language menu can grey the languages without a local
  // voice before anything is selected. A local call; nothing leaves the machine.
  useEffect(() => {
    if (!available) return undefined;
    const synth = window.speechSynthesis;
    const read = () => setVoices(typeof synth.getVoices === 'function' ? synth.getVoices() : []);
    read();
    synth.addEventListener?.('voiceschanged', read);
    return () => { synth.removeEventListener?.('voiceschanged', read); };
  }, [available]);

  const stop = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);

  // Escape stops a reading (the context menu that started it has long closed). Listened to in
  // the bubble phase and only when nothing else took the key: an Escape that closes a dialog or
  // a menu (they cancel the event) leaves the reading alone.
  useEffect(() => {
    if (!speaking || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) stop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [speaking, stop]);

  useEffect(() => () => {
    controllerRef.current?.cancel();
    controllerRef.current = null;
  }, []);

  const speak = useCallback(() => {
    const text = layerSelection()?.text || '';
    if (!text) return false;
    controllerRef.current?.cancel();
    const controller = speakText(text, {
      lang,
      onEnd: () => {
        controllerRef.current = null;
        setSpeaking(false);
      },
    });
    if (controller.chunkCount === 0) return false;
    controllerRef.current = controller;
    setSpeaking(true);
    return true;
  }, [lang]);

  /** @param {string} value  '' for automatic, or an ISO 639-1 language. */
  const chooseLanguage = useCallback((value) => {
    setSpeechLanguagePreference(value);
    setPreferred(value || null);
  }, []);

  // Labels name the language, never the region ("svenska", not "svenska (Sverige)" for the
  // sv-SE interface locale). A menu entry's own name is capitalised; a language inside a
  // parenthesis keeps its own casing.
  const language = (code) => String(code || '').split(/[-_]/)[0];
  const name = (code) => speechLocaleLabel(language(code), i18n?.language);
  const inner = (code) => speechLocaleLabel(language(code), i18n?.language, false);
  // No local voice for the reading language: nothing is ever spoken with an online voice.
  const voiceMissing = !speaking && !pickSpeechVoice(voices, lang);
  const languageTitle = t('ocr.read.language', { defaultValue: 'Reading language' });
  // "Auto" always names what it will do: the language guessed for the selected page's text, or,
  // when the guess is unsure (or has no voice), the language it falls back to.
  const autoLabel = detected && automatic === detected
    ? t('ocr.read.auto', { language: inner(detected), defaultValue: `Auto (${inner(detected)})` })
    : t('ocr.read.autoUnknown', { language: inner(automatic || uiLanguage), defaultValue: `Auto (language not identified, reads in ${inner(automatic || uiLanguage)})` });
  // The choices: "Auto" (with the guess on) and the installed languages. One installed language
  // is offered alone, there is nothing to choose; none gives one greyed line saying so.
  const noVoicesLabel = t('ocr.read.noVoices', { defaultValue: 'No local voice installed for the recognised languages; online voices are never used' });
  /** @type {Array<{ value:string, label:string, disabled:boolean }>} */
  const entries = installed.length === 0
    ? [{ value: 'none', label: noVoicesLabel, disabled: true }]
    : [
      ...(autoDetect && !single ? [{ value: '', label: autoLabel, disabled: false }] : []),
      ...installed.map((code) => ({ value: code, label: name(code), disabled: false })),
    ];
  // The current choice among the entries: the single language, the user's offered choice, else
  // "Auto" when listed, else the automatic language itself.
  const selectedValue = installed.length === 0 ? 'none' : (chosen || (autoDetect && !single ? '' : automatic || ''));
  const currentLabel = entries.find((entry) => entry.value === selectedValue)?.label || entries[0].label;
  const reason = !available
    ? t('ocr.read.unavailable', { defaultValue: 'This browser cannot read text aloud' })
    : !selection
      ? t('ocr.read.noSelection', { defaultValue: "Select text in the page's text layer first" })
      : voiceMissing
        ? (installed.length === 0
          ? noVoicesLabel
          : t('ocr.read.noLocalVoice', { language: inner(lang), defaultValue: `No local voice installed for ${inner(lang)}; online voices are never used` }))
        : null;

  return {
    available,
    selection,
    speaking,
    voiceMissing,
    lang,
    langName: inner(lang),
    reason,
    speak,
    stop,
    autoDetect,
    languageTitle,
    entries,
    selectedValue,
    currentLabel,
    chooseLanguage,
  };
}
