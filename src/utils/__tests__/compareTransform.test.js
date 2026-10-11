// File: src/utils/__tests__/compareTransform.test.js
/**
 * Free per-page transform for the compare view (utils/compareTransform.js,
 * docs-src/compare-transform.md): reducer set/reset/preset interplay, locale-aware numeric parsing,
 * keyboard mapping, the quarter-turn/residual rotation split and the CSS the renderer applies.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARE_TRANSFORM_LIMITS,
  IDENTITY_COMPARE_TRANSFORM,
  INITIAL_COMPARE_TRANSFORM_STATE,
  buildCompareTransformCss,
  compareTransformReducer,
  formatTransformNumber,
  isIdentityCompareTransform,
  normalizeCompareTransform,
  normalizeTransformRotation,
  parseLocaleNumber,
  resolveTransformKeyAction,
  selectCompareTransform,
  splitTransformRotation,
} from '../compareTransform.js';

/** @param {Array<Object>} actions */
function run(actions, state = INITIAL_COMPARE_TRANSFORM_STATE) {
  return actions.reduce(compareTransformReducer, state);
}

describe('compare transform shape', () => {
  it('starts at identity for both pages and round-trips through JSON unchanged', () => {
    expect(INITIAL_COMPARE_TRANSFORM_STATE).toEqual({
      primary: { scale: 1, dx: 0, dy: 0, rotation: 0 },
      compare: { scale: 1, dx: 0, dy: 0, rotation: 0 },
    });
    const state = run([
      { type: 'set', target: 'compare', transform: { scale: 1.2345, dx: 12.5, dy: -3, rotation: 359.96 } },
    ]);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
    expect(Object.keys(roundTripped.compare).sort()).toEqual(['dx', 'dy', 'rotation', 'scale']);
    expect(normalizeCompareTransform(roundTripped.compare)).toEqual(roundTripped.compare);
  });

  it('normalizes resolution and range: 0.1 % scale, 0.1 degree rotation, clamped scale', () => {
    expect(normalizeCompareTransform({ scale: 1.23456, dx: 1.234, dy: -0.0001, rotation: 12.345 }))
      .toEqual({ scale: 1.235, dx: 1.23, dy: 0, rotation: 12.3 });
    expect(normalizeCompareTransform({ scale: 0.01 }).scale).toBe(COMPARE_TRANSFORM_LIMITS.minScale);
    expect(normalizeCompareTransform({ scale: 99 }).scale).toBe(COMPARE_TRANSFORM_LIMITS.maxScale);
    expect(normalizeCompareTransform({ dx: 1e9 }).dx).toBe(COMPARE_TRANSFORM_LIMITS.maxOffsetPx);
    expect(normalizeCompareTransform({ scale: 'x', dx: NaN, rotation: Infinity })).toEqual(IDENTITY_COMPARE_TRANSFORM);
    expect(normalizeCompareTransform(null)).toEqual(IDENTITY_COMPARE_TRANSFORM);
  });

  it('keeps rotation in [0, 360) without negative zero', () => {
    expect(normalizeTransformRotation(-0.1)).toBe(359.9);
    expect(normalizeTransformRotation(360)).toBe(0);
    expect(normalizeTransformRotation(359.96)).toBe(0);
    expect(normalizeTransformRotation(-90)).toBe(270);
    expect(Object.is(normalizeTransformRotation(-0), 0)).toBe(true);
    expect(normalizeTransformRotation(725.25)).toBe(5.3);
  });

  it('selects one page and falls back to identity for unknown targets or state', () => {
    const state = run([{ type: 'set', target: 'primary', transform: { dx: 4 } }]);
    expect(selectCompareTransform(state, 'primary').dx).toBe(4);
    expect(selectCompareTransform(state, 'compare')).toEqual(IDENTITY_COMPARE_TRANSFORM);
    expect(selectCompareTransform(null, 'primary')).toEqual(IDENTITY_COMPARE_TRANSFORM);
    expect(selectCompareTransform(state, 'unknown')).toEqual(state.primary);
  });
});

