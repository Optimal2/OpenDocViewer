// File: src/utils/__tests__/compareOverlay.test.js
/**
 * Overlay view settings (utils/compareOverlay.js): opacity bounds and keyboard steps, swapping the
 * top page, nudge keys for the top page only, and the calibration JSON for support cases.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARE_CALIBRATION_VERSION,
  COMPARE_OVERLAY_OPACITY,
  INITIAL_COMPARE_OVERLAY_STATE,
  hasCompareCalibration,
  clampOverlayOpacity,
  compareOverlayReducer,
  getOverlayBottomTarget,
  resolveOverlayNudgeKeyAction,
  resolveOverlayOpacityKeyAction,
  serializeCompareCalibration,
} from '../compareOverlay.js';

/** @param {Array<Object>} actions */
function run(actions, state = INITIAL_COMPARE_OVERLAY_STATE) {
  return actions.reduce(compareOverlayReducer, state);
}

describe('overlay opacity', () => {
  it('defaults to 50 % with page B (compare) on top', () => {
    expect(INITIAL_COMPARE_OVERLAY_STATE).toEqual({ opacity: 50, top: 'compare', calibrated: false });
    expect(COMPARE_OVERLAY_OPACITY).toMatchObject({ min: 0, max: 100, step: 1, largeStep: 10 });
  });

  it('clamps to whole percents in 0–100', () => {
    expect(clampOverlayOpacity(-5)).toBe(0);
    expect(clampOverlayOpacity(0)).toBe(0);
    expect(clampOverlayOpacity(100)).toBe(100);
    expect(clampOverlayOpacity(140)).toBe(100);
    expect(clampOverlayOpacity(33.6)).toBe(34);
    expect(clampOverlayOpacity('x')).toBe(50);
    expect(clampOverlayOpacity(Number.NaN)).toBe(50);
    expect(run([{ type: 'setOpacity', value: 250 }]).opacity).toBe(100);
    expect(run([{ type: 'setOpacity', value: -1 }]).opacity).toBe(0);
  });

  it('steps stop at the bounds and an unchanged value keeps the state object', () => {
    const top = run([{ type: 'setOpacity', value: 95 }]);
    expect(run([{ type: 'stepOpacity', delta: 10 }], top).opacity).toBe(100);
    const full = run([{ type: 'setOpacity', value: 100 }]);
    expect(run([{ type: 'stepOpacity', delta: 1 }], full)).toBe(full);
    const empty = run([{ type: 'setOpacity', value: 0 }]);
    expect(run([{ type: 'stepOpacity', delta: -10 }], empty)).toBe(empty);
  });

  it('keyboard: Left/Right 1 %, Shift 10 %, Home/End to the bounds; other keys ignored', () => {
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowRight' })).toEqual({ type: 'stepOpacity', delta: 1 });
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowLeft' })).toEqual({ type: 'stepOpacity', delta: -1 });
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'stepOpacity', delta: 10 });
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowLeft', shiftKey: true })).toEqual({ type: 'stepOpacity', delta: -10 });
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowUp' })).toEqual({ type: 'stepOpacity', delta: 1 });
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowDown' })).toEqual({ type: 'stepOpacity', delta: -1 });
    expect(resolveOverlayOpacityKeyAction({ key: 'Home' })).toEqual({ type: 'setOpacity', value: 0 });
    expect(resolveOverlayOpacityKeyAction({ key: 'End' })).toEqual({ type: 'setOpacity', value: 100 });
    expect(resolveOverlayOpacityKeyAction({ key: 'a' })).toBe(null);
    expect(resolveOverlayOpacityKeyAction({ key: 'ArrowRight', ctrlKey: true })).toBe(null);
    expect(resolveOverlayOpacityKeyAction(null)).toBe(null);
    const state = run([
      resolveOverlayOpacityKeyAction({ key: 'ArrowRight' }),
      resolveOverlayOpacityKeyAction({ key: 'ArrowRight', shiftKey: true }),
    ]);
    expect(state.opacity).toBe(61);
  });
});

