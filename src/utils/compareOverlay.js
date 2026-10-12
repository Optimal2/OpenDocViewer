// File: src/utils/compareOverlay.js
/**
 * File: src/utils/compareOverlay.js
 *
 * Overlay view of the compare mode: the two compared pages stacked in one coordinate space, the
 * top page drawn semi-transparent. Each page keeps its own free transform from the viewer context
 * (utils/compareTransform.js); this module only holds the view settings that are not part of the
 * transform: the top page's opacity and which page lies on top.
 *
 * The settings are plain, serialisable data kept in the viewer context, so closing and reopening
 * the view keeps them. Design note: docs-src/compare-transform.md (section "Overlay view").
 *
 * @module compareOverlay
 */

import { normalizeCompareTransform, resolveTransformKeyAction } from './compareTransform.js';
import { pickStoredImageAdjustments } from './imageAdjustments.js';

/**
 * @typedef {Object} CompareOverlayState
 * @property {number} opacity Opacity of the top page in percent, 0–100 (0 = invisible).
 * @property {('primary'|'compare')} top The page drawn on top (`compare` = page B by default).
 * @property {boolean} calibrated True once the overlay view has been opened in this compare session,
 *   i.e. a calibration exists that the curtain view can show (utils/compareCurtain.js).
 */

/** Opacity range and steps of the overlay slider (percent). */
export const COMPARE_OVERLAY_OPACITY = Object.freeze({
  min: 0,
  max: 100,
  defaultValue: 50,
  step: 1,
  largeStep: 10,
});

/** @type {CompareOverlayState} */
export const INITIAL_COMPARE_OVERLAY_STATE = Object.freeze({
  opacity: COMPARE_OVERLAY_OPACITY.defaultValue,
  top: 'compare',
  calibrated: false,
});

/**
 * Clamp an opacity to whole percents in [0, 100]; non-numbers fall back to the default.
 *
 * @param {*} value
 * @returns {number}
 */
export function clampOverlayOpacity(value) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : COMPARE_OVERLAY_OPACITY.defaultValue;
  const { min, max } = COMPARE_OVERLAY_OPACITY;
  return Math.round(Math.max(min, Math.min(max, numeric))) + 0;
}

/**
 * The page under the top page.
 *
 * @param {('primary'|'compare')} top
 * @returns {('primary'|'compare')}
 */
export function getOverlayBottomTarget(top) {
  return top === 'primary' ? 'compare' : 'primary';
}

/**
 * True when a calibration exists in the viewer context: the overlay view has been opened since
 * compare mode started. Enables the curtain view from the compare toolbar.
 *
 * @param {(CompareOverlayState|null|undefined)} state
 * @returns {boolean}
 */
export function hasCompareCalibration(state) {
  return !!state?.calibrated;
}

/**
 * Reducer for the overlay settings. Actions:
 * - `{ type: 'setOpacity', value }` absolute opacity in percent.
 * - `{ type: 'stepOpacity', delta }` relative change in percent.
 * - `{ type: 'swap' }` exchange which page lies on top.
 * - `{ type: 'markCalibrated' }` the overlay view was opened: a calibration exists.
 * - `{ type: 'clearCalibrated' }` compare mode ended: the calibration no longer applies.
 * - `{ type: 'reset' }` back to the defaults (50 %, page B on top, not calibrated).
 *
 * @param {CompareOverlayState} state
 * @param {Object} action
 * @returns {CompareOverlayState}
 */
export function compareOverlayReducer(state, action) {
  const current = state || INITIAL_COMPARE_OVERLAY_STATE;
  if (!action || typeof action !== 'object') return current;
  switch (action.type) {
    case 'setOpacity': {
      const opacity = clampOverlayOpacity(action.value);
      return opacity === current.opacity ? current : { ...current, opacity };
    }
    case 'stepOpacity': {
      const delta = typeof action.delta === 'number' && Number.isFinite(action.delta) ? action.delta : 0;
      const opacity = clampOverlayOpacity(current.opacity + delta);
      return opacity === current.opacity ? current : { ...current, opacity };
    }
    case 'swap':
      return { ...current, top: getOverlayBottomTarget(current.top) };
    case 'markCalibrated':
      return current.calibrated ? current : { ...current, calibrated: true };
    case 'clearCalibrated':
      return current.calibrated ? { ...current, calibrated: false } : current;
    case 'reset':
      return INITIAL_COMPARE_OVERLAY_STATE;
    default:
      return current;
  }
}

/**
 * Map a key press on the opacity slider to a reducer action: Left/Down −1 %, Right/Up +1 %,
 * Shift ×10, Home 0 %, End 100 %. Returns null for any other key (and with Ctrl/Alt/Meta).
 *
 * @param {(KeyboardEvent|Object|null)} event A keydown event or `{ key, shiftKey, ... }`.
 * @returns {(Object|null)}
 */
export function resolveOverlayOpacityKeyAction(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const step = event.shiftKey ? COMPARE_OVERLAY_OPACITY.largeStep : COMPARE_OVERLAY_OPACITY.step;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return { type: 'stepOpacity', delta: -step };
    case 'ArrowRight':
    case 'ArrowUp':
      return { type: 'stepOpacity', delta: step };
    case 'Home':
      return { type: 'setOpacity', value: COMPARE_OVERLAY_OPACITY.min };
    case 'End':
      return { type: 'setOpacity', value: COMPARE_OVERLAY_OPACITY.max };
    default:
      return null;
  }
}

/**
 * Nudge mode: arrow keys move the top page only (1 px, Shift 10 px), as on the move control.
 *
 * @param {(KeyboardEvent|Object|null)} event
 * @param {('primary'|'compare')} top
 * @returns {(Object|null)} A compareTransformReducer action, or null.
 */
export function resolveOverlayNudgeKeyAction(event, top) {
  return resolveTransformKeyAction(event, top);
}

/**
 * Version of the calibration JSON. Version 1 (2026-10-11) had no `version` field and held the
 * transform only; version 2 adds the stored image adjustment to each page.
 */
export const COMPARE_CALIBRATION_VERSION = 2;

/**
 * The calibration as JSON for support cases. Nothing reads it back; the text is for a person:
 * `{ "version": 2, "A": page, "B": page }`, where A is the primary (left) page and B the compare
 * (right) page. Each page holds the transform fields where version 1 had them (scale, dx, dy,
 * rotation) followed by its image adjustment (brightness, contrast, grayscale, invert).
 *
 * @param {({ primary:Object, compare:Object }|null|undefined)} transforms
 * @param {({ primary:Object, compare:Object }|null|undefined)=} imageAdjustments Missing pages read as neutral.
 * @returns {string}
 */
export function serializeCompareCalibration(transforms, imageAdjustments) {
  const page = (target) => ({
    ...normalizeCompareTransform(transforms?.[target]),
    ...pickStoredImageAdjustments(imageAdjustments?.[target]),
  });
  return JSON.stringify({
    version: COMPARE_CALIBRATION_VERSION,
    A: page('primary'),
    B: page('compare'),
  }, null, 2);
}
