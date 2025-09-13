// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * File: src/components/DocumentToolbar/PageNavigationButtons.jsx
 *
 * Page navigation controls with support for single-step clicks and
 * continuous stepping on press-and-hold (mouse/touch).
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.prevPageDisabled - Disable "previous page".
 * @param {boolean} props.nextPageDisabled - Disable "next page".
 * @param {boolean} props.firstPageDisabled - Disable "first page".
 * @param {boolean} props.lastPageDisabled - Disable "last page".
 * @param {function(PageDirection):void} props.startPrevPageTimer - Start the "prev" repeat timer.
 * @param {function():void} props.stopPrevPageTimer - Stop the "prev" repeat timer.
 * @param {function(PageDirection):void} props.startNextPageTimer - Start the "next" repeat timer.
 * @param {function():void} props.stopNextPageTimer - Stop the "next" repeat timer.
 * @param {function():void} props.handleFirstPage - Jump to first page.
 * @param {function():void} props.handleLastPage - Jump to last page.
 * @param {function():void} props.handlePrevPage - Single-step to previous page.
 * @param {function():void} props.handleNextPage - Single-step to next page.
 * @param {number} props.pageNumber - Current page number (1-based).
 * @param {number} props.totalPages - Total pages.
 * @returns {JSX.Element}
 */

import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
        aria-label={t('toolbar.firstPage')}
        title={t('toolbar.firstPage')}
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
        aria-label={t('toolbar.previousPage')}
        title={t('toolbar.previousPage')}
        className="odv-btn"
        disabled={prevPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_left</span>
      </button>

      {/* Page info (live region announces updates politely) */}
      <div className="page-info" aria-live="polite">
        <div>{t('toolbar.page')}</div>
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
        aria-label={t('toolbar.nextPage')}
        title={t('toolbar.nextPage')}
        className="odv-btn"
        disabled={nextPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_right</span>
      </button>

      {/* Last page */}
      <button
        type="button"
        onClick={handleLastPage}
        aria-label={t('toolbar.lastPage')}
        title={t('toolbar.lastPage')}
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
