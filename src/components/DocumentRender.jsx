/**
 * File: src/components/DocumentRender.jsx
 *
 * OpenDocViewer — Main Page Renderer
 *
 * PURPOSE
 *   Render the current page either via <canvas> (with rotation/filters) or as a plain <img>.
 *   This component coordinates image loading, initial “fit to screen” zoom, and exposes
 *   an imperative API for toolbar actions (fit-to-screen, fit-to-width, zoom in/out, etc.).
 *
 * ACCESSIBILITY
 *   - The image/canvas is absolutely positioned; alt text lives in the ImageRenderer.
 *   - Loading and error states are surfaced via LoadingMessage where applicable.
 *
 * IMPORTANT PROJECT GOTCHA
 *   - When we type-sniff elsewhere in the application we import from the **root** 'file-type'
 *     package, NOT 'file-type/browser'. With file-type v21 the '/browser' subpath is not
 *     exported for bundlers and will break Vite builds. See README “Design notes & gotchas”.
 *
 * Provenance / baseline reference for prior content: :contentReference[oaicite:0]{index=0}
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useImperativeHandle,
} from 'react';
import logger from '../LogController';
import ImageRenderer from './ImageRenderer';
import CanvasRenderer from './CanvasRenderer';
import LoadingMessage from './LoadingMessage';
import {
  calculateFitToScreenZoom,
  calculateFitToWidthZoom,
  handleZoomIn,
  handleZoomOut,
} from '../utils/zoomUtils';

/**
 * @typedef {Object} PageEntry
 * @property {string} fullSizeUrl           Resolved URL for the full-size raster image
 * @property {string} [thumbnailUrl]        Optional URL for the thumbnail
 * @property {number} status                Load status: 0=loading, 1=ready, -1=failed
 * @property {number} [realWidth]           Optional source width hint (pre-sniffed)
 * @property {number} [realHeight]          Optional source height hint (pre-sniffed)
 */

/**
 * Get the current page (1-based index) or null.
 * @param {PageEntry[]} allPages
 * @param {number} pageNumber
 * @returns {PageEntry|null}
 */
function getCurrentPage(allPages, pageNumber) {
  if (!Array.isArray(allPages) || allPages.length === 0) return null;
  return allPages[pageNumber - 1] || null;
}

/**
 * @typedef {Object} DocumentRenderHandle
 * @property {() => void} updateImageSourceAndFit   Reload current page and (re)draw
 * @property {() => HTMLCanvasElement|HTMLImageElement|null} getActiveCanvas
 * @property {() => void} fitToScreen               Compute “fit to screen” zoom and apply
 * @property {() => void} fitToWidth                Compute “fit to width” zoom and apply
 * @property {() => void} zoomIn                    Increase zoom (clamped)
 * @property {() => void} zoomOut                   Decrease zoom (clamped)
 * @property {() => void} forceRender               Flag to force a re-render on next effect
 */

/**
 * DocumentRender
 *
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.zoom
 * @param {() => void} [props.initialRenderDone]  Callback when the very first page finishes rendering
 * @param {() => void} [props.onRender]           Callback on each render completion
 * @param {{ current: HTMLElement|null }} props.viewerContainerRef
 * @param {(z: number|((prev: number) => number)) => void} props.setZoom
 * @param {(n: number|((prev: number) => number)) => void} props.setPageNumber
 * @param {boolean} props.isCompareMode
 * @param {{ rotation: number, brightness: number, contrast: number }} props.imageProperties
 * @param {boolean} props.isCanvasEnabled
 * @param {boolean} props.forceRender
 * @param {PageEntry[]} props.allPages
 * @param {{ current: HTMLElement|null }} props.thumbnailsContainerRef
 * @param {React.Ref<DocumentRenderHandle>} ref
 * @returns {JSX.Element}
 */
