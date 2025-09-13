// File: src/components/DocumentToolbar/ZoomButtons.jsx
/**
 * File: src/components/DocumentToolbar/ZoomButtons.jsx
 *
 * Zoom control cluster: zoom out/in and fit to screen/width.
 *
 * @component
 * @param {Object} props
 * @param {function():void} props.zoomIn - Zoom in handler.
 * @param {function():void} props.zoomOut - Zoom out handler.
 * @param {function():void} props.fitToScreen - Fit page content to screen height.
 * @param {function():void} props.fitToWidth - Fit page content to container width.
 * @param {boolean} [props.disableZoomOut=false] - Disable the "zoom out" action.
 * @param {boolean} [props.disableZoomIn=false] - Disable the "zoom in" action.
 * @param {boolean} [props.disableFits=false] - Disable fit actions.
 * @returns {JSX.Element}
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

const ZoomButtons = ({
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  disableZoomOut = false,
  disableZoomIn = false,
  disableFits = false,
}) => {
  const { t } = useTranslation();
  return (
    <>
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

      <button
        type="button"
        onClick={fitToScreen}
        aria-label={t('toolbar.fitToScreen')}
        title={t('toolbar.fitToScreen')}
        className="odv-btn"
        disabled={disableFits}
      >
        <span className="material-symbols-outlined" aria-hidden="true">fit_page</span>
      </button>

      <button
        type="button"
        onClick={fitToWidth}
        aria-label={t('toolbar.fitToWidth')}
        title={t('toolbar.fitToWidth')}
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
