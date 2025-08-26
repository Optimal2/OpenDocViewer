// File: src/components/DocumentThumbnailList.jsx
/**
 * File: src/components/DocumentThumbnailList.jsx
 *
 * OpenDocViewer — Document Thumbnail List
 *
 * PURPOSE
 *   Render a scrollable, accessible list of page thumbnails that allows users to
 *   jump to a specific page via mouse or keyboard. The component remembers its
 *   scroll position across re-renders for a stable UX.
 *
 * ACCESSIBILITY
 *   - Uses a listbox/option pattern so the currently selected page can be announced.
 *   - The container exposes `aria-activedescendant` pointing at the selected option.
 *   - Each thumbnail is keyboard-activatable via Enter/Space.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import logger from '../LogController.js';

/**
 * @param {Object} props
 * @param {Array.<{ thumbnailUrl: string, status: number }>} props.allPages
 * @param {number} props.pageNumber
 * @param {function(number): void} props.setPageNumber
 * @param {{ current: (HTMLElement|null) }} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {function(number): void} [props.selectForCompare]  Optional SHIFT-click handler
 * @returns {React.ReactElement}
 */
const DocumentThumbnailList = React.memo(function DocumentThumbnailList({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
  selectForCompare,
}) {
  const scrollPosition = useRef(0);

  /** Selected option id for aria-activedescendant (only valid when in range). */
  const activeDescendantId = useMemo(() => {
    const inRange = Number.isFinite(pageNumber) && pageNumber >= 1 && pageNumber <= allPages.length;
    return inRange ? `thumbnail-${pageNumber}` : undefined;
  }, [pageNumber, allPages.length]);

  /**
   * Handle a thumbnail activation from click (supports SHIFT to select for compare).
   * @param {number} pageNum
   * @param {MouseEvent|React.MouseEvent} [evt]
   * @returns {void}
   */
  const handleActivate = useCallback(
    (pageNum, evt) => {
      try {
        const useCompare = !!(evt && evt.shiftKey) && typeof selectForCompare === 'function';
        if (useCompare) {
          // SHIFT-click: select for compare (right pane) without changing the left page.
          evt.preventDefault && evt.preventDefault();
          evt.stopPropagation && evt.stopPropagation();
          selectForCompare(pageNum);
          logger.info('Thumbnail SHIFT-activated for compare', { pageNum });
        } else {
          // Normal click: navigate left pane only.
          setPageNumber(pageNum);
          logger.info('Thumbnail activated', { pageNum });
        }
      } catch (error) {
        logger.error('Failed to handle thumbnail activation', {
          error: String(error && error.message ? error.message : error),
          pageNum,
        });
      }
    },
    [setPageNumber, selectForCompare]
  );

  /** Keyboard activation: Enter/Space to navigate; SHIFT+Enter/Space selects for compare. */
  const handleKeyDown = useCallback(
    (e, pageNum) => {
      const key = e.key || '';
      if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        if (e.shiftKey && typeof selectForCompare === 'function') {
          selectForCompare(pageNum);
          logger.info('Thumbnail SHIFT-key activated for compare', { pageNum });
        } else {
          setPageNumber(pageNum);
          logger.info('Thumbnail key activated', { pageNum });
        }
      }
    },
    [setPageNumber, selectForCompare]
  );

  /** Remember scroll position on container scroll. */
  const handleScroll = useCallback(() => {
    const el = thumbnailsContainerRef && thumbnailsContainerRef.current;
    if (el) scrollPosition.current = el.scrollTop;
  }, [thumbnailsContainerRef]);

  /** Restore scroll position when the container ref changes or on mount. */
  useEffect(() => {
    const el = thumbnailsContainerRef && thumbnailsContainerRef.current;
    if (el) el.scrollTop = scrollPosition.current;
  }, [thumbnailsContainerRef]);

  /** Attach/detach a passive scroll handler (imperative for perf/compat). */
  useEffect(() => {
    const el = thumbnailsContainerRef && thumbnailsContainerRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [thumbnailsContainerRef, handleScroll]);

  return (
    <div
      className="thumbnails-container"
      ref={thumbnailsContainerRef}
      role="listbox"
      aria-label="Document Thumbnails"
      aria-activedescendant={activeDescendantId}
      style={{ width: String(Number(width) || 0) + 'px' }}
    >
      <div className="thumbnails-list">
        {allPages.map((page, index) => {
          const itemIndex = index + 1;
          const isSelected = pageNumber === itemIndex;
          const thumbnailUrl = page && page.thumbnailUrl ? page.thumbnailUrl : '';
          const status = page && typeof page.status === 'number' ? page.status : 0;

          return (
            <div
              key={itemIndex}
              id={`thumbnail-${itemIndex}`}
              className={`thumbnail-wrapper ${isSelected ? 'selected' : ''}`}
              onClick={(e) => handleActivate(itemIndex, e)}
              onKeyDown={(e) => handleKeyDown(e, itemIndex)}
              role="option"
              tabIndex={isSelected ? 0 : -1}
              aria-label={`Go to page ${itemIndex}`}
              aria-selected={isSelected}
              title={`Go to page ${itemIndex}`}
            >
              <div id={`thumbnail-anchor-${itemIndex}`} className="thumbnail-anchor" />
              <div className="thumbnail-number">{itemIndex}</div>
              <div className="thumbnail-image">
                {/* 0=loading, -1=failed, 1=ready */}
                {status === 0 && (typeof LoadingSpinner !== 'undefined' ? <LoadingSpinner /> : <div className="loading-spinner" />)}
                {status === -1 && (
                  <img
                    src="lost.png"
                    alt={`Page ${itemIndex} failed to load`}
                    className="thumbnail"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                )}
                {status === 1 && (
                  <img
                    src={thumbnailUrl}
                    alt={`Page ${itemIndex}`}
                    className="thumbnail"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

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
    current: PropTypes.any, // HTMLElement|null (loosened to avoid SSR PropTypes issues)
  }).isRequired,
  width: PropTypes.number.isRequired,
  selectForCompare: PropTypes.func,
};

export default DocumentThumbnailList;
