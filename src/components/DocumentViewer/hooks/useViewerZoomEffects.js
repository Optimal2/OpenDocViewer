// File: src/components/DocumentViewer/hooks/useViewerZoomEffects.js
/**
 * Zoom, resize, wheel, print-shortcut, and initial-fit effects for DocumentViewer.
 *
 * @module useViewerZoomEffects
 */

import { useEffect } from 'react';
import logger from '../../../logging/systemLogger.js';

/**
 * @param {Object} args
 * @returns {void}
 */
export function useViewerZoomEffects({
  zoom,
  zoomState,
  setZoomState,
  documentRenderRef,
  viewerContainerRef,
  imageRotationKey,
  isComparing,
  thumbnailWidth,
  pageNumber,
  zoomIn,
  zoomOut,
  fitToCustomWidth,
  onOpenPrintDialog,
  printEnabled = true,
  interactionSuspended = false,
  keyboardPrintShortcutBehavior = 'browser',
  hasActiveModalDialog,
  isEditableTarget,
}) {
  // Keep zoomState.scale in sync with numeric zoom.
  useEffect(() => {
    setZoomState((current) => {
      if (Number(current?.scale) === Number(zoom)) return current;
      return { ...current, scale: zoom };
    });
  }, [zoom, setZoomState]);

  // Sticky Fit recomputation on relevant changes.
  // Defer the DOM reads/writes to the next animation frame so fast key-repeat navigation does not
  // stack synchronous layout work in the middle of React state commits.
  useEffect(() => {
    const mode = zoomState.mode;
    if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH' && mode !== 'FIT_CUSTOM') return undefined;

    const ref = documentRenderRef.current;
    if (!ref) return undefined;

    const rafId = window.requestAnimationFrame(() => {
      try {
        if (mode === 'FIT_PAGE') ref.fitToScreen?.();
        else if (mode === 'FIT_WIDTH') ref.fitToWidth?.();
        else if (mode === 'FIT_CUSTOM') ref.fitToCustomWidth?.();
      } catch (error) {
        logger.warn('Sticky fit recomputation failed', {
          mode,
          pageNumber,
          error: String(error?.message || error),
        });
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [pageNumber, imageRotationKey, isComparing, thumbnailWidth, zoomState.mode, documentRenderRef]);

  // Re-fit on container resize (only in Fit modes)
  useEffect(() => {
    const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
    if (!el) return;

    let rafId = 0;
    const ro = new ResizeObserver(() => {
      const mode = zoomState.mode;
      if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH' && mode !== 'FIT_CUSTOM') return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          if (mode === 'FIT_PAGE') documentRenderRef.current?.fitToScreen?.();
          else if (mode === 'FIT_WIDTH') documentRenderRef.current?.fitToWidth?.();
          else if (mode === 'FIT_CUSTOM') documentRenderRef.current?.fitToCustomWidth?.();
        } catch (error) {
          logger.warn('ResizeObserver fit recomputation failed', {
            mode,
            error: String(error?.message || error),
          });
        }
      });
    });

    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [viewerContainerRef, zoomState.mode, documentRenderRef]);

  // Global Ctrl/Cmd + wheel to zoom the document (never the browser page)
  useEffect(() => {
    /** @param {WheelEvent} e */
    const onWheelGlobal = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (hasActiveModalDialog()) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      e.preventDefault();
      if (interactionSuspended) return;
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    window.addEventListener('wheel', onWheelGlobal, { passive: false, capture: true });
    return () => { window.removeEventListener('wheel', onWheelGlobal, { capture: true }); };
  }, [hasActiveModalDialog, interactionSuspended, isEditableTarget, zoomIn, zoomOut]);

  // Config-driven Ctrl/Cmd+P handling.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      if (key !== 'p') return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (hasActiveModalDialog()) return;
      if (interactionSuspended) {
        e.preventDefault();
        return;
      }
      if (!printEnabled) {
        e.preventDefault();
        return;
      }
      if (keyboardPrintShortcutBehavior === 'browser') return;

      e.preventDefault();
      if (keyboardPrintShortcutBehavior === 'dialog') {
        try { onOpenPrintDialog?.(); } catch {}
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); };
  }, [hasActiveModalDialog, interactionSuspended, keyboardPrintShortcutBehavior, onOpenPrintDialog, printEnabled]);

  // Optional: apply the configured initial zoom mode after first mount if the renderer supports it.
  useEffect(() => {
    const mode = zoomState.mode;
    const t = setTimeout(() => {
      try {
        if (mode === 'FIT_WIDTH') documentRenderRef.current?.fitToWidth?.();
        else if (mode === 'FIT_CUSTOM') documentRenderRef.current?.fitToCustomWidth?.();
        else if (mode === 'FIT_PAGE') documentRenderRef.current?.fitToScreen?.();
      } catch {}
    }, 0);
    return () => { clearTimeout(t); };
  }, [documentRenderRef, fitToCustomWidth, zoomState.mode]);
}
