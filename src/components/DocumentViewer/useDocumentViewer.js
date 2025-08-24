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
 *   - First successful render triggers an auto “fit to screen”.
 *
 * PROJECT GOTCHA (for future reviewers)
 *   - In other modules we import from the **root** 'file-type' package — NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *
 * Provenance / baseline reference for prior version of this file: :contentReference[oaicite:0]{index=0}
 */

import { useState, useRef, useEffect, useCallback, useContext } from 'react';
import logger from '../../LogController';
import { ViewerContext } from '../../ViewerContext';
import {
  handlePrevPage,
  handleNextPage,
  handleFirstPage,
  handleLastPage,
} from '../../utils/navigationUtils';

/**
 * @typedef {(update: number | ((prev: number) => number)) => void} SetNumber
 */

/**
 * Clamp a page number into [1, total].
 * @param {number} n
 * @param {number} total
 * @returns {number}
 */
function clampPage(n, total) {
  if (!Number.isFinite(total) || total < 1) return 1;
  const i = Math.max(1, Math.min(Math.floor(Number(n) || 1), Math.floor(total)));
  return i;
}

/**
 * Parse a numeric input (from <input> events etc.) with fallback.
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Custom hook for managing the document viewer state and behavior.
 *
 * @returns {{
 *   pageNumber: number,
 *   setPageNumber: (newPageNumber: number, fromThumbnail?: boolean) => void,
 *   zoom: number,
 *   setZoom: SetNumber,
 *   isComparing: boolean,
 *   comparePageNumber: number|null,
 *   imageProperties: { rotation: number, brightness: number, contrast: number },
 *   isExpanded: boolean,
 *   thumbnailWidth: number,
 *   viewerContainerRef: React.MutableRefObject<HTMLElement|null>,
 *   thumbnailsContainerRef: React.MutableRefObject<HTMLElement|null>,
 *   documentRenderRef: React.MutableRefObject<any>,
 *   compareRef: React.MutableRefObject<any>,
 *   handlePageNumberChange: (newPageNumber: number, fromThumbnail?: boolean) => void,
 *   zoomIn: () => void,
 *   zoomOut: () => void,
 *   fitToScreen: () => void,
 *   fitToWidth: () => void,
 *   handleContainerClick: () => void,
 *   handleCompare: () => void,
 *   handleRotationChange: (angle: number) => void,
 *   handleBrightnessChange: (e: { target: { value: any } }) => void,
 *   handleContrastChange: (e: { target: { value: any } }) => void,
 *   resetImageProperties: () => void,
 *   handleMouseDown: (e: MouseEvent) => void,
 *   setIsExpanded: (v: boolean | ((prev: boolean) => boolean)) => void,
 * }}
 */
