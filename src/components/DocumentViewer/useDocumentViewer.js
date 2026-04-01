// File: src/components/DocumentViewer/useDocumentViewer.js
/**
 * File: src/components/DocumentViewer/useDocumentViewer.js
 *
 * Primary viewer-state hook.
 *
 * Responsibilities:
 * - own local viewer interaction state such as page number, zoom, compare mode, and image adjustments
 * - expose memoized handlers consumed by the viewer shell and toolbar
 * - coordinate with helper hooks that manage effects and per-pane post-zoom behavior
 *
 * This is the main public hook for viewer interaction state. Helper hooks may be split further, but the
 * returned API from this module should remain stable unless a deliberate consumer-facing refactor is made.
 */

import { useState, useRef, useCallback, useContext } from 'react';
import logger from '../../logging/systemLogger.js';
import ViewerContext from '../../contexts/viewerContext.js';
import ThemeContext from '../../contexts/themeContext.js';
import { getKeyboardPrintShortcutBehavior } from '../../utils/runtimeConfig.js';
import { useViewerPostZoom } from './hooks/useViewerPostZoom.js';
import { useViewerEffects } from './hooks/useViewerEffects.js';

/**
 * Clamp a 1-based page number into [1, total].
 * @param {number} n
 * @param {number} total
 * @returns {number}
 */
function clampPage(n, total) {
  if (!Number.isFinite(total) || total < 1) return 1;
  const v = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(v, total);
}

/**
 * Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer.
 *
 * JavaScript modulo keeps negative signs, so repeated 90-degree counter-clockwise rotation would
 * otherwise produce -90 and -180. The edit canvas expects positive quarter-turn values when it
 * decides whether width/height should be swapped.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeRotationDegrees(value) {
  const numeric = Math.round(Number(value) || 0);
  return ((numeric % 360) + 360) % 360;
}

const THUMBNAIL_WIDTH_MIN = 160;
const THUMBNAIL_WIDTH_MAX = 520;
const THUMBNAIL_WIDTH_STEP = 48;
const THUMBNAIL_WIDTH_DEFAULT = 220;

/**
 * Image adjustment properties for canvas edit mode.
 * @typedef {Object} ImageProperties
 * @property {number} rotation       Degrees, positive clockwise. 0 is neutral.
 * @property {number} brightness     0..200 (100 = neutral)
 * @property {number} contrast       0..200 (100 = neutral)
 */

/**
 * Sticky zoom modes used by the viewer (subset is used here).
 * @typedef {'FIT_PAGE'|'FIT_WIDTH'|'CUSTOM'|'ACTUAL_SIZE'} ZoomMode
 */

/**
 * Zoom state (mode + current numeric scale).
 * @typedef {Object} ZoomState
 * @property {ZoomMode} mode
 * @property {number} scale
 */

/** @typedef {'primary'|'compare'} ViewerPageTarget */

/**
 * Hook that centralizes viewer UI state and event handlers.
 * Public entry – returns the full API consumed by the viewer.
 *
 * The hook now exposes explicit primary/compare navigation helpers so keyboard shortcuts,
 * toolbar buttons, and thumbnail interactions can share the exact same page-target logic.
 * That keeps compare mode deterministic and avoids accidentally steering the wrong pane.
 *
 * @returns {Object} Returns the viewer API object (see returned keys below).
 */
