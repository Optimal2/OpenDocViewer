// File: src/components/CanvasRenderer.jsx
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
 *   - The bitmap size (`naturalWidth` × `naturalHeight`) is applied imperatively and only when it
 *     differs from the canvas's current size. Per the HTML specification, setting a canvas's
 *     width or height attribute clears the bitmap even when the value is unchanged. As a JSX
 *     attribute React would re-apply the size whenever the prop changes — and the parent learns
 *     the size it drew only after drawing, so the re-applied attribute wiped the freshly drawn
 *     page whenever a rotation swapped the axes (90° → 180° showed an empty page).
 *   - Project-wide reminder: when type-sniffing elsewhere we import from the
 *     **root** 'file-type' package, NOT 'file-type/browser' (v21 does not export
 *     that subpath for bundlers and builds will fail if changed).
 */

import React, { useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { applyCanvasBitmapSize } from '../utils/canvasBitmapSize.js';

/**
 * CanvasRenderer component.
 *
 * @param {Object} props
 * @param {number} props.naturalWidth    The natural (unscaled) raster width.
 * @param {number} props.naturalHeight   The natural (unscaled) raster height.
 * @param {number} props.zoom            Zoom factor where 1 = 100%.
 * @param {number} props.pageNumber      1-based page number for data attributes.
 * @returns {React.ReactElement}
 */
const CanvasRenderer = React.forwardRef(function CanvasRenderer(
  { naturalWidth, naturalHeight, zoom, pageNumber },
  ref
) {
  const canvasRef = useRef(/** @type {(HTMLCanvasElement|null)} */ (null));
  useImperativeHandle(ref, () => canvasRef.current, []);

  // Defensive zoom: keep > 0; NaN/Infinity fall back to 1
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  // Layout effect so the bitmap has its size before the parent's layout effect draws into it;
  // a child's layout effects run before the parent's.
  useLayoutEffect(() => {
    applyCanvasBitmapSize(canvasRef.current, naturalWidth, naturalHeight);
  }, [naturalHeight, naturalWidth]);

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
      ref={canvasRef}
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
