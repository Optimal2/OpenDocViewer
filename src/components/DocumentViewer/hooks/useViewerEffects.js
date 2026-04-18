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
 * The keyboard layer now understands compare-targeted navigation with Shift and document-level
 * navigation with Ctrl. When compare mode is available, Shift + navigation keys steer the right
 * pane. When multiple visible documents exist, Ctrl + navigation keys step whole documents instead
 * of pages.
 *
 * @module useViewerEffects
 */

import { useCallback, useEffect, useRef } from 'react';
import logger from '../../../logging/systemLogger.js';
import usePageTimer from '../../../hooks/usePageTimer.js';

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
 * @property {Function} goToPreviousDocument
 * @property {Function} goToNextDocument
 * @property {Function} goToFirstDocument
 * @property {Function} goToLastDocument
 * @property {boolean} documentNavigationEnabled
 * @property {boolean} compareNavigationEnabled
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
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    goToPreviousDocument,
    goToNextDocument,
    goToFirstDocument,
    goToLastDocument,
    documentNavigationEnabled,
    compareNavigationEnabled,
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

  const activeKeyboardRepeatKeyRef = useRef(null);
  const keyboardRepeatTargetRef = useRef('primary');
  const keyboardRepeatScopeRef = useRef('page');
  const goToPreviousPageRef = useRef(goToPreviousPage);
  const goToNextPageRef = useRef(goToNextPage);
  const goToFirstPageRef = useRef(goToFirstPage);
  const goToLastPageRef = useRef(goToLastPage);
  const goToPreviousDocumentRef = useRef(goToPreviousDocument);
  const goToNextDocumentRef = useRef(goToNextDocument);
  const goToFirstDocumentRef = useRef(goToFirstDocument);
  const goToLastDocumentRef = useRef(goToLastDocument);
  const documentNavigationEnabledRef = useRef(documentNavigationEnabled);
  const compareNavigationEnabledRef = useRef(compareNavigationEnabled);
  const zoomInRef = useRef(zoomIn);
  const zoomOutRef = useRef(zoomOut);
  const actualSizeRef = useRef(actualSize);
  const fitToScreenRef = useRef(fitToScreen);
  const fitToWidthRef = useRef(fitToWidth);
  const handleCompareRef = useRef(handleCompare);
  const setIsExpandedGuardedRef = useRef(setIsExpandedGuarded);
  const onOpenPrintDialogRef = useRef(onOpenPrintDialog);
  const onToggleThemeRef = useRef(onToggleTheme);

  goToPreviousPageRef.current = goToPreviousPage;
  goToNextPageRef.current = goToNextPage;
  goToFirstPageRef.current = goToFirstPage;
  goToLastPageRef.current = goToLastPage;
  goToPreviousDocumentRef.current = goToPreviousDocument;
  goToNextDocumentRef.current = goToNextDocument;
  goToFirstDocumentRef.current = goToFirstDocument;
  goToLastDocumentRef.current = goToLastDocument;
  documentNavigationEnabledRef.current = documentNavigationEnabled;
  compareNavigationEnabledRef.current = compareNavigationEnabled;
  zoomInRef.current = zoomIn;
  zoomOutRef.current = zoomOut;
  actualSizeRef.current = actualSize;
  fitToScreenRef.current = fitToScreen;
  fitToWidthRef.current = fitToWidth;
  handleCompareRef.current = handleCompare;
  setIsExpandedGuardedRef.current = setIsExpandedGuarded;
  onOpenPrintDialogRef.current = onOpenPrintDialog;
  onToggleThemeRef.current = onToggleTheme;

  const handleKeyboardPreviousRepeatStep = useCallback(() => {
    const target = keyboardRepeatTargetRef.current === 'compare' ? 'compare' : 'primary';
    if (keyboardRepeatScopeRef.current === 'document') {
      goToPreviousDocumentRef.current?.(target);
      return;
    }
    goToPreviousPageRef.current?.(target);
  }, []);

  const handleKeyboardNextRepeatStep = useCallback(() => {
    const target = keyboardRepeatTargetRef.current === 'compare' ? 'compare' : 'primary';
    if (keyboardRepeatScopeRef.current === 'document') {
      goToNextDocumentRef.current?.(target);
      return;
    }
    goToNextPageRef.current?.(target);
  }, []);

  const {
    startPageTimer: startKeyboardPreviousRepeatTimer,
    stopPageTimer: stopKeyboardPreviousRepeatTimer,
  } = usePageTimer(500, handleKeyboardPreviousRepeatStep);

  const {
    startPageTimer: startKeyboardNextRepeatTimer,
    stopPageTimer: stopKeyboardNextRepeatTimer,
  } = usePageTimer(500, handleKeyboardNextRepeatStep);

  const stopKeyboardRepeat = useCallback(() => {
    activeKeyboardRepeatKeyRef.current = null;
    keyboardRepeatScopeRef.current = 'page';
    stopKeyboardPreviousRepeatTimer();
    stopKeyboardNextRepeatTimer();
  }, [stopKeyboardNextRepeatTimer, stopKeyboardPreviousRepeatTimer]);

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
    if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH') return undefined;

    const ref = documentRenderRef.current;
    if (!ref) return undefined;

    const rafId = window.requestAnimationFrame(() => {
      try {
        if (mode === 'FIT_PAGE') ref.fitToScreen?.();
        else if (mode === 'FIT_WIDTH') ref.fitToWidth?.();
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
  }, [pageNumber, imageRotation, isComparing, thumbnailWidth, zoomState.mode, documentRenderRef]);

  // Re-fit on container resize (only in Fit modes)
  useEffect(() => {
    const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
    if (!el) return;

    let rafId = 0;
    const ro = new ResizeObserver(() => {
      const mode = zoomState.mode;
      if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH') return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          if (mode === 'FIT_PAGE') documentRenderRef.current?.fitToScreen?.();
          else if (mode === 'FIT_WIDTH') documentRenderRef.current?.fitToWidth?.();
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
  // Repeat navigation uses the same timer hook as the toolbar buttons instead of relying on the
  // browser's native key-repeat cadence. That keeps fast keyboard paging aligned with press-and-hold
  // mouse behavior and avoids overdriving React state updates on long documents.
  useEffect(() => {
    /**
     * @param {KeyboardEvent} e
     * @returns {'primary'|'compare'}
     */
    const getTarget = (e) => (
      e.shiftKey && compareNavigationEnabledRef.current ? 'compare' : 'primary'
    );

    /**
     * @param {KeyboardEvent} e
     * @returns {'page'|'document'}
     */
    const getScope = (e) => (
      e.ctrlKey && !e.altKey && !e.metaKey && documentNavigationEnabledRef.current
        ? 'document'
        : 'page'
    );

    /**
     * @param {KeyboardEvent} e
     * @returns {boolean}
     */
    const isNextRepeatKey = (e) => e.key === 'PageDown' || e.key === 'ArrowDown';

    /**
     * @param {KeyboardEvent} e
     * @returns {boolean}
     */
    const isPreviousRepeatKey = (e) => e.key === 'PageUp' || e.key === 'ArrowUp';

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (shouldIgnoreViewerShortcut(e)) return;

      const hasModifierKey = e.ctrlKey || e.metaKey;
      const target = getTarget(e);
      const scope = getScope(e);

      if (isNextRepeatKey(e)) {
        e.preventDefault();
        // Native keyboard auto-repeat can keep firing while a hold session is already active.
        // Ignore duplicate keydown events for the same physical hold so we do not restart the
        // leading-edge timer path and accidentally drive page changes faster than the toolbar does.
        if (activeKeyboardRepeatKeyRef.current === e.key) return;
        stopKeyboardRepeat();
        keyboardRepeatTargetRef.current = target;
        keyboardRepeatScopeRef.current = scope;
        activeKeyboardRepeatKeyRef.current = e.key;
        startKeyboardNextRepeatTimer('next');
        return;
      }

      if (isPreviousRepeatKey(e)) {
        e.preventDefault();
        if (activeKeyboardRepeatKeyRef.current === e.key) return;
        stopKeyboardRepeat();
        keyboardRepeatTargetRef.current = target;
        keyboardRepeatScopeRef.current = scope;
        activeKeyboardRepeatKeyRef.current = e.key;
        startKeyboardPreviousRepeatTimer('prev');
        return;
      }

      switch (e.key) {
        case 'Home':
          e.preventDefault();
          stopKeyboardRepeat();
          if (scope === 'document') goToFirstDocumentRef.current?.(target);
          else goToFirstPageRef.current?.(target);
          break;
        case 'End':
          e.preventDefault();
          stopKeyboardRepeat();
          if (scope === 'document') goToLastDocumentRef.current?.(target);
          else goToLastPageRef.current?.(target);
          break;
        case 'Escape':
          stopKeyboardRepeat();
          break;

        case '+':
          if (!hasModifierKey) { e.preventDefault(); zoomInRef.current?.(); }
          break;
        case '-':
          if (!hasModifierKey) { e.preventDefault(); zoomOutRef.current?.(); }
          break;

        default:
          // Numpad variants
          if (!hasModifierKey && e.code === 'NumpadAdd') { e.preventDefault(); zoomInRef.current?.(); break; }
          if (!hasModifierKey && e.code === 'NumpadSubtract') { e.preventDefault(); zoomOutRef.current?.(); break; }

          // Number hotkeys (Print, 1:1, Fit Page, Fit Width, Compare, Edit, Theme)
          if (!hasModifierKey && !e.shiftKey && !e.altKey) {
            if (e.key === '0') { e.preventDefault(); onOpenPrintDialogRef.current?.(); }
            else if (e.key === '1') { e.preventDefault(); actualSizeRef.current?.(); }
            else if (e.key === '2') { e.preventDefault(); fitToScreenRef.current?.(); }
            else if (e.key === '3') { e.preventDefault(); fitToWidthRef.current?.(); }
            else if (e.key === '4') { e.preventDefault(); handleCompareRef.current?.(); }
            else if (e.key === '5') { e.preventDefault(); setIsExpandedGuardedRef.current?.((v) => !v); }
            else if (e.key === '6') { e.preventDefault(); onToggleThemeRef.current?.(); }
          }
          break;
      }
    }

    /** @param {KeyboardEvent} e */
    function onKeyUp(e) {
      if (activeKeyboardRepeatKeyRef.current !== e.key) return;
      stopKeyboardRepeat();
    }

    /** @returns {void} */
    function onWindowBlur() {
      stopKeyboardRepeat();
    }

    /** @returns {void} */
    function onVisibilityChange() {
      if (document.hidden) stopKeyboardRepeat();
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur, true);
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
      stopKeyboardRepeat();
    };
  }, [
    startKeyboardNextRepeatTimer,
    startKeyboardPreviousRepeatTimer,
    stopKeyboardRepeat,
  ]);

  // Optional: auto-fit after first mount if renderer supports it.
  useEffect(() => {
    const t = setTimeout(() => {
      try { if (documentRenderRef.current?.fitToScreen) documentRenderRef.current.fitToScreen(); } catch {}
    }, 0);
    return () => { clearTimeout(t); };
  }, [documentRenderRef]);
}
