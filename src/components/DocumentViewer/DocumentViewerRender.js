// File: src/components/DocumentViewer/DocumentViewerRender.js

import React from 'react';
import DocumentRender from '../DocumentRender';

/**
 * Renders the main document view, including optional comparison view.
 *
 * @param {Object} props - Component props
 * @param {number} props.pageNumber - Current page number to display
 * @param {number} props.zoom - Current zoom level
 * @param {Object} props.viewerContainerRef - Ref to the viewer container
 * @param {Function} props.setZoom - Function to set the zoom level
 * @param {Function} props.setPageNumber - Function to set the page number
 * @param {boolean} props.isComparing - Flag to indicate if comparing mode is enabled
 * @param {Object} props.imageProperties - Image properties for rendering
 * @param {boolean} props.isExpanded - Flag to indicate if the view is expanded
 * @param {Object} props.documentRenderRef - Ref to the document render component
 * @param {number|null} props.comparePageNumber - Page number to compare, if any
 * @param {Object} props.compareRef - Ref to the compare document render component
 * @param {Array} props.allPages - List of all pages in the document
 * @param {Object} props.thumbnailsContainerRef - Ref to the thumbnails container
 *
 * @returns {React.Element} - The rendered component
 */
const DocumentViewerRender = ({
  pageNumber,
  zoom,
  viewerContainerRef,
  setZoom,
  setPageNumber,
  isComparing,
  imageProperties,
  isExpanded,
  documentRenderRef,
  comparePageNumber,
  compareRef,
  allPages,
  thumbnailsContainerRef,
}) => (
  <div className="viewer-section" style={{ display: 'flex', padding: '15px' }}>
    <div className={isComparing ? 'document-render-container-comparison' : 'document-render-container-single'}>
      <DocumentRender
        ref={documentRenderRef}
        pageNumber={pageNumber}
        zoom={zoom}
        initialRenderDone={() => {}}
        viewerContainerRef={viewerContainerRef}
        setZoom={setZoom}
        setPageNumber={setPageNumber}
        isCompareMode={isComparing}
        imageProperties={imageProperties}
        isCanvasEnabled={isExpanded}
        allPages={allPages}
        thumbnailsContainerRef={thumbnailsContainerRef}
      />
    </div>
    {isComparing && comparePageNumber !== null && (
      <div className="document-render-container-comparison">
        <DocumentRender
          ref={compareRef}
          pageNumber={comparePageNumber}
          zoom={zoom}
          initialRenderDone={() => {}}
          viewerContainerRef={viewerContainerRef}
          setZoom={setZoom}
          setPageNumber={setPageNumber}
          isCompareMode={true}
          imageProperties={imageProperties}
          isCanvasEnabled={isExpanded}
          allPages={allPages}
          thumbnailsContainerRef={thumbnailsContainerRef}
        />
      </div>
    )}
  </div>
);

export default DocumentViewerRender;
