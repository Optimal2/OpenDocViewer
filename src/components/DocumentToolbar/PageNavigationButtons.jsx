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
 *   - Press & hold (mouse or touch) → continuous stepping using timers provided by the parent.
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

import React, { useRef } from 'react';
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
  // Suppress the subsequent onClick if a pointer press already caused a leading-edge step.
  const suppressNextClickRef = useRef(false);

  // Touch helpers so press-and-hold also works on touch devices without scrolling the page.
  const onTouchStartPrev = (e) => {
    if (!prevPageDisabled) {
      e.preventDefault();
      suppressNextClickRef.current = true; // leading-edge step will occur via timer
      startPrevPageTimer('prev');
    }
  };
  const onTouchStartNext = (e) => {
    if (!nextPageDisabled) {
      e.preventDefault();
      suppressNextClickRef.current = true;
      startNextPageTimer('next');
    }
  };

  // Click handlers that respect suppression (so a press that already stepped once won’t step again).
  const onClickPrev = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return; // skip duplicate step
    }
    handlePrevPage();
  };
  const onClickNext = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    handleNextPage();
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
        onClick={onClickPrev}
        onMouseDown={() => {
          if (!prevPageDisabled) {
            suppressNextClickRef.current = true; // leading-edge step via timer
            startPrevPageTimer('prev');
          }
        }}
        onMouseUp={stopPrevPageTimer}
        onMouseLeave={() => {
          stopPrevPageTimer();
          // If the pointer left the button, a click won’t follow; clear suppression to avoid stickiness.
          suppressNextClickRef.current = false;
        }}
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
        onClick={onClickNext}
        onMouseDown={() => {
          if (!nextPageDisabled) {
            suppressNextClickRef.current = true;
            startNextPageTimer('next');
          }
        }}
        onMouseUp={stopNextPageTimer}
        onMouseLeave={() => {
          stopNextPageTimer();
          suppressNextClickRef.current = false;
        }}
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
