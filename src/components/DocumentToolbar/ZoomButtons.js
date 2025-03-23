// File: src/components/DocumentToolbar/ZoomButtons.js

import React from 'react';
import PropTypes from 'prop-types';

/**
 * ZoomButtons component.
 * Provides buttons to zoom in, zoom out, fit to screen, and fit to width.
 * 
 * @param {Object} props - Component props.
 * @param {function} props.zoomIn - Function to zoom in.
 * @param {function} props.zoomOut - Function to zoom out.
 * @param {function} props.fitToScreen - Function to fit the document to the screen.
 * @param {function} props.fitToWidth - Function to fit the document to the width of the screen.
 */
const ZoomButtons = ({ zoomIn, zoomOut, fitToScreen, fitToWidth }) => (
  <>
    <button onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
      <span className="material-icons">zoom_out</span>
    </button>
    <button onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
      <span className="material-icons">zoom_in</span>
    </button>
    <button onClick={fitToScreen} aria-label="Fit to screen" title="Fit to screen">
      <span className="material-symbols-outlined">fit_page</span>
    </button>
    <button onClick={fitToWidth} aria-label="Fit to width" title="Fit to width">
      <span className="material-symbols-outlined">fit_width</span>
    </button>
  </>
);

ZoomButtons.propTypes = {
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
};

export default ZoomButtons;
