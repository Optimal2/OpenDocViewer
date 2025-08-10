// File: src/components/DocumentViewer/DocumentViewerThumbnails.js

import React from 'react';
import DocumentThumbnailList from '../DocumentThumbnailList';

/**
 * Renders the list of document thumbnails.
 *
 * @param {Object} props - Component props
 * @param {Array} props.allPages - List of all pages in the document
 * @param {number} props.pageNumber - Current page number
 * @param {Function} props.setPageNumber - Function to set the page number
 * @param {Object} props.thumbnailsContainerRef - Ref to the thumbnails container
 * @param {number} props.width - Width of the thumbnails container
 *
 * @returns {React.Element} - The rendered component
 */
const DocumentViewerThumbnails = ({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
}) => (
  <DocumentThumbnailList
    allPages={allPages}
    pageNumber={pageNumber}
    setPageNumber={setPageNumber}
    thumbnailsContainerRef={thumbnailsContainerRef}
    width={width}
  />
);

export default DocumentViewerThumbnails;
