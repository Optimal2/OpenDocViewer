// File: src/components/DocumentToolbar/ZoomButtons.jsx
/**
 * File: src/components/DocumentToolbar/ZoomButtons.jsx
 *
 * Zoom control cluster:
 *   [ - ] [  % editable  ] [ + ]  |  [ 1:1 ] [ Fit Page ] [ Fit Width ] [ Custom Fit ]
 *
 * - When the field is NOT focused, it renders like “100%”.
 * - When focused, it renders just the raw number “100” for easy editing.
 * - Enter/Blur applies; Escape cancels and restores the previous value.
 *
 * @component
 * @param {Object} props
 * @param {function():void} props.zoomIn            Zoom in handler.
 * @param {function():void} props.zoomOut           Zoom out handler.
 * @param {function():void} props.fitToScreen       Fit page content within the current pane viewport.
 * @param {function():void} props.fitToCustomWidth  Fit page width with a configured/user factor.
 * @param {function():void} props.fitToWidth        Fit page content to the current pane width.
 * @param {function():void=} props.onActualSize     Optional: set zoom to 100% (ACTUAL_SIZE / 1:1).
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM')=} props.zoomMode
 *        Optional: current zoom mode for highlighting.
 * @param {boolean=} props.isOneToOneActive         Optional: true when mode is not FIT_* and zoom ≈ 100%.
 * @param {number=} props.zoomPercent               Optional: current zoom in percent (rounded).
 * @param {function(number):void=} props.onPercentApply
 *        Optional: apply a new percent (whole integer, 5–800). If omitted, input edits won't affect zoom.
 * @param {boolean} [props.disableZoomOut=false]    Disable the "zoom out" action.
 * @param {boolean} [props.disableZoomIn=false]     Disable the "zoom in" action.
 * @param {boolean} [props.disableFits=false]       Disable fit actions.
 * @param {number=} props.customFitWidthFactorPercent
 * @param {number=} props.configuredCustomFitWidthFactorPercent
 * @param {function(number):void=} props.onCustomFitWidthFactorChange
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|null)=} props.userDefaultZoomMode
 * @param {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')=} props.configuredDefaultZoomMode
 * @param {function((string|null)):void=} props.onDefaultZoomModeChange
 * @returns {JSX.Element}
 */

import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import useAcceleratingHoldRepeat from '../../hooks/useAcceleratingHoldRepeat.js';
import SplitToolbarButton from './SplitToolbarButton.jsx';

function clampPercent(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(5, Math.min(800, v));
}

