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
 *     keyboard navigation (PageUp/PageDown/Home/End) works immediately after click.
 *
 * PERFORMANCE
 *   - Minimizes logs in the hot path (debug-level only).
 *   - Defers image/canvas work to child components.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the project we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With `file-type` v21 that subpath is not exported and will
 *     break Vite builds. See README “Design notes & gotchas” for details.
 *
 * Provenance (baseline prior to this revision): :contentReference[oaicite:0]{index=0}
 */

import React, { useContext } from 'react';
import DocumentViewerToolbar from './DocumentViewerToolbar.jsx';
import DocumentViewerThumbnails from './DocumentViewerThumbnails.jsx';
import DocumentViewerRender from './DocumentViewerRender.jsx';
import Resizer from '../Resizer.jsx';
import logger from '../../LogController.js';
import { ViewerContext } from '../../ViewerContext.jsx';
import { useDocumentViewer } from './useDocumentViewer.js';

/**
 * Top-level viewer container.
 * Pulls data from ViewerContext and composes the toolbar, thumbnails, and renderer.
 *
 * @returns {JSX.Element}
 */
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
  } = useDocumentViewer(); // no args; hook owns its own state and pulls totals from context

  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const prevPageDisabled = pageNumber <= 1;
  const nextPageDisabled = pageNumber >= totalPages;
  const firstPageDisabled = pageNumber <= 1;
  const lastPageDisabled = pageNumber >= totalPages;

  logger.debug('Rendering DocumentViewer', { totalPages });

  return (
    <div className="document-viewer-container" onClick={handleContainerClick}>
      {/* Toolbar with navigation and image adjustment controls */}
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
          />
          <Resizer onMouseDown={handleMouseDown} />
        </div>

        {/* Main/compare rendering */}
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
