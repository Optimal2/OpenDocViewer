// @vitest-environment jsdom
// File: src/components/__tests__/useCompareOverlay.test.jsx
/**
 * Open/close state of the compare overlay view (hooks/useCompareOverlay.js) against a viewer
 * context that holds the real compare-transform and overlay reducers: the round trip keeps the
 * transforms and the overlay settings, "reset to compare" restores the calibration from when the
 * view was opened (transforms AND the per-pane image adjustment, through the real
 * usePaneImageAdjustments), and the view closes itself when compare mode ends. The curtain view
 * opens only once a calibration exists and its Close returns to the view it was opened from.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, useMemo, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerContext from '../../contexts/viewerContext.js';
import { resolveShownCompareViews, useCompareOverlay } from '../DocumentViewer/hooks/useCompareOverlay.js';
import { usePaneImageAdjustments } from '../DocumentViewer/hooks/usePaneImageAdjustments.js';
import viewerSource from '../DocumentViewer/DocumentViewer.jsx?raw';
import { INITIAL_COMPARE_TRANSFORM_STATE, compareTransformReducer } from '../../utils/compareTransform.js';
import { INITIAL_COMPARE_OVERLAY_STATE, compareOverlayReducer } from '../../utils/compareOverlay.js';

/** Latest hook results and context value, written on every render. */
const probe = { hook: null, context: null, images: null };

