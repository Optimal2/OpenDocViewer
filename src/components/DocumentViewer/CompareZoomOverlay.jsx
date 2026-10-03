// File: src/components/DocumentViewer/CompareZoomOverlay.jsx
/**
 * File: src/components/DocumentViewer/CompareZoomOverlay.jsx
 *
 * Per-pane “post-zoom” controls shown in comparison mode, tucked behind the pane marker ring at the
 * top-left of each pane. At rest only the (semi-transparent) ring shows, with a faded tail below it
 * hinting at the controls. Hovering the zone, keyboard focus inside it, or a tap expands it
 * downwards into a vertical control:
 *
 *     ( ring )
 *   [ zoom_in ]
 *       ×N
 *   [ zoom_out ]
 *
 * It collapses shortly after the pointer has left and focus has moved out, and at once on Escape.
 * - Only the zone's own box takes pointer events; the collapsed controls are hidden (not focusable,
 *   not in the accessibility tree), so scrolling and clicking the page around it stay natural.
 * - Accessible: titles/aria-labels, a focusable live-updating factor, Tab order ring → zoom in →
 *   factor → zoom out.
 *
 * @component
 * @param {Object} props
 * @param {number} props.value              Current post-zoom factor (e.g., 1.0)
 * @param {function():void} props.onInc     Increment handler (e.g., +0.1, clamped upstream)
 * @param {function():void} props.onDec     Decrement handler (e.g., -0.1, clamped upstream)
 * @param {number} [props.min=0.1]          Optional: lower clamp (for disabling "−" at boundary)
 * @param {number} [props.max=4.0]          Optional: upper clamp (for disabling "+" at boundary)
 * @param {('primary'|'compare')} [props.pane='primary']  Pane tone: blue (primary) or orange (compare).
 * @param {React.ReactNode} [props.marker=null]  The pane marker ring (first focusable element).
 * @returns {JSX.Element}
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/** Delay before the zone collapses after the pointer/focus has left, so it does not flicker. */
const COLLAPSE_DELAY_MS = 180;

/**
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isKeyboardFocus(target) {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * CompareZoomOverlay
 * Parent owns the factor and clamping; this component only owns the expanded/collapsed state.
 */
const CompareZoomOverlay = ({ value, onInc, onDec, min = 0.1, max = 4.0, pane = 'primary', marker = null }) => {
  const { t } = useTranslation('common');
  const v = Number.isFinite(value) ? value : 1.0;
  const display = `×${v.toFixed(1)}`;

  const atMin = v <= min + 1e-9;
  const atMax = v >= max - 1e-9;

  const [expanded, setExpanded] = useState(false);
  const zoneRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const collapseTimerRef = useRef(0);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  // After Escape the zone stays collapsed while focus remains on the ring.
  const suppressedRef = useRef(false);

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = 0;
    }
  }, []);

  const sync = useCallback(() => {
    cancelCollapse();
    if (pointerInsideRef.current || focusInsideRef.current) {
      setExpanded(true);
      return;
    }
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = 0;
      setExpanded(false);
    }, COLLAPSE_DELAY_MS);
  }, [cancelCollapse]);

  useEffect(() => cancelCollapse, [cancelCollapse]);

  // A lifted finger sends no pointerleave of its own, so a tap elsewhere collapses a tapped zone.
  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (event) => {
      if (zoneRef.current?.contains(/** @type {Node} */ (event.target))) return;
      pointerInsideRef.current = false;
      sync();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded, sync]);

  const handlePointerEnter = () => {
    suppressedRef.current = false;
    pointerInsideRef.current = true;
    sync();
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType === 'touch') return;
    pointerInsideRef.current = false;
    sync();
  };

  const handleFocus = (event) => {
    // A mouse click on the ring leaves focus there; only keyboard focus keeps the zone open.
    focusInsideRef.current = !suppressedRef.current && isKeyboardFocus(event.target);
    sync();
  };

  const handleBlur = (event) => {
    if (zoneRef.current?.contains(/** @type {Node|null} */ (event.relatedTarget))) return;
    focusInsideRef.current = false;
    suppressedRef.current = false;
    sync();
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    suppressedRef.current = true;
    pointerInsideRef.current = false;
    focusInsideRef.current = false;
    cancelCollapse();
    setExpanded(false);
    // Focus inside the controls would vanish with them; return it to the ring.
    const zone = zoneRef.current;
    if (zone && zone.contains(document.activeElement) && document.activeElement?.closest('.compare-zoom-overlay')) {
      /** @type {HTMLElement|null} */ (zone.querySelector('button, [tabindex]'))?.focus();
    }
  };

  // Prevent text selection on rapid clicks / double-clicks
  const preventSelect = (e) => {
    e.preventDefault();
  };

  return (
    <div
      ref={zoneRef}
      className={[
        'compare-zoom-zone',
        pane === 'compare' ? 'is-compare' : 'is-primary',
        expanded ? 'is-expanded' : '',
      ].filter(Boolean).join(' ')}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {marker}
      <span className="compare-zoom-tail" aria-hidden="true" />
      <div
        className="compare-zoom-overlay"
        role="group"
        aria-label={t('compareZoom.groupLabel', { defaultValue: 'Per-pane zoom controls' })}
        // Also prevent accidental text selection when double-clicking near the label
        onMouseDown={preventSelect}
        onDoubleClick={preventSelect}
        onSelectStart={preventSelect}
      >
        <button
          type="button"
          className="odv-btn icon"
          onClick={onInc}
          onMouseDown={preventSelect}
          onDoubleClick={preventSelect}
          draggable={false}
          title={t('compareZoom.increase', { defaultValue: 'Increase pane zoom' })}
          aria-label={t('compareZoom.increase', { defaultValue: 'Increase pane zoom' })}
          disabled={atMax}
        >
          {/* Use same icon family as main toolbar, just smaller; CSS will size/color */}
          <span className="material-icons" aria-hidden="true">zoom_in</span>
        </button>

        <output
          className="factor"
          tabIndex={0}
          aria-label={`${t('compareZoom.factor', { defaultValue: 'Pane zoom factor' })} ${display}`}
          aria-live="polite"
        >
          {display}
        </output>

        <button
          type="button"
          className="odv-btn icon"
          onClick={onDec}
          onMouseDown={preventSelect}
          onDoubleClick={preventSelect}
          draggable={false}
          title={t('compareZoom.decrease', { defaultValue: 'Decrease pane zoom' })}
          aria-label={t('compareZoom.decrease', { defaultValue: 'Decrease pane zoom' })}
          disabled={atMin}
        >
          <span className="material-icons" aria-hidden="true">zoom_out</span>
        </button>
      </div>
    </div>
  );
};

CompareZoomOverlay.propTypes = {
  value: PropTypes.number.isRequired,
  onInc: PropTypes.func.isRequired,
  onDec: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  pane: PropTypes.oneOf(['primary', 'compare']),
  marker: PropTypes.node,
};

export default React.memo(CompareZoomOverlay);
