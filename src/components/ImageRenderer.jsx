// File: src/components/ImageRenderer.js

import React from 'react';
import PropTypes from 'prop-types';

/**
 * ImageRenderer component.
 * Renders an image with the specified properties.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - The source URL of the image.
 * @param {number} props.zoom - The zoom level to apply to the image.
 * @param {number} props.pageNumber - The page number of the image.
 * @param {Object} ref - The reference to the image element.
 */
const ImageRenderer = React.forwardRef(({ src, zoom, pageNumber }, ref) => (
  <img
    ref={ref}
    src={src}
    alt={`Page ${pageNumber}`}
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      visibility: 'visible',
      transform: `scale(${zoom})`,
      objectFit: 'contain',
    }}
    data-page-number={pageNumber}
  />
));

ImageRenderer.displayName = 'ImageRenderer';

ImageRenderer.propTypes = {
  src: PropTypes.string.isRequired,
  zoom: PropTypes.number.isRequired,
  pageNumber: PropTypes.number.isRequired,
};

export default ImageRenderer;
