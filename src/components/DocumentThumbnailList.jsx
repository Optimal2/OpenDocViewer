// File: src/components/DocumentThumbnailList.js

import React, { useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import logger from '../LogController';
import LoadingSpinner from './LoadingSpinner';

/**
 * DocumentThumbnailList component.
 * Renders a list of document thumbnails.
 *
 * @param {Object} props - Component props.
 * @param {Array} props.allPages - Array of all pages.
 * @param {number} props.pageNumber - Current page number.
 * @param {function} props.setPageNumber - Function to set the page number.
 * @param {Object} props.thumbnailsContainerRef - Reference to the thumbnails container.
 * @param {number} props.width - Width of the thumbnails container.
 */
const DocumentThumbnailList = React.memo(({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
}) => {
  const scrollPosition = useRef(0);

  /**
   * Handles thumbnail click to set the current page number.
   *
   * @param {number} pageNum - The page number to set.
   */
  const handleThumbnailClick = useCallback((pageNum) => {
    setPageNumber(pageNum);
    logger.info('Thumbnail clicked', { pageNum });
  }, [setPageNumber]);

  /**
   * Handles scroll event to save the current scroll position.
   */
  const handleScroll = useCallback(() => {
    if (thumbnailsContainerRef.current) {
      scrollPosition.current = thumbnailsContainerRef.current.scrollTop;
    }
  }, [thumbnailsContainerRef]);

  useEffect(() => {
    if (thumbnailsContainerRef.current) {
      thumbnailsContainerRef.current.scrollTop = scrollPosition.current;
    }
  }, [thumbnailsContainerRef]);

  useEffect(() => {
    const currentRef = thumbnailsContainerRef.current;
    if (currentRef) {
      currentRef.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (currentRef) {
        currentRef.removeEventListener('scroll', handleScroll);
      }
    };
  }, [thumbnailsContainerRef, handleScroll]);

  return (
    <div
      className="thumbnails-container"
      ref={thumbnailsContainerRef}
      role="listbox"
      aria-label="Document Thumbnails"
      style={{ width: `${width}px` }}
    >
      <div className="thumbnails-list">
        {allPages.map((page, index) => {
          const { thumbnailUrl, status } = page;

          return (
            <div
              id={`thumbnail-${index + 1}`}
              key={`${index + 1}`}
              className={`thumbnail-wrapper ${pageNumber === index + 1 ? 'selected' : ''}`}
              onClick={() => handleThumbnailClick(index + 1)}
              role="option"
              tabIndex={0}
              onKeyPress={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleThumbnailClick(index + 1);
                }
              }}
              aria-label={`Go to page ${index + 1}`}
              aria-selected={pageNumber === index + 1}
              title={`Go to page ${index + 1}`}
            >
              <div id={`thumbnail-anchor-${index + 1}`} className="thumbnail-anchor"></div>
              <div className="thumbnail-number">{index + 1}</div>
              <div className="thumbnail-image">
                {status === 0 && <LoadingSpinner />}
                {status === -1 && <img src="lost.png" alt="Page not found" className="thumbnail" />}
                {status === 1 && <img src={thumbnailUrl} alt={`Page ${index + 1}`} className="thumbnail" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

DocumentThumbnailList.displayName = 'DocumentThumbnailList';

DocumentThumbnailList.propTypes = {
  allPages: PropTypes.arrayOf(
    PropTypes.shape({
      thumbnailUrl: PropTypes.string.isRequired,
      status: PropTypes.number.isRequired,
    })
  ).isRequired,
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  thumbnailsContainerRef: PropTypes.shape({
    current: PropTypes.oneOfType([
      PropTypes.instanceOf(Element),
      PropTypes.object,
    ]),
  }).isRequired,
  width: PropTypes.number.isRequired,
};

export default DocumentThumbnailList;
