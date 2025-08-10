// File: src/components/DocumentViewer/DocumentViewerToolbar.js

import React from 'react';
import DocumentToolbar from '../DocumentToolbar/DocumentToolbar';

/**
 * Renders the toolbar for the document viewer.
 *
 * @param {Object} props - Component props
 * @param {Array} props.pages - List of all pages in the document
 * @param {number} props.pageNumber - Current page number
 * @param {number} props.totalPages - Total number of pages
 * @param {Function} props.setPageNumber - Function to set the page number
 * @param {Function} props.zoomIn - Function to zoom in
 * @param {Function} props.zoomOut - Function to zoom out
 * @param {Function} props.fitToScreen - Function to fit the document to the screen
 * @param {Function} props.fitToWidth - Function to fit the document to the width
 * @param {Function} props.setZoom - Function to set the zoom level
 * @param {Object} props.viewerContainerRef - Ref to the viewer container
 * @param {Function} props.handleCompare - Function to handle comparison mode
 * @param {boolean} props.isComparing - Whether comparison mode is enabled
 * @param {Object} props.imageProperties - Image properties (e.g., brightness, contrast)
 * @param {Function} props.handleRotationChange - Function to handle rotation changes
 * @param {Function} props.handleBrightnessChange - Function to handle brightness changes
 * @param {Function} props.handleContrastChange - Function to handle contrast changes
 * @param {Function} props.resetImageProperties - Function to reset image properties
 * @param {Object} props.documentRenderRef - Ref to the document render component
 * @param {boolean} props.isExpanded - Whether the document viewer is expanded
 * @param {Function} props.setIsExpanded - Function to set the expanded state
 * @param {boolean} props.prevPageDisabled - Whether the previous page button is disabled
 * @param {boolean} props.nextPageDisabled - Whether the next page button is disabled
 * @param {boolean} props.firstPageDisabled - Whether the first page button is disabled
 * @param {boolean} props.lastPageDisabled - Whether the last page button is disabled
 *
 * @returns {React.Element} - The rendered component
 */
const DocumentViewerToolbar = ({
  pages,
  pageNumber,
  totalPages,
  setPageNumber,
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  setZoom,
  viewerContainerRef,
  handleCompare,
  isComparing,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  documentRenderRef,
  isExpanded,
  setIsExpanded,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
}) => (
  <DocumentToolbar
    pages={pages}
    pageNumber={pageNumber}
    totalPages={totalPages}
    setPageNumber={setPageNumber}
    zoomIn={zoomIn}
    zoomOut={zoomOut}
    fitToScreen={fitToScreen}
    fitToWidth={fitToWidth}
    setZoom={setZoom}
    viewerContainerRef={viewerContainerRef}
    handleCompare={handleCompare}
    isComparing={isComparing}
    imageProperties={imageProperties}
    handleRotationChange={handleRotationChange}
    handleBrightnessChange={handleBrightnessChange}
    handleContrastChange={handleContrastChange}
    resetImageProperties={resetImageProperties}
    documentRenderRef={documentRenderRef}
    isExpanded={isExpanded}
    setIsExpanded={setIsExpanded}
    prevPageDisabled={prevPageDisabled}
    nextPageDisabled={nextPageDisabled}
    firstPageDisabled={firstPageDisabled}
    lastPageDisabled={lastPageDisabled}
  />
);

export default DocumentViewerToolbar;
