// File: src/components/DocumentToolbar/ReadSelectionButton.jsx
/**
 * Read the selected recognised text aloud: a toolbar button that appears only while the
 * selection lies in OCR text layers (components/OcrTextLayer.jsx) and the browser can speak
 * (utils/speech.js). A click speaks the selection as it reads on the page, line by line, in the
 * reading language; while speaking the button becomes a stop button and stays until the
 * reading ends or is stopped. The button keeps the selection when clicked (its mousedown is not
 * allowed to move the focus).
 *
 * Only voices that run on the machine are used (utils/speech.js): the text is document content
 * and must not reach an online voice service. Without a local voice for the reading language
 * the button is shown disabled and says so, and nothing is spoken.
 *
 * The reading language is, by default, the language guessed for the selected page's text
 * (`ocr.speech.autoDetectLanguage`, the text layer's `lang`), or the viewer's UI language when
 * the guess is unsure or the guess is turned off. A menu opens under the button while the
 * pointer rests on it (and from the keyboard with the arrow keys): "Automatic" first, then one
 * entry per OCR language (`ocr.languages`), greyed when no local voice is installed for it,
 * and "Follow the interface language" last. The choice is kept in the viewer preferences
 * (utils/viewerPreferences.js): absent for automatic, `ui` for the interface language, or an
 * ISO 639-1 language. The menu, like the button, never takes the selection away; the viewer's
 * own shortcuts are off while the focus is in the button or the menu (`data-odv-shortcuts="off"`),
 * so the arrow keys open the menu without turning the page, and a choice or Escape made from
 * the keyboard puts the focus back on the button. Mounted by OcrToolbarActions (from
 * DocumentToolbar) only while `ocr.enabled` is the literal true and `ocr.speech.enabled` is not
 * the literal false, so with either off the toolbar neither listens to the selection nor touches
 * speech.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOcrLayerSelection, ocrSelectionText } from '../../utils/ocrTextLayout.js';
import { getOcrLanguages, isSpeechLanguageAutoDetectEnabled } from '../../utils/runtimeConfig.js';
import { speechLanguagesForOcr } from '../../utils/ocrLanguageCodes.js';
import { isSpeechSynthesisAvailable, pickSpeechVoice, resolveSpeechLanguage, speakText, speechLocaleLabel } from '../../utils/speech.js';
import { getSpeechLanguagePreference, setSpeechLanguagePreference } from '../../utils/viewerPreferences.js';

/** How long the pointer may leave the button and its menu before the menu closes. */
const READ_MENU_CLOSE_DELAY_MS = 250;
/** Preference value for "follow the interface language" (absent: automatic). */
const FOLLOW_UI = 'ui';

/**
 * The selection inside the text layers: its text as it reads on the page, and the language the
 * text flow of its start was given (the page's guessed language), or null outside the layers.
 * @returns {({ text:string, language:(string|null) }|null)}
 */
