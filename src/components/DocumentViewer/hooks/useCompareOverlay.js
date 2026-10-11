// File: src/components/DocumentViewer/hooks/useCompareOverlay.js
/**
 * File: src/components/DocumentViewer/hooks/useCompareOverlay.js
 *
 * Open/close state of the compare overlay view (CompareOverlayView.jsx). The calibration itself
 * stays in the viewer context: the per-page transforms (`compareTransforms`) and the overlay
 * settings (`compareOverlay`: top page and its opacity). Opening and closing the view therefore
 * never touches them; only "reset to compare" restores the transforms saved when the view opened.
 *
 * @module useCompareOverlay
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ViewerContext from '../../../contexts/viewerContext.js';
import { INITIAL_COMPARE_TRANSFORM_STATE } from '../../../utils/compareTransform.js';

const NOOP_DISPATCH = () => {};

/**
 * @param {boolean} available True in compare mode with two pages shown.
 * @returns {{
 *   compareOverlayOpen: boolean,
 *   compareOverlaySnapshot: (Object|null),
 *   openCompareOverlay: function(): boolean,
 *   closeCompareOverlay: function(): void,
 *   resetCompareOverlayCalibration: function(): void
 * }}
 */
export function useCompareOverlay(available) {
  const context = useContext(ViewerContext);
  const transforms = context?.compareTransforms || INITIAL_COMPARE_TRANSFORM_STATE;
  const dispatch = typeof context?.dispatchCompareTransform === 'function'
    ? context.dispatchCompareTransform
    : NOOP_DISPATCH;
  const isAvailable = !!available;

  // Read at open time without making the callbacks depend on every transform change.
  const transformsRef = useRef(transforms);
  transformsRef.current = transforms;
  const availableRef = useRef(isAvailable);
  availableRef.current = isAvailable;

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(/** @type {(Object|null)} */ (null));

  const openCompareOverlay = useCallback(() => {
    if (!availableRef.current) return false;
    setSnapshot(transformsRef.current);
    setOpen(true);
    return true;
  }, []);

  const closeCompareOverlay = useCallback(() => {
    setOpen(false);
  }, []);

  const resetCompareOverlayCalibration = useCallback(() => {
    if (snapshot) dispatch({ type: 'restore', state: snapshot });
  }, [dispatch, snapshot]);

  // Leaving compare mode (or losing the second page) closes the view; it does not reopen by itself.
  useEffect(() => {
    if (!isAvailable) setOpen(false);
  }, [isAvailable]);

  return useMemo(() => ({
    compareOverlayOpen: open && isAvailable,
    compareOverlaySnapshot: snapshot,
    openCompareOverlay,
    closeCompareOverlay,
    resetCompareOverlayCalibration,
  }), [closeCompareOverlay, isAvailable, open, openCompareOverlay, resetCompareOverlayCalibration, snapshot]);
}
