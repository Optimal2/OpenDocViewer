// @vitest-environment jsdom
// File: src/components/__tests__/usePaneImageAdjustments.test.jsx
/**
 * Per-pane image adjustments behind useDocumentViewer (hooks/usePaneImageAdjustments.js): the
 * grayscale/invert handlers touch only the targeted pane, and the three resets land on the states
 * the compare panel labels promise. The transform state runs through the real
 * compareTransformReducer so the asserted end states are the ones the viewer shows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  usePaneImageAdjustments,
} from '../DocumentViewer/hooks/usePaneImageAdjustments.js';
import {
  INITIAL_COMPARE_TRANSFORM_STATE,
  compareTransformReducer,
} from '../../utils/compareTransform.js';

const NEUTRAL = { rotation: 0, brightness: 100, contrast: 100, grayscale: 0, invert: false };

/**
 * Mount the hook next to a real transform reducer.
 * @param {boolean} isComparing
 */
async function mount(isComparing) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const latest = { current: /** @type {any} */ (null) };
  const props = { isComparing };

  function Harness({ comparing }) {
    const [transforms, dispatch] = useReducer(compareTransformReducer, INITIAL_COMPARE_TRANSFORM_STATE);
    const api = usePaneImageAdjustments({ isComparing: comparing, dispatchCompareTransform: dispatch });
    latest.current = { ...api, transforms, dispatch };
    return null;
  }

  const render = () => act(() => root.render(createElement(Harness, { comparing: props.isComparing })));
  await render();
  return {
    get api() { return latest.current; },
    run: (fn) => act(() => { fn(latest.current); }),
    setComparing: async (value) => { props.isComparing = value; await render(); },
    cleanup: async () => { await act(() => root.unmount()); container.remove(); },
  };
}

/** Put both panes into a fully adjusted state: transform off identity and every image value set. */
async function adjustBoth(view) {
  for (const target of ['primary', 'compare']) {
    await view.run((api) => api.dispatch({ type: 'set', target, transform: { scale: 1.5, dx: 12, dy: -4, rotation: 4.6 } }));
    await view.run((api) => api.dispatch({ type: 'rotate', target, delta: 90 }));
    await view.run((api) => api.handleBrightnessChange({ target: { value: 140 } }, target));
    await view.run((api) => api.handleContrastChange({ target: { value: 60 } }, target));
    await view.run((api) => api.handleGrayscaleChange({ target: { value: 70 } }, target));
    await view.run((api) => api.handleInvertChange({ target: { type: 'checkbox', checked: true } }, target));
  }
}

const ADJUSTED_TRANSFORM = { scale: 1.5, dx: 12, dy: -4, rotation: 94.6 };
const ADJUSTED_IMAGE = { rotation: 0, brightness: 140, contrast: 60, grayscale: 70, invert: true };

describe('usePaneImageAdjustments', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('starts neutral on both panes', async () => {
    const view = await mount(true);
    expect(DEFAULT_IMAGE_ADJUSTMENTS).toEqual(NEUTRAL);
    expect(view.api.primaryImageAdjustments).toEqual(NEUTRAL);
    expect(view.api.compareImageAdjustments).toEqual(NEUTRAL);
    await view.cleanup();
  });

  it('handleGrayscaleChange and handleInvertChange change only the targeted pane', async () => {
    const view = await mount(true);
    await view.run((api) => api.handleGrayscaleChange({ target: { value: 250 } }, 'compare'));
    expect(view.api.compareImageAdjustments.grayscale).toBe(100);
    expect(view.api.primaryImageAdjustments).toEqual(NEUTRAL);

    await view.run((api) => api.handleInvertChange({ target: { type: 'checkbox', checked: true } }, 'primary'));
    expect(view.api.primaryImageAdjustments.invert).toBe(true);
    expect(view.api.compareImageAdjustments.invert).toBe(false);

    await view.run((api) => api.handleInvertChange({ target: { value: 'false' } }, 'primary'));
    expect(view.api.primaryImageAdjustments.invert).toBe(false);
    expect(view.api.compareImageAdjustments.grayscale).toBe(100);
    await view.cleanup();
  });

  it('resetImageProperties restores grayscale 0 and invert false on the targeted pane only', async () => {
    const view = await mount(false);
    await view.run((api) => api.handleGrayscaleChange({ target: { value: 30 } }, 'primary'));
    await view.run((api) => api.handleInvertChange(true, 'primary'));
    await view.run((api) => api.handleGrayscaleChange({ target: { value: 45 } }, 'compare'));
    await view.run((api) => api.resetImageProperties('primary'));
    expect(view.api.primaryImageAdjustments).toMatchObject({ grayscale: 0, invert: false });
    expect(view.api.primaryImageAdjustments).toEqual(NEUTRAL);
    expect(view.api.compareImageAdjustments.grayscale).toBe(45);
    await view.cleanup();
  });

  it('compare mode: the toolbar reset (resetImageProperties) and the panel full reset (resetPane) land on the same end state', async () => {
    const view = await mount(true);
    await adjustBoth(view);
    expect(view.api.transforms.compare).toEqual(ADJUSTED_TRANSFORM);
    expect(view.api.compareImageAdjustments).toEqual(ADJUSTED_IMAGE);

    await view.run((api) => api.resetImageProperties('compare'));
    const toolbarEnd = { transform: view.api.transforms.compare, image: view.api.compareImageAdjustments };
    await view.run((api) => api.resetPane('primary'));
    const panelEnd = { transform: view.api.transforms.primary, image: view.api.primaryImageAdjustments };

    expect(toolbarEnd).toEqual({ transform: { scale: 1, dx: 0, dy: 0, rotation: 0 }, image: NEUTRAL });
    expect(panelEnd).toEqual(toolbarEnd);
    await view.cleanup();
  });

  it('outside compare mode the toolbar reset is unchanged: rotation 0, but zoom and position stay', async () => {
    const view = await mount(false);
    await adjustBoth(view);
    await view.run((api) => api.resetImageProperties('primary'));
    expect(view.api.transforms.primary).toEqual({ scale: 1.5, dx: 12, dy: -4, rotation: 0 });
    expect(view.api.primaryImageAdjustments).toEqual(NEUTRAL);
    await view.cleanup();
  });

  it('the parity follows the current mode, not the mode at mount', async () => {
    const view = await mount(false);
    await view.setComparing(true);
    await adjustBoth(view);
    await view.run((api) => api.resetImageProperties('compare'));
    expect(view.api.transforms.compare).toEqual({ scale: 1, dx: 0, dy: 0, rotation: 0 });
    await view.cleanup();
  });

  it('the partial image reset keeps the transform; the layout part is the reducer reset', async () => {
    const view = await mount(true);
    await adjustBoth(view);
    await view.run((api) => api.clearImageAdjustments('compare'));
    expect(view.api.compareImageAdjustments).toEqual(NEUTRAL);
    expect(view.api.transforms.compare).toEqual(ADJUSTED_TRANSFORM);
    expect(view.api.primaryImageAdjustments).toEqual(ADJUSTED_IMAGE);
    await view.cleanup();
  });

  it('compareImageHandlers bundles the panel callbacks', async () => {
    const view = await mount(true);
    const handlers = view.api.compareImageHandlers;
    expect(Object.keys(handlers).sort()).toEqual([
      'onBrightnessChange', 'onContrastChange', 'onGrayscaleChange', 'onInvertChange', 'onResetImage', 'onResetPane',
    ]);
    expect(handlers.onResetPane).toBe(view.api.resetPane);
    expect(handlers.onResetImage).toBe(view.api.clearImageAdjustments);
    await view.cleanup();
  });
});
