// File: src/components/DocumentViewer/hooks/useCompareOverlay.js
/**
 * File: src/components/DocumentViewer/hooks/useCompareOverlay.js
 *
 * Open/close state of the compare overlay view (CompareOverlayView.jsx). The calibration itself
 * stays in the viewer context: the per-page transforms (`compareTransforms`) and the overlay
 * settings (`compareOverlay`: top page and its opacity). Opening and closing the view therefore
 * never touches them; only "reset to compare" restores what was saved when the view opened: the
 * transforms of both pages and, when the caller passes them, both panes' stored image adjustment
 * (brightness, contrast, grayscale, invert). The image rotation is not saved: it is derived from
 * the transform's quarter turn and follows the restored transform.
 *
 * The curtain view (CompareCurtainView.jsx) shows the same calibration with a draggable border.
 * It opens only once a calibration exists (`compareOverlay.calibrated`, set when the overlay view
 * opens and cleared when compare mode ends). Opened from the overlay view, the overlay view stays
 * open underneath (hidden), so Close returns to it with its "reset to compare" point intact;
 * opened from the compare view, Close returns to the compare view.
 *
 * Availability (`compare.overlay.enabled` / `compare.curtain.enabled` in the runtime config): a
 * disabled view's open action refuses and a stale open flag is never reported as open. The render
 * in DocumentViewer.jsx gates once more through resolveShownCompareViews(). With the overlay view
 * disabled the curtain needs no overlay calibration: it opens on the compare view's own per-page
 * transforms, and a calibration flag already stored in the viewer context is left untouched.
 *
 * @module useCompareOverlay
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ViewerContext from '../../../contexts/viewerContext.js';
import { INITIAL_COMPARE_TRANSFORM_STATE } from '../../../utils/compareTransform.js';
import { hasCompareCalibration } from '../../../utils/compareOverlay.js';
import { pickStoredImageAdjustments } from '../../../utils/imageAdjustments.js';
import {
  getRuntimeConfig,
  isCompareCurtainEnabled,
  isCompareOverlayEnabled,
} from '../../../utils/runtimeConfig.js';

const NOOP_DISPATCH = () => {};

/**
 * Render gate for the compare views: a view is shown only while it is open AND enabled in the
 * runtime config, so a stale open flag can never surface a disabled view.
 *
 * @param {{ overlayOpen: boolean, curtainOpen: boolean }} open
 * @param {Object=} cfg
 * @returns {{ overlay: boolean, curtain: boolean }}
 */
export function resolveShownCompareViews({ overlayOpen, curtainOpen }, cfg = getRuntimeConfig()) {
  return {
    overlay: !!overlayOpen && isCompareOverlayEnabled(cfg),
    curtain: !!curtainOpen && isCompareCurtainEnabled(cfg),
  };
}

/**
 * @param {boolean} available True in compare mode with two pages shown.
 * @param {Object=} images The panes' image adjustment (hooks/usePaneImageAdjustments.js).
 * @param {{ primary:Object, compare:Object }=} images.imageAdjustments Current stored image fields per pane.
 * @param {function({ primary:Object, compare:Object }): void=} images.onRestoreImageAdjustments
 * @returns {{
 *   compareOverlayOpen: boolean,
 *   compareOverlaySnapshot: ({ transforms:Object, imageAdjustments:Object }|null),
 *   openCompareOverlay: function(): boolean,
 *   closeCompareOverlay: function(): void,
 *   resetCompareOverlayCalibration: function(): void,
 *   compareCalibrated: boolean,
 *   compareCurtainOpen: boolean,
 *   openCompareCurtain: function(): boolean,
 *   closeCompareCurtain: function(): void
 * }}
 */
