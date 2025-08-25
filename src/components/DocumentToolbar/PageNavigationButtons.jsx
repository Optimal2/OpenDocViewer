// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * File: src/components/DocumentToolbar/PageNavigationButtons.jsx
 *
 * OpenDocViewer — Page Navigation Controls
 *
 * PURPOSE
 *   Stateless group of navigation controls to move between pages and jump to
 *   the first/last page. Supports both single-step clicks and press-and-hold
 *   (continuous) navigation via timers provided by the parent hook.
 *
 * ACCESSIBILITY
 *   - Each control has clear aria-labels and title tooltips.
 *   - Current page info is exposed in a polite live region so AT announces updates.
 *
 * INTERACTION MODEL
 *   - Click → single step (prev/next).
 *   - Press & hold (mouse or touch) → continuous stepping using timers:
 *       • startPrevPageTimer('prev') / stopPrevPageTimer()
 *       • startNextPageTimer('next') / stopNextPageTimer()
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With file-type v21 the '/browser' subpath is not
 *     exported for bundlers and will break the Vite build. See README for details.
 */

/**
 * Direction token for page timers/navigation.
 * Prefer reusing the central typedef if available in jsdoc-types.js.
 * @typedef {'prev'|'next'} PageDirection
 */

/**
 * Start a continuous page-timer in the given direction.
 * @callback StartPageTimer
 * @param {PageDirection} dir
 * @returns {void}
 */

/**
 * Stop a running page-timer.
 * @callback StopPageTimer
 * @returns {void}
 */

import React from 'react';
import PropTypes from 'prop-types';

/**
 * PageNavigationButtons component.
 *
 * @param {Object} props
 * @param {boolean} props.prevPageDisabled
 * @param {boolean} props.nextPageDisabled
 * @param {boolean} props.firstPageDisabled
 * @param {boolean} props.lastPageDisabled
 * @param {StartPageTimer} props.startPrevPageTimer
 * @param {StopPageTimer} props.stopPrevPageTimer
 * @param {StartPageTimer} props.startNextPageTimer
 * @param {StopPageTimer} props.stopNextPageTimer
 * @param {function(): void} props.handleFirstPage
 * @param {function(): void} props.handleLastPage
 * @param {function(): void} props.handlePrevPage
 * @param {function(): void} props.handleNextPage
 * @param {number} props.pageNumber
 * @param {number} props.totalPages
 * @returns {React.ReactElement}
 */
const PageNavigationButtons = ({
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  startPrevPageTimer,
  stopPrevPageTimer,
  startNextPageTimer,
  stopNextPageTimer,
  handleFirstPage,
  handleLastPage,
  handlePrevPage,
  handleNextPage,
  pageNumber,
  totalPages,
}) => {
  // Touch helpers so press-and-hold also works on touch devices without scrolling the page.
  const onTouchStartPrev = (e) => {
    if (!prevPageDisabled) {
      e.preventDefault();
      startPrevPageTimer('prev');
    }
  };
  const onTouchStartNext = (e) => {
    if (!nextPageDisabled) {
      e.preventDefault();
      startNextPageTimer('next');
    }
  };

  return (
    <>
      {/* First page */}
      <button
        type="button"
        onClick={handleFirstPage}
        aria-label="First page"
        title="First page"
        className="odv-btn"
        disabled={firstPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">first_page</span>
      </button>

      {/* Previous (click = single step; press & hold = continuous) */}
      <button
        type="button"
        onClick={handlePrevPage}
        onMouseDown={() => !prevPageDisabled && startPrevPageTimer('prev')}
        onMouseUp={stopPrevPageTimer}
        onMouseLeave={stopPrevPageTimer}
        onTouchStart={onTouchStartPrev}
        onTouchEnd={stopPrevPageTimer}
        aria-label="Previous page"
        title="Previous page"
        className="odv-btn"
        disabled={prevPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_left</span>
      </button>

      {/* Page info (live region announces updates politely) */}
      <div className="page-info" aria-live="polite">
        <div>Page</div>
        <div>{pageNumber} / {totalPages}</div>
      </div>

      {/* Next (click = single step; press & hold = continuous) */}
      <button
        type="button"
        onClick={handleNextPage}
        onMouseDown={() => !nextPageDisabled && startNextPageTimer('next')}
        onMouseUp={stopNextPageTimer}
        onMouseLeave={stopNextPageTimer}
        onTouchStart={onTouchStartNext}
        onTouchEnd={stopNextPageTimer}
        aria-label="Next page"
        title="Next page"
        className="odv-btn"
        disabled={nextPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_right</span>
      </button>

      {/* Last page */}
      <button
        type="button"
        onClick={handleLastPage}
        aria-label="Last page"
        title="Last page"
        className="odv-btn"
        disabled={lastPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">last_page</span>
      </button>
    </>
  );
};

PageNavigationButtons.propTypes = {
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  startPrevPageTimer: PropTypes.func.isRequired,
  stopPrevPageTimer: PropTypes.func.isRequired,
  startNextPageTimer: PropTypes.func.isRequired,
  stopNextPageTimer: PropTypes.func.isRequired,
  handleFirstPage: PropTypes.func.isRequired,
  handleLastPage: PropTypes.func.isRequired,
  handlePrevPage: PropTypes.func.isRequired,
  handleNextPage: PropTypes.func.isRequired,
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
};

export default React.memo(PageNavigationButtons);
