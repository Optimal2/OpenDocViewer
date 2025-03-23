// File: src/utils/zoomUtils.js

import logger from '../LogController';

/**
 * Calculates and sets the zoom level to fit the image within the viewer container.
 * @param {HTMLImageElement} image - The image element to be zoomed.
 * @param {React.RefObject} viewerContainerRef - Reference to the viewer container element.
 * @param {function} setZoom - Function to set the zoom level.
 * @param {boolean} isComparing - Flag indicating if the compare mode is enabled.
 */
export const calculateFitToScreenZoom = (image, viewerContainerRef, setZoom, isComparing) => {
  logger.info('Calculating fit to screen zoom', { isComparing });
  const container = viewerContainerRef.current;
  if (!image || !container) {
    logger.warn('Image or viewer container is not available', { imageExists: !!image, viewerContainerExists: !!container });
    return;
  }

  const { naturalWidth, naturalHeight } = image;
  let containerWidth = container.clientWidth - 250;
  const containerHeight = container.clientHeight - 30;

  if (isComparing) {
    containerWidth = (containerWidth / 2) - 30; // Divide the container width by 2 if comparing
  }

  const widthRatio = containerWidth / naturalWidth;
  const heightRatio = containerHeight / naturalHeight;
  const zoom = Math.min(widthRatio, heightRatio);

  setZoom(zoom);
};

/**
 * Calculates and sets the zoom level to fit the image width within the viewer container.
 * @param {HTMLImageElement} image - The image element to be zoomed.
 * @param {React.RefObject} viewerContainerRef - Reference to the viewer container element.
 * @param {function} setZoom - Function to set the zoom level.
 * @param {boolean} isComparing - Flag indicating if the compare mode is enabled.
 */
export const calculateFitToWidthZoom = (image, viewerContainerRef, setZoom, isComparing) => {
  logger.info('Calculating fit to width zoom', { isComparing });
  const container = viewerContainerRef.current;
  if (!image || !container) {
    logger.warn('Image or viewer container is not available', { imageExists: !!image, viewerContainerExists: !!container });
    return;
  }

  const { naturalWidth } = image;
  let containerWidth = container.clientWidth - 250;

  if (isComparing) {
    containerWidth = (containerWidth / 2) - 30; // Divide the container width by 2 if comparing
  }

  const widthRatio = containerWidth / naturalWidth;

  setZoom(widthRatio);
};

/**
 * Increases the zoom level by 10%.
 * @param {function} setZoom - Function to set the zoom level.
 */
export const handleZoomIn = (setZoom) => {
  logger.info('Zooming in');
  setZoom(prevZoom => prevZoom * 1.1);
};

/**
 * Decreases the zoom level by 10%.
 * @param {function} setZoom - Function to set the zoom level.
 */
export const handleZoomOut = (setZoom) => {
  logger.info('Zooming out');
  setZoom(prevZoom => prevZoom / 1.1);
};