describe('overlay swap and nudge', () => {
  it('swap exchanges the top page and twice returns to the start', () => {
    const swapped = run([{ type: 'swap' }]);
    expect(swapped.top).toBe('primary');
    expect(getOverlayBottomTarget(swapped.top)).toBe('compare');
    expect(run([{ type: 'swap' }, { type: 'swap' }]).top).toBe('compare');
    expect(run([{ type: 'swap' }, { type: 'setOpacity', value: 20 }, { type: 'reset' }])).toEqual(INITIAL_COMPARE_OVERLAY_STATE);
  });

  it('nudge keys move only the page on top (1 px, Shift 10 px)', () => {
    expect(resolveOverlayNudgeKeyAction({ key: 'ArrowLeft' }, 'compare'))
      .toEqual({ type: 'nudge', target: 'compare', field: 'dx', delta: -1 });
    expect(resolveOverlayNudgeKeyAction({ key: 'ArrowDown', shiftKey: true }, 'primary'))
      .toEqual({ type: 'nudge', target: 'primary', field: 'dy', delta: 10 });
    expect(resolveOverlayNudgeKeyAction({ key: 'Enter' }, 'compare')).toBe(null);
  });
});

describe('calibration presence', () => {
  it('is set when the overlay view calibrates and cleared when compare mode ends', () => {
    expect(hasCompareCalibration(INITIAL_COMPARE_OVERLAY_STATE)).toBe(false);
    const marked = run([{ type: 'setOpacity', value: 30 }, { type: 'markCalibrated' }]);
    expect(marked).toEqual({ opacity: 30, top: 'compare', calibrated: true });
    expect(hasCompareCalibration(marked)).toBe(true);
    expect(compareOverlayReducer(marked, { type: 'markCalibrated' })).toBe(marked);
    const cleared = compareOverlayReducer(marked, { type: 'clearCalibrated' });
    expect(cleared).toEqual({ opacity: 30, top: 'compare', calibrated: false });
    expect(compareOverlayReducer(cleared, { type: 'clearCalibrated' })).toBe(cleared);
    expect(hasCompareCalibration(null)).toBe(false);
  });
});

describe('calibration JSON', () => {
  const NEUTRAL_PAGE = { scale: 1, dx: 0, dy: 0, rotation: 0, brightness: 100, contrast: 100, grayscale: 0, invert: false };

  it('writes { version: 2, A, B } with the normalized transform and image adjustment per page', () => {
    const json = serializeCompareCalibration(
      {
        primary: { scale: 1.2345, dx: 3, dy: -2, rotation: -0.1 },
        compare: { scale: 1, dx: 0, dy: 0, rotation: 0 },
      },
      {
        primary: { rotation: 90, brightness: 120, contrast: 80, grayscale: 100, invert: true },
        compare: { brightness: 100, contrast: 100, grayscale: 250, invert: 'false' },
      }
    );
    expect(JSON.parse(json)).toEqual({
      version: 2,
      A: { scale: 1.235, dx: 3, dy: -2, rotation: 359.9, brightness: 120, contrast: 80, grayscale: 100, invert: true },
      B: { ...NEUTRAL_PAGE, grayscale: 100 },
    });
    // The version comes first, so a support reader sees at once which shape the text has.
    expect(Object.keys(JSON.parse(json))).toEqual(['version', 'A', 'B']);
    expect(JSON.parse(serializeCompareCalibration(null))).toEqual({ version: 2, A: NEUTRAL_PAGE, B: NEUTRAL_PAGE });
  });

  it('keeps the transform fields of the old { A, B } text where they were (version 1 had no version field)', () => {
    const page = JSON.parse(serializeCompareCalibration({ primary: { scale: 2, dx: 5, dy: 6, rotation: 1 } })).A;
    expect(page).toMatchObject({ scale: 2, dx: 5, dy: 6, rotation: 1 });
    // The quarter turn in the image properties is derived from the transform, never written twice.
    expect(JSON.parse(serializeCompareCalibration(null, { primary: { rotation: 180 } })).A.rotation).toBe(0);
    expect(COMPARE_CALIBRATION_VERSION).toBe(2);
  });
});
