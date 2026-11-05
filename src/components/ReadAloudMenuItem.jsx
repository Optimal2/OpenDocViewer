// File: src/components/ReadAloudMenuItem.jsx
/**
 * The page context menu's read-aloud entry (DocumentViewer/DocumentViewerRender.jsx): "Read the
 * selection aloud" while nothing is being read, greyed with the reason in its tooltip when
 * nothing can be read (no selection in the text layers, no local voice for the reading
 * language); "Stop reading aloud" while a reading runs (Escape stops it too). The entry keeps
 * the selection (its mousedown never moves the focus). Renders nothing without the read-aloud
 * state (contexts/readAloudContext.js), that is while OCR or read-aloud is off.
 */
import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ReadAloudContext from '../contexts/readAloudContext.js';

/**
 * @param {{ onDone: function(): void }} props  Called after a choice, so the menu closes.
 * @returns {(React.ReactElement|null)}
 */
export default function ReadAloudMenuItem({ onDone }) {
  const { t } = useTranslation('common');
  const readAloud = useContext(ReadAloudContext);
  if (!readAloud) return null;
  const { speaking, reason, speak, stop } = readAloud;
  const label = speaking
    ? t('ocr.read.stop', { defaultValue: 'Stop reading aloud' })
    : t('ocr.read.menuSpeak', { defaultValue: 'Read the selection aloud' });
  // Greyed with aria-disabled rather than disabled: the entry stays focusable, so the arrow keys
  // reach it and a screen reader hears the reason (in its accessible name).
  const disabled = !speaking && !!reason;
  return (
    <button
      type="button"
      className="odv-context-menu-item"
      role="menuitem"
      data-odv-ocr="read"
      data-speaking={speaking ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      aria-label={disabled ? `${label} · ${reason}` : undefined}
      title={disabled ? `${label} · ${reason}` : (speaking ? label : t('ocr.read.speak', { defaultValue: 'Read the selected text aloud' }))}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (disabled) return;
        if (speaking) stop();
        else speak();
        if (typeof onDone === 'function') onDone();
      }}
    >
      <span className="material-icons" aria-hidden="true">{speaking ? 'stop_circle' : 'record_voice_over'}</span>
      <span>{label}</span>
    </button>
  );
}

ReadAloudMenuItem.propTypes = {
  onDone: PropTypes.func,
};
