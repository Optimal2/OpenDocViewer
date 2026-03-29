// File: src/utils/zoomUtils.js
/**
 * OpenDocViewer — Zoom utilities.
 *
 * These helpers work against the *exact* viewport for a single rendered pane instead of trying to
 * infer available space from global layout constants. That keeps zoom math stable when surrounding
 * chrome changes (thumbnail pane width, compare borders, scrollbar gutters, etc.).
 */

import logger from '../logging/systemLogger.js';

/** Minimum allowed zoom factor (5%). Kept intentionally permissive for very large pages. */
const MIN_ZOOM = 0.05;
/** Maximum allowed zoom factor (800%). */
const MAX_ZOOM = 8;
/** Zoom step multiplier: 1.1x for zoom in, divide by 1.1 for zoom out. */
const ZOOM_STEP = 1.1;

/**
 * Optional calculation overrides.
 * @typedef {Object} ZoomCalcOptions
 * @property {number=} viewportInsetPx Conservative safety inset subtracted from the measured
 *     viewport on each axis. Leave at 0 to use the full client box.
 */

/**
 * Clamp a numeric value into the inclusive range [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolve an exact viewport element from either a DOM node or a React-like ref.
 *
 * @param {(HTMLElement|{ current: HTMLElement|null }|null|undefined)} viewportOrRef
 * @returns {(HTMLElement|null)}
 */
function getViewport(viewportOrRef) {
  if (!viewportOrRef) return null;
  if (viewportOrRef instanceof HTMLElement) return viewportOrRef;
  const current = /** @type {*} */ (viewportOrRef).current;
  return current instanceof HTMLElement ? current : null;
}

/**
 * Read the intrinsic size of the active render surface.
 * Supports both images and canvases because canvas edit mode renders into a rotated/filtered
 * canvas while normal mode uses an image element directly.
 *
 * @param {(HTMLImageElement|HTMLCanvasElement|null|undefined)} surface
 * @returns {{ w: number, h: number } | null}
 */
function getRenderableSize(surface) {
  if (!surface) return null;

  let width = 0;
  let height = 0;

  if (surface instanceof HTMLImageElement) {
    width = Number(surface.naturalWidth || surface.width || 0);
    height = Number(surface.naturalHeight || surface.height || 0);
  } else if (surface instanceof HTMLCanvasElement) {
    width = Number(surface.width || 0);
    height = Number(surface.height || 0);
  } else {
    width = Number(surface?.width || 0);
    height = Number(surface?.height || 0);
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { w: width, h: height };
}

/**
 * Read the exact client viewport available to the rendered pane.
 *
 * @param {HTMLElement} viewport
 * @param {ZoomCalcOptions=} opts
 * @returns {{ vw: number, vh: number }}
 */
function getViewportSize(viewport, opts) {
  const inset = Math.max(0, Number(opts?.viewportInsetPx ?? 0));
  return {
    vw: Math.max(0, Number(viewport.clientWidth || 0) - inset),
    vh: Math.max(0, Number(viewport.clientHeight || 0) - inset),
  };
}

/**
 * Set a new zoom value using the provided setter, clamped to [MIN_ZOOM, MAX_ZOOM].
 * @param {SetNumberState} setZoom
 * @param {number} next
 * @returns {void}
 */
function applyZoom(setZoom, next) {
  const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM);
  setZoom(clamped);
}

/**
 * Calculate and set a zoom that fits the render surface within both viewport axes.
 *
 * @param {(HTMLImageElement|HTMLCanvasElement|null|undefined)} surface Active image/canvas.
 * @param {(HTMLElement|{ current: HTMLElement|null }|null|undefined)} viewportOrRef Exact pane viewport.
 * @param {SetNumberState} setZoom React-like state setter for zoom.
 * @param {ZoomCalcOptions=} opts Optional conservative inset.
 * @returns {void}
 */
export function calculateFitToScreenZoom(surface, viewportOrRef, setZoom, opts) {
  logger.info('Calculating fit-to-screen zoom');

  const viewport = getViewport(viewportOrRef);
  const size = getRenderableSize(surface);

  if (!viewport || !size) {
    logger.warn('Render surface or viewport unavailable for fit-to-screen', {
      surfaceExists: !!surface,
      viewportExists: !!viewport,
      width: surface ? Number(surface.width || 0) || null : null,
      height: surface ? Number(surface.height || 0) || null : null,
      naturalWidth: surface instanceof HTMLImageElement ? Number(surface.naturalWidth || 0) || null : null,
      naturalHeight: surface instanceof HTMLImageElement ? Number(surface.naturalHeight || 0) || null : null,
    });
    return;
  }

  const { vw, vh } = getViewportSize(viewport, opts);
  if (vw <= 0 || vh <= 0) {
    logger.warn('Non-positive viewport for fit-to-screen', { vw, vh });
    return;
  }

  let zoom = Math.min(vw / size.w, vh / size.h);
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

  applyZoom(setZoom, zoom);
}

/**
 * Calculate and set a zoom that fits the render surface width within the pane viewport.
 * Height may overflow vertically and remain scrollable.
 *
 * @param {(HTMLImageElement|HTMLCanvasElement|null|undefined)} surface Active image/canvas.
 * @param {(HTMLElement|{ current: HTMLElement|null }|null|undefined)} viewportOrRef Exact pane viewport.
 * @param {SetNumberState} setZoom React-like state setter for zoom.
 * @param {ZoomCalcOptions=} opts Optional conservative inset.
 * @returns {void}
 */
export function calculateFitToWidthZoom(surface, viewportOrRef, setZoom, opts) {
  logger.info('Calculating fit-to-width zoom');

  const viewport = getViewport(viewportOrRef);
  const size = getRenderableSize(surface);

  if (!viewport || !size) {
    logger.warn('Render surface or viewport unavailable for fit-to-width', {
      surfaceExists: !!surface,
      viewportExists: !!viewport,
      width: surface ? Number(surface.width || 0) || null : null,
      height: surface ? Number(surface.height || 0) || null : null,
      naturalWidth: surface instanceof HTMLImageElement ? Number(surface.naturalWidth || 0) || null : null,
      naturalHeight: surface instanceof HTMLImageElement ? Number(surface.naturalHeight || 0) || null : null,
    });
    return;
  }

  const { vw } = getViewportSize(viewport, opts);
  if (vw <= 0) {
    logger.warn('Non-positive viewport width for fit-to-width', { vw });
    return;
  }

  let zoom = vw / size.w;
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

  applyZoom(setZoom, zoom);
}

/**
 * Increase the zoom level by 10% (multiplicative), clamped to the safe range.
 *
 * @param {SetNumberState} setZoom React-like state setter for zoom.
 * @returns {void}
 */
export function handleZoomIn(setZoom) {
  logger.info('Zooming in');
  setZoom((prevZoom) => {
    const current = Number(prevZoom) || 1;
    const next = clamp(current * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}

/**
 * Decrease the zoom level by ~9.09% (inverse of +10%), clamped to the safe range.
 *
 * @param {SetNumberState} setZoom React-like state setter for zoom.
 * @returns {void}
 */
export function handleZoomOut(setZoom) {
  logger.info('Zooming out');
  setZoom((prevZoom) => {
    const current = Number(prevZoom) || 1;
    const next = clamp(current / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}
