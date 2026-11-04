// File: src/components/DocumentToolbar/ReadSelectionButton.jsx
/**
 * Read the selected recognised text aloud: a toolbar button that appears only while the
 * selection lies in OCR text layers (components/OcrTextLayer.jsx) and the browser can speak
 * (utils/speech.js). A click speaks the selection as it reads on the page, line by line, in the
 * reading language; while speaking the button becomes a stop button and stays until the
 * reading ends or is stopped. The button keeps the selection when clicked (its mousedown is not
 * allowed to move the focus).
 *
 * The reading language follows the viewer's UI language unless the user picks another one: a
 * menu opens under the button while the pointer rests on it (and from the keyboard with the
 * arrow keys), listing the locales the installed voices offer, with "follow the interface
 * language" first. The choice is kept in the viewer preferences (utils/viewerPreferences.js), so
 * it survives reloads without touching the UI language. The menu, like the button, never takes
 * the selection away; the viewer's own shortcuts are off while the focus is in the button or
 * the menu (`data-odv-shortcuts="off"`), so the arrow keys open the menu without turning the
 * page, and a choice or Escape made from the keyboard puts the focus back on the button.
 * Mounted by DocumentToolbar only while `ocr.enabled` is the literal true, so the default code
 * path neither listens to the selection nor touches speech.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOcrLayerSelection, ocrSelectionText } from '../../utils/ocrTextLayout.js';
import { isSpeechSynthesisAvailable, listSpeechLocales, resolveSpeechLanguage, speakText, speechLocaleLabel } from '../../utils/speech.js';
import { getSpeechLanguagePreference, setSpeechLanguagePreference } from '../../utils/viewerPreferences.js';

/** How long the pointer may leave the button and its menu before the menu closes. */
const READ_MENU_CLOSE_DELAY_MS = 250;

/** @returns {string} The selected text as it reads on the page, or '' outside the text layers. */
function selectedLayerText() {
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!selection || selection.isCollapsed || !isOcrLayerSelection(selection)) return '';
  return ocrSelectionText(selection).trim();
}

/**
 * @returns {(React.ReactElement|null)}
 */
export default function ReadSelectionButton() {
  const { t, i18n } = useTranslation('common');
  const available = useMemo(() => isSpeechSynthesisAvailable(), []);
  const [hasSelection, setHasSelection] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voices, setVoices] = useState(/** @type {Array<Object>} */ ([]));
  const [preferred, setPreferred] = useState(() => getSpeechLanguagePreference());
  const controllerRef = useRef(/** @type {(Object|null)} */ (null));
  const shellRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const buttonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const closeTimerRef = useRef(/** @type {*} */ (null));
  const menuId = useId();
  const uiLocale = resolveSpeechLanguage(i18n?.language);
  const lang = preferred || uiLocale;
  const shown = available && (hasSelection || speaking);

  useEffect(() => {
    if (!available || typeof document === 'undefined') return undefined;
    const update = () => setHasSelection(selectedLayerText().length > 0);
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
    const text = selectedLayerText();
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

  /** @param {string} locale  '' follows the UI language. */
  const chooseLanguage = (locale) => {
    setSpeechLanguagePreference(locale);
    setPreferred(locale || null);
    closeMenu();
  };

  if (!shown) return null;

  const locales = listSpeechLocales(voices);
  const label = speaking
    ? t('ocr.read.stop', { defaultValue: 'Stop reading aloud' })
    : t('ocr.read.speak', { defaultValue: 'Read the selected text aloud' });
  const languageTitle = t('ocr.read.language', { defaultValue: 'Reading language' });
  const uiLabel = speechLocaleLabel(uiLocale, i18n?.language);
  const followLabel = t('ocr.read.followUi', { language: uiLabel, defaultValue: `Follow the interface language (${uiLabel})` });
  const currentLabel = preferred ? speechLocaleLabel(preferred, i18n?.language) : followLabel;

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
        aria-label={label}
        title={`${label} · ${languageTitle}: ${currentLabel}`}
        aria-pressed={speaking}
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={speaking ? stop : speak}
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
          {[{ code: '', label: followLabel }, ...locales.map((code) => ({ code, label: speechLocaleLabel(code, i18n?.language) }))].map((entry) => {
            const selected = (preferred || '') === entry.code;
            return (
              <button
                key={entry.code || 'ui'}
                type="button"
                className={`toolbar-popup-menu-item${selected ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                data-speech-locale={entry.code}
                title={entry.code || undefined}
                onClick={() => chooseLanguage(entry.code)}
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