describe('compareTransformReducer', () => {
  it('set merges a partial transform into one page only', () => {
    const state = run([
      { type: 'set', target: 'compare', transform: { scale: 1.5 } },
      { type: 'set', target: 'compare', transform: { dx: 10 } },
    ]);
    expect(state.compare).toEqual({ scale: 1.5, dx: 10, dy: 0, rotation: 0 });
    expect(state.primary).toEqual(IDENTITY_COMPARE_TRANSFORM);
  });

  it('nudge adds a delta to one field and clamps', () => {
    const state = run([
      { type: 'nudge', target: 'primary', field: 'dx', delta: 1 },
      { type: 'nudge', target: 'primary', field: 'dx', delta: 10 },
      { type: 'nudge', target: 'primary', field: 'dy', delta: -1 },
      { type: 'nudge', target: 'primary', field: 'rotation', delta: -0.1 },
      { type: 'nudge', target: 'primary', field: 'scale', delta: 0.001 },
      { type: 'nudge', target: 'primary', field: 'bogus', delta: 5 },
    ]);
    expect(state.primary).toEqual({ scale: 1.001, dx: 11, dy: -1, rotation: 359.9 });
    expect(run([{ type: 'nudge', target: 'primary', field: 'scale', delta: -5 }]).primary.scale)
      .toBe(COMPARE_TRANSFORM_LIMITS.minScale);
  });

  it('the zoom-step preset adds ±0.1 and keeps a calibrated fraction', () => {
    const fine = run([{ type: 'set', target: 'compare', transform: { scale: 1.005 } }]);
    expect(run([{ type: 'zoomStep', target: 'compare', sign: 1 }], fine).compare.scale).toBe(1.105);
    expect(run([{ type: 'zoomStep', target: 'compare', sign: -1 }], fine).compare.scale).toBe(0.905);
    // +0.1 then −0.1 returns to the calibrated value instead of a snapped one.
    expect(run([
      { type: 'zoomStep', target: 'compare', sign: 1 },
      { type: 'zoomStep', target: 'compare', sign: -1 },
    ], fine).compare.scale).toBe(1.005);
    expect(run([{ type: 'zoomStep', target: 'compare', sign: -1 }]).compare.scale).toBe(0.9);
    const low = run([{ type: 'set', target: 'compare', transform: { scale: 0.15 } }]);
    expect(run([{ type: 'zoomStep', target: 'compare', sign: -1 }], low).compare.scale).toBe(COMPARE_TRANSFORM_LIMITS.minScale);
    const high = run([{ type: 'set', target: 'compare', transform: { scale: 7.95 } }]);
    expect(run([{ type: 'zoomStep', target: 'compare', sign: 1 }], high).compare.scale).toBe(COMPARE_TRANSFORM_LIMITS.maxScale);
  });

  it('restore replaces both pages with a saved, normalized state (overlay "reset to compare")', () => {
    const saved = run([
      { type: 'set', target: 'primary', transform: { scale: 1.2, dx: 4 } },
      { type: 'set', target: 'compare', transform: { rotation: 0.5 } },
    ]);
    const changed = run([
      { type: 'nudge', target: 'compare', field: 'dx', delta: 30 },
      { type: 'nudge', target: 'primary', field: 'scale', delta: 0.5 },
    ], saved);
    expect(run([{ type: 'restore', state: saved }], changed)).toEqual(saved);
    expect(run([{ type: 'restore', state: { primary: { scale: 99 }, compare: null } }], changed)).toEqual({
      primary: { scale: COMPARE_TRANSFORM_LIMITS.maxScale, dx: 0, dy: 0, rotation: 0 },
      compare: IDENTITY_COMPARE_TRANSFORM,
    });
    expect(run([{ type: 'restore' }], changed)).toBe(changed);
  });

  it('the 90 degree presets add quarter turns and keep the fine residual', () => {
    const fine = run([{ type: 'set', target: 'primary', transform: { rotation: 0.3 } }]);
    expect(run([{ type: 'rotate', target: 'primary', delta: 90 }], fine).primary.rotation).toBe(90.3);
    expect(run([{ type: 'rotate', target: 'primary', delta: -90 }], fine).primary.rotation).toBe(270.3);
    expect(run([{ type: 'rotate', target: 'primary', delta: -90 }]).primary.rotation).toBe(270);
  });

  it('reset restores identity for one page; resetScale only touches scale; resetAll clears both', () => {
    const state = run([
      { type: 'set', target: 'primary', transform: { scale: 2, dx: 5, dy: 6, rotation: 91.5 } },
      { type: 'set', target: 'compare', transform: { scale: 0.5, dx: -5 } },
    ]);
    expect(run([{ type: 'reset', target: 'primary' }], state)).toEqual({
      primary: IDENTITY_COMPARE_TRANSFORM,
      compare: state.compare,
    });
    expect(run([{ type: 'resetScale' }], state)).toEqual({
      primary: { ...state.primary, scale: 1 },
      compare: { ...state.compare, scale: 1 },
    });
    expect(run([{ type: 'resetAll' }], state)).toEqual(INITIAL_COMPARE_TRANSFORM_STATE);
  });

  it('resetAlignment keeps only the nearest quarter turn (used when compare mode toggles)', () => {
    const state = run([
      { type: 'set', target: 'primary', transform: { scale: 2, dx: 5, dy: 6, rotation: 91.5 } },
      { type: 'set', target: 'compare', transform: { rotation: 314.9 } },
    ]);
    expect(run([{ type: 'resetAlignment' }], state)).toEqual({
      primary: { scale: 1, dx: 0, dy: 0, rotation: 90 },
      compare: { scale: 1, dx: 0, dy: 0, rotation: 270 },
    });
  });

  it('returns the same state object for no-op or unknown actions', () => {
    const state = INITIAL_COMPARE_TRANSFORM_STATE;
    expect(compareTransformReducer(state, { type: 'unknown' })).toBe(state);
    expect(compareTransformReducer(state, { type: 'set', target: 'primary', transform: {} })).toBe(state);
    expect(compareTransformReducer(state, null)).toBe(state);
  });

  it('accepts an updater function for set', () => {
    const state = run([
      { type: 'set', target: 'compare', transform: (current) => ({ dx: current.dx + 3 }) },
      { type: 'set', target: 'compare', transform: (current) => ({ dx: current.dx + 3 }) },
    ]);
    expect(state.compare.dx).toBe(6);
  });
});

