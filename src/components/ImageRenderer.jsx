// File: src/components/ImageRenderer.jsx
/**
 * File: src/components/ImageRenderer.jsx
 *
 * OpenDocViewer — Absolute-positioned Image Renderer
 *
 * PURPOSE
 *   Render a single page image at a specified zoom factor. The element is absolutely
 *   positioned and scaled via CSS transforms. The parent container controls layout.
 *
 * ACCESSIBILITY
 *   - Provides an informative alt text with the page number.
 *
 * DESIGN NOTES / GOTCHAS
 *   - We scale with CSS `transform: scale()` and set `transformOrigin: 'top left'` so
 *     coordinates/measurements are intuitive for overlay math.
 *   - We keep this component “dumb”: layout and visibility are owned by the parent.
 *   - Project-wide reminder: When type-sniffing elsewhere we import from the **root**
 *     'file-type' package, NOT 'file-type/browser' (v21 does not export that subpath
 *     for bundlers and builds will fail if changed).
 *
 * Provenance / source reference for previous baseline: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';

/**
 * Image load/error handler.
 * @callback ImgEventHandler
 * @param {*} e
 * @returns {void}
 */

/**
 * ImageRenderer component.
 *
 * @param {Object} props
 * @param {string} props.src                     Resolved URL of the rasterized page image.
 * @param {number} props.zoom                    Zoom factor (1 = 100%).
 * @param {number} props.pageNumber              1-based page number for alt text and data attribute.
 * @param {string} [props.className]             Optional extra class names.
 * @param {*} [props.style]                      Optional style overrides (merged last).
 * @param {('anonymous'|'use-credentials')} [props.crossOrigin] Optional CORS mode.
 * @param {string} [props.referrerPolicy]        Optional referrer policy for the request.
 * @param {ImgEventHandler} [props.onLoad]       Load handler.
 * @param {ImgEventHandler} [props.onError]      Error handler.
 * @param {boolean} [props.draggable=false]      Whether the image is draggable.
 * @returns {React.ReactElement}
 */
const ImageRenderer = React.forwardRef(function ImageRenderer(
  {
    src,
    zoom,
    pageNumber,
    className = '',
    style = {},
    crossOrigin,
    referrerPolicy,
    onLoad,
    onError,
    draggable = false,
    // Note: not documenting dashed prop names (e.g., 'data-testid') in JSDoc to keep Closure parser happy.
    ...rest
  },
  ref
) {
  // Defensive: ensure a sane, positive zoom
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  /** @type {React.CSSProperties} */
  const baseStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    visibility: 'visible',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    objectFit: 'contain',
    willChange: 'transform',
    imageRendering: 'auto',
  };

  return (
    <img
      ref={ref}
      src={src}
      alt={`Page ${pageNumber}`}
      data-page-number={pageNumber}
      className={className}
      style={{ ...baseStyle, ...style }}
      crossOrigin={crossOrigin}
      referrerPolicy={referrerPolicy}
      draggable={draggable}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
      {...rest}
    />
  );
});

ImageRenderer.displayName = 'ImageRenderer';

ImageRenderer.propTypes = {
  src: PropTypes.string.isRequired,
  zoom: PropTypes.number.isRequired,
  pageNumber: PropTypes.number.isRequired,
  className: PropTypes.string,
  style: PropTypes.object,
  crossOrigin: PropTypes.oneOf(['anonymous', 'use-credentials']),
  referrerPolicy: PropTypes.string,
  onLoad: PropTypes.func,
  onError: PropTypes.func,
  draggable: PropTypes.bool,
};

export default ImageRenderer;
