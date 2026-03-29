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

/**
 * Hook that centralizes viewer UI state and event handlers.
 * Public entry – returns the full API consumed by the viewer.
 * @returns {Object} Returns the viewer API object (see returned keys below).
 */
export function useDocumentViewer() {
  const { allPages } = useContext(ViewerContext);
  const { toggleTheme } = useContext(ThemeContext);
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const keyboardPrintShortcutBehavior = getKeyboardPrintShortcutBehavior();

  // --- Core viewer interaction state ----------------------------------------------
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [zoomState, setZoomState] = useState(/** @type {ZoomState} */({ mode: 'FIT_PAGE', scale: 1 }));

  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(/** @type {(number|null)} */ (null));
  const [isPrintDialogOpen, setPrintDialogOpen] = useState(false);

  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0, brightness: 100, contrast: 100
  }));

  const [isExpandedRaw, setIsExpandedRaw] = useState(false); // raw edit-mode flag
  const isExpanded = isExpandedRaw;

  const THUMBNAIL_WIDTH_MIN = 160;
  const THUMBNAIL_WIDTH_MAX = 520;
  const THUMBNAIL_WIDTH_STEP = 48;
  const THUMBNAIL_WIDTH_DEFAULT = 220;

  const [thumbnailWidth, setThumbnailWidth] = useState(THUMBNAIL_WIDTH_DEFAULT);

  // Refs shared with the renderer layer and the effect helpers.
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type {{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type {{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type {{ current: any }} */ const compareRef = useRef(null);

  // --- Page navigation -----------------------------------------------------------
  /**
   * Change the current page number safely (clamped).
   * While compare is active, the right-hand "locked" page is unchanged.
   * @param {number} next
   * @param {boolean} [fromThumbnail=false]
   * @returns {void}
   */
  const handlePageNumberChange = useCallback((next, _fromThumbnail = false) => {
    const clamped = clampPage(next, totalPages);
    if (clamped !== pageNumber) setPageNumber(clamped);
  }, [pageNumber, totalPages]);

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
    try { if (documentRenderRef.current?.zoomIn) { documentRenderRef.current.zoomIn(); return; } } catch {}
    setZoom((z) => Math.min(8, Math.round((z * 1.1) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try { if (documentRenderRef.current?.zoomOut) { documentRenderRef.current.zoomOut(); return; } } catch {}
    setZoom((z) => Math.max(0.1, Math.round((z / 1.1) * 100) / 100));
  }, []);

  const fitToScreen = useCallback(() => {
    setZoomState({ mode: 'FIT_PAGE', scale: zoom });
    try { documentRenderRef.current?.fitToScreen?.(); } catch {}
  }, [zoom]);

  const fitToWidth = useCallback(() => {
    setZoomState({ mode: 'FIT_WIDTH', scale: zoom });
    try { documentRenderRef.current?.fitToWidth?.(); } catch {}
  }, [zoom]);

  /** Set zoom mode directly ('FIT_PAGE'|'FIT_WIDTH'|'CUSTOM') */
  const setZoomMode = useCallback((mode) => {
    setZoomState((s) => ({ ...s, mode }));
    if (mode === 'FIT_PAGE')      { try { documentRenderRef.current?.fitToScreen?.(); } catch {} }
    else if (mode === 'FIT_WIDTH'){ try { documentRenderRef.current?.fitToWidth?.(); } catch {} }
  }, []);

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
        // Disallow enabling edit when compare is active
        return curr;
      }
      return !!wanted;
    });
  }, [isComparing]);

  /** Toggle/enable compare mode; blocked if edit mode is active. */
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
      // Want to enable?
      if (!prev && isExpanded) {
        return prev; // blocked by active edit mode
      }
      const next = !prev;
      if (next) setComparePageNumber(pageNumber);
      return next;
    });
  }, [isExpanded, pageNumber]);

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
    setIsComparing(true);
    logger.info('Compare selection updated', { comparePage: clamped });
  }, [totalPages, isExpanded]);

  // --- Image adjustments ---------------------------------------------------------
  const handleRotationChange = useCallback((delta) => {
    const d = Number(delta || 0);
    setImageProperties((s) => ({ ...s, rotation: Math.round((s.rotation + d) % 360) }));
    try { documentRenderRef.current?.forceRender?.(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((s) => ({ ...s, brightness: v }));
    try { documentRenderRef.current?.forceRender?.(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((s) => ({ ...s, contrast: v }));
    try { documentRenderRef.current?.forceRender?.(); } catch {}
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
    try { documentRenderRef.current?.forceRender?.(); } catch {}
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

  /** Placeholder for future focus/selection behaviors. */
  const handleContainerClick = useCallback(function (_event) {}, []);

  // --- Post-zoom (compare panes) -------------------------------------------------
  const {
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  } = useViewerPostZoom(isComparing);

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
    setZoom,
    setPageNumber,
    setZoomMode,
    zoomIn,
    zoomOut,
    handleCompare,
    setIsExpandedGuarded: setIsExpanded,
    onOpenPrintDialog: openPrintDialog,
    onToggleTheme: toggleTheme,
    keyboardPrintShortcutBehavior,
  });

  // --- Public API ---------------------------------------------------------------
  return {
    pageNumber,
    setPageNumber,
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
    handlePageNumberChange,
    zoomIn,
    zoomOut,
    fitToScreen,
    fitToWidth,
    handleContainerClick,
    handleCompare,
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
