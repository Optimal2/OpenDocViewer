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
 * Renders the document page with the provided properties and controls.
 *
 * @param {Object} props - Component props.
 * @param {number} props.pageNumber - The current page number.
 * @param {number} props.zoom - The current zoom level.
 * @param {function} props.initialRenderDone - Callback for initial render done.
 * @param {function} props.onRender - Callback for render.
 * @param {Object} props.viewerContainerRef - Reference to the viewer container.
 * @param {function} props.setZoom - Function to set the zoom level.
 * @param {function} props.setPageNumber - Function to set the page number.
 * @param {boolean} props.isCompareMode - Flag indicating compare mode.
 * @param {Object} props.imageProperties - Image properties (brightness, contrast, rotation).
 * @param {boolean} props.isCanvasEnabled - Flag indicating if canvas rendering is enabled.
 * @param {boolean} props.forceRender - Flag to force rendering.
 * @param {Array} props.allPages - Array of all pages.
 * @param {Object} props.thumbnailsContainerRef - Reference to the thumbnails container.
 * @param {Object} ref - Reference object.
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
  const [previousStatus, setPreviousStatus] = useState(getCurrentPage(allPages, pageNumber)?.status);
  const [shouldForceRender, setShouldForceRender] = useState(forceRender);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const currentPage = useMemo(() => getCurrentPage(allPages, pageNumber), [allPages, pageNumber]);

  /**
   * Draws the image on the canvas with the specified properties.
   *
   * @param {HTMLImageElement} image - The image element to draw.
   */
  const drawImageOnCanvas = useCallback((image) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !image || !context) return;

    const { width, height } = image;
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
  }, [imageProperties]);

  useEffect(() => {
    if (!currentPage || (pageNumber === lastRendered && !shouldForceRender)) return;

    const loadCurrentImage = () => {
      const imageUrl = currentPage.fullSizeUrl;
      const image = new Image();
      imgRef.current = image;

      image.onload = () => {
        if (isCanvasEnabled) drawImageOnCanvas(image);
        if (!initialRenderRef.current) {
          initialRenderDone();
          initialRenderRef.current = true;
        }
        onRender();
        setLastRendered(pageNumber);
        setShouldForceRender(false);

        if (isInitialLoad) {
          setIsInitialLoad(false);
          calculateFitToScreenZoom(image, viewerContainerRef, setZoom, isCompareMode);
        }

        if (thumbnailsContainerRef.current) {
          const anchor = document.getElementById(`thumbnail-anchor-${pageNumber}`);
          if (anchor) {
            thumbnailsContainerRef.current.scrollTop = anchor.offsetTop - thumbnailsContainerRef.current.offsetTop;
            logger.info('DocumentRender: Scrolled to current page', { pageNumber, offsetTop: anchor.offsetTop });
          } else {
            logger.warn('DocumentRender: Anchor not found', { pageNumber });
          }
        }
      };
      image.onerror = () => {
        logger.error(`Failed to load image for page ${pageNumber}`);
      };
      image.src = imageUrl;
    };

    loadCurrentImage();
  }, [currentPage, pageNumber, initialRenderDone, onRender, lastRendered, drawImageOnCanvas, isCanvasEnabled, setZoom, shouldForceRender, isInitialLoad, viewerContainerRef, isCompareMode, thumbnailsContainerRef]);

  useEffect(() => {
    if (currentPage?.status !== previousStatus && currentPage?.status === 1) {
      setPreviousStatus(currentPage.status);
      setTimeout(() => setPageNumber(pageNumber), 0);
    }
  }, [currentPage?.status, previousStatus, setPageNumber, pageNumber]);

  useEffect(() => {
    if (isCanvasEnabled) {
      drawImageOnCanvas(imgRef.current);
    }
  }, [zoom, imageProperties, drawImageOnCanvas, isCanvasEnabled]);

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

  return (
    <div className="document-render-container" style={{ height: '100%', position: 'relative' }}>
      {currentPage && currentPage.status === 1 ? (
        isCanvasEnabled ? (
          <CanvasRenderer
            ref={canvasRef}
            naturalWidth={imgRef.current?.naturalWidth || 0}
            naturalHeight={imgRef.current?.naturalHeight || 0}
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
