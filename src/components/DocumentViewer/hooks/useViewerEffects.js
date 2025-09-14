// File: src/components/DocumentViewer/hooks/useViewerEffects.js
/**
 * File: src/components/DocumentViewer/hooks/useViewerEffects.js
 *
 * Cross-cutting viewer effects:
 *  - Sync zoomState.scale from numeric zoom
 *  - Sticky Fit recomputation on relevant changes
 *  - ResizeObserver to re-fit on container resize
 *  - Global Ctrl/Cmd + wheel zoom
 *  - Keyboard navigation/zoom/hotkeys
 *  - Focus tracking (shortcuts hint) + focusViewer helper
 *
 * @module useViewerEffects
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Sticky zoom modes used by the viewer.
 * @typedef {'FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'} ZoomMode
 */

/**
 * Arguments for useViewerEffects. (Simplified types for JSDoc compatibility.)
 * @typedef {Object} UseViewerEffectsArgs
 * @property {number} zoom
 * @property {Object} zoomState                 - { mode: ZoomMode, scale: number }
 * @property {Function} setZoomState
 * @property {Object} documentRenderRef         - Ref-like { current: any }
 * @property {Object} viewerContainerRef        - Ref-like { current: HTMLElement|null }
 * @property {number} imageRotation
 * @property {boolean} isComparing
 * @property {number} thumbnailWidth
 * @property {number} pageNumber
 * @property {number} totalPages
 * @property {Function} setZoom
 * @property {Function} setPageNumber
 * @property {Function} setZoomMode
 * @property {Function} zoomIn
 * @property {Function} zoomOut
 * @property {Function} handleCompare
 * @property {Function} setIsExpandedGuarded
 */

/**
 * @param {UseViewerEffectsArgs} args
 * @returns {{needsViewerFocusHint: boolean, focusViewer: function(): void}}
 */
