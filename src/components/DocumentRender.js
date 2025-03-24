// File: src/components/DocumentRender.js

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import logger from '../LogController';
import ImageRenderer from './ImageRenderer';
import CanvasRenderer from './CanvasRenderer';
import LoadingMessage from './LoadingMessage';
import { calculateFitToScreenZoom, calculateFitToWidthZoom, handleZoomIn, handleZoomOut } from '../utils/zoomUtils';

/**
 * Retrieves the current page from the allPages array based on the pageNumber.
 *
 * @param {Array} allPages - The array of all pages.
 * @param {number} pageNumber - The current page number.
 * @returns {Object|null} The current page object or null if not found.
 */
const getCurrentPage = (allPages, pageNumber) => {
  if (!allPages || allPages.length === 0) return null;
  return allPages[pageNumber - 1] || null;
};

/**
 * DocumentRender component.
 * Initially displays a loading indicator until all pages are loaded in the background.
 * Once all pages are loaded, it automatically displays the current page and applies "fit to screen" zoom.
 *
 * @component
 * @param {Object} props - Component props.
 * @param {number} props.pageNumber - The current page number.
 * @param {number} props.zoom - The current zoom level.
 * @param {Function} [props.initialRenderDone] - Callback for initial render completion.
 * @param {Function} [props.onRender] - Callback to signal render completion.
 * @param {Object} props.viewerContainerRef - Ref to the viewer container.
 * @param {Function} props.setZoom - Function to set the zoom level.
 * @param {Function} props.setPageNumber - Function to set the page number.
 * @param {boolean} props.isCompareMode - Flag indicating compare mode.
 * @param {Object} props.imageProperties - Image properties (rotation, brightness, contrast).
 * @param {boolean} props.isCanvasEnabled - Flag indicating if canvas rendering is enabled.
 * @param {boolean} props.forceRender - Flag to force re-rendering.
 * @param {Array} props.allPages - Array of all pages.
 * @param {Object} props.thumbnailsContainerRef - Ref to the thumbnails container.
 * @param {Object} ref - React ref.
 * @returns {JSX.Element} The rendered document.
 */
const DocumentRender = React.forwardRef(({
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
}, ref) => {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const initialRenderRef = useRef(false);
  const [lastRendered, setLastRendered] = useState(null);
  const [shouldForceRender, setShouldForceRender] = useState(forceRender);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // Controls whether to display the image page; initially false.
  const [showPage, setShowPage] = useState(false);

  const currentPage = useMemo(() => getCurrentPage(allPages, pageNumber), [allPages, pageNumber]);

  /**
   * Helper to get the "real" dimensions of the image.
   * Uses currentPage.realWidth/realHeight if available; otherwise falls back to the image's natural dimensions.
   *
   * @param {HTMLImageElement} image - The loaded image element.
   * @returns {{width: number, height: number}} The dimensions object.
   */
  const getImageDimensions = useCallback((image) => {
    const realWidth = currentPage.realWidth || image.naturalWidth;
    const realHeight = currentPage.realHeight || image.naturalHeight;
    logger.info('Using image dimensions', { realWidth, realHeight });
    return { width: realWidth, height: realHeight };
  }, [currentPage]);

  /**
   * Draws the image on the canvas using the "real" dimensions.
   *
   * @param {HTMLImageElement} image - The loaded image element.
   */
  const drawImageOnCanvas = useCallback((image) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !image || !context) return;

    const { width, height } = getImageDimensions(image);
    const { rotation, brightness, contrast } = imageProperties;

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
  }, [imageProperties, getImageDimensions]);

  // Automatically set showPage to true once all pages are loaded.
  useEffect(() => {
    if (
      !showPage &&
      allPages &&
      allPages.length > 0 &&
      allPages.every(page => page.status === 1)
    ) {
      setShowPage(true);
    }
  }, [allPages, showPage]);

  // Load the current image when showPage is true.
  useEffect(() => {
    if (!showPage) return;
    if (!currentPage || (pageNumber === lastRendered && !shouldForceRender)) return;

    const loadCurrentImage = () => {
      const imageUrl = currentPage.fullSizeUrl;
      const image = new Image();
      imgRef.current = image;

      image.onload = () => {
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

          if (isInitialLoad) {
            setIsInitialLoad(false);
            // Calculate available space using viewer container dimensions.
            const topMenuHeight = 0;
            const thumbnailsWidth = 0;
            const container = viewerContainerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              let availableWidth = rect.width - thumbnailsWidth;
              let availableHeight = rect.height - topMenuHeight;
              if (isCompareMode) {
                availableWidth = availableWidth / 2;
              }
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
                newZoom
              });
              setTimeout(() => {
                setZoom(newZoom);
              }, 0);
            }
          }

          if (thumbnailsContainerRef.current) {
            const anchor = document.getElementById(`thumbnail-anchor-${pageNumber}`);
            if (anchor) {
              thumbnailsContainerRef.current.scrollTop =
                anchor.offsetTop - thumbnailsContainerRef.current.offsetTop;
              logger.info('Scrolled to current page', { pageNumber, offsetTop: anchor.offsetTop });
            } else {
              logger.warn('Anchor not found', { pageNumber });
            }
          }
        }, 0);
      };

      image.onerror = () => {
        logger.error(`Failed to load image for page ${pageNumber}`);
      };
      image.src = imageUrl;
    };

    loadCurrentImage();
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
    getImageDimensions
  ]);

  // Redraw the canvas when zoom or image properties change.
  useEffect(() => {
    if (isCanvasEnabled && showPage) {
      drawImageOnCanvas(imgRef.current);
    }
  }, [zoom, imageProperties, drawImageOnCanvas, isCanvasEnabled, showPage]);

  useEffect(() => {
    if (forceRender) {
      setShouldForceRender(true);
    }
  }, [forceRender]);

  const imperativeHandle = useMemo(() => ({
    updateImageSourceAndFit() {
      const imageUrl = currentPage.fullSizeUrl;
      if (imgRef.current) {
        imgRef.current.src = imageUrl;
        if (isCanvasEnabled) drawImageOnCanvas(imgRef.current);
      }
    },
    getActiveCanvas() {
      return isCanvasEnabled ? canvasRef.current : imgRef.current;
    },
    fitToScreen() {
      if (imgRef.current?.complete) {
        calculateFitToScreenZoom(imgRef.current, viewerContainerRef, setZoom, isCompareMode);
      }
    },
    fitToWidth() {
      if (imgRef.current?.complete) {
        calculateFitToWidthZoom(imgRef.current, viewerContainerRef, setZoom, isCompareMode);
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
  }), [currentPage, isCanvasEnabled, drawImageOnCanvas, viewerContainerRef, setZoom, isCompareMode]);

  React.useImperativeHandle(ref, () => imperativeHandle, [imperativeHandle]);

  // While showPage is false, display a centered loading indicator.
  if (!showPage) {
    return (
      <div className="document-render-container" style={{
        height: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div className="loading-progress" style={{ fontSize: '1.5rem' }}>
          Loading pages… Please wait.
        </div>
      </div>
    );
  }

  return (
    <div className="document-render-container" style={{ height: '100%', position: 'relative' }}>
      {currentPage && currentPage.status === 1 ? (
        isCanvasEnabled ? (
          <CanvasRenderer
            ref={canvasRef}
            naturalWidth={imgRef.current?.naturalWidth || (currentPage.realWidth || 0)}
            naturalHeight={imgRef.current?.naturalHeight || (currentPage.realHeight || 0)}
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