function layerSelection() {
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
function normalizeStoredLanguage(stored, languages) {
  const value = String(stored || '').trim().toLowerCase();
  if (!value) return null;
  if (value === FOLLOW_UI) return FOLLOW_UI;
  const base = value.split(/[-_]/)[0];
  return languages.includes(base) ? base : null;
}

/**
 * @returns {(React.ReactElement|null)}
 */
export default function ReadSelectionButton() {
  const { t, i18n } = useTranslation('common');
  const available = useMemo(() => isSpeechSynthesisAvailable(), []);
  const autoDetect = useMemo(() => isSpeechLanguageAutoDetectEnabled(), []);
  const ocrLanguages = useMemo(() => speechLanguagesForOcr(getOcrLanguages()), []);
  const [selection, setSelection] = useState(/** @type {({ text:string, language:(string|null) }|null)} */ (null));
  const [speaking, setSpeaking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voices, setVoices] = useState(/** @type {Array<Object>} */ ([]));
  const [preferred, setPreferred] = useState(() => normalizeStoredLanguage(getSpeechLanguagePreference(), ocrLanguages));
  const controllerRef = useRef(/** @type {(Object|null)} */ (null));
  const shellRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const buttonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const closeTimerRef = useRef(/** @type {*} */ (null));
  const menuId = useId();
  const uiLocale = resolveSpeechLanguage(i18n?.language);
  const detected = autoDetect ? selection?.language || null : null;
  // The reading language: the user's choice, else the page's guessed language, else the UI's.
  const lang = preferred && preferred !== FOLLOW_UI
    ? resolveSpeechLanguage(preferred)
    : (preferred !== FOLLOW_UI && detected ? resolveSpeechLanguage(detected) : uiLocale);
  const shown = available && (!!selection || speaking);

  useEffect(() => {
    if (!available || typeof document === 'undefined') return undefined;
    const update = () => setSelection(layerSelection());
    document.addEventListener('selectionchange', update);
    update();
    return () => { document.removeEventListener('selectionchange', update); };
  }, [available]);

  // The installed voices, read while the button is shown (Chromium lists them only after
  // `voiceschanged` the first time).
  useEffect(() => {
    if (!shown) return undefined;
    const synth = window.speechSynthesis;
    const read = () => setVoices(typeof synth.getVoices === 'function' ? synth.getVoices() : []);
    read();
    synth.addEventListener?.('voiceschanged', read);
    return () => { synth.removeEventListener?.('voiceschanged', read); };
  }, [shown]);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openMenu = () => {
    clearCloseTimer();
    setMenuOpen(true);
  };
  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setMenuOpen(false);
    // Closed from the keyboard with the focus in the menu: the menu unmounts, so the focus
    // goes back to the button instead of falling to the body.
    if (shellRef.current?.contains(document.activeElement) && document.activeElement !== buttonRef.current) {
      buttonRef.current?.focus?.();
    }
  }, []);
  const closeMenuSoon = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpen(false);
    }, READ_MENU_CLOSE_DELAY_MS);
  };

  // Escape and a press outside close the menu, as the toolbar's other menus do.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (shellRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => () => {
    clearCloseTimer();
    controllerRef.current?.cancel();
    controllerRef.current = null;
  }, []);

  const stop = () => {
    controllerRef.current?.cancel();
  };

  const speak = () => {
    const text = layerSelection()?.text || '';
    if (!text) return;
    controllerRef.current?.cancel();
    const controller = speakText(text, {
      lang,
      onEnd: () => {
        controllerRef.current = null;
        setSpeaking(false);
      },
    });
    if (controller.chunkCount === 0) return;
    controllerRef.current = controller;
    setSpeaking(true);
  };

  /** @param {string} value  '' for automatic, FOLLOW_UI, or an ISO 639-1 language. */
  const chooseLanguage = (value) => {
    setSpeechLanguagePreference(value);
    setPreferred(value || null);
    closeMenu();
  };

  if (!shown) return null;

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
  const label = speaking
    ? t('ocr.read.stop', { defaultValue: 'Stop reading aloud' })
    : voiceMissing
      ? t('ocr.read.noLocalVoice', { language: name(lang), defaultValue: `No local voice installed for ${name(lang)}; online voices are never used` })
      : t('ocr.read.speak', { defaultValue: 'Read the selected text aloud' });

  return (
    <div
      ref={shellRef}
      className="toolbar-menu-shell toolbar-ocr-read-shell"
      data-odv-shortcuts="off"
      onMouseEnter={openMenu}
      onMouseLeave={closeMenuSoon}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn toolbar-ocr-read${speaking ? ' is-active' : ''}`}
        data-odv-ocr="read"
        data-speaking={speaking ? 'true' : undefined}
        data-voice-missing={voiceMissing ? 'true' : undefined}
        data-reading-language={lang}
        aria-label={label}
        title={`${label} · ${languageTitle}: ${currentLabel}`}
        aria-pressed={speaking}
        aria-disabled={voiceMissing || undefined}
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={speaking ? stop : (voiceMissing ? undefined : speak)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="material-icons" aria-hidden="true">{speaking ? 'stop_circle' : 'record_voice_over'}</span>
      </button>
      {menuOpen ? (
        <div
          id={menuId}
          className="toolbar-popup-menu toolbar-ocr-read-menu"
          role="menu"
          aria-label={languageTitle}
          data-odv-ocr="read-menu"
          // The menu never takes the selection (and so the button) away.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="toolbar-ocr-read-menu-title" aria-hidden="true">{languageTitle}</div>
          {entries.map((entry) => {
            const selected = entry.value === selectedValue;
            return (
              <button
                key={entry.value || 'auto'}
                type="button"
                className={`toolbar-popup-menu-item${selected ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                aria-disabled={entry.disabled || undefined}
                disabled={entry.disabled}
                data-speech-language={entry.value}
                onClick={() => chooseLanguage(entry.value)}
              >
                <span className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`} aria-hidden="true">
                  {selected ? 'check' : ''}
                </span>
                <span>{entry.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
