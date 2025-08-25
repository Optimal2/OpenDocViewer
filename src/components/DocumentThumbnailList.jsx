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
 *
 * PERFORMANCE
 *   - Wrapped in React.memo to avoid unnecessary re-renders when props are stable.
 *   - Keeps scroll position in a ref (no state churn).
 *
 * LOGGING
 *   - Logs user thumbnail clicks at `info` level with the target page number.
 *
 * IMPORTANT PROJECT NOTE (gotcha for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With `file-type` v21 the '/browser' subpath is not exported
 *     for bundlers and will break Vite builds. See README “Design notes & gotchas”.
 *
 * Provenance / previous baseline for this component: :contentReference[oaicite:0]{index=0}
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import logger from '../LogController';
import LoadingSpinner from './LoadingSpinner';

/**
 * @typedef {Object} PageItem
 * @property {string} thumbnailUrl  - URL for the page thumbnail image (when loaded).
 * @property {number} status        - Load status (0=loading, 1=ready, -1=failed).
 */

/**
 * DocumentThumbnailList component.
 *
 * @param {Object} props
 * @param {Array.<PageItem>} props.allPages
 * @param {number} props.pageNumber
 * @param {SetPageNumber} props.setPageNumber
 * @param {{ current: (HTMLElement|null) }} props.thumbnailsContainerRef
 * @param {number} props.width
 * @returns {React.ReactElement}
 */
const DocumentThumbnailList = React.memo(function DocumentThumbnailList({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
}) {
  const scrollPosition = useRef(0);

  /** Selected option id for aria-activedescendant (only valid when in range). */
  const activeDescendantId = useMemo(() => {
    const inRange = Number.isFinite(pageNumber) && pageNumber >= 1 && pageNumber <= allPages.length;
    return inRange ? `thumbnail-${pageNumber}` : undefined;
  }, [pageNumber, allPages.length]);

  /**
   * Handle a thumbnail activation (click or key).
   * Uses a stable callback so children don't re-render unnecessarily.
   * @param {number} pageNum
   * @returns {void}
   */
  const handleActivate = useCallback(
    (pageNum) => {
      try {
        setPageNumber(pageNum);
        logger.info('Thumbnail activated', { pageNum });
      } catch (error) {
        logger.error('Failed to set page from thumbnail', { error: String(error?.message || error), pageNum });
      }
    },
    [setPageNumber]
  );

  /** Remember scroll position on container scroll. */
  const handleScroll = useCallback(() => {
    const el = thumbnailsContainerRef?.current;
    if (el) scrollPosition.current = el.scrollTop;
  }, [thumbnailsContainerRef]);

  /** Restore scroll position when the container ref changes or on mount. */
  useEffect(() => {
    const el = thumbnailsContainerRef?.current;
    if (el) el.scrollTop = scrollPosition.current;
  }, [thumbnailsContainerRef]);

  /** Attach/detach a passive scroll handler (imperative for perf/compat). */
  useEffect(() => {
    const el = thumbnailsContainerRef?.current;
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
      style={{ width: `${Number(width) || 0}px` }}
    >
      <div className="thumbnails-list">
        {allPages.map((page, index) => {
          const itemIndex = index + 1;
          const isSelected = pageNumber === itemIndex;
          const optionId = `thumbnail-${itemIndex}`;
          const { thumbnailUrl, status } = page;

          /** Keyboard: activate on Enter/Space; keep focus on the option. */
          const onKeyDown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleActivate(itemIndex);
            }
          };

          return (
            <div
              id={optionId}
              key={optionId}
              className={`thumbnail-wrapper ${isSelected ? 'selected' : ''}`}
              onClick={() => handleActivate(itemIndex)}
              onKeyDown={onKeyDown}
              role="option"
              tabIndex={isSelected ? 0 : -1}
              aria-label={`Go to page ${itemIndex}`}
              aria-selected={isSelected}
              title={`Go to page ${itemIndex}`}
            >
              <div id={`thumbnail-anchor-${itemIndex}`} className="thumbnail-anchor" />
              <div className="thumbnail-number">{itemIndex}</div>
              <div className="thumbnail-image">
                {status === 0 && <LoadingSpinner />}
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
    current: PropTypes.any, // HTMLElement|null (loosened to avoid SSR PropTypes issues)
  }).isRequired,
  width: PropTypes.number.isRequired,
};

export default DocumentThumbnailList;
