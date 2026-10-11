// File: src/components/DocumentViewer/hooks/useCompareOverlay.js
/**
 * File: src/components/DocumentViewer/hooks/useCompareOverlay.js
 *
 * Open/close state of the compare overlay view (CompareOverlayView.jsx). The calibration itself
 * stays in the viewer context: the per-page transforms (`compareTransforms`) and the overlay
 * settings (`compareOverlay`: top page and its opacity). Opening and closing the view therefore
 * never touches them; only "reset to compare" restores the transforms saved when the view opened.
 *
 * The curtain view (CompareCurtainView.jsx) shows the same calibration with a draggable border.
 * It opens only once a calibration exists (`compareOverlay.calibrated`, set when the overlay view
 * opens and cleared when compare mode ends). Opened from the overlay view, the overlay view stays
 * open underneath (hidden), so Close returns to it with its "reset to compare" point intact;
 * opened from the compare view, Close returns to the compare view.
 *
 * @module useCompareOverlay
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ViewerContext from '../../../contexts/viewerContext.js';
import { INITIAL_COMPARE_TRANSFORM_STATE } from '../../../utils/compareTransform.js';
import { hasCompareCalibration } from '../../../utils/compareOverlay.js';

const NOOP_DISPATCH = () => {};

/**
 * @param {boolean} available True in compare mode with two pages shown.
 * @returns {{
 *   compareOverlayOpen: boolean,
 *   compareOverlaySnapshot: (Object|null),
 *   openCompareOverlay: function(): boolean,
 *   closeCompareOverlay: function(): void,
 *   resetCompareOverlayCalibration: function(): void,
 *   compareCalibrated: boolean,
 *   compareCurtainOpen: boolean,
 *   openCompareCurtain: function(): boolean,
 *   closeCompareCurtain: function(): void
 * }}
 */
export function useCompareOverlay(available) {
  const context = useContext(ViewerContext);
  const transforms = context?.compareTransforms || INITIAL_COMPARE_TRANSFORM_STATE;
  const dispatch = typeof context?.dispatchCompareTransform === 'function'
    ? context.dispatchCompareTransform
    : NOOP_DISPATCH;
  const dispatchOverlay = typeof context?.dispatchCompareOverlay === 'function'
    ? context.dispatchCompareOverlay
    : NOOP_DISPATCH;
  const calibrated = hasCompareCalibration(context?.compareOverlay);
  const isAvailable = !!available;

  // Read at open time without making the callbacks depend on every transform change.
  const transformsRef = useRef(transforms);
  transformsRef.current = transforms;
  const availableRef = useRef(isAvailable);
  availableRef.current = isAvailable;
  const calibratedRef = useRef(calibrated);
  calibratedRef.current = calibrated;

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(/** @type {(Object|null)} */ (null));
  const [curtainOpen, setCurtainOpen] = useState(false);

  const openCompareOverlay = useCallback(() => {
    if (!availableRef.current) return false;
    setSnapshot(transformsRef.current);
    setOpen(true);
    dispatchOverlay({ type: 'markCalibrated' });
    return true;
  }, [dispatchOverlay]);

  const closeCompareOverlay = useCallback(() => {
    setOpen(false);
  }, []);

  const resetCompareOverlayCalibration = useCallback(() => {
    if (snapshot) dispatch({ type: 'restore', state: snapshot });
  }, [dispatch, snapshot]);

  const openCompareCurtain = useCallback(() => {
    if (!availableRef.current || !calibratedRef.current) return false;
    setCurtainOpen(true);
    return true;
  }, []);

  const closeCompareCurtain = useCallback(() => {
    setCurtainOpen(false);
  }, []);

  // Leaving compare mode (or losing the second page) closes both views and drops the calibration
  // flag (the transforms are reset on compare enter/exit); nothing reopens by itself.
  useEffect(() => {
    if (isAvailable) return;
    setOpen(false);
    setCurtainOpen(false);
    dispatchOverlay({ type: 'clearCalibrated' });
  }, [dispatchOverlay, isAvailable]);

  const curtainShown = curtainOpen && isAvailable;

  return useMemo(() => ({
    compareOverlayOpen: open && isAvailable && !curtainShown,
    compareOverlaySnapshot: snapshot,
    openCompareOverlay,
    closeCompareOverlay,
    resetCompareOverlayCalibration,
    compareCalibrated: calibrated && isAvailable,
    compareCurtainOpen: curtainShown,
    openCompareCurtain,
    closeCompareCurtain,
  }), [
    calibrated,
    closeCompareCurtain,
    closeCompareOverlay,
    curtainShown,
    isAvailable,
    open,
    openCompareCurtain,
    openCompareOverlay,
    resetCompareOverlayCalibration,
    snapshot,
  ]);
}