export const useDocumentViewer = () => {
  const { allPages } = useContext(ViewerContext);

  // Core UI state
  const [pageNumber, setPageNumberState] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(/** @type {number|null} */ (null));
  const [imageProperties, setImageProperties] = useState({
    rotation: 0,
    brightness: 100,
    contrast: 100,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [thumbnailWidth, setThumbnailWidth] = useState(200);

  // Refs to DOM / imperative APIs
  const viewerContainerRef = useRef(/** @type {HTMLElement|null} */ (null));
  const thumbnailsContainerRef = useRef(/** @type {HTMLElement|null} */ (null));
  const documentRenderRef = useRef(/** @type {any} */ (null));
  const compareRef = useRef(/** @type {any} */ (null));
  const hasInitialRender = useRef(false);

  /** Compute total pages defensively (0 if unknown). */
  const totalPages = Array.isArray(allPages) ? allPages.length : 0;

  /**
   * Programmatic setter with clamping.
   * @param {number} newPageNumber
   * @param {boolean} [fromThumbnail=false]
   */
  const setPageNumber = useCallback(
    (newPageNumber, fromThumbnail = false) => {
      const next = clampPage(newPageNumber, totalPages || 1);
      setPageNumberState(next);
      logger.info('Page number set', { next, fromThumbnail });
    },
    [totalPages]
  );

  /**
   * Keep current page in range if the number of pages changes (e.g., reload/new doc).
   */
  useEffect(() => {
    if (totalPages > 0) {
      setPageNumberState((prev) => clampPage(prev, totalPages));
    } else {
      setPageNumberState(1);
    }
  }, [totalPages]);

  /**
   * Global keyboard shortcuts:
   *   PageUp   → prev
   *   PageDown → next
   *   Home     → first
   *   End      → last
   */
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const handleKeyDown = (event) => {
      try {
        switch (event.key) {
          case 'PageUp':
            handlePrevPage(setPageNumberState);
            break;
          case 'PageDown':
            handleNextPage(setPageNumberState, totalPages);
            break;
          case 'Home':
            handleFirstPage(setPageNumberState);
            break;
          case 'End':
            handleLastPage(setPageNumberState, totalPages);
            break;
          default:
            break;
        }
      } catch (error) {
        logger.error('Key navigation failed', { error: String(error?.message || error) });
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: true });
    return () => window.removeEventListener('keydown', handleKeyDown, /** @type {any} */ ({ passive: true }));
  }, [totalPages]);

  /**
   * First-time auto fit-to-screen once there are pages and the renderer exists.
   */
  useEffect(() => {
    if (totalPages > 0 && !hasInitialRender.current) {
      hasInitialRender.current = true;
      logger.info('DocumentViewer initial render: fit to screen');
      try {
        documentRenderRef.current?.fitToScreen?.();
      } catch (error) {
        logger.error('Initial fitToScreen failed', { error: String(error?.message || error) });
      }
    }
  }, [totalPages]);

  /**
   * Handle external page number changes (from thumbnails, toolbar etc.).
   * Ensures fit-to-screen on jump to keep the page fully visible.
   *
   * @param {number} newPageNumber
   * @param {boolean} [fromThumbnail=false]
   */
  const handlePageNumberChange = useCallback(
    (newPageNumber, fromThumbnail = false) => {
      const next = clampPage(newPageNumber, totalPages || 1);
      if (next !== pageNumber) {
        setPageNumber(next, fromThumbnail);
        try {
          documentRenderRef.current?.fitToScreen?.();
        } catch (error) {
          logger.error('fitToScreen failed after page change', { error: String(error?.message || error) });
        }
      }
    },
    [pageNumber, setPageNumber, totalPages]
  );

  /** Zoom helpers (delegated to the renderer’s imperative API). */
  const zoomIn = useCallback(() => {
    try { documentRenderRef.current?.zoomIn?.(); } catch {}
  }, []);
  const zoomOut = useCallback(() => {
    try { documentRenderRef.current?.zoomOut?.(); } catch {}
  }, []);
  const fitToScreen = useCallback(() => {
    try { documentRenderRef.current?.fitToScreen?.(); } catch {}
  }, []);
  const fitToWidth = useCallback(() => {
    try { documentRenderRef.current?.fitToWidth?.(); } catch {}
  }, []);

  /** Focus the container so keystrokes reach the viewer. */
  const handleContainerClick = useCallback(() => {
    try { viewerContainerRef.current?.focus?.(); } catch {}
  }, []);

  /** Toggle compare mode (remember the anchor page on entry). */
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
      if (!prev) setComparePageNumber(pageNumber);
      return !prev;
    });
  }, [pageNumber]);

  /** Relative rotation (accumulates and wraps to [0,360)). */
  const handleRotationChange = useCallback((angle) => {
    setImageProperties((prevProps) => ({
      ...prevProps,
      rotation: (prevProps.rotation + toNumber(angle, 0) + 360) % 360,
    }));
  }, []);

  /** Brightness (expects percentage). */
  const handleBrightnessChange = useCallback((event) => {
    const value = clampPage(toNumber(event?.target?.value, 100), 10000); // reuse clamp for min 1, cap large
    setImageProperties((prevProps) => ({ ...prevProps, brightness: value }));
  }, []);

  /** Contrast (expects percentage). */
  const handleContrastChange = useCallback((event) => {
    const value = clampPage(toNumber(event?.target?.value, 100), 10000);
    setImageProperties((prevProps) => ({ ...prevProps, contrast: value }));
  }, []);

  /** Reset all image adjustments. */
  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
  }, []);

  /**
   * Handle drag on a vertical resizer to adjust thumbnail sidebar width.
   * Parent should pass this to the <Resizer> onMouseDown.
   *
   * @param {MouseEvent} e
   */
  const handleMouseDown = useCallback(
    (e) => {
      const startX = e.clientX;
      const startWidth = thumbnailWidth;

      /** @param {MouseEvent} ev */
      const handleMouseMove = (ev) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(30, Math.min(1200, startWidth + delta));
        setThumbnailWidth(newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [thumbnailWidth]
  );

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
    setIsExpanded,
  };
};