function Probe({ available }) {
  const context = probe.context;
  const images = usePaneImageAdjustments({ isComparing: true, dispatchCompareTransform: context.dispatchCompareTransform });
  probe.images = images;
  probe.hook = useCompareOverlay(available, {
    imageAdjustments: { primary: images.primaryImageAdjustments, compare: images.compareImageAdjustments },
    onRestoreImageAdjustments: images.restoreImageAdjustments,
  });
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
    expect(probe.hook.compareOverlaySnapshot.transforms).toEqual(compareViewState);

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
    expect(probe.context.compareOverlay).toEqual({ opacity: 30, top: 'primary', calibrated: true });
    expect(probe.hook.compareOverlaySnapshot.transforms).toEqual(calibrated);
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

  it('reset to compare restores brightness, contrast, grayscale and invert of both panes too', async () => {
    const view = await mount(true);
    const value = (v) => ({ target: { value: v } });
    // Compare view state: A brighter, B grayscale; rotate B a quarter turn so its image rotation is derived.
    await run(() => probe.images.handleBrightnessChange(value(130), 'primary'));
    await run(() => probe.images.handleGrayscaleChange(value(60), 'compare'));
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { rotation: 90 } }));
    const transformsAtOpen = probe.context.compareTransforms;
    const imageAtOpen = { primary: probe.images.primaryImageAdjustments, compare: probe.images.compareImageAdjustments };
    await run(() => probe.hook.openCompareOverlay());
    expect(probe.hook.compareOverlaySnapshot.imageAdjustments).toEqual({
      primary: { brightness: 130, contrast: 100, grayscale: 0, invert: false },
      compare: { brightness: 100, contrast: 100, grayscale: 60, invert: false },
    });

    // Calibrate: every stored image field on both panes changes, and the transforms move.
    await run(() => probe.images.handleBrightnessChange(value(40), 'primary'));
    await run(() => probe.images.handleContrastChange(value(170), 'primary'));
    await run(() => probe.images.handleGrayscaleChange(value(100), 'primary'));
    await run(() => probe.images.handleInvertChange(true, 'primary'));
    await run(() => probe.images.handleBrightnessChange(value(150), 'compare'));
    await run(() => probe.images.handleContrastChange(value(20), 'compare'));
    await run(() => probe.images.handleGrayscaleChange(value(0), 'compare'));
    await run(() => probe.images.handleInvertChange(true, 'compare'));
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { rotation: 180, dx: 9 } }));

    await run(() => probe.hook.resetCompareOverlayCalibration());
    expect(probe.context.compareTransforms).toEqual(transformsAtOpen);
    expect(probe.images.primaryImageAdjustments).toEqual(imageAtOpen.primary);
    expect(probe.images.compareImageAdjustments).toEqual(imageAtOpen.compare);
    // The quarter turn follows the restored transform; it is not stored with the image.
    expect(probe.context.compareTransforms.compare.rotation).toBe(90);
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

  it('curtain: needs a calibration; the overlay view creates it and leaving compare mode clears it', async () => {
    const view = await mount(true);
    expect(probe.hook.compareCalibrated).toBe(false);
    await run(() => expect(probe.hook.openCompareCurtain()).toBe(false));
    expect(probe.hook.compareCurtainOpen).toBe(false);

    await run(() => probe.hook.openCompareOverlay());
    expect(probe.hook.compareCalibrated).toBe(true);
    await run(() => probe.hook.closeCompareOverlay());
    expect(probe.hook.compareCalibrated).toBe(true);

    await view.rerender(false);
    expect(probe.hook.compareCalibrated).toBe(false);
    await view.rerender(true);
    await run(() => expect(probe.hook.openCompareCurtain()).toBe(false));
    await view.unmount();
  });

  it('curtain opened from the compare view: Close returns to the compare view', async () => {
    const view = await mount(true);
    await run(() => probe.hook.openCompareOverlay());
    await run(() => probe.hook.closeCompareOverlay());

    await run(() => expect(probe.hook.openCompareCurtain()).toBe(true));
    expect(probe.hook.compareCurtainOpen).toBe(true);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await run(() => probe.hook.closeCompareCurtain());
    expect(probe.hook.compareCurtainOpen).toBe(false);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await view.unmount();
  });

  it('curtain opened from the overlay view: Close returns to the overlay view with its reset point', async () => {
    const view = await mount(true);
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dx: 7 } }));
    const atOverlayOpen = probe.context.compareTransforms;
    await run(() => probe.hook.openCompareOverlay());
    await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dy: 3 } }));
    const calibrated = probe.context.compareTransforms;

    await run(() => expect(probe.hook.openCompareCurtain()).toBe(true));
    expect(probe.hook.compareCurtainOpen).toBe(true);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    expect(probe.context.compareTransforms).toEqual(calibrated);

    await run(() => probe.hook.closeCompareCurtain());
    expect(probe.hook.compareCurtainOpen).toBe(false);
    expect(probe.hook.compareOverlayOpen).toBe(true);
    expect(probe.hook.compareOverlaySnapshot.transforms).toEqual(atOverlayOpen);
    expect(probe.context.compareTransforms).toEqual(calibrated);
    await view.unmount();
  });

  describe('availability gating (compare.overlay.enabled / compare.curtain.enabled)', () => {
    afterEach(() => {
      delete window.__ODV_CONFIG__;
    });

    it('overlay disabled: the open action refuses and sets no calibration flag', async () => {
      window.__ODV_CONFIG__ = { compare: { overlay: { enabled: false } } };
      const view = await mount(true);
      await run(() => expect(probe.hook.openCompareOverlay()).toBe(false));
      expect(probe.hook.compareOverlayOpen).toBe(false);
      expect(probe.hook.compareOverlaySnapshot).toBeNull();
      expect(probe.context.compareOverlay.calibrated).toBe(false);
      await view.unmount();
    });

    it('overlay disabled: the curtain still opens on the compare view\'s own calibration', async () => {
      window.__ODV_CONFIG__ = { compare: { overlay: { enabled: false } } };
      const view = await mount(true);
      await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dx: 9, rotation: 0.3 } }));
      const transforms = probe.context.compareTransforms;
      expect(probe.hook.compareCalibrated).toBe(true);
      await run(() => expect(probe.hook.openCompareCurtain()).toBe(true));
      expect(probe.hook.compareCurtainOpen).toBe(true);
      expect(probe.context.compareTransforms).toEqual(transforms);
      await run(() => probe.hook.closeCompareCurtain());
      expect(probe.hook.compareCurtainOpen).toBe(false);
      expect(probe.hook.compareOverlayOpen).toBe(false);
      await view.unmount();
    });

    it('overlay disabled later: a stale open flag is not shown and the stored calibration is kept', async () => {
      const view = await mount(true);
      await run(() => probe.hook.openCompareOverlay());
      await run(() => probe.context.dispatchCompareTransform({ type: 'set', target: 'compare', transform: { dy: 4 } }));
      const calibrated = probe.context.compareTransforms;
      expect(probe.hook.compareOverlayOpen).toBe(true);

      window.__ODV_CONFIG__ = { compare: { overlay: { enabled: false } } };
      await view.rerender(true);
      expect(probe.hook.compareOverlayOpen).toBe(false);
      expect(probe.context.compareTransforms).toEqual(calibrated);
      expect(probe.context.compareOverlay.calibrated).toBe(true);
      await run(() => expect(probe.hook.openCompareCurtain()).toBe(true));
      expect(probe.hook.compareCurtainOpen).toBe(true);
      await view.unmount();
    });

    it('curtain disabled: the open action refuses even with a calibration; the overlay is unaffected', async () => {
      window.__ODV_CONFIG__ = { compare: { curtain: { enabled: false } } };
      const view = await mount(true);
      await run(() => expect(probe.hook.openCompareOverlay()).toBe(true));
      expect(probe.hook.compareOverlayOpen).toBe(true);
      expect(probe.hook.compareCalibrated).toBe(true);
      await run(() => expect(probe.hook.openCompareCurtain()).toBe(false));
      expect(probe.hook.compareCurtainOpen).toBe(false);
      expect(probe.hook.compareOverlayOpen).toBe(true);
      await view.unmount();
    });

    it('curtain disabled later: a stale open flag is not shown', async () => {
      const view = await mount(true);
      await run(() => probe.hook.openCompareOverlay());
      await run(() => probe.hook.openCompareCurtain());
      expect(probe.hook.compareCurtainOpen).toBe(true);

      window.__ODV_CONFIG__ = { compare: { curtain: { enabled: false } } };
      await view.rerender(true);
      expect(probe.hook.compareCurtainOpen).toBe(false);
      expect(probe.hook.compareOverlayOpen).toBe(true);
      await view.unmount();
    });
  });

  describe('resolveShownCompareViews (render gate)', () => {
    it('passes the open flags through by default', () => {
      expect(resolveShownCompareViews({ overlayOpen: true, curtainOpen: false }, {})).toEqual({ overlay: true, curtain: false });
      expect(resolveShownCompareViews({ overlayOpen: false, curtainOpen: true }, {})).toEqual({ overlay: false, curtain: true });
    });

    it('refuses each view on its own switch, even with a stale open flag', () => {
      const open = { overlayOpen: true, curtainOpen: true };
      expect(resolveShownCompareViews(open, { compare: { overlay: { enabled: false } } })).toEqual({ overlay: false, curtain: true });
      expect(resolveShownCompareViews(open, { compare: { curtain: { enabled: false } } })).toEqual({ overlay: true, curtain: false });
      expect(resolveShownCompareViews(open, { compare: { overlay: { enabled: 'no' }, curtain: { enabled: 0 } } })).toEqual({ overlay: true, curtain: true });
    });

    it('is the gate DocumentViewer renders the views through', () => {
      expect(viewerSource).toMatch(/resolveShownCompareViews\(/);
      expect(viewerSource).toMatch(/\{shownCompareViews\.overlay \? \(\s*<CompareOverlayView/);
      expect(viewerSource).toMatch(/\{shownCompareViews\.curtain \? \(\s*<CompareCurtainView/);
    });
  });

  it('curtain closes with the overlay view when compare mode ends', async () => {
    const view = await mount(true);
    await run(() => probe.hook.openCompareOverlay());
    await run(() => probe.hook.openCompareCurtain());
    await view.rerender(false);
    expect(probe.hook.compareCurtainOpen).toBe(false);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await view.rerender(true);
    expect(probe.hook.compareCurtainOpen).toBe(false);
    expect(probe.hook.compareOverlayOpen).toBe(false);
    await view.unmount();
  });
});
