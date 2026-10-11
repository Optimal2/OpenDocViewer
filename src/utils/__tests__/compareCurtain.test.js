// File: src/utils/__tests__/compareCurtain.test.js
/**
 * Curtain view of the compare mode (utils/compareCurtain.js): clip geometry of the top page for
 * both modes at 0 %, 50 % and 100 %, the grab bar position, pointer-to-percent mapping, keyboard
 * steps (1 %, Shift 10 %) and the per-mode position memory of the reducer.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARE_CURTAIN_POSITION,
  INITIAL_COMPARE_CURTAIN_STATE,
  buildCurtainClipPath,
  buildCurtainHandleStyle,
  clampCurtainPosition,
  compareCurtainReducer,
  curtainPositionFromPointer,
  resolveCurtainKeyAction,
  selectCurtainPosition,
} from '../compareCurtain.js';

describe('curtain clip geometry', () => {
  it('horizontal mode clips page B to the area below the line', () => {
    expect(buildCurtainClipPath('horizontal', 0)).toBe('inset(0% 0% 0% 0%)');
    expect(buildCurtainClipPath('horizontal', 50)).toBe('inset(50% 0% 0% 0%)');
    expect(buildCurtainClipPath('horizontal', 100)).toBe('inset(100% 0% 0% 0%)');
  });

  it('vertical mode clips page B to the area right of the line', () => {
    expect(buildCurtainClipPath('vertical', 0)).toBe('inset(0% 0% 0% 0%)');
    expect(buildCurtainClipPath('vertical', 50)).toBe('inset(0% 0% 0% 50%)');
    expect(buildCurtainClipPath('vertical', 100)).toBe('inset(0% 0% 0% 100%)');
  });

  it('clamps out-of-range positions and treats an unknown mode as vertical', () => {
    expect(buildCurtainClipPath('horizontal', -20)).toBe('inset(0% 0% 0% 0%)');
    expect(buildCurtainClipPath('horizontal', 140)).toBe('inset(100% 0% 0% 0%)');
    expect(buildCurtainClipPath('diagonal', 25)).toBe('inset(0% 0% 0% 25%)');
  });

  it('places the grab bar on the line', () => {
    expect(buildCurtainHandleStyle('horizontal', 0)).toEqual({ top: '0%' });
    expect(buildCurtainHandleStyle('horizontal', 50)).toEqual({ top: '50%' });
    expect(buildCurtainHandleStyle('vertical', 100)).toEqual({ left: '100%' });
  });
});

describe('curtain position', () => {
  it('clamps to [0, 100] with two decimals; non-numbers fall back to 50', () => {
    expect(clampCurtainPosition(-1)).toBe(0);
    expect(clampCurtainPosition(101)).toBe(100);
    expect(clampCurtainPosition(33.33333)).toBe(33.33);
    expect(clampCurtainPosition('x')).toBe(COMPARE_CURTAIN_POSITION.defaultValue);
    expect(clampCurtainPosition(Number.NaN)).toBe(50);
  });

  it('maps a pointer to the percentage along the moving axis', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(curtainPositionFromPointer('vertical', rect, 100, 999)).toBe(0);
    expect(curtainPositionFromPointer('vertical', rect, 300, 0)).toBe(50);
    expect(curtainPositionFromPointer('vertical', rect, 900, 0)).toBe(100);
    expect(curtainPositionFromPointer('horizontal', rect, 0, 100)).toBe(25);
    expect(curtainPositionFromPointer('horizontal', rect, 0, 0)).toBe(0);
    expect(curtainPositionFromPointer('horizontal', { left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toBe(50);
  });
});

describe('curtain keyboard', () => {
  it('arrows step 1 %, Shift 10 %; Up/Left towards 0, Down/Right towards 100', () => {
    expect(resolveCurtainKeyAction({ key: 'ArrowRight' })).toEqual({ type: 'stepPosition', delta: 1 });
    expect(resolveCurtainKeyAction({ key: 'ArrowDown' })).toEqual({ type: 'stepPosition', delta: 1 });
    expect(resolveCurtainKeyAction({ key: 'ArrowLeft' })).toEqual({ type: 'stepPosition', delta: -1 });
    expect(resolveCurtainKeyAction({ key: 'ArrowUp', shiftKey: true })).toEqual({ type: 'stepPosition', delta: -10 });
    expect(resolveCurtainKeyAction({ key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'stepPosition', delta: 10 });
  });

  it('ignores other keys and modified arrows', () => {
    expect(resolveCurtainKeyAction({ key: 'Home' })).toBeNull();
    expect(resolveCurtainKeyAction({ key: 'a' })).toBeNull();
    expect(resolveCurtainKeyAction({ key: 'ArrowLeft', ctrlKey: true })).toBeNull();
    expect(resolveCurtainKeyAction({ key: 'ArrowLeft', altKey: true })).toBeNull();
    expect(resolveCurtainKeyAction(null)).toBeNull();
  });
});

describe('compareCurtainReducer', () => {
  it('starts in vertical mode at 50 % in both modes', () => {
    expect(INITIAL_COMPARE_CURTAIN_STATE).toEqual({ mode: 'vertical', positions: { horizontal: 50, vertical: 50 } });
    expect(selectCurtainPosition(INITIAL_COMPARE_CURTAIN_STATE)).toBe(50);
  });

  it('remembers the position per mode', () => {
    let state = compareCurtainReducer(INITIAL_COMPARE_CURTAIN_STATE, { type: 'setPosition', value: 20 });
    state = compareCurtainReducer(state, { type: 'setMode', mode: 'horizontal' });
    expect(selectCurtainPosition(state)).toBe(50);
    state = compareCurtainReducer(state, { type: 'stepPosition', delta: 10 });
    expect(selectCurtainPosition(state)).toBe(60);
    state = compareCurtainReducer(state, { type: 'setMode', mode: 'vertical' });
    expect(selectCurtainPosition(state)).toBe(20);
    expect(state.positions).toEqual({ horizontal: 60, vertical: 20 });
  });

  it('clamps steps at the bounds and keeps the state object when nothing changes', () => {
    let state = compareCurtainReducer(INITIAL_COMPARE_CURTAIN_STATE, { type: 'setPosition', value: 95 });
    state = compareCurtainReducer(state, { type: 'stepPosition', delta: 10 });
    expect(selectCurtainPosition(state)).toBe(100);
    expect(compareCurtainReducer(state, { type: 'stepPosition', delta: 1 })).toBe(state);
    expect(compareCurtainReducer(state, { type: 'setMode', mode: 'vertical' })).toBe(state);
    expect(compareCurtainReducer(state, { type: 'setMode', mode: 'diagonal' })).toBe(state);
    expect(compareCurtainReducer(state, { type: 'unknown' })).toBe(state);
    expect(compareCurtainReducer(undefined, null)).toBe(INITIAL_COMPARE_CURTAIN_STATE);
  });
});
