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
/** Zoom-in multiplier: each click increases zoom by 10% of the current zoom level (1.1x). */
const ZOOM_IN_MULTIPLIER = 1.1;
/** Zoom-out multiplier: inverse of +10%, approximately a 9.09% decrease. */
const ZOOM_OUT_MULTIPLIER = 1 / ZOOM_IN_MULTIPLIER;
/** Treat zoom deltas smaller than this as unchanged to avoid redundant React updates. */
const ZOOM_CHANGE_THRESHOLD = 0.0005;

/**
 * Optional calculation overrides.
 * @typedef {Object} ZoomCalcOptions
 * @property {number=} viewportInsetPx Conservative safety inset subtracted from the measured
 *     viewport on each axis. Leave at 0 to use the full client box.
 * @property {number=} widthFactor Optional multiplier for fit-width calculations. Use 0.7 to
 *     apply 70% of the normal fit-width zoom.
 * @property {number=} heightFactor Optional multiplier for fit-height calculations. Use 0.7 to
 *     apply 70% of the normal fit-height zoom.
 * @property {number=} actualSizeFactor Optional multiplier for 1:1 zoom. Use 0.8 to cap the
 *     result at 80% actual size.
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
 * @param {number} value
 * @returns {boolean}
 */
function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
function hasValidDimensions(width, height) {
  return isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height);
}

/**
 * @param {*} value
 * @param {(number|null)=} defaultValue
 * @returns {(number|null)}
 */
function normalizeOptionalFactor(value, defaultValue = null) {
  const numeric = Number(value);
  return isPositiveFiniteNumber(numeric) ? numeric : defaultValue;
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

  if (!hasValidDimensions(width, height)) {
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
 * @param {function((number|function(number): number)): void} setZoom React-like numeric state setter.
 * @param {number} next
 * @returns {void}
 */
function applyZoom(setZoom, next) {
  const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM);
  setZoom((current) => {
    const numericCurrent = Number(current);
    if (Number.isFinite(numericCurrent) && Math.abs(numericCurrent - clamped) < ZOOM_CHANGE_THRESHOLD) {
      return numericCurrent;
    }
    return clamped;
  });
}

/**
 * Calculate and set a zoom that fits the render surface within both viewport axes.
 *
 * @param {(HTMLImageElement|HTMLCanvasElement|null|undefined)} surface Active image/canvas.
 * @param {(HTMLElement|{ current: HTMLElement|null }|null|undefined)} viewportOrRef Exact pane viewport.
 * @param {function((number|function(number): number)): void} setZoom React-like state setter for zoom.
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
  if (!hasValidDimensions(vw, vh)) {
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
 * @param {function((number|function(number): number)): void} setZoom React-like state setter for zoom.
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

  const { vw, vh } = getViewportSize(viewport, opts);
  if (!isPositiveFiniteNumber(vw)) {
    logger.warn('Non-positive viewport width for fit-to-width', { vw });
    return;
  }

  const factor = normalizeOptionalFactor(opts?.widthFactor, 1);
  const candidates = [(vw / size.w) * factor];

  const heightFactor = normalizeOptionalFactor(opts?.heightFactor);
  if (heightFactor != null && isPositiveFiniteNumber(vh)) candidates.push((vh / size.h) * heightFactor);

  const actualSizeFactor = normalizeOptionalFactor(opts?.actualSizeFactor);
  if (actualSizeFactor != null) candidates.push(actualSizeFactor);

  let zoom = Math.min(...candidates.filter(isPositiveFiniteNumber));
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

  applyZoom(setZoom, zoom);
}

/**
 * Increase the zoom level by 10% (multiplicative), clamped to the safe range.
 *
 * @param {function((number|function(number): number)): void} setZoom React-like state setter for zoom.
 * @returns {void}
 */
export function handleZoomIn(setZoom) {
  logger.info('Zooming in');
  setZoom((prevZoom) => {
    const current = Number(prevZoom) || 1;
    const next = clamp(current * ZOOM_IN_MULTIPLIER, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}

/**
 * Decrease the zoom level by ~9.09% (inverse of +10%), clamped to the safe range.
 *
 * @param {function((number|function(number): number)): void} setZoom React-like state setter for zoom.
 * @returns {void}
 */
export function handleZoomOut(setZoom) {
  logger.info('Zooming out');
  setZoom((prevZoom) => {
    const current = Number(prevZoom) || 1;
    const next = clamp(current * ZOOM_OUT_MULTIPLIER, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}