export function useDocumentViewer() {
  const { allPages } = useContext(ViewerContext);
  const { toggleTheme } = useContext(ThemeContext);
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const keyboardPrintShortcutBehavior = getKeyboardPrintShortcutBehavior();

  // --- Core viewer interaction state ----------------------------------------------
  const [pageNumber, setPageNumber] = useState(1);
  const pageNumberRef = useRef(1);
  pageNumberRef.current = pageNumber;

  const [primaryDisplayState, setPrimaryDisplayState] = useState({
    requestedPageNumber: 1,
    displayedPageNumber: 0,
    pending: false,
    blockingLoading: false,
    hasError: false,
  });
  const [zoom, setZoom] = useState(1);
  const [zoomState, setZoomState] = useState(/** @type {ZoomState} */({ mode: 'FIT_PAGE', scale: 1 }));

  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumberRaw] = useState(/** @type {(number|null)} */ (null));
  const [isPrintDialogOpen, setPrintDialogOpen] = useState(false);

  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0, brightness: 100, contrast: 100,
  }));

  const [isExpandedRaw, setIsExpandedRaw] = useState(false); // raw edit-mode flag
  const isExpanded = isExpandedRaw;

  const [thumbnailWidth, setThumbnailWidth] = useState(THUMBNAIL_WIDTH_DEFAULT);

  // Refs shared with the renderer layer and the effect helpers.
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type {{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type {{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type {{ current: any }} */ const compareRef = useRef(null);

  // --- Post-zoom (compare panes) -------------------------------------------------
  const {
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  } = useViewerPostZoom(isComparing);

  // --- Page navigation -----------------------------------------------------------
  /**
   * Generic primary/compare page setter that accepts either a concrete page number or a React-like
   * updater callback. Compare-targeted updates automatically enable compare mode and reuse the left
   * page as the base when the right page has not been chosen yet.
   *
   * The primary page is mirrored in a ref so keyboard press-and-hold navigation can keep using a
   * stable callback identity across page changes. That avoids tearing down the global key listeners
   * on every repeated step, which was one of the main differences from the toolbar button path.
   *
   * @param {ViewerPageTarget} target
   * @param {(number|function(number): number)} next
   * @returns {void}
   */
  const updatePageTarget = useCallback((target, next) => {
    const resolveNext = (currentBase) => {
      const proposed = typeof next === 'function' ? next(currentBase) : next;
      return clampPage(proposed, totalPages);
    };

    if (target === 'compare') {
      if (isExpanded) return;
      setComparePageNumberRaw((current) => {
        const base = clampPage(Number.isFinite(current) ? current : pageNumberRef.current, totalPages);
        return resolveNext(base);
      });
      setIsComparing(true);
      return;
    }

    setPageNumber((current) => {
      const base = clampPage(current, totalPages);
      return resolveNext(base);
    });
  }, [isExpanded, totalPages]);

  /**
   * Change the primary page number safely (clamped).
   * @param {number} next
   * @returns {void}
   */
  const handlePageNumberChange = useCallback((next) => {
    updatePageTarget('primary', next);
  }, [updatePageTarget]);

  /**
   * Change the right-hand compare page safely (clamped) and enable compare mode when possible.
   * @param {(number|function(number): number)} next
   * @returns {void}
   */
  const setComparePageNumber = useCallback((next) => {
    updatePageTarget('compare', next);
  }, [updatePageTarget]);

  /**
   * Keep requested-page state and the actually displayed page synchronized for diagnostics. The
   * thumbnail highlight now follows the requested page immediately, but this state is still useful
   * for overlays, logging, and future UI affordances.
   *
   * @param {{ requestedPageNumber:number, displayedPageNumber:number, pending:boolean, blockingLoading:boolean, hasError:boolean }} nextState
   * @returns {void}
   */
  const handlePrimaryDisplayStateChange = useCallback((nextState) => {
    setPrimaryDisplayState((current) => {
      const normalized = {
        requestedPageNumber: Math.max(1, Number(nextState?.requestedPageNumber || current.requestedPageNumber || 1)),
        displayedPageNumber: Math.max(0, Number(nextState?.displayedPageNumber || 0)),
        pending: !!nextState?.pending,
        blockingLoading: !!nextState?.blockingLoading,
        hasError: !!nextState?.hasError,
      };

      if (
        current.requestedPageNumber === normalized.requestedPageNumber
        && current.displayedPageNumber === normalized.displayedPageNumber
        && current.pending === normalized.pending
        && current.blockingLoading === normalized.blockingLoading
        && current.hasError === normalized.hasError
      ) {
        return current;
      }
      return normalized;
    });
  }, []);

  /**
   * The thumbnail pane should react immediately when the user changes page. The large pane now
   * switches either directly to the requested page or to an explicit loading overlay, so keeping the
   * thumbnail highlight on the requested page no longer causes the old mismatch bug.
   */
  const thumbnailSelectionPageNumber = pageNumber;

  /**
   * Move one page backward in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToPreviousPage = useCallback((target = 'primary') => {
    updatePageTarget(target, (current) => current - 1);
  }, [updatePageTarget]);

  /**
   * Move one page forward in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToNextPage = useCallback((target = 'primary') => {
    updatePageTarget(target, (current) => current + 1);
  }, [updatePageTarget]);

  /**
   * Jump to the first page in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToFirstPage = useCallback((target = 'primary') => {
    updatePageTarget(target, 1);
  }, [updatePageTarget]);

  /**
   * Jump to the last page in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToLastPage = useCallback((target = 'primary') => {
    updatePageTarget(target, Math.max(1, totalPages || 1));
  }, [totalPages, updatePageTarget]);

  // --- Print dialog --------------------------------------------------------------
  const openPrintDialog = useCallback(() => {
    setPrintDialogOpen(true);
  }, []);

  const closePrintDialog = useCallback(() => {
    setPrintDialogOpen(false);
  }, []);

  // --- Zoom helpers --------------------------------------------------------------
  const zoomIn = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try { if (documentRenderRef.current?.zoomIn) { documentRenderRef.current.zoomIn(); return; } } catch (error) {
      logger.warn('DocumentRender zoomIn failed; using state fallback', { error: String(error?.message || error) });
    }
    setZoom((z) => Math.min(8, Math.round((z * 1.1) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try { if (documentRenderRef.current?.zoomOut) { documentRenderRef.current.zoomOut(); return; } } catch (error) {
      logger.warn('DocumentRender zoomOut failed; using state fallback', { error: String(error?.message || error) });
    }
    setZoom((z) => Math.max(0.1, Math.round((z / 1.1) * 100) / 100));
  }, []);

  const actualSize = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'ACTUAL_SIZE', scale: 1 });
    setZoom(1);
  }, [resetPostZoom]);

  const fitToScreen = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'FIT_PAGE', scale: zoom });
    try { documentRenderRef.current?.fitToScreen?.(); } catch (error) {
      logger.warn('DocumentRender fitToScreen failed', { error: String(error?.message || error) });
    }
  }, [resetPostZoom, zoom]);

  const fitToWidth = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'FIT_WIDTH', scale: zoom });
    try { documentRenderRef.current?.fitToWidth?.(); } catch (error) {
      logger.warn('DocumentRender fitToWidth failed', { error: String(error?.message || error) });
    }
  }, [resetPostZoom, zoom]);

  /** Set zoom mode directly ('FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'). */
  const setZoomMode = useCallback((mode) => {
    if (mode === 'FIT_PAGE') {
      fitToScreen();
      return;
    }
    if (mode === 'FIT_WIDTH') {
      fitToWidth();
      return;
    }
    if (mode === 'ACTUAL_SIZE') {
      actualSize();
      return;
    }
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
  }, [actualSize, fitToScreen, fitToWidth]);

  // --- Compare/Edit mutual exclusivity + handlers --------------------------------
  /**
   * Guarded setter for edit mode: refuses to enable while compare is active.
   * Supports boolean or updater function forms.
   * @param {boolean|Function} next
   */
  const setIsExpanded = useCallback((next) => {
    const resolve = (curr) => (typeof next === 'function' ? next(curr) : next);
    setIsExpandedRaw((curr) => {
      const wanted = resolve(curr);
      if (wanted && isComparing) {
        // Disallow enabling edit when compare is active.
        return curr;
      }
      return !!wanted;
    });
  }, [isComparing]);

  /** Toggle compare mode; blocked if edit mode is active. */
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
      if (!prev && isExpanded) return prev;
      const next = !prev;
      if (next) {
        setComparePageNumberRaw((current) => clampPage(Number.isFinite(current) ? current : pageNumber, totalPages));
      }
      return next;
    });
  }, [isExpanded, pageNumber, totalPages]);

  /**
   * Close compare mode without affecting the left page.
   * @returns {void}
   */
  const closeCompare = useCallback(() => {
    setIsComparing(false);
  }, []);

  /**
   * Select a page for the right-hand compare pane.
   * If compare is OFF, enables it unless edit mode is active (then no-op).
   * If compare is ON, just replaces the right-hand page.
   * @param {number} page
   * @returns {void}
   */
  const selectForCompare = useCallback((page) => {
    if (isExpanded) return; // blocked by active edit mode
    const clamped = clampPage(page, totalPages);
    setComparePageNumber(clamped);
    logger.info('Compare selection updated', { comparePage: clamped });
  }, [setComparePageNumber, totalPages, isExpanded]);

  // --- Image adjustments ---------------------------------------------------------
  const handleRotationChange = useCallback((delta) => {
    const d = Number(delta || 0);
    setImageProperties((state) => ({
      ...state,
      rotation: normalizeRotationDegrees((Number(state.rotation) || 0) + d),
    }));
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((state) => ({ ...state, brightness: v }));
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((state) => ({ ...state, contrast: v }));
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
  }, []);

  // --- Thumbnail resizer ---------------------------------------------------------
  /**
   * Mouse down handler for the thumbnail resizer; listens for mousemove/up on window.
   * @param {MouseEvent} e
   * @returns {void}
   */
  const applyThumbnailWidth = useCallback((next) => {
    const numeric = Number(next);
    if (!Number.isFinite(numeric)) return;
    if (numeric <= 0) {
      setThumbnailWidth(0);
      return;
    }
    setThumbnailWidth(Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, Math.round(numeric))));
  }, []);

  const increaseThumbnailWidth = useCallback(() => {
    setThumbnailWidth((current) => {
      const base = current > 0 ? current : THUMBNAIL_WIDTH_DEFAULT;
      return Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, base + THUMBNAIL_WIDTH_STEP));
    });
  }, []);

  const decreaseThumbnailWidth = useCallback(() => {
    setThumbnailWidth((current) => {
      if (current <= THUMBNAIL_WIDTH_MIN) return THUMBNAIL_WIDTH_MIN;
      return Math.max(THUMBNAIL_WIDTH_MIN, current - THUMBNAIL_WIDTH_STEP);
    });
  }, []);

  const hideThumbnailPane = useCallback(() => {
    setThumbnailWidth(0);
  }, []);

  const showThumbnailPane = useCallback(() => {
    setThumbnailWidth((current) => {
      if (current > 0) return current;
      return THUMBNAIL_WIDTH_DEFAULT;
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = Math.max(THUMBNAIL_WIDTH_MIN, thumbnailWidth || THUMBNAIL_WIDTH_DEFAULT);

    /** @param {MouseEvent} ev */
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const next = Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, startWidth + dx));
      setThumbnailWidth(next);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [thumbnailWidth]);

  /**
   * Intentionally a no-op. The outer viewer shell keeps an explicit click handler slot so the
   * container API shape stays stable while focus/selection behavior is evaluated separately from
   * page activation, compare toggling, and edit-mode interactions.
   */
  const handleContainerClick = useCallback(function handleContainerClick() {}, []);

  // --- Effects: sticky fit, global wheel, hotkeys --------------------------------
  useViewerEffects({
    zoom,
    zoomState,
    setZoomState,
    documentRenderRef,
    viewerContainerRef,
    imageRotation: imageProperties.rotation,
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
    setIsExpandedGuarded: setIsExpanded,
    onOpenPrintDialog: openPrintDialog,
    onToggleTheme: toggleTheme,
    keyboardPrintShortcutBehavior,
  });

  // --- Public API ---------------------------------------------------------------
  return {
    pageNumber,
    setPageNumber: handlePageNumberChange,
    setComparePageNumber,
    thumbnailSelectionPageNumber,
    primaryDisplayState,
    zoom,
    setZoom,
    isComparing,
    comparePageNumber,
    isPrintDialogOpen,
    openPrintDialog,
    closePrintDialog,
    imageProperties,
    isExpanded,
    thumbnailWidth,
    applyThumbnailWidth,
    increaseThumbnailWidth,
    decreaseThumbnailWidth,
    hideThumbnailPane,
    showThumbnailPane,
    viewerContainerRef,
    thumbnailsContainerRef,
    documentRenderRef,
    compareRef,
    handlePrimaryDisplayStateChange,
    handlePageNumberChange,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    zoomIn,
    zoomOut,
    actualSize,
    fitToScreen,
    fitToWidth,
    handleContainerClick,
    handleCompare,
    closeCompare,
    handleRotationChange,
    handleBrightnessChange,
    handleContrastChange,
    resetImageProperties,
    handleMouseDown,
    selectForCompare,
    setIsExpanded, // guarded setter
    zoomState,
    setZoomMode,

    // per-pane post-zoom
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  };
}
