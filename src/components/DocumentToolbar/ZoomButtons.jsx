/**
 * File: src/components/DocumentToolbar/ZoomButtons.jsx
 *
 * OpenDocViewer — Zoom & Fit Controls
 *
 * PURPOSE
 *   Small, stateless group of buttons used by the toolbar to control zoom and
 *   auto-fit behavior. This component stays “dumb” on purpose—business logic
 *   (clamping, recomputing fit, etc.) lives in higher-level hooks/components.
 *
 * ACCESSIBILITY
 *   - Each control has an aria-label and a title tooltip for clarity.
 *   - Buttons are standard <button type="button">, keyboard and screen-reader friendly.
 *
 * ICONS
 *   - Relies on Material Icons classes present in the consuming page:
 *       • "material-icons"               (filled set)
 *       • "material-symbols-outlined"    (symbols set)
 *     Swap the spans if you prefer a different icon system.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the project we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With `file-type` v21 that subpath is not exported and
 *     will break Vite builds. See README “Design notes & gotchas”.
 *
 * Provenance / baseline reference for earlier version of this component: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';

/**
 * ZoomButtons
 *
 * @param {Object} props
 * @param {() => void} props.zoomIn        Increase zoom level (clamped by caller).
 * @param {() => void} props.zoomOut       Decrease zoom level (clamped by caller).
 * @param {() => void} props.fitToScreen   Compute and apply “fit to screen” zoom.
 * @param {() => void} props.fitToWidth    Compute and apply “fit to width” zoom.
 * @param {boolean} [props.disableZoomOut] Optional: disable the zoom-out action.
 * @param {boolean} [props.disableZoomIn]  Optional: disable the zoom-in action.
 * @param {boolean} [props.disableFits]    Optional: disable both fit actions.
 * @returns {JSX.Element}
 */
const ZoomButtons = ({
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  disableZoomOut = false,
  disableZoomIn = false,
  disableFits = false,
}) => {
  return (
    <>
      <button
        type="button"
        onClick={zoomOut}
        aria-label="Zoom out"
        title="Zoom out"
        className="odv-btn"
        disabled={disableZoomOut}
      >
        <span className="material-icons" aria-hidden="true">zoom_out</span>
      </button>

      <button
        type="button"
        onClick={zoomIn}
        aria-label="Zoom in"
        title="Zoom in"
        className="odv-btn"
        disabled={disableZoomIn}
      >
        <span className="material-icons" aria-hidden="true">zoom_in</span>
      </button>

      <button
        type="button"
        onClick={fitToScreen}
        aria-label="Fit to screen"
        title="Fit to screen"
        className="odv-btn"
        disabled={disableFits}
      >
        <span className="material-symbols-outlined" aria-hidden="true">fit_page</span>
      </button>

      <button
        type="button"
        onClick={fitToWidth}
        aria-label="Fit to width"
        title="Fit to width"
        className="odv-btn"
        disabled={disableFits}
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
  disableZoomOut: PropTypes.bool,
  disableZoomIn: PropTypes.bool,
  disableFits: PropTypes.bool,
};

export default React.memo(ZoomButtons);
