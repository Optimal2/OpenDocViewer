// File: src/components/DocumentViewer/useDocumentViewer.js
/**
 * File: src/components/DocumentViewer/useDocumentViewer.js
 *
 * OpenDocViewer — Document Viewer State & Control Hook (public entry)
 *
 * PURPOSE
 *   Centralize the viewer’s local UI state (page, zoom, compare mode, image adjustments)
 *   and expose memoized handlers that the toolbar and child components can call.
 *   This file delegates effect plumbing and per-pane post-zoom to dedicated hooks
 *   to keep this module focused and readable.
 *
 * NOTE
 *   - API surface (returned object) is unchanged from previous versions.
 *   - Compare/Edit mutual exclusivity is enforced here (guarded toggles).
 */

import { useState, useRef, useCallback, useContext } from 'react';
import logger from '../../LogController.js';
import { ViewerContext } from '../../ViewerContext.jsx';
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
 * Move by delta pages relative to current, clamped.
 * @param {number} current
 * @param {number} delta
 * @param {number} total
 * @returns {number}
 */
function stepPage(current, delta, total) {
  return clampPage(current + delta, total);
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
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;

  // --- Core state ----------------------------------------------------------------
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [zoomState, setZoomState] = useState(/** @type {ZoomState} */({ mode: 'FIT_PAGE', scale: 1 }));

  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(/** @type {(number|null)} */ (null));

  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0, brightness: 100, contrast: 100
  }));

  const [isExpandedRaw, setIsExpandedRaw] = useState(false); // raw edit-mode flag
  const isExpanded = isExpandedRaw;

  const [thumbnailWidth, setThumbnailWidth] = useState(200);

  // Refs shared with renderer and effects
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
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = thumbnailWidth;

    /** @param {MouseEvent} ev */
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const next = Math.max(120, Math.min(480, startWidth + dx));
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

  // --- Effects: sticky fit, global wheel, hotkeys, focus hint --------------------
  const { needsViewerFocusHint, focusViewer } = useViewerEffects({
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
  });

  // --- Public API (unchanged) ----------------------------------------------------
  return {
    pageNumber,
    setPageNumber,
    zoom,
    setZoom,
    isComparing,
    comparePageNumber,
    imageProperties,
    isExpanded,
    thumbnailWidth,
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
    needsViewerFocusHint,
    focusViewer,

    // per-pane post-zoom
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  };
}