describe('rotation split and CSS', () => {
  it('splits a free angle into the canvas quarter turn and a CSS residual in [-45, 45)', () => {
    expect(splitTransformRotation(0)).toEqual({ quarterTurn: 0, residual: 0 });
    expect(splitTransformRotation(0.1)).toEqual({ quarterTurn: 0, residual: 0.1 });
    expect(splitTransformRotation(359.9)).toEqual({ quarterTurn: 0, residual: -0.1 });
    expect(splitTransformRotation(90)).toEqual({ quarterTurn: 90, residual: 0 });
    expect(splitTransformRotation(134.9)).toEqual({ quarterTurn: 90, residual: 44.9 });
    expect(splitTransformRotation(135)).toEqual({ quarterTurn: 180, residual: -45 });
    expect(splitTransformRotation(270.5)).toEqual({ quarterTurn: 270, residual: 0.5 });
  });

  it('builds scale → translate → rotate with dx/dy in CSS px at scale 1', () => {
    expect(buildCompareTransformCss(IDENTITY_COMPARE_TRANSFORM)).toBe('');
    expect(buildCompareTransformCss({ scale: 1.5, dx: 10, dy: -2.5, rotation: 90.3 }))
      .toBe('scale(1.5) translate(10px, -2.5px) rotate(0.3deg)');
    // A pure quarter turn is drawn by the canvas, so the CSS stays empty.
    expect(buildCompareTransformCss({ scale: 1, dx: 0, dy: 0, rotation: 180 })).toBe('');
    expect(isIdentityCompareTransform({ scale: 1, dx: 0, dy: 0, rotation: 0 })).toBe(true);
    expect(isIdentityCompareTransform({ scale: 1, dx: 0, dy: 0, rotation: 90 })).toBe(false);
  });
});

