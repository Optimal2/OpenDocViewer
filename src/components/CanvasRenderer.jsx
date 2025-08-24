/**
 * File: src/components/CanvasRenderer.jsx
 *
 * OpenDocViewer — Absolute-positioned Canvas Renderer
 *
 * PURPOSE
 *   Render a <canvas> element for a single page at a specified zoom factor.
 *   The parent component (DocumentRender) draws into the canvas and controls
 *   rotation/filters; this component focuses on layout and accessibility.
 *
 * ACCESSIBILITY
 *   - The canvas carries a data attribute with the 1-based page number so
 *     assistive tooling/tests can reference it. Visual labeling happens in
 *     surrounding UI (thumbnails, toolbar, etc.).
 *
 * DESIGN NOTES / GOTCHAS
 *   - We scale using CSS `transform: scale(...)` with `transformOrigin: 'top left'`
 *     so overlay math (coordinates) is intuitive.
 *   - We do not apply `pointerEvents: 'none'`—the parent may want to capture
 *     interactions on the canvas (drag-to-pan, etc.).
 *   - Project-wide reminder: when type-sniffing elsewhere we import from the
 *     **root** 'file-type' package, NOT 'file-type/browser' (v21 does not export
 *     that subpath for bundlers and builds will fail if changed).
 *
 * Provenance / source reference for prior baseline: :contentReference[oaicite:0]{index=0}
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * CanvasRenderer component.
 *
 * @param {Object} props
 * @param {number} props.naturalWidth    The natural (unscaled) raster width.
 * @param {number} props.naturalHeight   The natural (unscaled) raster height.
 * @param {number} props.zoom            Zoom factor where 1 = 100%.
 * @param {number} props.pageNumber      1-based page number for data attributes.
 * @param {React.Ref<HTMLCanvasElement>} ref Forwarded ref to the <canvas> element.
 * @returns {JSX.Element}
 */
const CanvasRenderer = React.forwardRef(function CanvasRenderer(
  { naturalWidth, naturalHeight, zoom, pageNumber },
  ref
) {
  // Defensive zoom: keep > 0; NaN/Infinity fall back to 1
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  const canvasStyle = useMemo(
    () =>
      /** @type {React.CSSProperties} */ ({
        position: 'absolute',
        top: 0,
        left: 0,
        visibility: 'visible',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        objectFit: 'contain',
        willChange: 'transform',
        imageRendering: 'auto', // consider 'pixelated' for very high zoom if desired
      }),
    [scale]
  );

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

export default React.memo(CanvasRenderer);
