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

import { useCallback, useContext, useEffect, useMemo } from 'react';
import ViewerContext from '../../../contexts/viewerContext.js';
import {
  INITIAL_COMPARE_TRANSFORM_STATE,
  selectCompareTransform,
} from '../../../utils/compareTransform.js';

const NOOP_DISPATCH = () => {};

/**
 * @param {boolean} isComparing Whether compare mode is active.
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
export function useCompareTransforms(isComparing) {
  const context = useContext(ViewerContext);
  const state = context?.compareTransforms || INITIAL_COMPARE_TRANSFORM_STATE;
  const dispatch = typeof context?.dispatchCompareTransform === 'function'
    ? context.dispatchCompareTransform
    : NOOP_DISPATCH;

  const primaryTransform = selectCompareTransform(state, 'primary');
  const compareTransform = selectCompareTransform(state, 'compare');

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

  // Fresh alignment on compare enter/exit; whole quarter turns survive like the old page rotation.
  useEffect(() => {
    dispatch({ type: 'resetAlignment' });
  }, [dispatch, isComparing]);

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
