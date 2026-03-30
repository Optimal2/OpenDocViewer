// File: src/components/DocumentViewer/hooks/useViewerEffects.js
/**
 * File: src/components/DocumentViewer/hooks/useViewerEffects.js
 *
 * Cross-cutting viewer effects:
 *  - Sync zoomState.scale from numeric zoom
 *  - Sticky Fit recomputation on relevant changes
 *  - ResizeObserver to re-fit on container resize
 *  - Global Ctrl/Cmd + wheel zoom
 *  - Global keyboard navigation/zoom/hotkeys with context guards
 *  - Config-driven Ctrl/Cmd + P behavior
 *
 * The keyboard layer now understands compare-targeted navigation with Shift. When compare mode is
 * available, Shift + page-navigation keys steer the right pane and can implicitly enable compare.
 * That keeps keyboard behavior aligned with the existing Shift+thumbnail-click interaction.
 *
 * @module useViewerEffects
 */

import { useEffect } from 'react';

/**
 * Sticky zoom modes used by the viewer.
 * @typedef {'FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'} ZoomMode
 */

/** @typedef {'browser'|'disable'|'dialog'} KeyboardPrintShortcutBehavior */

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
 * @property {Function} goToPreviousPage
 * @property {Function} goToNextPage
 * @property {Function} goToFirstPage
 * @property {Function} goToLastPage
 * @property {Function} closeCompare
 * @property {Function} zoomIn
 * @property {Function} zoomOut
 * @property {Function} actualSize
 * @property {Function} fitToScreen
 * @property {Function} fitToWidth
 * @property {Function} handleCompare
 * @property {Function} setIsExpandedGuarded
 * @property {Function=} onOpenPrintDialog
 * @property {Function=} onToggleTheme
 * @property {KeyboardPrintShortcutBehavior=} keyboardPrintShortcutBehavior
 */

/**
 * Determine whether the event target is an editable or form control where viewer shortcuts
 * must stay inactive.
 *
 * Buttons are intentionally NOT treated as blocking controls so toolbar buttons may keep focus
 * while the global viewer shortcuts remain available.
 *
 * @param {*} target
 * @returns {boolean}
 */
function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-odv-shortcuts="off"]'
  );
}

/**
 * Determine whether a modal dialog is currently open.
 * While a modal is active, viewer shortcuts should be completely suspended so the dialog owns
 * keyboard interaction.
 *
 * @returns {boolean}
 */
function hasActiveModalDialog() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]');
}

/**
 * Decide whether a keyboard shortcut should be ignored for the viewer.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function shouldIgnoreViewerShortcut(event) {
  if (event.defaultPrevented) return true;
  if (event.isComposing) return true;
  if (hasActiveModalDialog()) return true;
  if (isEditableTarget(event.target)) return true;
  return isEditableTarget(document.activeElement);
}

/**
 * @param {UseViewerEffectsArgs} args
 * @returns {void}
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
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    closeCompare,
    zoomIn,
    zoomOut,
    actualSize,
    fitToScreen,
    fitToWidth,
    handleCompare,
    setIsExpandedGuarded,
    onOpenPrintDialog,
    onToggleTheme,
    keyboardPrintShortcutBehavior = 'browser',
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
      if (!(e.ctrlKey || e.metaKey)) return;
      if (hasActiveModalDialog()) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    window.addEventListener('wheel', onWheelGlobal, { passive: false, capture: true });
    return () => { window.removeEventListener('wheel', onWheelGlobal, { capture: true }); };
  }, [zoomIn, zoomOut]);

  // Config-driven Ctrl/Cmd+P handling.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      if (key !== 'p') return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (keyboardPrintShortcutBehavior === 'browser') return;
      if (hasActiveModalDialog()) return;

      e.preventDefault();
      if (keyboardPrintShortcutBehavior === 'dialog') {
        try { onOpenPrintDialog?.(); } catch {}
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); };
  }, [keyboardPrintShortcutBehavior, onOpenPrintDialog]);

  // Global keyboard navigation & zoom shortcuts.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (shouldIgnoreViewerShortcut(e)) return;

      const mod = e.ctrlKey || e.metaKey; // don’t collide with browser zoom reset
      const target = e.shiftKey ? 'compare' : 'primary';

      switch (e.key) {
        case 'PageDown':
        case 'ArrowDown':
          e.preventDefault();
          goToNextPage(target);
          break;
        case 'PageUp':
        case 'ArrowUp':
          e.preventDefault();
          goToPreviousPage(target);
          break;
        case 'Home':
          e.preventDefault();
          goToFirstPage(target);
          break;
        case 'End':
          e.preventDefault();
          goToLastPage(target);
          break;
        case 'Escape':
          if (e.shiftKey && isComparing) {
            e.preventDefault();
            closeCompare();
          }
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

          // Number hotkeys (Print, 1:1, Fit Page, Fit Width, Compare, Edit, Theme)
          if (!mod && !e.shiftKey && !e.altKey) {
            if (e.key === '0') { e.preventDefault(); onOpenPrintDialog?.(); }
            else if (e.key === '1') { e.preventDefault(); actualSize(); }
            else if (e.key === '2') { e.preventDefault(); fitToScreen(); }
            else if (e.key === '3') { e.preventDefault(); fitToWidth(); }
            else if (e.key === '4') { e.preventDefault(); handleCompare(); }
            else if (e.key === '5') { e.preventDefault(); setIsExpandedGuarded((v) => !v); }
            else if (e.key === '6') { e.preventDefault(); onToggleTheme?.(); }
          }
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); };
  }, [
    totalPages,
    actualSize,
    fitToScreen,
    fitToWidth,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    closeCompare,
    isComparing,
    handleCompare,
    setIsExpandedGuarded,
    zoomIn,
    zoomOut,
    onOpenPrintDialog,
    onToggleTheme,
  ]);

  // Optional: auto-fit after first mount if renderer supports it.
  useEffect(() => {
    const t = setTimeout(() => {
      try { if (documentRenderRef.current?.fitToScreen) documentRenderRef.current.fitToScreen(); } catch {}
    }, 0);
    return () => { clearTimeout(t); };
  }, [documentRenderRef]);
}
