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

/** Preference value for "follow the interface language" (absent: automatic). */
export const FOLLOW_UI = 'ui';

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
 * A stored reading-language choice in today's form: `ui`, or one of the OCR languages, else
 * null (automatic). An older choice stored as a locale ('en-US') counts as its language.
 * @param {(string|null)} stored
 * @param {Array<string>} languages  The OCR languages (ISO 639-1).
 * @returns {(string|null)}
 */
export function normalizeStoredLanguage(stored, languages) {
  const value = String(stored || '').trim().toLowerCase();
  if (!value) return null;
  if (value === FOLLOW_UI) return FOLLOW_UI;
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
  const detected = autoDetect ? selection?.language || null : null;
  // The reading language: the user's choice, else the page's guessed language, else the UI's.
  const lang = preferred && preferred !== FOLLOW_UI
    ? resolveSpeechLanguage(preferred)
    : (preferred !== FOLLOW_UI && detected ? resolveSpeechLanguage(detected) : uiLocale);

  useEffect(() => {
    if (!available || typeof document === 'undefined') return undefined;
    const update = () => setSelection(layerSelection());
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

  // Escape stops a reading (the context menu that started it has long closed).
  useEffect(() => {
    if (!speaking || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); };
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

  /** @param {string} value  '' for automatic, FOLLOW_UI, or an ISO 639-1 language. */
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
  const followLabel = t('ocr.read.followUi', { language: inner(uiLocale), defaultValue: `Follow the interface language (${inner(uiLocale)})` });
  // "Auto" always names what it will do: the language guessed for the selected page's text, or,
  // when the guess is unsure, the UI language it falls back to.
  const autoLabel = detected
    ? t('ocr.read.auto', { language: inner(detected), defaultValue: `Auto (${inner(detected)})` })
    : t('ocr.read.autoUnknown', { language: inner(uiLocale), defaultValue: `Auto (language not identified, reads in ${inner(uiLocale)})` });
  /** @type {Array<{ value:string, label:string, disabled:boolean }>} */
  const entries = [
    ...(autoDetect ? [{ value: '', label: autoLabel, disabled: false }] : []),
    ...ocrLanguages.map((code) => {
      const hasVoice = !!pickSpeechVoice(voices, resolveSpeechLanguage(code));
      return {
        value: code,
        label: hasVoice ? name(code) : t('ocr.read.languageNoVoice', { language: name(code), defaultValue: `${name(code)} (no local voice installed)` }),
        disabled: !hasVoice,
      };
    }),
    { value: FOLLOW_UI, label: followLabel, disabled: false },
  ];
  // With the guess off, an absent preference is the interface language.
  const selectedValue = preferred ?? (autoDetect ? '' : FOLLOW_UI);
  const currentLabel = entries.find((entry) => entry.value === selectedValue)?.label || followLabel;
  const reason = !available
    ? t('ocr.read.unavailable', { defaultValue: 'This browser cannot read text aloud' })
    : !selection
      ? t('ocr.read.noSelection', { defaultValue: "Select text in the page's text layer first" })
      : voiceMissing
        ? t('ocr.read.noLocalVoice', { language: inner(lang), defaultValue: `No local voice installed for ${inner(lang)}; online voices are never used` })
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