const DocumentRender = React.forwardRef(function DocumentRender(
  {
    pageNumber,
    zoom,
    initialRenderDone = () => {},
    onRender = () => {},
    viewerContainerRef,
    setZoom,
    setPageNumber,
    isCompareMode,
    imageProperties,
    isCanvasEnabled,
    forceRender,
    allPages,
    thumbnailsContainerRef,
  },
  ref
) {
  // DOM refs for actual drawing/hosting of the page
  const canvasRef = useRef(/** @type {HTMLCanvasElement|null} */ (null));
  const imgRef = useRef(/** @type {HTMLImageElement|null} */ (null));

  // Internal state/flags
  const initialRenderRef = useRef(false);
  const [lastRendered, setLastRendered] = useState(/** @type {number|null} */ (null));
  const [shouldForceRender, setShouldForceRender] = useState(!!forceRender);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showPage, setShowPage] = useState(false); // becomes true when all pages are status===1

  const currentPage = useMemo(
    () => getCurrentPage(allPages, pageNumber),
    [allPages, pageNumber]
  );

  /**
   * Best-effort compute raster dimensions for drawing.
   * Uses currentPage hints if present; otherwise falls back to image.natural*.
   * @param {HTMLImageElement} image
   * @returns {{ width: number, height: number }}
   */
  const getImageDimensions = useCallback(
    (image) => {
      const realWidth = currentPage?.realWidth || image?.naturalWidth || 0;
      const realHeight = currentPage?.realHeight || image?.naturalHeight || 0;
      logger.info('Using image dimensions', { realWidth, realHeight });
      return { width: realWidth, height: realHeight };
    },
    [currentPage]
  );

  /**
   * Draw a loaded image onto the canvas with rotation/filters.
   * @param {HTMLImageElement} image
   */
  const drawImageOnCanvas = useCallback(
    (image) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !image || !context) return;

      const { width, height } = getImageDimensions(image);
      const { rotation, brightness, contrast } = imageProperties;

      // Swap canvas dimensions for 90/270-degree rotations
      if (rotation === 90 || rotation === 270) {
        canvas.width = height;
        canvas.height = width;
      } else {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
      context.drawImage(image, -width / 2, -height / 2, width, height);
      context.restore();
    },
    [imageProperties, getImageDimensions]
  );

  // When ALL pages are ready, we switch from initial placeholder to actual page rendering
  useEffect(() => {
    if (!showPage && Array.isArray(allPages) && allPages.length > 0) {
      const allReady = allPages.every((p) => p && p.status === 1);
      if (allReady) setShowPage(true);
    }
  }, [allPages, showPage]);

  /**
   * Load the current page image, then:
   *   - draw on canvas (if enabled)
   *   - compute initial fit-to-screen zoom (once, on the very first load)
   *   - scroll the thumbnail strip to current page
   */
  useEffect(() => {
    if (!showPage) return;
    if (!currentPage || (pageNumber === lastRendered && !shouldForceRender)) return;

    let cancelled = false;
    const image = new Image();
    imgRef.current = image;
    // Hint modern browsers to decode off the main thread
    try { image.decoding = 'async'; } catch {}

    image.onload = () => {
      if (cancelled) return;

      // Yield to allow layout to settle before heavy work
      setTimeout(() => {
        if (isCanvasEnabled) {
          drawImageOnCanvas(image);
        }

        if (!initialRenderRef.current) {
          initialRenderDone();
          initialRenderRef.current = true;
        }

        onRender();
        setLastRendered(pageNumber);
        setShouldForceRender(false);

        // First-time auto-zoom: compute a “fit-to-screen” zoom using container bounds.
        if (isInitialLoad) {
          setIsInitialLoad(false);

          const container = viewerContainerRef?.current || null;
          if (container) {
            // Compute available viewport considering compare mode split
            const rect = container.getBoundingClientRect();
            let availableWidth = rect.width;
            let availableHeight = rect.height;
            if (isCompareMode) availableWidth = availableWidth / 2;

            const { width: imgWidth, height: imgHeight } = getImageDimensions(image);
            const widthRatio = availableWidth / imgWidth;
            const heightRatio = availableHeight / imgHeight;
            const newZoom = Math.min(widthRatio, heightRatio);

            logger.info('Calculated fit-to-screen zoom', {
              containerRect: rect,
              availableWidth,
              availableHeight,
              imgWidth,
              imgHeight,
              widthRatio,
              heightRatio,
              newZoom,
            });

            // Apply zoom on next tick to avoid layout thrash
            setTimeout(() => setZoom(newZoom), 0);
          }
        }

        // Ensure the current thumbnail is visible in the sidebar
        const containerEl = thumbnailsContainerRef?.current || null;
        if (containerEl) {
          const anchor = document.getElementById(`thumbnail-anchor-${pageNumber}`);
          if (anchor) {
            containerEl.scrollTop = anchor.offsetTop - containerEl.offsetTop;
            logger.info('Scrolled to current page', { pageNumber, offsetTop: anchor.offsetTop });
          } else {
            logger.warn('Thumbnail anchor not found', { pageNumber });
          }
        }
      }, 0);
    };

    image.onerror = () => {
      if (cancelled) return;
      logger.error('Failed to load image for page', { pageNumber, url: currentPage?.fullSizeUrl });
    };

    // Kick off the fetch
    image.src = currentPage.fullSizeUrl;

    return () => {
      cancelled = true;
      // Break potential cycles / free memory
      if (imgRef.current) {
        imgRef.current.onload = null;
        imgRef.current.onerror = null;
      }
    };
  }, [
    showPage,
    currentPage,
    pageNumber,
    initialRenderDone,
    onRender,
    lastRendered,
    drawImageOnCanvas,
    isCanvasEnabled,
    setZoom,
    shouldForceRender,
    isInitialLoad,
    viewerContainerRef,
    isCompareMode,
    thumbnailsContainerRef,
    getImageDimensions,
  ]);

  // Re-draw the canvas when zoom/filters change (only if we already drew once)
  useEffect(() => {
    if (isCanvasEnabled && showPage && imgRef.current) {
      drawImageOnCanvas(imgRef.current);
    }
  }, [zoom, imageProperties, drawImageOnCanvas, isCanvasEnabled, showPage]);

  // External flag to force a re-render (e.g., toolbar “refresh”)
  useEffect(() => {
    if (forceRender) setShouldForceRender(true);
  }, [forceRender]);

  // Imperative API exposed to parent components (toolbar, print, etc.)
  const imperativeHandle = useMemo(
    () =>
      /** @type {DocumentRenderHandle} */ ({
        updateImageSourceAndFit() {
          const url = currentPage?.fullSizeUrl;
          if (!url || !imgRef.current) return;
          imgRef.current.src = url; // triggers onload; canvas will be drawn if enabled
          if (isCanvasEnabled) drawImageOnCanvas(imgRef.current);
        },
        getActiveCanvas() {
          return isCanvasEnabled ? canvasRef.current : imgRef.current;
        },
        fitToScreen() {
          const img = imgRef.current;
          if (img && img.complete) {
            calculateFitToScreenZoom(img, viewerContainerRef, setZoom, isCompareMode);
          }
        },
        fitToWidth() {
          const img = imgRef.current;
          if (img && img.complete) {
            calculateFitToWidthZoom(img, viewerContainerRef, setZoom, isCompareMode);
          }
        },
        zoomIn() {
          handleZoomIn(setZoom);
        },
        zoomOut() {
          handleZoomOut(setZoom);
        },
        forceRender() {
          setShouldForceRender(true);
        },
      }),
    [currentPage, isCanvasEnabled, drawImageOnCanvas, viewerContainerRef, setZoom, isCompareMode]
  );

  useImperativeHandle(ref, () => imperativeHandle, [imperativeHandle]);

  // While we wait for all pages to be ready, show a centered loading message.
  if (!showPage) {
    return (
      <div
        className="document-render-container"
        style={{
          height: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="loading-progress" style={{ fontSize: '1.5rem' }}>
          Loading pages… Please wait.
        </div>
      </div>
    );
  }

  // Main render: canvas vs image depending on feature flag and current page status.
  return (
    <div className="document-render-container" style={{ height: '100%', position: 'relative' }}>
      {currentPage && currentPage.status === 1 ? (
        isCanvasEnabled ? (
          <CanvasRenderer
            ref={canvasRef}
            naturalWidth={imgRef.current?.naturalWidth || currentPage.realWidth || 0}
            naturalHeight={imgRef.current?.naturalHeight || currentPage.realHeight || 0}
            zoom={zoom}
            pageNumber={pageNumber}
          />
        ) : (
          <ImageRenderer
            ref={imgRef}
            src={currentPage.fullSizeUrl}
            zoom={zoom}
            pageNumber={pageNumber}
          />
        )
      ) : (
        <div className="loading-wrapper" style={{ height: '100%' }}>
          <LoadingMessage pageStatus={currentPage?.status || 0} />
        </div>
      )}
    </div>
  );
});

DocumentRender.displayName = 'DocumentRender';

export default DocumentRender;
