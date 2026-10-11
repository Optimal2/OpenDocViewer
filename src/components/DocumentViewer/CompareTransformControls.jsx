// File: src/components/DocumentViewer/CompareTransformControls.jsx
/**
 * File: src/components/DocumentViewer/CompareTransformControls.jsx
 *
 * Compare toolbar for one compared page: a disclosure button with a short summary, which expands
 * into fine controls for the page's free transform (utils/compareTransform.js):
 *
 *   zoom      [−] [ 100,0 ] % [+]       0.1 % steps (Shift: 1 %), Ctrl+wheel on the page: 1 %
 *   move      [✥] X [ 0,0 ] Y [ 0,0 ]   drag the page, or arrow keys on ✥ (1 px, Shift: 10 px)
 *   rotation  [↺] [ 0,0 ] ° [↻]        0.1° steps (Shift: 1°)
 *   [reset]
 *
 * Only rendered in compare mode, so the main toolbar never shifts for other users. Numeric fields
 * accept both decimal comma and point; Enter or blur commits, Escape reverts, ArrowUp/ArrowDown
 * step. While the bar is expanded the parent turns drag and Ctrl+wheel on the page into transform
 * changes.
 *
 * @component
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import {
  COMPARE_TRANSFORM_LIMITS,
  formatTransformNumber,
  isIdentityCompareTransform,
  parseLocaleNumber,
  resolveTransformKeyAction,
} from '../../utils/compareTransform.js';

/**
 * Rotation shown signed in (-180, 180] so a small counter-clockwise tilt reads as −0,1 and not 359,9.
 * @param {number} rotation
 * @returns {number}
 */
function toSignedRotation(rotation) {
  return rotation > 180 ? Math.round((rotation - 360) * 10) / 10 : rotation;
}

/**
 * Numeric text field with locale-aware parsing; keeps a draft while focused.
 *
 * @param {Object} props
 * @param {number} props.value
 * @param {number} props.decimals
 * @param {string} props.language
 * @param {string} props.label
 * @param {string} props.unit
 * @param {number} props.step
 * @param {number=} props.min
 * @param {number=} props.max
 * @param {string} props.invalidMessage
 * @param {string} props.className
 * @param {function(number): void} props.onCommit
 * @param {function(number): void} props.onStep
 * @returns {React.ReactElement}
 */
function TransformNumberField({
  value, decimals, language, label, unit, step, min, max, invalidMessage, className, onCommit, onStep,
}) {
  const formatted = formatTransformNumber(value, decimals, language);
  const [draft, setDraft] = useState(formatted);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(formatted);
  }, [editing, formatted]);

  const commit = useCallback(() => {
    // An untouched field must not round the stored value to the displayed decimals.
    if (draft === formatted) {
      setInvalid(false);
      return;
    }
    const parsed = parseLocaleNumber(draft);
    if (Number.isNaN(parsed)) {
      setInvalid(true);
      setDraft(formatted);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  }, [draft, formatted, onCommit]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      setEditing(false);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setInvalid(false);
      setDraft(formatted);
      setEditing(false);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const sign = event.key === 'ArrowUp' ? 1 : -1;
      setEditing(false);
      onStep(sign * step * (event.shiftKey ? 10 : 1));
    }
  };

  return (
    <span className={`compare-transform-field ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        className={invalid ? 'is-invalid' : ''}
        value={draft}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${formatted} ${unit}`.trim()}
        aria-invalid={invalid || undefined}
        title={invalid ? invalidMessage : label}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => { setEditing(true); event.target.select(); }}
        onChange={(event) => { setEditing(true); setDraft(event.target.value); }}
        onBlur={() => { commit(); setEditing(false); }}
        onKeyDown={handleKeyDown}
      />
      {unit ? <span className="compare-transform-unit" aria-hidden="true">{unit}</span> : null}
    </span>
  );
}

TransformNumberField.propTypes = {
  value: PropTypes.number.isRequired,
  decimals: PropTypes.number.isRequired,
  language: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  unit: PropTypes.string,
  step: PropTypes.number.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  invalidMessage: PropTypes.string.isRequired,
  className: PropTypes.string,
  onCommit: PropTypes.func.isRequired,
  onStep: PropTypes.func.isRequired,
};

