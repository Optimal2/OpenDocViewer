// File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js
/**
 * File: src/components/DocumentViewer/hooks/usePaneImageAdjustments.js
 *
 * Per-pane image adjustments (brightness, contrast, grayscale, invert) and the resets that combine
 * them with the per-page compare transform (utils/compareTransform.js). Rotation is not stored
 * here: it lives in the transform, and useDocumentViewer derives the canvas quarter turn from it.
 *
 * Resets, per pane:
 * - `clearImageAdjustments(target)`  image only; the transform is kept ("Reset image").
 * - `resetPane(target)`              transform to identity (rotation 0 including the quarter turn)
 *                                    and image to neutral ("Reset all" in the compare panel).
 * - `resetImageProperties(target)`   the main toolbar reset. In compare mode it is `resetPane`, so
 *                                    toolbar and panel end in the same state; outside compare mode
 *                                    it keeps its earlier scope (rotation 0 and image neutral, a
 *                                    pane zoom or position stays).
 * - `restoreImageAdjustments(state)` both panes' stored image fields from a saved
 *                                    `{ primary, compare }` (the overlay view's "reset to compare").
 *
 * @module usePaneImageAdjustments
 */

import { useCallback, useMemo, useState } from 'react';
import {
  normalizeGrayscale,
  normalizeInvert,
  pickStoredImageAdjustments,
} from '../../../utils/imageAdjustments.js';

/** Neutral per-page image adjustment state. */
export const DEFAULT_IMAGE_ADJUSTMENTS = Object.freeze({
  rotation: 0,
  brightness: 100,
  contrast: 100,
  grayscale: 0,
  invert: false,
});

/**
 * @param {*} target
 * @returns {('primary'|'compare')}
 */
function normalizeTarget(target) {
  return target === 'compare' ? 'compare' : 'primary';
}

/**
 * @param {*} e  A `{ target: { value } }` event.
 * @returns {number} The value clamped to 0..200; 100 when it is not a number.
 */
function readPercent200(e) {
  const raw = Number(e && e.target ? e.target.value : undefined);
  return Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
}

/**
 * @param {Object} options
 * @param {boolean} options.isComparing
 * @param {function(Object): void} options.dispatchCompareTransform compareTransformReducer dispatcher.
 */
export function usePaneImageAdjustments({ isComparing, dispatchCompareTransform }) {
  const [primaryImageAdjustments, setPrimaryImageAdjustments] = useState(DEFAULT_IMAGE_ADJUSTMENTS);
  const [compareImageAdjustments, setCompareImageAdjustments] = useState(DEFAULT_IMAGE_ADJUSTMENTS);

  /** @param {*} target @param {Object} patch */
  const patchPane = useCallback((target, patch) => {
    const update = (state) => ({ ...state, ...patch });
    if (normalizeTarget(target) === 'compare') {
      setCompareImageAdjustments(update);
      return;
    }
    setPrimaryImageAdjustments(update);
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e, target = 'primary') => {
    patchPane(target, { brightness: readPercent200(e) });
  }, [patchPane]);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e, target = 'primary') => {
    patchPane(target, { contrast: readPercent200(e) });
  }, [patchPane]);

  /** @param {{target:{value:*}}} e */
  const handleGrayscaleChange = useCallback((e, target = 'primary') => {
    patchPane(target, { grayscale: normalizeGrayscale(e && e.target ? e.target.value : undefined) });
  }, [patchPane]);

  /**
   * Accepts a checkbox event (`target.checked`), a `{ target: { value } }` event or a plain value.
   * @param {*} e
   */
  const handleInvertChange = useCallback((e, target = 'primary') => {
    const source = e && e.target ? e.target : null;
    const readsChecked = source && (source.type === 'checkbox' || !('value' in source));
    const raw = source ? (readsChecked ? source.checked : source.value) : e;
    patchPane(target, { invert: normalizeInvert(raw) });
  }, [patchPane]);

  /** Image only; the transform is kept. */
  const clearImageAdjustments = useCallback((target = 'primary') => {
    if (normalizeTarget(target) === 'compare') {
      setCompareImageAdjustments(DEFAULT_IMAGE_ADJUSTMENTS);
      return;
    }
    setPrimaryImageAdjustments(DEFAULT_IMAGE_ADJUSTMENTS);
  }, []);

  /**
   * Restore both panes' stored image fields (brightness, contrast, grayscale, invert) from a saved
   * `{ primary, compare }`; the transform, and with it the quarter turn, is not touched.
   * @param {({ primary:Object, compare:Object }|null|undefined)} state
   */
  const restoreImageAdjustments = useCallback((state) => {
    if (!state) return;
    setPrimaryImageAdjustments((current) => ({ ...current, ...pickStoredImageAdjustments(state.primary) }));
    setCompareImageAdjustments((current) => ({ ...current, ...pickStoredImageAdjustments(state.compare) }));
  }, []);

  /** Everything for one pane: identity transform (no quarter turn either) and neutral image. */
  const resetPane = useCallback((target = 'primary') => {
    const normalizedTarget = normalizeTarget(target);
    dispatchCompareTransform({ type: 'reset', target: normalizedTarget });
    clearImageAdjustments(normalizedTarget);
  }, [clearImageAdjustments, dispatchCompareTransform]);

  /** The main toolbar reset: `resetPane` in compare mode, its earlier scope otherwise. */
  const resetImageProperties = useCallback((target = 'primary') => {
    const normalizedTarget = normalizeTarget(target);
    if (isComparing) {
      resetPane(normalizedTarget);
      return;
    }
    dispatchCompareTransform({ type: 'set', target: normalizedTarget, transform: { rotation: 0 } });
    clearImageAdjustments(normalizedTarget);
  }, [clearImageAdjustments, dispatchCompareTransform, isComparing, resetPane]);

  // What the compare panel (CompareTransformControls) calls; one object keeps its props short.
  const compareImageHandlers = useMemo(() => ({
    onBrightnessChange: handleBrightnessChange,
    onContrastChange: handleContrastChange,
    onGrayscaleChange: handleGrayscaleChange,
    onInvertChange: handleInvertChange,
    onResetImage: clearImageAdjustments,
    onResetPane: resetPane,
  }), [
    clearImageAdjustments,
    handleBrightnessChange,
    handleContrastChange,
    handleGrayscaleChange,
    handleInvertChange,
    resetPane,
  ]);

  return {
    primaryImageAdjustments,
    compareImageAdjustments,
    handleBrightnessChange,
    handleContrastChange,
    handleGrayscaleChange,
    handleInvertChange,
    clearImageAdjustments,
    resetPane,
    resetImageProperties,
    restoreImageAdjustments,
    compareImageHandlers,
  };
}