export function useCompareOverlay(available, { imageAdjustments, onRestoreImageAdjustments } = {}) {
  const context = useContext(ViewerContext);
  const transforms = context?.compareTransforms || INITIAL_COMPARE_TRANSFORM_STATE;
  const dispatch = typeof context?.dispatchCompareTransform === 'function'
    ? context.dispatchCompareTransform
    : NOOP_DISPATCH;
  const dispatchOverlay = typeof context?.dispatchCompareOverlay === 'function'
    ? context.dispatchCompareOverlay
    : NOOP_DISPATCH;
  const overlayEnabled = isCompareOverlayEnabled();
  const curtainEnabled = isCompareCurtainEnabled();
  // Without the overlay view there is nothing to calibrate first: the curtain shows the compare
  // view's own transforms. The stored flag is only read here, never cleared.
  const calibrated = hasCompareCalibration(context?.compareOverlay) || !overlayEnabled;
  const isAvailable = !!available;

  // Read at open time without making the callbacks depend on every transform change.
  const transformsRef = useRef(transforms);
  transformsRef.current = transforms;
  const imageAdjustmentsRef = useRef(imageAdjustments);
  imageAdjustmentsRef.current = imageAdjustments;
  const restoreImageRef = useRef(onRestoreImageAdjustments);
  restoreImageRef.current = onRestoreImageAdjustments;
  const availableRef = useRef(isAvailable);
  availableRef.current = isAvailable;
  const calibratedRef = useRef(calibrated);
  calibratedRef.current = calibrated;
  const overlayEnabledRef = useRef(overlayEnabled);
  overlayEnabledRef.current = overlayEnabled;
  const curtainEnabledRef = useRef(curtainEnabled);
  curtainEnabledRef.current = curtainEnabled;

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(/** @type {(Object|null)} */ (null));
  const [curtainOpen, setCurtainOpen] = useState(false);

  const openCompareOverlay = useCallback(() => {
    if (!availableRef.current || !isCompareOverlayEnabled()) return false;
    const images = imageAdjustmentsRef.current;
    setSnapshot({
      transforms: transformsRef.current,
      imageAdjustments: {
        primary: pickStoredImageAdjustments(images?.primary),
        compare: pickStoredImageAdjustments(images?.compare),
      },
    });
    setOpen(true);
    dispatchOverlay({ type: 'markCalibrated' });
    return true;
  }, [dispatchOverlay]);

  const closeCompareOverlay = useCallback(() => {
    setOpen(false);
  }, []);

  const resetCompareOverlayCalibration = useCallback(() => {
    if (!snapshot) return;
    dispatch({ type: 'restore', state: snapshot.transforms });
    if (typeof restoreImageRef.current === 'function') restoreImageRef.current(snapshot.imageAdjustments);
  }, [dispatch, snapshot]);

  const openCompareCurtain = useCallback(() => {
    if (!availableRef.current || !isCompareCurtainEnabled() || !calibratedRef.current) return false;
    setCurtainOpen(true);
    return true;
  }, []);

  const closeCompareCurtain = useCallback(() => {
    setCurtainOpen(false);
  }, []);

  // Boot config is stable for a session. If a host replaces it and re-renders, discard stale open
  // flags as well as gating the render, so enabling a capability later cannot reopen a view.
  useEffect(() => {
    if (!overlayEnabled) setOpen(false);
    if (!curtainEnabled) setCurtainOpen(false);
  }, [curtainEnabled, overlayEnabled]);

  // Leaving compare mode (or losing the second page) closes both views and drops the calibration
  // flag; the page-bound transforms survive compare enter/exit. Nothing reopens by itself.
  useEffect(() => {
    if (isAvailable) return;
    setOpen(false);
    setCurtainOpen(false);
    dispatchOverlay({ type: 'clearCalibrated' });
  }, [dispatchOverlay, isAvailable]);

  const curtainShown = curtainOpen && isAvailable && curtainEnabled;

  return useMemo(() => ({
    compareOverlayOpen: open && isAvailable && overlayEnabled && !curtainShown,
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
    overlayEnabled,
    openCompareCurtain,
    openCompareOverlay,
    resetCompareOverlayCalibration,
    snapshot,
  ]);
}
