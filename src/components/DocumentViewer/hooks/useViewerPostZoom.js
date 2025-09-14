// File: src/components/DocumentViewer/hooks/useViewerPostZoom.js
/**
 * File: src/components/DocumentViewer/hooks/useViewerPostZoom.js
 *
 * Encapsulates per-pane "post-zoom" state & handlers used only in compare mode.
 * The post-zoom factor multiplies the base zoom independently per pane.
 *
 * @module useViewerPostZoom
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Clamp a numeric value to [min, max].
 * @param {number} v
 * @param {number} [min=0.1]
 * @param {number} [max=4.0]
 * @returns {number}
 */
function clamp(v, min = 0.1, max = 4.0) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Round to one decimal place (avoids float drift when stepping by 0.1).
 * @param {number} v
 * @returns {number}
 */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Hook managing per-pane post-zoom factors for compare mode.
 *
 * @param {boolean} isComparing Whether compare mode is active
 * @returns {{
 *   postZoomLeft: number,
 *   postZoomRight: number,
 *   bumpPostZoomLeft: function(number): void,
 *   bumpPostZoomRight: function(number): void,
 *   resetPostZoom: function(): void
 * }}
 */
export function useViewerPostZoom(isComparing) {
  const [postZoomLeft, setPostZoomLeft] = useState(1.0);
  const [postZoomRight, setPostZoomRight] = useState(1.0);

  /** Reset both per-pane factors to 1.0. */
  const resetPostZoom = useCallback(() => {
    setPostZoomLeft(1.0);
    setPostZoomRight(1.0);
  }, []);

  /**
   * Adjust left pane post-zoom by ±0.1 steps.
   * @param {number} sign Use +1 to increase, -1 to decrease.
   */
  const bumpPostZoomLeft = useCallback((sign) => {
    const step = sign >= 0 ? 0.1 : -0.1;
    setPostZoomLeft((v) => round1(clamp(v + step)));
  }, []);

  /**
   * Adjust right pane post-zoom by ±0.1 steps.
   * @param {number} sign Use +1 to increase, -1 to decrease.
   */
  const bumpPostZoomRight = useCallback((sign) => {
    const step = sign >= 0 ? 0.1 : -0.1;
    setPostZoomRight((v) => round1(clamp(v + step)));
  }, []);

  // Fresh start on compare enter/exit
  useEffect(() => {
    resetPostZoom();
  }, [isComparing, resetPostZoom]);

  return {
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  };
}
