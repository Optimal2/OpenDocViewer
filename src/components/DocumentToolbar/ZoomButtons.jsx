// File: src/components/DocumentToolbar/ZoomButtons.jsx
/**
 * File: src/components/DocumentToolbar/ZoomButtons.jsx
 *
 * Zoom control cluster:
 *   [ - ] [  % editable  ] [ + ]  |  [ 1:1 ] [ Fit Page ] [ Fit Width ]
 *
 * - When the field is NOT focused, it renders like “100%”.
 * - When focused, it renders just the raw number “100” for easy editing.
 * - Enter/Blur applies; Escape cancels and restores the previous value.
 *
 * @component
 * @param {Object} props
 * @param {function():void} props.zoomIn            Zoom in handler.
 * @param {function():void} props.zoomOut           Zoom out handler.
 * @param {function():void} props.fitToScreen       Fit page content to screen height.
 * @param {function():void} props.fitToWidth        Fit page content to container width.
 * @param {function():void=} props.onActualSize     Optional: set zoom to 100% (CUSTOM @ 1.0).
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'CUSTOM')=} props.zoomMode
 *        Optional: current zoom mode for highlighting.
 * @param {boolean=} props.isOneToOneActive         Optional: true when mode is not FIT_* and zoom ≈ 100%.
 * @param {number=} props.zoomPercent               Optional: current zoom in percent (rounded).
 * @param {function(number):void=} props.onPercentApply
 *        Optional: apply a new percent (whole integer, 5–800). If omitted, input edits won't affect zoom.
 * @param {boolean} [props.disableZoomOut=false]    Disable the "zoom out" action.
 * @param {boolean} [props.disableZoomIn=false]     Disable the "zoom in" action.
 * @param {boolean} [props.disableFits=false]       Disable fit actions.
 * @returns {JSX.Element}
 */

import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

function clampPercent(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(5, Math.min(800, v));
}

/**
 * Parse a percent-like string safely.
 * Accepts: "80", "80%", "80.5%", "80,5%", with extra spaces or repeated symbols.
 * - Removes ALL whitespace and percent signs
 * - Normalizes commas to dots
 * - Strips any other non-numeric/non-dot chars
 * - Collapses multiple dots to a single decimal separator
 */
function parsePercentInput(value) {
  if (value == null) return null;
  let s = String(value).trim();

  // Remove ALL whitespace and %; normalize commas to dots (global)
  s = s.replace(/[%\s]+/g, '').replace(/,/g, '.');

  // Keep only digits and dots
  s = s.replace(/[^0-9.]/g, '');

  // Collapse multiple dots to a single one (keep the first)
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return clampPercent(n);
}

