// File: src/components/DocumentViewer/DocumentViewerThumbnails.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewerThumbnails.jsx
 *
 * OpenDocViewer — Document Viewer Thumbnails (Wrapper)
 *
 * PURPOSE
 *   Thin, typed wrapper that wires the viewer’s thumbnail-related props to the
 *   generic <DocumentThumbnailList />. Keeping this as a separate component
 *   lets the parent viewer keep concerns clean and focused.
 *
 * ACCESSIBILITY
 *   - All ARIA roles/labels and keyboard interaction live inside
 *     <DocumentThumbnailList />; this wrapper is purely a pass-through.
 *
 * PERFORMANCE
 *   - Wrapped in React.memo to avoid unnecessary re-renders when inputs are stable.
 */
import React from 'react';
import PropTypes from 'prop-types';
import DocumentThumbnailList from '../DocumentThumbnailList.jsx';

/**
 * Renders the document thumbnail list for navigation.
 *
 * @param {Object} props
 * @param {Array.<{ thumbnailUrl: string, status: number }>} props.allPages
 *        Array of page entries with thumbnail URL and load status.
 * @param {number} props.pageNumber
 *        Current 1-based page number (selected thumbnail).
 * @param {function(number): void} props.setPageNumber
 *        Setter to change the current page number.
 * @param {Object} props.thumbnailsContainerRef
 *        Ref to the scrollable thumbnails container element.
 * @param {number} props.width
 *        Pixel width to apply to the thumbnails pane.
 * @param {function(number): void} [props.selectForCompare]
 *        Handler to select a page for the right-hand compare pane (SHIFT-click).
 * @returns {React.ReactElement}
 */
const DocumentViewerThumbnails = ({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
  selectForCompare,
}) => {
  return (
    <DocumentThumbnailList
      allPages={allPages}
      pageNumber={pageNumber}
      setPageNumber={setPageNumber}
      thumbnailsContainerRef={thumbnailsContainerRef}
      width={width}
      selectForCompare={selectForCompare}
    />
  );
};

DocumentViewerThumbnails.propTypes = {
  allPages: PropTypes.arrayOf(
    PropTypes.shape({
      thumbnailUrl: PropTypes.string.isRequired,
      status: PropTypes.number.isRequired, // 0=loading, 1=ready, -1=failed
    })
  ).isRequired,
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  thumbnailsContainerRef: PropTypes.shape({
    current: PropTypes.any, // HTMLElement|null (loosened for SSR)
  }).isRequired,
  width: PropTypes.number.isRequired,
  selectForCompare: PropTypes.func, // optional
};

export default React.memo(DocumentViewerThumbnails);
