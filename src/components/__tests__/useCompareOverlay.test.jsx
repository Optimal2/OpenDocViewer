// @vitest-environment jsdom
// File: src/components/__tests__/useCompareOverlay.test.jsx
/**
 * Open/close state of the compare overlay view (hooks/useCompareOverlay.js) against a viewer
 * context that holds the real compare-transform and overlay reducers: the round trip keeps the
 * transforms and the overlay settings, "reset to compare" restores the calibration from when the
 * view was opened, and the view closes itself when compare mode ends.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement, useMemo, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerContext from '../../contexts/viewerContext.js';
import { useCompareOverlay } from '../DocumentViewer/hooks/useCompareOverlay.js';
import { INITIAL_COMPARE_TRANSFORM_STATE, compareTransformReducer } from '../../utils/compareTransform.js';
import { INITIAL_COMPARE_OVERLAY_STATE, compareOverlayReducer } from '../../utils/compareOverlay.js';

/** Latest hook result and context value, written on every render. */
const probe = { hook: null, context: null };

function Probe({ available }) {
  probe.hook = useCompareOverlay(available);
  return null;
}

function Harness({ available }) {
  const [compareTransforms, dispatchCompareTransform] = useReducer(compareTransformReducer, INITIAL_COMPARE_TRANSFORM_STATE);
  const [compareOverlay, dispatchCompareOverlay] = useReducer(compareOverlayReducer, INITIAL_COMPARE_OVERLAY_STATE);
  const value = useMemo(() => ({
    compareTransforms,
    dispatchCompareTransform,
    compareOverlay,
    dispatchCompareOverlay,
  }), [compareOverlay, compareTransforms]);
  probe.context = value;
  return createElement(ViewerContext.Provider, { value }, createElement(Probe, { available }));
}

async function mount(available = true) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(() => root.render(createElement(Harness, { available })));
  return {
    rerender: (next) => act(() => root.render(createElement(Harness, { available: next }))),
    unmount: () => act(() => root.unmount()),
  };
}

const run = (fn) => act(() => { fn(); });

describe('useCompareOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('open → calibrate → close keeps transforms and overlay settings; reopen keeps them too', async () => {
    const view = await mount(true);
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { scale: 1.2, rotation: 0.4 } }));
    const compareViewState = probe.context.compareTransforms;

    expect(probe.hook.compareOverlayOpen).toBe(false);
    await run(() => expect(probe.hook.openCompareOverlay()).toBe(true));
    expect(probe.hook.compareOverlayOpen).toBe(true);
    expect(probe.hook.compareOverlaySnapshot).toEqual(compareViewState);

    // Calibrate inside the view: move B, scale A, change opacity and swap.
    await run(() => probe.context.dispatchCompareTransform({ type: 'nudge', target: 'compare', field: 'dx', delta: 12 }));
    await run(() => probe.context.dispatchCompareTransform({ type: 'nudge', target: 'primary', field: 'scale', delta: 0.05 }));
    await run(() => probe.context.dispatchCompareOverlay({ type: 'setOpacity', value: 30 }));
    await run(() => probe.context.dispatchCompareOverlay({ type: 'swap' }));
    const calibrated = probe.context.compareTransforms;

    await run(() => probe.hook.closeCompareOverlay());
    expect(probe.hook.compareOverlayOpen).toBe(false);
    expect(probe.context.compareTransforms).toEqual(calibrated);
    expect(probe.context.compareTransforms).toEqual({
      primary: { scale: 1.05, dx: 0, dy: 0, rotation: 0 },
      compare: { scale: 1.2, dx: 12, dy: 0, rotation: 0.4 },
    });

    await run(() => probe.hook.openCompareOverlay());
    expect(probe.context.compareTransforms).toEqual(calibrated);
    expect(probe.context.compareOverlay).toEqual({ opacity: 30, top: 'primary' });
    expect(probe.hook.compareOverlaySnapshot).toEqual(calibrated);
    await view.unmount();
  });

  it('reset to compare restores the transforms from when the view was opened', async () => {
    const view = await mount(true);
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'primary', transform: { dx: 5 } }));
    const atOpen = probe.context.compareTransforms;
    await run(() => probe.hook.openCompareOverlay());
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dy: -40, rotation: 1.5 } }));
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'primary', transform: { scale: 2 } }));
    expect(probe.context.compareTransforms).not.toEqual(atOpen);
    await run(() => probe.hook.resetCompareOverlayCalibration());
    expect(probe.context.compareTransforms).toEqual(atOpen);
    await view.unmount();
  });

  it('does not open without two compared pages and closes when compare mode ends', async () => {
    const view = await mount(false);
    await run(() => expect(probe.hook.openCompareOverlay()).toBe(false));
    expect(probe.hook.compareOverlayOpen).toBe(false);

    await view.rerender(true);
    await run(() => probe.hook.openCompareOverlay());
    expect(probe.hook.compareOverlayOpen).toBe(true);
    await view.rerender(false);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await view.rerender(true);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await view.unmount();
  });
});
