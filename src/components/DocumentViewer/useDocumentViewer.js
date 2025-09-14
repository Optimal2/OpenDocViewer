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
 *   - NEW: Zoom is governed by a "mode" so that Fit modes recompute on page change & resize.
 *   - NEW: Global Ctrl/Cmd + wheel always zooms the document (never browser page zoom).
 *   - NEW: Focus hint when shortcuts are inactive (focus outside viewer).
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

/** @typedef {'FIT_PAGE'|'FIT_WIDTH'|'CUSTOM'} ZoomMode */

/**
 * Zoom state (mode + current numeric scale).
 * @typedef {Object} ZoomState
 * @property {ZoomMode} mode
 * @property {number} scale
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
 * @property {ZoomState} zoomState
 * @property {function(ZoomMode): void} setZoomMode
 * @property {boolean} needsViewerFocusHint                     // NEW: true when focus is outside viewer
 * @property {function(): void} focusViewer                     // NEW: programmatically focus the viewer
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
  const [zoomState, setZoomState] = useState(/** @type {ZoomState} */({ mode: 'FIT_PAGE', scale: 1 }));
  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(/** @type {(number|null)} */ (null));
  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0,
    brightness: 100,
    contrast: 100
  }));
  const [isExpanded, setIsExpanded] = useState(false);
  const [thumbnailWidth, setThumbnailWidth] = useState(200);
  const [needsViewerFocusHint, setNeedsViewerFocusHint] = useState(false); // NEW

  // Refs
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type={{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type={{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type={{ current: any }} */ const compareRef = useRef(null);

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

  // Keep zoomState.scale in sync with numeric zoom
  useEffect(() => {
    setZoomState((s) => ({ ...s, scale: zoom }));
  }, [zoom]);

  // Zoom helpers
  const zoomIn = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.zoomIn === 'function') {
        documentRenderRef.current.zoomIn();
        return;
      }
    } catch {}
    setZoom((z) => Math.min(8, Math.round((z * 1.1) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.zoomOut === 'function') {
        documentRenderRef.current.zoomOut();
        return;
      }
    } catch {}
    setZoom((z) => Math.max(0.1, Math.round((z / 1.1) * 100) / 100));
  }, []);

  const fitToScreen = useCallback(() => {
    setZoomState({ mode: 'FIT_PAGE', scale: zoom }); // scale will be updated by setZoom in renderer
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.fitToScreen === 'function') {
        documentRenderRef.current.fitToScreen();
      }
    } catch {}
  }, [zoom]);

  const fitToWidth = useCallback(() => {
    setZoomState({ mode: 'FIT_WIDTH', scale: zoom });
    try {
      if (documentRenderRef.current && typeof documentRenderRef.current.fitToWidth === 'function') {
        documentRenderRef.current.fitToWidth();
      }
    } catch {}
  }, [zoom]);

  /** Set zoom mode directly ('FIT_PAGE'|'FIT_WIDTH'|'CUSTOM') */
  const setZoomMode = useCallback((mode) => {
    setZoomState((s) => ({ ...s, mode }));
    if (mode === 'FIT_PAGE') {
      try { documentRenderRef.current?.fitToScreen?.(); } catch {}
    } else if (mode === 'FIT_WIDTH') {
      try { documentRenderRef.current?.fitToWidth?.(); } catch {}
    }
    // 'CUSTOM' is handled by direct zoom changes elsewhere.
  }, []);

  // Recompute fits when the page changes, rotation changes, or compare toggles,
  // but ONLY if we are in a Fit mode (sticky behavior users expect).
  useEffect(() => {
    const mode = zoomState.mode;
    if (mode !== 'FIT_PAGE' && mode !== 'FIT_WIDTH') return;
    const ref = documentRenderRef.current;
    if (!ref) return;
    const doFit = () => {
      try {
        if (mode === 'FIT_PAGE') ref.fitToScreen?.();
        else if (mode === 'FIT_WIDTH') ref.fitToWidth?.();
      } catch {}
    };
    doFit();
  }, [pageNumber, imageProperties.rotation, isComparing, thumbnailWidth, zoomState.mode]);

  // Compare toggle (toolbar button)
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
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
    setImageProperties((s) => ({ ...s, rotation: Math.round((s.rotation + d) % 360) }));
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((s) => ({ ...s, brightness: v }));
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((s) => ({ ...s, contrast: v }));
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
    try { if (documentRenderRef.current && typeof documentRenderRef.current.forceRender === 'function') documentRenderRef.current.forceRender(); } catch {}
  }, []);

  // Keyboard navigation & zoom shortcuts on the viewer container (when focused)
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (!viewerContainerRef.current) return;
      const inside = e.target instanceof Node && viewerContainerRef.current.contains(/** @type {Node} */(e.target));
      if (!inside) return;

      // Do not interfere with browser Ctrl/Cmd+0 (page zoom reset)
      const mod = e.ctrlKey || e.metaKey;

      switch (e.key) {
        // Paging: ArrowUp/Down and PageUp/PageDown (Left/Right reserved for future rotation)
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

        // Zoom keys: + (including NumpadAdd), - (including NumpadSubtract)
        case '+':
          if (!mod) { e.preventDefault(); zoomIn(); }
          break;
        case '-':
          if (!mod) { e.preventDefault(); zoomOut(); }
          break;
        default:
          // Numpad variants via code (for some layouts)
          if (!mod && e.code === 'NumpadAdd') { e.preventDefault(); zoomIn(); break; }
          if (!mod && e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut(); break; }

          // Number hotkeys (no modifiers): align with button order: 1:1, Fit Page, Fit Width, Compare, Edit
          if (!mod && !e.shiftKey && !e.altKey) {
            if (e.key === '1') { e.preventDefault(); setZoomMode('CUSTOM'); setZoom(1); }
            else if (e.key === '2') { e.preventDefault(); setZoomMode('FIT_PAGE'); }
            else if (e.key === '3') { e.preventDefault(); setZoomMode('FIT_WIDTH'); }
            else if (e.key === '4') { e.preventDefault(); setIsComparing((v) => !v); if (!isComparing) setComparePageNumber(pageNumber); }
            else if (e.key === '5') { e.preventDefault(); setIsExpanded((v) => !v); }
            // '6' reserved for theme toggle (handled in toolbar where toggleTheme exists)
          }
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [totalPages, setZoomMode, setZoom, isComparing, pageNumber]);

  // Optional: auto-fit after first mount if renderer supports it.
  useEffect(() => {
    const t = setTimeout(() => {
      try { if (documentRenderRef.current && typeof documentRenderRef.current.fitToScreen === 'function') documentRenderRef.current.fitToScreen(); } catch {}
    }, 0);
    return () => { clearTimeout(t); };
  }, []);

  /**
   * Recompute fits when container size changes (ResizeObserver).
   * Debounced by rAF via micro task scheduling.
   */
  useEffect(() => {
    const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
    if (!el) return;
    if (zoomState.mode !== 'FIT_PAGE' && zoomState.mode !== 'FIT_WIDTH') return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          if (zoomState.mode === 'FIT_PAGE') documentRenderRef.current?.fitToScreen?.();
          else if (zoomState.mode === 'FIT_WIDTH') documentRenderRef.current?.fitToWidth?.();
        } catch {}
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [viewerContainerRef, zoomState.mode]);

  // GLOBAL: Ctrl/Cmd + wheel (or trackpad pinch) → always zoom document, never browser page
  useEffect(() => {
    /** @param {WheelEvent} e */
    const onWheelGlobal = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // block browser zoom
        if (e.deltaY < 0) zoomIn();
        else if (e.deltaY > 0) zoomOut();
      }
    };
    // Capture phase to preempt browser/page handlers even over the toolbar
    window.addEventListener('wheel', onWheelGlobal, { passive: false, capture: true });
    return () => { window.removeEventListener('wheel', onWheelGlobal, { capture: true }); };
  }, [zoomIn, zoomOut]);

  // Focus tracking: show a hint when focus is outside the viewer (shortcuts inactive)
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
  }, []);

  /**
   * Programmatically focus the viewer container and clear the hint.
   * @returns {void}
   */
  const focusViewer = useCallback(() => {
    try {
      const el = /** @type {HTMLElement|null} */ (viewerContainerRef.current);
      if (el && typeof el.focus === 'function') el.focus();
    } finally {
      setNeedsViewerFocusHint(false);
    }
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
    setIsExpanded,
    zoomState,
    setZoomMode,
    needsViewerFocusHint,      // NEW
    focusViewer               // NEW
  };
}