function clampFactorPercent(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(100, v));
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
  fitToCustomWidth,
  fitToWidth,
  onActualSize,
  zoomMode = 'CUSTOM',
  isOneToOneActive = false,
  zoomPercent,
  onPercentApply,
  disableZoomOut = false,
  disableZoomIn = false,
  disableFits = false,
  customFitWidthFactorPercent = 70,
  configuredCustomFitWidthFactorPercent = 70,
  onCustomFitWidthFactorChange,
  userDefaultZoomMode = null,
  configuredDefaultZoomMode = 'FIT_WIDTH',
  onDefaultZoomModeChange,
}) => {
  const { t } = useTranslation();

  const fitPageActive = zoomMode === 'FIT_PAGE';
  const fitCustomActive = zoomMode === 'FIT_CUSTOM';
  const fitWidthActive = zoomMode === 'FIT_WIDTH';

  // Local draft state for the editable percent field
  const [draft, setDraft] = useState(
    Number.isFinite(zoomPercent) ? String(Math.round(zoomPercent)) : ''
  );
  const [isFocused, setIsFocused] = useState(false);
  const [factorDraft, setFactorDraft] = useState(String(clampFactorPercent(customFitWidthFactorPercent) || 70));
  const inputRef = useRef(null);

  // Keep draft in sync when zoomPercent prop changes (and input is not focused)
  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused && Number.isFinite(zoomPercent)) {
      setDraft(String(Math.round(zoomPercent)));
    }
  }, [zoomPercent, isFocused]);

  useEffect(() => {
    const next = clampFactorPercent(customFitWidthFactorPercent) || 70;
    setFactorDraft(String(next));
  }, [customFitWidthFactorPercent]);

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

  function applyFactorDraft() {
    const next = clampFactorPercent(factorDraft);
    if (next == null) {
      setFactorDraft(String(clampFactorPercent(customFitWidthFactorPercent) || 70));
      return;
    }
    setFactorDraft(String(next));
    onCustomFitWidthFactorChange?.(next);
  }

  const getZoomModeLabel = (mode) => {
    if (mode === 'ACTUAL_SIZE') return t('toolbar.zoomDefault.modes.actual', { defaultValue: 'Actual size (1:1)' });
    if (mode === 'FIT_PAGE') return t('toolbar.zoomDefault.modes.fitPage', { defaultValue: 'Fit page' });
    if (mode === 'FIT_CUSTOM') return t('toolbar.zoomDefault.modes.fitCustom', { defaultValue: 'Custom fit' });
    return t('toolbar.zoomDefault.modes.fitWidth', { defaultValue: 'Fit width' });
  };

  const renderDefaultZoomModeRow = (mode, closeMenu) => {
    const selected = userDefaultZoomMode === mode;
    return (
      <button
        key={mode}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        className={`toolbar-popup-menu-item toolbar-split-menu-row${selected ? ' is-selected' : ''}`}
        onClick={() => {
          onDefaultZoomModeChange?.(mode);
          closeMenu();
        }}
      >
        <span className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`} aria-hidden="true">
          {selected ? 'check' : ''}
        </span>
        <span>{getZoomModeLabel(mode)}</span>
      </button>
    );
  };

  const disableOneToOne = !onActualSize || !!isOneToOneActive;
  const disableFitPage = disableFits || fitPageActive;
  const disableFitCustom = disableFits || fitCustomActive;
  const disableFitWidth = disableFits || fitWidthActive;
  const zoomOutRepeat = useAcceleratingHoldRepeat({
    action: zoomOut,
    disabled: disableZoomOut,
  });
  const zoomInRepeat = useAcceleratingHoldRepeat({
    action: zoomIn,
    disabled: disableZoomIn,
  });

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
          onClick={zoomOutRepeat.onClick}
          onPointerDown={zoomOutRepeat.onPointerDown}
          onMouseDown={zoomOutRepeat.onMouseDown}
          onTouchStart={zoomOutRepeat.onTouchStart}
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
          onClick={zoomInRepeat.onClick}
          onPointerDown={zoomInRepeat.onPointerDown}
          onMouseDown={zoomInRepeat.onMouseDown}
          onTouchStart={zoomInRepeat.onTouchStart}
          aria-label={t('toolbar.zoomIn')}
          title={t('toolbar.zoomIn')}
          className="odv-btn"
          disabled={disableZoomIn}
        >
          <span className="material-icons" aria-hidden="true">zoom_in</span>
        </button>
      </div>

      {/* 1:1 (Actual size) — active when zoom is effectively 100%; disabled while active */}
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

      {/* Custom fit-width factor */}
      <SplitToolbarButton
        onClick={fitToCustomWidth}
        ariaLabel={t('toolbar.fitCustomWidth', {
          percent: customFitWidthFactorPercent,
          defaultValue: `Custom fit (${customFitWidthFactorPercent}% of width)`,
        })}
        title={t('toolbar.fitCustomWidthTitle', {
          percent: customFitWidthFactorPercent,
          defaultValue: `Fit to ${customFitWidthFactorPercent}% of the calculated fit-width zoom`,
        })}
        menuLabel={t('toolbar.fitCustomWidthMenu', { defaultValue: 'Custom zoom settings' })}
        className={fitCustomActive ? 'is-active' : ''}
        mainClassName={fitCustomActive ? 'is-active' : ''}
        disabled={disableFitCustom}
        menuChildren={({ closeMenu }) => (
          <>
            <div className="toolbar-split-menu-section">
              <div className="toolbar-split-menu-title">
                {t('toolbar.fitCustomWidthFactor.label', { defaultValue: 'Width factor' })}
              </div>
              <div className="toolbar-split-menu-form">
                <label htmlFor="odv-custom-fit-width-factor">
                  {t('toolbar.fitCustomWidthFactor.inputLabel', { defaultValue: 'Percent of fit width' })}
                </label>
                <input
                  id="odv-custom-fit-width-factor"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={factorDraft}
                  onChange={(event) => setFactorDraft(event.target.value)}
                  onBlur={applyFactorDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyFactorDraft();
                      closeMenu();
                    } else if (event.key === 'Escape') {
                      closeMenu();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                role="menuitem"
                className="toolbar-popup-menu-item toolbar-split-menu-row"
                onClick={() => {
                  const next = clampFactorPercent(configuredCustomFitWidthFactorPercent) || 70;
                  setFactorDraft(String(next));
                  onCustomFitWidthFactorChange?.(next);
                  closeMenu();
                }}
              >
                <span className="toolbar-popup-menu-check material-icons" aria-hidden="true">restart_alt</span>
                <span>
                  {t('toolbar.fitCustomWidthFactor.useSystem', {
                    percent: configuredCustomFitWidthFactorPercent,
                    defaultValue: `Use system factor (${configuredCustomFitWidthFactorPercent}%)`,
                  })}
                </span>
              </button>
            </div>
            <div className="toolbar-split-menu-section">
              <div className="toolbar-split-menu-title">
                {t('toolbar.zoomDefault.title', { defaultValue: 'Startup zoom' })}
              </div>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={userDefaultZoomMode == null}
                className={`toolbar-popup-menu-item toolbar-split-menu-row${userDefaultZoomMode == null ? ' is-selected' : ''}`}
                onClick={() => {
                  onDefaultZoomModeChange?.(null);
                  closeMenu();
                }}
              >
                <span className={`toolbar-popup-menu-check${userDefaultZoomMode == null ? ' material-icons is-selected' : ''}`} aria-hidden="true">
                  {userDefaultZoomMode == null ? 'check' : ''}
                </span>
                <span>
                  {t('toolbar.zoomDefault.useSystem', {
                    mode: getZoomModeLabel(configuredDefaultZoomMode),
                    defaultValue: `Use system default (${getZoomModeLabel(configuredDefaultZoomMode)})`,
                  })}
                </span>
              </button>
              {['ACTUAL_SIZE', 'FIT_PAGE', 'FIT_CUSTOM', 'FIT_WIDTH'].map((mode) => renderDefaultZoomModeRow(mode, closeMenu))}
            </div>
          </>
        )}
      >
        <span className="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
      </SplitToolbarButton>
    </>
  );
};

ZoomButtons.propTypes = {
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToCustomWidth: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  onActualSize: PropTypes.func,
  zoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', 'CUSTOM']),
  isOneToOneActive: PropTypes.bool,
  zoomPercent: PropTypes.number,
  onPercentApply: PropTypes.func,
  disableZoomOut: PropTypes.bool,
  disableZoomIn: PropTypes.bool,
  disableFits: PropTypes.bool,
  customFitWidthFactorPercent: PropTypes.number,
  configuredCustomFitWidthFactorPercent: PropTypes.number,
  onCustomFitWidthFactorChange: PropTypes.func,
  userDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', null]),
  configuredDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE']),
  onDefaultZoomModeChange: PropTypes.func,
};

export default React.memo(ZoomButtons);