const ZoomButtons = ({
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  onActualSize,
  zoomMode = 'CUSTOM',
  isOneToOneActive = false,
  zoomPercent,
  onPercentApply,
  disableZoomOut = false,
  disableZoomIn = false,
  disableFits = false,
}) => {
  const { t } = useTranslation();

  const fitPageActive = zoomMode === 'FIT_PAGE';
  const fitWidthActive = zoomMode === 'FIT_WIDTH';

  // Local draft state for the editable percent field
  const [draft, setDraft] = useState(
    Number.isFinite(zoomPercent) ? String(Math.round(zoomPercent)) : ''
  );
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  // Keep draft in sync when zoomPercent prop changes (and input is not focused)
  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused && Number.isFinite(zoomPercent)) {
      setDraft(String(Math.round(zoomPercent)));
    }
  }, [zoomPercent, isFocused]);

  function applyDraft() {
    const next = parsePercentInput(draft);
    if (next == null) {
      // Revert to last known percent
      if (Number.isFinite(zoomPercent)) {
        setDraft(String(Math.round(zoomPercent)));
      }
      return;
    }
    setDraft(String(next));
    if (typeof onPercentApply === 'function') {
      onPercentApply(next);
    }
  }

  function cancelDraft() {
    if (Number.isFinite(zoomPercent)) {
      setDraft(String(Math.round(zoomPercent)));
    } else {
      setDraft('');
    }
  }

  const disableOneToOne = !onActualSize || !!isOneToOneActive;
  const disableFitPage = disableFits || fitPageActive;
  const disableFitWidth = disableFits || fitWidthActive;

  // Display value: show "100%" while not focused; show "100" while editing.
  const displayValue = isFocused
    ? draft
    : (Number.isFinite(zoomPercent) ? `${Math.round(zoomPercent)}%` : '');

  return (
    <>
      {/* Fixed-zoom group: [-] [ % ] [+] */}
      <div className="zoom-fixed-group" role="group" aria-label={t('toolbar.zoomPercentAria')}>
        <button
          type="button"
          onClick={zoomOut}
          aria-label={t('toolbar.zoomOut')}
          title={t('toolbar.zoomOut')}
          className="odv-btn"
          disabled={disableZoomOut}
        >
          <span className="material-icons" aria-hidden="true">zoom_out</span>
        </button>

        <input
          ref={inputRef}
          className="zoom-percent-input"
          type="text"
          inputMode="decimal"
          pattern="[0-9,.\s%]*"
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setIsFocused(true);
            // Replace “100%” -> “100” for editing and select the text.
            const numeric = Number.isFinite(zoomPercent)
              ? String(Math.round(zoomPercent))
              : draft.replace(/%/g, '');
            setDraft(numeric);
            e.currentTarget.select();
          }}
          onBlur={() => {
            applyDraft();
            setIsFocused(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              applyDraft();
              setIsFocused(false);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelDraft();
              setIsFocused(false);
              e.currentTarget.blur();
            }
          }}
          aria-label={t('toolbar.zoomPercentAria')}
          title={t('toolbar.zoomPercentAria')}
          // Accessible spinbutton semantics without native up/down steppers
          role="spinbutton"
          aria-valuemin={5}
          aria-valuemax={800}
          aria-valuenow={Number.isFinite(zoomPercent) ? Math.round(zoomPercent) : undefined}
          aria-valuetext={
            Number.isFinite(zoomPercent) ? `${Math.round(zoomPercent)}%` : undefined
          }
        />

        <button
          type="button"
          onClick={zoomIn}
          aria-label={t('toolbar.zoomIn')}
          title={t('toolbar.zoomIn')}
          className="odv-btn"
          disabled={disableZoomIn}
        >
          <span className="material-icons" aria-hidden="true">zoom_in</span>
        </button>
      </div>

      {/* 1:1 (Actual size) — active when CUSTOM ≈ 100%; disabled while active */}
      {typeof onActualSize === 'function' && (
        <button
          type="button"
          onClick={onActualSize}
          aria-label={t('toolbar.zoomActual')}
          title={t('toolbar.zoomActual')}
          className={`odv-btn ${isOneToOneActive ? 'is-active' : ''}`}
          disabled={disableOneToOne}
        >
          1:1
        </button>
      )}

      {/* Fit Page */}
      <button
        type="button"
        onClick={fitToScreen}
        aria-label={t('toolbar.fitToScreen')}
        title={t('toolbar.fitToScreen')}
        className={`odv-btn ${fitPageActive ? 'is-active' : ''}`}
        disabled={disableFitPage}
      >
        <span className="material-symbols-outlined" aria-hidden="true">fit_page</span>
      </button>

      {/* Fit Width */}
      <button
        type="button"
        onClick={fitToWidth}
        aria-label={t('toolbar.fitToWidth')}
        title={t('toolbar.fitToWidth')}
        className={`odv-btn ${fitWidthActive ? 'is-active' : ''}`}
        disabled={disableFitWidth}
      >
        <span className="material-symbols-outlined" aria-hidden="true">fit_width</span>
      </button>
    </>
  );
};

ZoomButtons.propTypes = {
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  onActualSize: PropTypes.func,
  zoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'CUSTOM']),
  isOneToOneActive: PropTypes.bool,
  zoomPercent: PropTypes.number,
  onPercentApply: PropTypes.func,
  disableZoomOut: PropTypes.bool,
  disableZoomIn: PropTypes.bool,
  disableFits: PropTypes.bool,
};

export default React.memo(ZoomButtons);
