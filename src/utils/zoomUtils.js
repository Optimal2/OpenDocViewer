/**
 * File: src/utils/zoomUtils.js
 *
 * OpenDocViewer — Zoom Utilities
 *
 * PURPOSE
 *   Helper functions for computing and applying zoom levels in the document viewer.
 *   These are intentionally UI-agnostic: they operate on DOM sizes and setters only.
 *
 * DESIGN NOTES
 *   - Zoom values are scale factors where `1` = 100% (natural size).
 *   - We clamp zoom to a safe, user-friendly range to avoid extreme CPU/GPU costs.
 *   - When compare mode is active, we assume the viewport is split horizontally
 *     into two panes and subtract a small gutter for the resizer/spacing.
 *   - Magic numbers from the current layout (sidebar/gutter heights) are collected
 *     as constants below to make future layout changes explicit and easy to adjust.
 *
 * LOGGING
 *   - These functions log at `info` level when actions occur and `warn` when inputs
 *     are missing. In production, the default log level is `warn`, so the info logs
 *     are typically suppressed unless you increase verbosity.
 *
 * Provenance / source reference for this revision: :contentReference[oaicite:0]{index=0}
 */

import logger from '../LogController';

/** Minimum allowed zoom factor (5%). */
const MIN_ZOOM = 0.05;
/** Maximum allowed zoom factor (800%). */
const MAX_ZOOM = 8;
/** Zoom step multiplier (±10%). */
const ZOOM_STEP = 1.1;

/**
 * Layout constants tied to the current viewer UI.
 * If you adjust toolbar/sidebar sizes, update these to keep zoom calculations correct.
 */
const SIDEBAR_WIDTH_PX = 250;     // Thumbnail sidebar nominal width
const CHROME_HEIGHT_PX = 30;      // Top/bottom chrome (toolbar paddings etc.)
const COMPARE_GUTTER_PX = 30;     // Extra spacing when compare mode splits the view

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
 * Get the current viewer container element from a React ref.
 * Best-effort — returns null if the ref is not attached yet.
 * @param {React.RefObject<HTMLElement>} viewerContainerRef
 * @returns {HTMLElement|null}
 */
function getContainer(viewerContainerRef) {
  try {
    return viewerContainerRef?.current ?? null;
  } catch {
    return null;
  }
}

/**
 * Safely read natural image dimensions. Returns null if invalid/zero.
 * @param {HTMLImageElement} image
 * @returns {{w: number, h: number} | null}
 */
function getNaturalSize(image) {
  if (!image) return null;
  const w = Number(image.naturalWidth || 0);
  const h = Number(image.naturalHeight || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/**
 * Compute available viewport width/height for rendering, taking into account
 * sidebar, chrome, and compare mode split.
 *
 * @param {HTMLElement} container
 * @param {boolean} isComparing
 * @returns {{ vw: number, vh: number }}
 */
function getViewportSize(container, isComparing) {
  // Subtract persistent UI chrome
  let vw = Math.max(0, container.clientWidth - SIDEBAR_WIDTH_PX);
  const vh = Math.max(0, container.clientHeight - CHROME_HEIGHT_PX);

  // In compare mode, split horizontally and subtract a small gutter for the divider
  if (isComparing) {
    vw = Math.max(0, Math.floor(vw / 2) - COMPARE_GUTTER_PX);
  }
  return { vw, vh };
}

/**
 * Set a new zoom value using the provided setter, clamped to [MIN_ZOOM, MAX_ZOOM].
 * @param {(next: number | ((prev: number) => number)) => void} setZoom
 * @param {number} next
 */
function applyZoom(setZoom, next) {
  const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM);
  setZoom(clamped);
}

/**
 * Calculates and sets the zoom level so that the image fits within both the width
 * and height of the viewer container (i.e., “Fit to Screen”).
 *
 * @param {HTMLImageElement} image                        The image element to be zoomed.
 * @param {React.RefObject<HTMLElement>} viewerContainerRef  Reference to the viewer container element.
 * @param {(next: number | ((prev: number) => number)) => void} setZoom  React state setter for zoom.
 * @param {boolean} isComparing                            Whether compare mode (split view) is enabled.
 */
export function calculateFitToScreenZoom(image, viewerContainerRef, setZoom, isComparing) {
  logger.info('Calculating fit-to-screen zoom', { isComparing });

  const container = getContainer(viewerContainerRef);
  const size = getNaturalSize(image);

  if (!container || !size) {
    logger.warn('Image or viewer container unavailable for fit-to-screen', {
      imageExists: !!image,
      viewerContainerExists: !!container,
      naturalWidth: image?.naturalWidth ?? null,
      naturalHeight: image?.naturalHeight ?? null,
    });
    return;
  }

  const { vw, vh } = getViewportSize(container, isComparing);
  if (vw <= 0 || vh <= 0) {
    logger.warn('Non-positive viewport for fit-to-screen', { vw, vh });
    return;
  }

  const widthRatio = vw / size.w;
  const heightRatio = vh / size.h;

  let zoom = Math.min(widthRatio, heightRatio);
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

  applyZoom(setZoom, zoom);
}

/**
 * Calculates and sets the zoom level to fit the image width within the viewer container
 * (i.e., “Fit to Width”). Height is allowed to overflow/scroll.
 *
 * @param {HTMLImageElement} image                        The image element to be zoomed.
 * @param {React.RefObject<HTMLElement>} viewerContainerRef  Reference to the viewer container element.
 * @param {(next: number | ((prev: number) => number)) => void} setZoom  React state setter for zoom.
 * @param {boolean} isComparing                            Whether compare mode (split view) is enabled.
 */
export function calculateFitToWidthZoom(image, viewerContainerRef, setZoom, isComparing) {
  logger.info('Calculating fit-to-width zoom', { isComparing });

  const container = getContainer(viewerContainerRef);
  const size = getNaturalSize(image);

  if (!container || !size) {
    logger.warn('Image or viewer container unavailable for fit-to-width', {
      imageExists: !!image,
      viewerContainerExists: !!container,
      naturalWidth: image?.naturalWidth ?? null,
    });
    return;
  }

  const { vw } = getViewportSize(container, isComparing);
  if (vw <= 0) {
    logger.warn('Non-positive viewport width for fit-to-width', { vw });
    return;
  }

  let zoom = vw / size.w;
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;

  applyZoom(setZoom, zoom);
}

/**
 * Increases the zoom level by 10% (multiplicative), clamped to the safe range.
 *
 * @param {(next: number | ((prev: number) => number)) => void} setZoom  React state setter for zoom.
 */
export function handleZoomIn(setZoom) {
  logger.info('Zooming in');
  setZoom((prevZoom) => {
    const next = clamp((Number(prevZoom) || 1) * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}

/**
 * Decreases the zoom level by ~9.09% (inverse of +10%), clamped to the safe range.
 *
 * @param {(next: number | ((prev: number) => number)) => void} setZoom  React state setter for zoom.
 */
export function handleZoomOut(setZoom) {
  logger.info('Zooming out');
  setZoom((prevZoom) => {
    const next = clamp((Number(prevZoom) || 1) / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    return next;
  });
}
