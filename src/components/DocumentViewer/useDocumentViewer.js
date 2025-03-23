import { useState, useRef, useEffect, useCallback, useContext } from 'react';
import logger from '../../LogController';
import { ViewerContext } from '../../ViewerContext';

/**
 * Custom hook for managing the document viewer state and behavior.
 *
 * @returns {Object} - State and handlers for the document viewer.
 */
export const useDocumentViewer = () => {
  const { allPages } = useContext(ViewerContext);
  const [pageNumber, setPageNumberState] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumber, setComparePageNumber] = useState(null);
  const [imageProperties, setImageProperties] = useState({
    rotation: 0,
    brightness: 100,
    contrast: 100,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [thumbnailWidth, setThumbnailWidth] = useState(200);
  const viewerContainerRef = useRef(null);
  const thumbnailsContainerRef = useRef(null);
  const documentRenderRef = useRef(null);
  const compareRef = useRef(null);
  const hasInitialRender = useRef(false);

  const setPageNumber = useCallback((newPageNumber, fromThumbnail = false) => {
    setPageNumberState(newPageNumber);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      switch (event.key) {
        case 'PageUp':
          setPageNumber((prev) => Math.max(prev - 1, 1));
          break;
        case 'PageDown':
          setPageNumber((prev) => Math.min(prev + 1, allPages.length));
          break;
        case 'Home':
          setPageNumber(1);
          break;
        case 'End':
          setPageNumber(allPages.length);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [allPages.length, setPageNumber]);

  useEffect(() => {
    if (allPages.length > 0 && !hasInitialRender.current) {
      logger.info('DocumentViewer initial render done');
      if (viewerContainerRef.current) {
        viewerContainerRef.current.dispatchEvent(new Event('fitToScreen'));
      }
      hasInitialRender.current = true;
    }
  }, [allPages]);

  const handlePageNumberChange = useCallback((newPageNumber, fromThumbnail = false) => {
    if (newPageNumber !== pageNumber) {
      setPageNumber(newPageNumber, fromThumbnail);
      if (viewerContainerRef.current) {
        documentRenderRef.current?.fitToScreen();
      }
    }
  }, [pageNumber, setPageNumber]);

  const zoomIn = useCallback(() => {
    documentRenderRef.current?.zoomIn();
  }, []);

  const zoomOut = useCallback(() => {
    documentRenderRef.current?.zoomOut();
  }, []);

  const fitToScreen = useCallback(() => {
    documentRenderRef.current?.fitToScreen();
  }, []);

  const fitToWidth = useCallback(() => {
    documentRenderRef.current?.fitToWidth();
  }, []);

  const handleContainerClick = useCallback(() => {
    if (viewerContainerRef.current) {
      viewerContainerRef.current.focus();
    }
  }, []);

  const handleCompare = useCallback(() => {
    if (!isComparing) {
      setComparePageNumber(pageNumber);
    }
    setIsComparing((prev) => !prev);
  }, [isComparing, pageNumber]);

  const handleRotationChange = useCallback((angle) => {
    setImageProperties((prevProps) => ({
      ...prevProps,
      rotation: (prevProps.rotation + angle + 360) % 360,
    }));
  }, []);

  const handleBrightnessChange = useCallback((event) => {
    setImageProperties((prevProps) => ({
      ...prevProps,
      brightness: event.target.value,
    }));
  }, []);

  const handleContrastChange = useCallback((event) => {
    setImageProperties((prevProps) => ({
      ...prevProps,
      contrast: event.target.value,
    }));
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({
      rotation: 0,
      brightness: 100,
      contrast: 100,
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    const startX = e.clientX;
    const startWidth = thumbnailWidth;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(30, Math.min(1200, startWidth + e.clientX - startX));
      setThumbnailWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [thumbnailWidth]);

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