/**
 * @param {Object} props
 * @param {('primary'|'compare')} props.pane
 * @param {{ scale:number, dx:number, dy:number, rotation:number }} props.transform The page's
 *   compare transform (utils/compareTransform.js).
 * @param {boolean} props.expanded
 * @param {function(boolean): void} props.onExpandedChange
 * @param {function(Object): void} props.onAction compareTransformReducer action dispatcher.
 * @returns {React.ReactElement}
 */
const CompareTransformControls = ({ pane, transform, expanded, onExpandedChange, onAction }) => {
  const { t, i18n } = useTranslation('common');
  const language = String(i18n?.resolvedLanguage || i18n?.language || 'en');
  const controlsId = useId();
  const target = pane === 'compare' ? 'compare' : 'primary';
  const invalidMessage = t('compareTransform.invalidNumber', { defaultValue: 'Enter a number, for example 12.5 or 12,5' });

  const zoomPercent = transform.scale * 100;
  const signedRotation = toSignedRotation(transform.rotation);
  const zoomText = formatTransformNumber(zoomPercent, 1, language);
  const rotationText = formatTransformNumber(signedRotation, 1, language);
  const summary = t('compareTransform.summary', {
    zoom: zoomText,
    rotation: rotationText,
    defaultValue: `${zoomText} % · ${rotationText}°`,
  });

  const nudge = (field, delta) => onAction({ type: 'nudge', target, field, delta });
  const set = (patch) => onAction({ type: 'set', target, transform: patch });
  const fine = (event, step) => step * (event?.shiftKey ? 10 : 1);

  const handlePadKeyDown = (event) => {
    const action = resolveTransformKeyAction(event, target);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    onAction(action);
  };

  const toggleLabel = expanded
    ? t('compareTransform.hide', { defaultValue: 'Hide fine-tuning for this page' })
    : t('compareTransform.show', { defaultValue: 'Fine-tune zoom, position and rotation for this page' });

  return (
    <div
      className={[
        'compare-transform-bar',
        target === 'compare' ? 'is-compare' : 'is-primary',
        expanded ? 'is-expanded' : '',
      ].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label={target === 'compare'
        ? t('compareTransform.toolbarCompare', { defaultValue: 'Fine-tuning, right page' })
        : t('compareTransform.toolbarPrimary', { defaultValue: 'Fine-tuning, left page' })}
    >
      <button
        type="button"
        className="odv-btn compare-transform-toggle"
        aria-expanded={expanded}
        aria-controls={controlsId}
        title={toggleLabel}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="material-icons" aria-hidden="true">tune</span>
        <span className="compare-transform-toggle-label">
          {t('compareTransform.toggle', { defaultValue: 'Fine-tune' })}
        </span>
        <span className="compare-transform-summary">{summary}</span>
      </button>

      {expanded ? (
        <div id={controlsId} className="compare-transform-controls">
          <span className="compare-transform-group" role="group" aria-label={t('compareTransform.zoomGroup', { defaultValue: 'Zoom' })}>
            <button
              type="button"
              className="odv-btn icon"
              title={t('compareTransform.zoomOut', { defaultValue: 'Zoom out 0.1 % (Shift: 1 %)' })}
              aria-label={t('compareTransform.zoomOut', { defaultValue: 'Zoom out 0.1 % (Shift: 1 %)' })}
              onClick={(event) => nudge('scale', -fine(event, 0.001))}
            >
              <span className="material-icons" aria-hidden="true">remove</span>
            </button>
            <TransformNumberField
              className="is-zoom"
              value={Math.round(zoomPercent * 10) / 10}
              decimals={1}
              language={language}
              unit="%"
              step={0.1}
              min={COMPARE_TRANSFORM_LIMITS.minScale * 100}
              max={COMPARE_TRANSFORM_LIMITS.maxScale * 100}
              label={t('compareTransform.zoomField', { defaultValue: 'Page zoom in percent' })}
              invalidMessage={invalidMessage}
              onCommit={(percent) => set({ scale: percent / 100 })}
              onStep={(deltaPercent) => nudge('scale', deltaPercent / 100)}
            />
            <button
              type="button"
              className="odv-btn icon"
              title={t('compareTransform.zoomIn', { defaultValue: 'Zoom in 0.1 % (Shift: 1 %)' })}
              aria-label={t('compareTransform.zoomIn', { defaultValue: 'Zoom in 0.1 % (Shift: 1 %)' })}
              onClick={(event) => nudge('scale', fine(event, 0.001))}
            >
              <span className="material-icons" aria-hidden="true">add</span>
            </button>
          </span>

          <span className="compare-transform-group" role="group" aria-label={t('compareTransform.moveGroup', { defaultValue: 'Position' })}>
            <button
              type="button"
              className="odv-btn icon compare-transform-pad"
              data-odv-shortcuts="off"
              title={t('compareTransform.movePad', { defaultValue: 'Move the page: drag it, or use the arrow keys here (Shift: 10 px)' })}
              aria-label={t('compareTransform.movePad', { defaultValue: 'Move the page: drag it, or use the arrow keys here (Shift: 10 px)' })}
              onKeyDown={handlePadKeyDown}
            >
              <span className="material-icons" aria-hidden="true">open_with</span>
            </button>
            <span className="compare-transform-axis" aria-hidden="true">X</span>
            <TransformNumberField
              className="is-offset"
              value={transform.dx}
              decimals={1}
              language={language}
              unit="px"
              step={1}
              label={t('compareTransform.dxField', { defaultValue: 'Horizontal offset in pixels' })}
              invalidMessage={invalidMessage}
              onCommit={(dx) => set({ dx })}
              onStep={(delta) => nudge('dx', delta)}
            />
            <span className="compare-transform-axis" aria-hidden="true">Y</span>
            <TransformNumberField
              className="is-offset"
              value={transform.dy}
              decimals={1}
              language={language}
              unit="px"
              step={1}
              label={t('compareTransform.dyField', { defaultValue: 'Vertical offset in pixels' })}
              invalidMessage={invalidMessage}
              onCommit={(dy) => set({ dy })}
              onStep={(delta) => nudge('dy', delta)}
            />
          </span>

          <span className="compare-transform-group" role="group" aria-label={t('compareTransform.rotationGroup', { defaultValue: 'Rotation' })}>
            <button
              type="button"
              className="odv-btn icon"
              title={t('compareTransform.rotateCcw', { defaultValue: 'Rotate 0.1° counter-clockwise (Shift: 1°)' })}
              aria-label={t('compareTransform.rotateCcw', { defaultValue: 'Rotate 0.1° counter-clockwise (Shift: 1°)' })}
              onClick={(event) => nudge('rotation', -fine(event, 0.1))}
            >
              <span className="material-icons" aria-hidden="true">rotate_left</span>
            </button>
            <TransformNumberField
              className="is-rotation"
              value={signedRotation}
              decimals={1}
              language={language}
              unit="°"
              step={0.1}
              label={t('compareTransform.rotationField', { defaultValue: 'Rotation in degrees' })}
              invalidMessage={invalidMessage}
              onCommit={(rotation) => set({ rotation })}
              onStep={(delta) => nudge('rotation', delta)}
            />
            <button
              type="button"
              className="odv-btn icon"
              title={t('compareTransform.rotateCw', { defaultValue: 'Rotate 0.1° clockwise (Shift: 1°)' })}
              aria-label={t('compareTransform.rotateCw', { defaultValue: 'Rotate 0.1° clockwise (Shift: 1°)' })}
              onClick={(event) => nudge('rotation', fine(event, 0.1))}
            >
              <span className="material-icons" aria-hidden="true">rotate_right</span>
            </button>
          </span>

          <button
            type="button"
            className="odv-btn icon"
            title={t('compareTransform.reset', { defaultValue: 'Reset zoom, position and rotation for this page' })}
            aria-label={t('compareTransform.reset', { defaultValue: 'Reset zoom, position and rotation for this page' })}
            disabled={isIdentityCompareTransform(transform)}
            onClick={() => onAction({ type: 'reset', target })}
          >
            <span className="material-icons" aria-hidden="true">restart_alt</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

CompareTransformControls.propTypes = {
  pane: PropTypes.oneOf(['primary', 'compare']).isRequired,
  transform: PropTypes.shape({
    scale: PropTypes.number.isRequired,
    dx: PropTypes.number.isRequired,
    dy: PropTypes.number.isRequired,
    rotation: PropTypes.number.isRequired,
  }).isRequired,
  expanded: PropTypes.bool.isRequired,
  onExpandedChange: PropTypes.func.isRequired,
  onAction: PropTypes.func.isRequired,
};

export default React.memo(CompareTransformControls);
