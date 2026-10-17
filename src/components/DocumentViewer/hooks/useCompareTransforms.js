// File: src/components/DocumentViewer/hooks/useCompareTransforms.js
/**
 * File: src/components/DocumentViewer/hooks/useCompareTransforms.js
 *
 * Viewer-side access to the free per-page compare transform kept in the viewer context
 * (utils/compareTransform.js, docs-src/compare-transform.md). The older per-pane ±0.1 "post-zoom"
 * buttons are presets that write the transform's scale, so the existing API stays available.
 *
 * @module useCompareTransforms
 */

import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import ViewerContext from '../../../contexts/viewerContext.js';
import {
  INITIAL_COMPARE_TRANSFORM_STATE,
  selectCompareTransform,
} from '../../../utils/compareTransform.js';

const NOOP_DISPATCH = () => {};

/**
 * @param {boolean} isComparing Whether compare mode is active.
 * @param {Object=} pages Optional page binding within the viewer session.
 * @param {(number|null)=} pages.primaryKey Original primary page number.
 * @param {(number|null)=} pages.compareKey Original secondary page number.
 * @param {*=} pages.sessionKey Bundle identity; replacing it clears saved page calibrations.
 * @returns {{
 *   primaryTransform: { scale:number, dx:number, dy:number, rotation:number },
 *   compareTransform: { scale:number, dx:number, dy:number, rotation:number },
 *   dispatchCompareTransform: function(Object): void,
 *   postZoomLeft: number,
 *   postZoomRight: number,
 *   bumpPostZoomLeft: function(number): void,
 *   bumpPostZoomRight: function(number): void,
 *   resetPostZoom: function(): void
 * }}
 */
export function useCompareTransforms(isComparing, { primaryKey, compareKey, sessionKey } = {}) {
  const context = useContext(ViewerContext);
  const state = context?.compareTransforms || INITIAL_COMPARE_TRANSFORM_STATE;
  const dispatch = typeof context?.dispatchCompareTransform === 'function'
    ? context.dispatchCompareTransform
    : NOOP_DISPATCH;

  // The context remains the single live transform model. Cache each pane's pages on navigation,
  // restoring before paint; a page never inherits the previous page's calibration. Separate banks
  // keep the two editing targets independent even when they display the same original page.
  const binding = useRef({ sessionKey, primaryKey, compareKey });
  const pages = useRef({ primary: new Map(), compare: new Map() });
  const sameSession = binding.current.sessionKey === sessionKey;
  const resolve = (pane, key) => sameSession && binding.current[`${pane}Key`] === key
    ? selectCompareTransform(state, pane)
    : (sameSession && pages.current[pane].get(key)) || INITIAL_COMPARE_TRANSFORM_STATE[pane];
  const primaryTransform = resolve('primary', primaryKey);
  const compareTransform = resolve('compare', compareKey);

  useLayoutEffect(() => {
    const previous = binding.current;
    if (previous.sessionKey === sessionKey && previous.primaryKey === primaryKey && previous.compareKey === compareKey) return;
    if (previous.sessionKey !== sessionKey) {
      pages.current = { primary: new Map(), compare: new Map() };
    } else {
      for (const pane of ['primary', 'compare']) {
        const key = previous[`${pane}Key`];
        if (key != null) pages.current[pane].set(key, selectCompareTransform(state, pane));
      }
    }
    binding.current = { sessionKey, primaryKey, compareKey };
    dispatch({ type: 'restore', state: { primary: primaryTransform, compare: compareTransform } });
  }, [compareKey, compareTransform, dispatch, primaryKey, primaryTransform, sessionKey, state]);

  /** @param {number} sign Use +1 to increase, -1 to decrease. */
  const bumpPostZoomLeft = useCallback((sign) => {
    dispatch({ type: 'zoomStep', target: 'primary', sign });
  }, [dispatch]);

  /** @param {number} sign Use +1 to increase, -1 to decrease. */
  const bumpPostZoomRight = useCallback((sign) => {
    dispatch({ type: 'zoomStep', target: 'compare', sign });
  }, [dispatch]);

  /** Scale 1 on both pages (fit and actual-size presets). */
  const resetPostZoom = useCallback(() => {
    dispatch({ type: 'resetScale' });
  }, [dispatch]);

  // Mode changes deliberately keep calibration. Only page identity, explicit resets and the
  // fit/actual-size presets change it. isComparing is retained for compatibility with callers.

  return useMemo(() => ({
    primaryTransform,
    compareTransform,
    dispatchCompareTransform: dispatch,
    postZoomLeft: primaryTransform.scale,
    postZoomRight: compareTransform.scale,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  }), [bumpPostZoomLeft, bumpPostZoomRight, compareTransform, dispatch, primaryTransform, resetPostZoom]);
}