export function useViewerEffects(args) {
  const {
    zoom,
    zoomState,
    setZoomState,
    documentRenderRef,
    viewerContainerRef,
    imageRotation,
    isComparing,
    thumbnailWidth,
    pageNumber,
    totalPages,
    setZoom,
    setPageNumber,
    setZoomMode,
    zoomIn,
    zoomOut,
    handleCompare,
    setIsExpandedGuarded,
  } = args;

  // Keep zoomState.scale in sync with numeric zoom
  useEffect(() => {
    setZoomState((s) => ({ ...s, scale: zoom }));
  }, [zoom, setZoomState]);

  // Sticky Fit recomputation on relevant changes
  useEffect(() => {
    const mode = zoomState.mode;
    if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH') return;
    const ref = documentRenderRef.current;
    if (!ref) return;
    try {
      if (mode === 'FIT_PAGE') ref.fitToScreen?.();
      else if (mode === 'FIT_WIDTH') ref.fitToWidth?.();
    } catch {}
  }, [pageNumber, imageRotation, isComparing, thumbnailWidth, zoomState.mode, documentRenderRef]);

  // Re-fit on container resize (only in Fit modes)
  useEffect(() => {
    const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
    if (!el) return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      const mode = zoomState.mode;
      if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          if (mode === 'FIT_PAGE') documentRenderRef.current?.fitToScreen?.();
          else if (mode === 'FIT_WIDTH') documentRenderRef.current?.fitToWidth?.();
        } catch {}
      });
    });

    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [viewerContainerRef, zoomState.mode, documentRenderRef]);

  // Global Ctrl/Cmd + wheel to zoom the document (never the browser page)
  useEffect(() => {
    /** @param {WheelEvent} e */
    const onWheelGlobal = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else if (e.deltaY > 0) zoomOut();
      }
    };
    window.addEventListener('wheel', onWheelGlobal, { passive: false, capture: true });
    return () => { window.removeEventListener('wheel', onWheelGlobal, { capture: true }); };
  }, [zoomIn, zoomOut]);

  // Keyboard navigation & zoom shortcuts (when viewer is focused)
  useEffect(() => {
    /** Clamp page helpers (inline to avoid importing) */
    const clampPage = (n, total) => {
      if (!Number.isFinite(total) || total < 1) return 1;
      const v = Math.max(1, Math.floor(Number(n) || 1));
      return Math.min(v, total);
    };
    const stepPage = (current, delta, total) => clampPage(current + delta, total);

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      const root = viewerContainerRef.current;
      if (!root) return;

      const inside = e.target instanceof Node && root.contains(/** @type {Node} */(e.target));
      if (!inside) return;

      const mod = e.ctrlKey || e.metaKey; // don’t collide with browser zoom reset

      switch (e.key) {
        case 'PageDown':
        case 'ArrowDown':
          setPageNumber((p) => stepPage(p, 1, totalPages));
          break;
        case 'PageUp':
        case 'ArrowUp':
          setPageNumber((p) => stepPage(p, -1, totalPages));
          break;
        case 'Home':
          setPageNumber(1);
          break;
        case 'End':
          setPageNumber(totalPages || 1);
          break;

        case '+':
          if (!mod) { e.preventDefault(); zoomIn(); }
          break;
        case '-':
          if (!mod) { e.preventDefault(); zoomOut(); }
          break;

        default:
          // Numpad variants
          if (!mod && e.code === 'NumpadAdd') { e.preventDefault(); zoomIn(); break; }
          if (!mod && e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut(); break; }

          // Number hotkeys (1:1, Fit Page, Fit Width, Compare, Edit)
          if (!mod && !e.shiftKey && !e.altKey) {
            if (e.key === '1') { e.preventDefault(); setZoomMode('CUSTOM'); setZoom(1); }
            else if (e.key === '2') { e.preventDefault(); setZoomMode('FIT_PAGE'); }
            else if (e.key === '3') { e.preventDefault(); setZoomMode('FIT_WIDTH'); }
            else if (e.key === '4') { e.preventDefault(); handleCompare(); }                 // guarded inside
            else if (e.key === '5') { e.preventDefault(); setIsExpandedGuarded((v) => !v); } // guarded inside
            // '6' remains for theme toggle (toolbar owns it)
          }
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [
    viewerContainerRef, totalPages, setPageNumber,
    setZoomMode, setZoom, handleCompare, setIsExpandedGuarded,
    zoomIn, zoomOut
  ]);

  // Focus tracking: hint when focus is outside the viewer (shortcuts inactive)
  const [needsViewerFocusHint, setNeedsViewerFocusHint] = useState(false);

  useEffect(() => {
    /** @param {Event} e */
    const update = (e) => {
      const container = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
      if (!container) return;
      const target = /** @type {any} */ (e.target);
      const inside = target instanceof Node ? container.contains(target) : false;
      setNeedsViewerFocusHint(!inside);
    };
    window.addEventListener('focusin', update, true);
    window.addEventListener('pointerdown', update, true);
    // Initialize once on mount
    update({ target: document.activeElement });
    return () => {
      window.removeEventListener('focusin', update, true);
      window.removeEventListener('pointerdown', update, true);
    };
  }, [viewerContainerRef]);

  /** Give focus to the viewer and clear the hint. */
  const focusViewer = useCallback(() => {
    try {
      const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
      if (el && typeof el.focus === 'function') el.focus();
    } finally {
      setNeedsViewerFocusHint(false);
    }
  }, [viewerContainerRef]);

  // Optional: auto-fit after first mount if renderer supports it.
  useEffect(() => {
    const t = setTimeout(() => {
      try { if (documentRenderRef.current?.fitToScreen) documentRenderRef.current.fitToScreen(); } catch {}
    }, 0);
    return () => { clearTimeout(t); };
  }, [documentRenderRef]);

  return { needsViewerFocusHint, focusViewer };
}
