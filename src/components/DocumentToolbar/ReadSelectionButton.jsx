// File: src/components/DocumentToolbar/ReadSelectionButton.jsx
/**
 * Read the selected recognised text aloud: a toolbar button that appears only while the
 * selection lies in OCR text layers (components/OcrTextLayer.jsx) and the browser can speak
 * (utils/speech.js). A click speaks the selection as it reads on the page, line by line, in the
 * viewer's UI language; while speaking the button becomes a stop button and stays until the
 * reading ends or is stopped. The button keeps the selection when clicked (its mousedown is not
 * allowed to move the focus). Mounted by DocumentToolbar only while `ocr.enabled` is the
 * literal true, so the default code path neither listens to the selection nor touches speech.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOcrLayerSelection, ocrSelectionText } from '../../utils/ocrTextLayout.js';
import { isSpeechSynthesisAvailable, resolveSpeechLanguage, speakText } from '../../utils/speech.js';

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
  const controllerRef = useRef(/** @type {(Object|null)} SpeechController of utils/speech.js */ (null));

  useEffect(() => {
    if (!available || typeof document === 'undefined') return undefined;
    const update = () => setHasSelection(selectedLayerText().length > 0);
    document.addEventListener('selectionchange', update);
    update();
    return () => { document.removeEventListener('selectionchange', update); };
  }, [available]);

  useEffect(() => () => {
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
      lang: resolveSpeechLanguage(i18n?.language),
      onEnd: () => {
        controllerRef.current = null;
        setSpeaking(false);
      },
    });
    if (controller.chunkCount === 0) return;
    controllerRef.current = controller;
    setSpeaking(true);
  };

  if (!available || (!hasSelection && !speaking)) return null;

  const label = speaking
    ? t('ocr.read.stop', { defaultValue: 'Stop reading aloud' })
    : t('ocr.read.speak', { defaultValue: 'Read the selected text aloud' });
  return (
    <button
      type="button"
      className={`odv-btn toolbar-ocr-read${speaking ? ' is-active' : ''}`}
      data-odv-ocr="read"
      data-speaking={speaking ? 'true' : undefined}
      aria-label={label}
      title={label}
      aria-pressed={speaking}
      onMouseDown={(event) => event.preventDefault()}
      onClick={speaking ? stop : speak}
    >
      <span className="material-icons" aria-hidden="true">{speaking ? 'stop_circle' : 'record_voice_over'}</span>
    </button>
  );
}
