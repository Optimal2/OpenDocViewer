// File: src/components/CanvasRenderer.js

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * CanvasRenderer component.
 * Renders a canvas element with specific styles and properties.
 * 
 * @param {Object} props - Component props.
 * @param {number} props.naturalWidth - The natural width of the image.
 * @param {number} props.naturalHeight - The natural height of the image.
 * @param {number} props.zoom - The zoom level.
 * @param {number} props.pageNumber - The page number for the canvas.
 * @param {React.Ref} ref - The ref to the canvas element.
 */
const CanvasRenderer = React.forwardRef(({ naturalWidth, naturalHeight, zoom, pageNumber }, ref) => {
  const canvasStyle = useMemo(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    visibility: 'visible',
    transform: `scale(${zoom})`,
    objectFit: 'contain',
  }), [zoom]);

  return (
    <canvas
      ref={ref}
      width={naturalWidth || 0}
      height={naturalHeight || 0}
      style={canvasStyle}
      data-page-number={pageNumber}
    />
  );
});

CanvasRenderer.displayName = 'CanvasRenderer';

CanvasRenderer.propTypes = {
  naturalWidth: PropTypes.number.isRequired,
  naturalHeight: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  pageNumber: PropTypes.number.isRequired,
};

export default CanvasRenderer;
