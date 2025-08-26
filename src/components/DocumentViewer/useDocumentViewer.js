// File: src/components/DocumentViewer/useDocumentViewer.js
/**
 * File: src/components/DocumentViewer/useDocumentViewer.js
 *
 * OpenDocViewer — Document Viewer State & Control Hook (React)
 *
 * PURPOSE
 *   Centralize the viewer’s local UI state (page, zoom, compare mode, image adjustments)
 *   and expose memoized handlers that the toolbar and child components can call.
 *
 * DESIGN NOTES
 *   - Page numbers are 1-based.
 *   - We clamp navigation into [1, totalPages] defensively.
 *   - Keyboard shortcuts (PageUp/PageDown/Home/End) are attached on mount.
 *   - First successful render can trigger an auto “fit to screen” if the renderer exposes it.
 *
 * TYPES
 *   This hook references common typedefs/callbacks from src/types/jsdoc-types.js:
 *     - SetPageNumber
 *     - SetBooleanState
 *     - RefLike
 *     - DocumentRenderHandle
 */
import { useState, useRef, useEffect, useCallback, useContext } from 'react';
import logger from '../../LogController.js';
import { ViewerContext } from '../../ViewerContext.jsx';

/**
 * Image adjustment properties for canvas edit mode.
 * @typedef {Object} ImageProperties
 * @property {number} rotation       Degrees, positive clockwise. 0 is neutral.
 * @property {number} brightness     0..200 (100 = neutral)
 * @property {number} contrast       0..200 (100 = neutral)
 */

/**
 * Aggregate return type for the viewer hook.
 * @typedef {Object} UseDocumentViewerReturn
 * @property {number} pageNumber
 * @property {function(number): void} setPageNumber
 * @property {number} zoom
 * @property {function(number): void} setZoom
 * @property {boolean} isComparing
 * @property {(number|null)} comparePageNumber
 * @property {ImageProperties} imageProperties
 * @property {boolean} isExpanded
 * @property {number} thumbnailWidth
 * @property {Object} viewerContainerRef
 * @property {Object} thumbnailsContainerRef
 * @property {Object} documentRenderRef
 * @property {Object} compareRef
 * @property {function(number, boolean=): void} handlePageNumberChange
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToWidth
 * @property {function(*=): void} handleContainerClick
 * @property {function(): void} handleCompare
 * @property {function(number): void} handleRotationChange
 * @property {function(*): void} handleBrightnessChange
 * @property {function(*): void} handleContrastChange
 * @property {function(): void} resetImageProperties
 * @property {function(MouseEvent): void} handleMouseDown
 * @property {function(number): void} selectForCompare
 * @property {function(boolean): void} setIsExpanded
 */

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
 * Hook that centralizes viewer UI state and event handlers.
 * @returns {UseDocumentViewerReturn}
 */
