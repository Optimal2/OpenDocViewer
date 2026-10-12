// File: src/utils/imageAdjustments.js
/**
 * File: src/utils/imageAdjustments.js
 *
 * Per-pane pixel adjustments (brightness, contrast, grayscale, invert) and the quarter turn the
 * canvas draws. One place decides whether a page needs the canvas at all and which filter the
 * canvas applies, so the viewer panes and the compare overlay/curtain views stay in step.
 *
 * Neutral values (rotation 0, brightness 100, contrast 100, grayscale 0, invert false) keep the
 * plain `<img>` fast path, and the neutral filter string is the one the canvas used before
 * grayscale and invert existed, so neutral pages render the same pixels as before.
 *
 * @module imageAdjustments
 */

/** The canvas filter for neutral values (brightness and contrast at 100 %, nothing else). */
export const NEUTRAL_IMAGE_FILTER = 'brightness(100%) contrast(100%)';

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Grayscale amount in percent, clamped to 0..100. Missing or non-finite values give 0 (neutral).
 *
 * @param {*} value
 * @returns {number}
 */
export function normalizeGrayscale(value) {
  return Math.max(0, Math.min(100, finiteOr(value, 0)));
}

/**
 * Invert as a real boolean. Only `true`, `1` and the string "true" invert; everything else,
 * including the string "false", is neutral.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function normalizeInvert(value) {
  if (value === true || value === 1) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/**
 * Whether any colour adjustment (brightness, contrast, grayscale, invert) is off its neutral value.
 * Rotation is not part of it: it belongs to the page layout.
 *
 * @param {(Object|null|undefined)} properties
 * @returns {boolean}
 */
export function hasImageAdjustment(properties) {
  return finiteOr(properties?.brightness, 100) !== 100
    || finiteOr(properties?.contrast, 100) !== 100
    || normalizeGrayscale(properties?.grayscale) !== 0
    || normalizeInvert(properties?.invert);
}

/**
 * Whether the page must be drawn on the canvas instead of the plain `<img>`.
 *
 * @param {(Object|null|undefined)} properties  { rotation, brightness, contrast, grayscale, invert }
 * @returns {boolean}
 */
export function needsCanvas(properties) {
  return finiteOr(properties?.rotation, 0) !== 0 || hasImageAdjustment(properties);
}

/**
 * The canvas 2d filter for the adjustments, composed as brightness, contrast, grayscale, invert.
 * Grayscale and invert are left out at their neutral values so the neutral filter stays
 * {@link NEUTRAL_IMAGE_FILTER}.
 *
 * @param {(Object|null|undefined)} properties
 * @returns {string}
 */
export function buildImageFilter(properties) {
  const brightness = finiteOr(properties?.brightness, 100);
  const contrast = finiteOr(properties?.contrast, 100);
  const grayscale = normalizeGrayscale(properties?.grayscale);
  const parts = [`brightness(${brightness}%)`, `contrast(${contrast}%)`];
  if (grayscale !== 0) parts.push(`grayscale(${grayscale}%)`);
  if (normalizeInvert(properties?.invert)) parts.push('invert(100%)');
  return parts.join(' ');
}
