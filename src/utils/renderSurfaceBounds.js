// File: src/utils/renderSurfaceBounds.js
/**
 * OpenDocViewer — conservative raster surface bounds.
 *
 * Browser canvas limits vary by engine and hardware. Keep the viewer below a stable upper bound so
 * edit-mode canvases and PDF page rasters degrade by scaling down instead of failing allocation.
 */

export const MAX_RENDER_SURFACE_DIMENSION = 32767;
export const MAX_RENDER_SURFACE_PIXELS = 268435456;

function toPositiveDimension(value) {
  const numeric = Math.ceil(Number(value) || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

/**
 * Clamp a requested raster surface into a conservative browser-safe envelope while preserving its
 * aspect ratio.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{ width:number, height:number, scale:number, clamped:boolean }}
 */
export function clampRenderSurfaceSize(width, height) {
  const safeWidth = toPositiveDimension(width);
  const safeHeight = toPositiveDimension(height);
  const area = safeWidth * safeHeight;

  let scale = 1;
  if (safeWidth > MAX_RENDER_SURFACE_DIMENSION || safeHeight > MAX_RENDER_SURFACE_DIMENSION) {
    scale = Math.min(
      scale,
      MAX_RENDER_SURFACE_DIMENSION / safeWidth,
      MAX_RENDER_SURFACE_DIMENSION / safeHeight
    );
  }
  if (area > MAX_RENDER_SURFACE_PIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_RENDER_SURFACE_PIXELS / area));
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const boundedWidth = Math.max(1, Math.floor(safeWidth * scale));
  const boundedHeight = Math.max(1, Math.floor(safeHeight * scale));
  return {
    width: boundedWidth,
    height: boundedHeight,
    scale: Math.min(1, Math.max(0, Math.min(boundedWidth / safeWidth, boundedHeight / safeHeight))),
    clamped: boundedWidth !== safeWidth || boundedHeight !== safeHeight,
  };
}
