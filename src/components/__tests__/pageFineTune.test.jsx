// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerContext from '../../contexts/viewerContext.js';
import { useCompareTransforms } from '../DocumentViewer/hooks/useCompareTransforms.js';
import { usePaneImageAdjustments } from '../DocumentViewer/hooks/usePaneImageAdjustments.js';
import { INITIAL_COMPARE_TRANSFORM_STATE, compareTransformReducer } from '../../utils/compareTransform.js';

let probe;
let root;
function Probe({ comparing, primaryKey, compareKey, sessionKey }) {
  const transforms = useCompareTransforms(comparing, { primaryKey, compareKey, sessionKey });
  const images = usePaneImageAdjustments({ isComparing: comparing,
    dispatchCompareTransform: transforms.dispatchCompareTransform, primaryKey, compareKey, sessionKey });
  probe = { ...transforms, ...images };
  return null;
}
function Harness(props) {
  const [compareTransforms, dispatchCompareTransform] = useReducer(compareTransformReducer, INITIAL_COMPARE_TRANSFORM_STATE);
  return createElement(ViewerContext.Provider, { value: { compareTransforms, dispatchCompareTransform } }, createElement(Probe, props));
}
describe('page-bound fine tuning', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    root = createRoot(document.createElement('div'));
  });
  afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });
  it('keeps independent page calibrations and images across navigation, mode changes and resets', async () => {
    const sessionKey = {};
    const render = (primaryKey, comparing = false, compareKey = 2) => act(() => root.render(createElement(Harness, { primaryKey, comparing, compareKey, sessionKey })));
    await render(1);
    await act(() => {
      probe.dispatchCompareTransform({ type: 'set', target: 'primary', transform: { scale: 1.25, dx: 17, rotation: 3.4 } });
      probe.handleBrightnessChange({ target: { value: 123 } });
    });
    await render(1, true);
    expect(probe.primaryTransform).toEqual({ scale: 1.25, dx: 17, dy: 0, rotation: 3.4 });
    await act(() => {
      probe.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dx: 29 } });
      probe.handleInvertChange(true, 'compare');
    });
    await render(3, true);
    expect(probe.primaryTransform).toEqual(INITIAL_COMPARE_TRANSFORM_STATE.primary);
    expect(probe.primaryImageAdjustments.brightness).toBe(100);
    expect(probe.compareTransform.dx).toBe(29);
    await act(() => probe.dispatchCompareTransform({ type: 'nudge', target: 'primary', field: 'dy', delta: 4 }));
    expect(probe.primaryTransform).toEqual({ scale: 1, dx: 0, dy: 4, rotation: 0 });
    await render(1, false, null);
    expect(probe.primaryTransform.rotation).toBe(3.4);
    expect(probe.primaryImageAdjustments.brightness).toBe(123);
    await render(1, true);
    expect(probe.compareTransform.dx).toBe(29);
    expect(probe.compareImageAdjustments.invert).toBe(true);
    await act(() => probe.compareImageHandlers.onResetPane('compare'));
    expect(probe.compareTransform.dx).toBe(0);
    expect(probe.compareImageAdjustments.invert).toBe(false);
    expect(probe.primaryTransform.dx).toBe(17);
    await act(() => probe.resetPostZoom());
    expect(probe.primaryTransform.scale).toBe(1);
    expect(probe.primaryTransform.rotation).toBe(3.4);
  });
  it('a new bundle clears page calibration even when original page numbers repeat', async () => {
    await act(() => root.render(createElement(Harness, { primaryKey: 1, compareKey: 2, sessionKey: 'first' })));
    await act(() => {
      probe.dispatchCompareTransform({ type: 'set', transform: { dx: 12 } });
      probe.handleContrastChange({ target: { value: 140 } });
    });
    await act(() => root.render(createElement(Harness, { primaryKey: 1, compareKey: 2, sessionKey: 'second' })));
    expect(probe.primaryTransform.dx).toBe(0);
    expect(probe.primaryImageAdjustments.contrast).toBe(100);
    // Reusing an earlier bundle object is still a new session boundary, never a resurrection.
    await act(() => root.render(createElement(Harness, { primaryKey: 1, compareKey: 2, sessionKey: 'first' })));
    expect(probe.primaryTransform.dx).toBe(0);
    expect(probe.primaryImageAdjustments.contrast).toBe(100);
  });
});
