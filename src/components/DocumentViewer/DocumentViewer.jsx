// File: src/components/DocumentViewer/DocumentViewer.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewer.jsx
 *
 * OpenDocViewer — Document Viewer (Container)
 *
 * PURPOSE
 *   Tie together:
 *     • Toolbar (actions, zoom, adjustments)
 *     • Thumbnails (navigation)
 *     • Main renderer (canvas/img)
 *   This component wires ViewerContext state into the viewer UI and delegates
 *   heavy logic to the dedicated hook `useDocumentViewer`.
 *
 * ACCESSIBILITY
 *   - The scrollable viewer container is focusable (tabIndex=0) so that
 *     keyboard navigation (PageUp/PageDown/Arrows, Home/End) works when the user focuses it.
 *
 * @returns {React.ReactElement}
 */
import React, { useContext } from 'react';
import DocumentViewerToolbar from './DocumentViewerToolbar.jsx';
import DocumentViewerThumbnails from './DocumentViewerThumbnails.jsx';
import DocumentViewerRender from './DocumentViewerRender.jsx';
import Resizer from '../Resizer.jsx';
import logger from '../../LogController.js';
import { ViewerContext } from '../../ViewerContext.jsx';
import { useDocumentViewer } from './useDocumentViewer.js';

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
    selectForCompare,
    setIsExpanded,
  } = useDocumentViewer();

  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const prevPageDisabled = pageNumber <= 1;
  const nextPageDisabled = pageNumber >= totalPages;
  const firstPageDisabled = pageNumber <= 1;
  const lastPageDisabled = pageNumber >= totalPages;

  logger.debug('Rendering DocumentViewer', { totalPages });

  return (
    <div
      className="document-viewer-container"
      onClick={handleContainerClick}
      role="region"
      aria-label="Document viewer container"
    >
      <DocumentViewerToolbar
        /* page + totals */
        pageNumber={pageNumber}
        setPageNumber={setPageNumber}
        totalPages={totalPages}
        allPages={allPages}

        /* zoom controls */
        zoom={zoom}
        setZoom={setZoom}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}

        /* compare + editing */
        isComparing={isComparing}
        handleCompare={handleCompare}
        handleRotationChange={handleRotationChange}
        handleBrightnessChange={handleBrightnessChange}
        handleContrastChange={handleContrastChange}
        resetImageProperties={resetImageProperties}
        imageProperties={imageProperties}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        documentRenderRef={documentRenderRef}

        /* nav button disabled states */
        prevPageDisabled={prevPageDisabled}
        nextPageDisabled={nextPageDisabled}
        firstPageDisabled={firstPageDisabled}
        lastPageDisabled={lastPageDisabled}
      />

      {/* Main area: thumbnails + resizer + page renderer(s) */}
      <div
        className="document-viewer-wrapper"
        ref={viewerContainerRef}
        id="viewerContainer"
        tabIndex={0}
        aria-label="Document viewer"
      >
        {/* Sidebar: thumbnails with resizer */}
        <div style={{ display: 'flex', width: `${thumbnailWidth}px`, flexShrink: 0 }}>
          <DocumentViewerThumbnails
            allPages={allPages}
            pageNumber={pageNumber}
            setPageNumber={(newPageNumber) => handlePageNumberChange(newPageNumber, true)}
            thumbnailsContainerRef={thumbnailsContainerRef}
            width={thumbnailWidth}
            selectForCompare={selectForCompare}
          />
          <Resizer onMouseDown={handleMouseDown} />
        </div>

        {/* Main renderer(s) */}
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

export default React.memo(DocumentViewer);