export function useDocumentViewer() {
  const { allPages } = useContext(ViewerContext);

  // Derived
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;

  // State
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(/** @type {(number|null)} */ (null));
  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0,
    brightness: 100,
    contrast: 100
  }));
  const [isExpanded, setIsExpanded] = useState(false);
  const [thumbnailWidth, setThumbnailWidth] = useState(200);

  // Refs
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type {{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type {{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type {{ current: any }} */ const compareRef = useRef(null);

  /**
   * Change the current page number safely (clamped).
   * NOTE: While compare mode is active, the right-hand "locked" page (comparePageNumber)
   *       is NOT modified here. It is set only when compare mode is toggled ON, or via
   *       selectForCompare().
   *
   * @param {number} next
   * @param {boolean} [fromThumbnail=false]
   * @returns {void}
   */
  const handlePageNumberChange = useCallback((next, _fromThumbnail = false) => {
    const clamped = clampPage(next, totalPages);
    if (clamped !== pageNumber) {
      setPageNumber(clamped);
      // Intentionally do NOT touch comparePageNumber here; the right pane stays locked.
    }
  }, [pageNumber, totalPages]);

  // Zoom helpers
  const zoomIn = useCallback(() => {
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.zoomIn === 'function') {
        documentRenderRef.current.zoomIn();
        return;
      }
    } catch {}
    setZoom(function (z) { return Math.min(8, Math.round((z + 0.1) * 100) / 100); });
  }, []);

  const zoomOut = useCallback(() => {
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.zoomOut === 'function') {
        documentRenderRef.current.zoomOut();
        return;
      }
    } catch {}
    setZoom(function (z) { return Math.max(0.1, Math.round((z - 0.1) * 100) / 100); });
  }, []);

  const fitToScreen = useCallback(() => {
    try { if (documentRenderRef.current && typeof documentRenderRef.current.fitToScreen === 'function') documentRenderRef.current.fitToScreen(); } catch {}
  }, []);

  const fitToWidth = useCallback(() => {
    try { if (documentRenderRef.current && typeof documentRenderRef.current.fitToWidth === 'function') documentRenderRef.current.fitToWidth(); } catch {}
  }, []);

  // Compare toggle (toolbar button)
  const handleCompare = useCallback(() => {
    setIsComparing(function (prev) {
      const next = !prev;
      if (next) setComparePageNumber(pageNumber);
      return next;
    });
  }, [pageNumber]);

  /**
   * Select a page for the right-hand compare pane.
   * - If compare mode is OFF, enables it and locks the given page on the right.
   * - If compare mode is ON, simply replaces the right-hand page.
   * Left pane (pageNumber) is never changed by this function.
   * @param {number} page
   * @returns {void}
   */
  const selectForCompare = useCallback((page) => {
    const clamped = clampPage(page, totalPages);
    setComparePageNumber(clamped);
    setIsComparing(true);
    logger.info('Compare selection updated', { comparePage: clamped });
  }, [totalPages]);

  // Image adjustments
  const handleRotationChange = useCallback((delta) => {
    const d = Number(delta || 0);
    setImageProperties(function (s) {
      return { ...s, rotation: Math.round((s.rotation + d) % 360) };
    });
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties(function (s) { return { ...s, brightness: v }; });
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties(function (s) { return { ...s, contrast: v }; });
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  // Keyboard navigation on the viewer container
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (!viewerContainerRef.current) return;
      const inside = e.target instanceof Node && viewerContainerRef.current.contains(/** @type {Node} */(e.target));
      if (!inside) return;

      switch (e.key) {
        case 'PageDown':
        case 'ArrowRight':
        case 'ArrowDown':
          setPageNumber(function (p) { return stepPage(p, 1, totalPages); });
          break;
        case 'PageUp':
        case 'ArrowLeft':
        case 'ArrowUp':
          setPageNumber(function (p) { return stepPage(p, -1, totalPages); });
          break;
        case 'Home':
          setPageNumber(1);
          break;
        case 'End':
          setPageNumber(totalPages || 1);
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return function cleanup() { window.removeEventListener('keydown', onKeyDown); };
  }, [totalPages]);

  // Optional: auto-fit after first mount if renderer supports it.
  useEffect(() => {
    const t = setTimeout(function () {
      try { if (documentRenderRef.current && typeof documentRenderRef.current.fitToScreen === 'function') documentRenderRef.current.fitToScreen(); } catch {}
    }, 0);
    return function cleanup() { clearTimeout(t); };
  }, []);

  /**
   * Handle container clicks. If a modal/dialog is open we may ignore the click.
   * @param {*} _event
   * @returns {void}
   */
  const handleContainerClick = useCallback(function (_event) {
    // Placeholder for future focus/selection behaviors.
  }, []);

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

  // Log mount/unmount for diagnostics
  useEffect(() => {
    logger.debug('useDocumentViewer mounted');
    return () => { logger.debug('useDocumentViewer unmounted'); };
  }, []);

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
    setIsExpanded
  };
}
