// File: src/components/DocumentViewer/CompareZoomOverlay.jsx
/**
 * File: src/components/DocumentViewer/CompareZoomOverlay.jsx
 *
 * Per-pane “post-zoom” controls shown in comparison mode.
 * Renders a small floating cluster:  [ zoom_out ]  ×N  [ zoom_in ]
 * - Only the buttons handle clicks; scrolling over panes should remain natural.
 * - Accessible: proper titles/aria-labels and live-updating factor text.
 *
 * @component
 * @param {Object} props
 * @param {number} props.value              Current post-zoom factor (e.g., 1.0)
 * @param {function():void} props.onInc     Increment handler (e.g., +0.1, clamped upstream)
 * @param {function():void} props.onDec     Decrement handler (e.g., -0.1, clamped upstream)
 * @param {number} [props.min=0.1]          Optional: lower clamp (for disabling "−" at boundary)
 * @param {number} [props.max=4.0]          Optional: upper clamp (for disabling "+" at boundary)
 * @returns {JSX.Element}
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * CompareZoomOverlay
 * Presentational-only (no state). Parent owns the factor and clamping.
 */
const CompareZoomOverlay = ({ value, onInc, onDec, min = 0.1, max = 4.0 }) => {
  const { t } = useTranslation('common');
  const v = Number.isFinite(value) ? value : 1.0;
  const display = `×${v.toFixed(1)}`;

  const atMin = v <= min + 1e-9;
  const atMax = v >= max - 1e-9;

  // Prevent text selection on rapid clicks / double-clicks
  const preventSelect = (e) => {
    e.preventDefault();
  };

  return (
    <div
      className="compare-zoom-overlay"
      role="group"
      aria-label={t('compareZoom.groupLabel', { defaultValue: 'Per-pane zoom controls' })}
      // Also prevent accidental text selection when double-clicking near the label
      onMouseDown={preventSelect}
      onDoubleClick={preventSelect}
      onSelect={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="odv-btn icon"
        onClick={onDec}
        onMouseDown={preventSelect}
        onDoubleClick={preventSelect}
        draggable={false}
        title={t('compareZoom.decrease')}
        aria-label={t('compareZoom.decrease')}
        disabled={atMin}
      >
        {/* Use same icon family as main toolbar, just smaller; CSS will size/color */}
        <span className="material-icons" aria-hidden="true">zoom_out</span>
      </button>

      <span
        className="factor"
        aria-label={t('compareZoom.factor')}
        aria-live="polite"
      >
        {display}
      </span>

      <button
        type="button"
        className="odv-btn icon"
        onClick={onInc}
        onMouseDown={preventSelect}
        onDoubleClick={preventSelect}
        draggable={false}
        title={t('compareZoom.increase')}
        aria-label={t('compareZoom.increase')}
        disabled={atMax}
      >
        <span className="material-icons" aria-hidden="true">zoom_in</span>
      </button>
    </div>
  );
};

CompareZoomOverlay.propTypes = {
  value: PropTypes.number.isRequired,
  onInc: PropTypes.func.isRequired,
  onDec: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
};

export default React.memo(CompareZoomOverlay);
