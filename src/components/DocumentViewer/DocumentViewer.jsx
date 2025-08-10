// File: src/components/DocumentViewer/DocumentViewer.js

import React, { useContext } from 'react';
import DocumentViewerToolbar from './DocumentViewerToolbar';
import DocumentViewerThumbnails from './DocumentViewerThumbnails';
import DocumentViewerRender from './DocumentViewerRender';
import Resizer from '../Resizer';
import logger from '../../LogController';
import { ViewerContext } from '../../ViewerContext';
import { useDocumentViewer } from './useDocumentViewer';

const DocumentViewer = () => {
  const { allPages } = useContext(ViewerContext);

  const {
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
  } = useDocumentViewer({  });

  const totalPages = allPages.length;
  const prevPageDisabled = pageNumber <= 1;
  const nextPageDisabled = pageNumber >= totalPages;
  const firstPageDisabled = pageNumber <= 1;
  const lastPageDisabled = pageNumber >= totalPages;

  logger.debug('Rendering DocumentViewer', { totalPages });

  return (
    <div className="document-viewer-container" onClick={handleContainerClick}>
      <DocumentViewerToolbar
        pages={allPages}
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
      <div className="document-viewer-wrapper" ref={viewerContainerRef} id="viewerContainer" tabIndex="0">
        <div style={{ display: 'flex', width: `${thumbnailWidth}px`, flexShrink: 0 }}>
          <DocumentViewerThumbnails
            allPages={allPages}
            pageNumber={pageNumber}
            setPageNumber={(newPageNumber) => handlePageNumberChange(newPageNumber, true)}
            thumbnailsContainerRef={thumbnailsContainerRef}
            width={thumbnailWidth}
          />
          <Resizer onMouseDown={handleMouseDown} />
        </div>
        <DocumentViewerRender
          pageNumber={pageNumber}
          zoom={zoom}
          viewerContainerRef={viewerContainerRef}
          setZoom={setZoom}
          setPageNumber={setPageNumber}
          isComparing={isComparing}
          imageProperties={imageProperties}
          isExpanded={isExpanded}
          documentRenderRef={documentRenderRef}
          comparePageNumber={comparePageNumber}
          compareRef={compareRef}
          allPages={allPages}
          thumbnailsContainerRef={thumbnailsContainerRef}
        />
      </div>
    </div>
  );
};

export default DocumentViewer;