describe('parseLocaleNumber', () => {
  it.each([
    ['12,5', 12.5],
    ['12.5', 12.5],
    [' -3,25 ', -3.25],
    ['−3,5', -3.5],
    ['+7', 7],
    ['0,1', 0.1],
    [',5', 0.5],
    ['1 234,5', 1234.5],
    ['1 234,5', 1234.5],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['125,0 %', 125],
    ['12,3°', 12.3],
    ['4 px', 4],
  ])('parses %j as %d', (text, expected) => {
    expect(parseLocaleNumber(text)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1,2,3x', '--1', '1-2', '.', ',', null, undefined])('rejects %j', (text) => {
    expect(Number.isNaN(parseLocaleNumber(text))).toBe(true);
  });

  it('passes finite numbers through', () => {
    expect(parseLocaleNumber(2.5)).toBe(2.5);
    expect(Number.isNaN(parseLocaleNumber(Infinity))).toBe(true);
  });
});

describe('formatTransformNumber', () => {
  it('uses the UI language decimal separator and a fixed number of decimals', () => {
    expect(formatTransformNumber(12.5, 1, 'sv')).toBe('12,5');
    expect(formatTransformNumber(12.5, 1, 'en')).toBe('12.5');
    expect(formatTransformNumber(-3, 2, 'sv')).toBe('−3,00');
    expect(formatTransformNumber(1234.5, 1, 'sv')).toBe('1234,5');
    expect(formatTransformNumber(-0, 1, 'en')).toBe('0.0');
  });

  it('round-trips through parseLocaleNumber in both languages', () => {
    for (const lang of ['sv', 'en']) {
      for (const value of [0, 0.1, -12.3, 359.9, 1234.5]) {
        expect(parseLocaleNumber(formatTransformNumber(value, 1, lang))).toBe(value);
      }
    }
  });
});

describe('resolveTransformKeyAction', () => {
  const key = (k, extra = {}) => ({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });

  it('maps arrow keys to 1 px pans and Shift+arrow to 10 px', () => {
    expect(resolveTransformKeyAction(key('ArrowLeft'), 'compare')).toEqual({ type: 'nudge', target: 'compare', field: 'dx', delta: -1 });
    expect(resolveTransformKeyAction(key('ArrowRight'), 'compare')).toEqual({ type: 'nudge', target: 'compare', field: 'dx', delta: 1 });
    expect(resolveTransformKeyAction(key('ArrowUp'), 'primary')).toEqual({ type: 'nudge', target: 'primary', field: 'dy', delta: -1 });
    expect(resolveTransformKeyAction(key('ArrowDown', { shiftKey: true }), 'primary')).toEqual({ type: 'nudge', target: 'primary', field: 'dy', delta: 10 });
  });

  it('ignores other keys and Ctrl/Alt/Meta combinations', () => {
    expect(resolveTransformKeyAction(key('a'), 'primary')).toBeNull();
    expect(resolveTransformKeyAction(key('ArrowLeft', { ctrlKey: true }), 'primary')).toBeNull();
    expect(resolveTransformKeyAction(key('ArrowLeft', { altKey: true }), 'primary')).toBeNull();
    expect(resolveTransformKeyAction(key('ArrowLeft', { metaKey: true }), 'primary')).toBeNull();
    expect(resolveTransformKeyAction(null, 'primary')).toBeNull();
  });
});
