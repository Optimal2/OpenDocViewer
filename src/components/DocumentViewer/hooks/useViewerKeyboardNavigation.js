// File: src/components/DocumentViewer/hooks/useViewerKeyboardNavigation.js
/**
 * Global keyboard navigation, zoom, rotation, and selection shortcuts for DocumentViewer.
 *
 * @module useViewerKeyboardNavigation
 */

import { useCallback, useEffect, useRef } from 'react';
import usePageTimer from '../../../hooks/usePageTimer.js';

/**
 * @param {Object} args
 * @returns {void}
 */
export function useViewerKeyboardNavigation({
  isComparing,
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
  activePane = 'primary',
  activatePrimaryPane,
  activateComparePane,
  closeCompare,
  hideCurrentPageFromSelection,
  hideCurrentDocumentFromSelection,
  zoomIn,
  zoomOut,
  rotateLeft,
  rotateRight,
  printEnabled = true,
  interactionSuspended = false,
  viewerContainerRef,
  shouldIgnoreViewerShortcut,
}) {
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
  const isComparingRef = useRef(isComparing);
  const activePaneRef = useRef(activePane === 'compare' ? 'compare' : 'primary');
  const activatePrimaryPaneRef = useRef(activatePrimaryPane);
  const activateComparePaneRef = useRef(activateComparePane);
  const closeCompareRef = useRef(closeCompare);
  const hideCurrentPageFromSelectionRef = useRef(hideCurrentPageFromSelection);
  const hideCurrentDocumentFromSelectionRef = useRef(hideCurrentDocumentFromSelection);
  const zoomInRef = useRef(zoomIn);
  const zoomOutRef = useRef(zoomOut);
  const rotateLeftRef = useRef(rotateLeft);
  const rotateRightRef = useRef(rotateRight);

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
  isComparingRef.current = isComparing;
  activePaneRef.current = activePane === 'compare' ? 'compare' : 'primary';
  activatePrimaryPaneRef.current = activatePrimaryPane;
  activateComparePaneRef.current = activateComparePane;
  closeCompareRef.current = closeCompare;
  hideCurrentPageFromSelectionRef.current = hideCurrentPageFromSelection;
  hideCurrentDocumentFromSelectionRef.current = hideCurrentDocumentFromSelection;
  zoomInRef.current = zoomIn;
  zoomOutRef.current = zoomOut;
  rotateLeftRef.current = rotateLeft;
  rotateRightRef.current = rotateRight;

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

  // Global keyboard navigation & zoom shortcuts.
  // Repeat navigation uses the same timer hook as the toolbar buttons instead of relying on the
  // browser's native key-repeat cadence. That keeps fast keyboard paging aligned with press-and-hold
  // mouse behavior and avoids overdriving React state updates on long documents.
  useEffect(() => {
    /**
     * @param {KeyboardEvent} e
     * @returns {'primary'|'compare'}
     */
    const getTarget = (e) => {
      if (!compareNavigationEnabledRef.current || !isComparingRef.current) return 'primary';
      const currentActivePane = activePaneRef.current === 'compare' ? 'compare' : 'primary';
      if (!e.shiftKey) return currentActivePane;
      return currentActivePane === 'compare' ? 'primary' : 'compare';
    };

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
    const isNextRepeatKey = (e) => e.key === 'ArrowDown'
      || (e.key === 'PageDown' && !e.ctrlKey && !e.metaKey && !e.altKey);

    /**
     * @param {KeyboardEvent} e
     * @returns {boolean}
     */
    const isPreviousRepeatKey = (e) => e.key === 'ArrowUp'
      || (e.key === 'PageUp' && !e.ctrlKey && !e.metaKey && !e.altKey);

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (shouldIgnoreViewerShortcut(e)) return;
      if (interactionSuspended) {
        stopKeyboardRepeat();
        return;
      }

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

        case 'ArrowLeft':
          if (e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            stopKeyboardRepeat();
            rotateLeftRef.current?.(target);
          } else if (!e.metaKey && !e.altKey) {
            e.preventDefault();
            stopKeyboardRepeat();
            if (isComparingRef.current && activePaneRef.current === 'primary') {
              closeCompareRef.current?.();
            } else {
              activatePrimaryPaneRef.current?.();
            }
          }
          break;
        case 'ArrowRight':
          if (e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            stopKeyboardRepeat();
            rotateRightRef.current?.(target);
          } else if (!e.metaKey && !e.altKey) {
            e.preventDefault();
            stopKeyboardRepeat();
            activateComparePaneRef.current?.();
          }
          break;

        case 'Delete':
          if (!e.metaKey && !e.altKey) {
            e.preventDefault();
            stopKeyboardRepeat();
            if (e.ctrlKey) {
              if (target === 'compare' && !isComparingRef.current) break;
              hideCurrentDocumentFromSelectionRef.current?.(target);
            } else {
              hideCurrentPageFromSelectionRef.current?.(target);
            }
          }
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

          // Plain number keys are intentionally not used as global viewer shortcuts anymore.
          // The next shortcut revision will introduce modifier-based letter combinations so we
          // avoid collisions with assistive technology, browser features, and form-like contexts.
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
    interactionSuspended,
    printEnabled,
    shouldIgnoreViewerShortcut,
    startKeyboardNextRepeatTimer,
    startKeyboardPreviousRepeatTimer,
    stopKeyboardRepeat,
    viewerContainerRef,
  ]);
}
