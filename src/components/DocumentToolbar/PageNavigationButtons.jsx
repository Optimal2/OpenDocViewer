// File: src/components/DocumentToolbar/PageNavigationButtons.js

import React from 'react';
import PropTypes from 'prop-types';

/**
 * PageNavigationButtons component.
 * Provides buttons for navigating through pages in the document viewer.
 * 
 * @param {Object} props - Component props.
 * @param {boolean} props.prevPageDisabled - Flag to disable the previous page button.
 * @param {boolean} props.nextPageDisabled - Flag to disable the next page button.
 * @param {boolean} props.firstPageDisabled - Flag to disable the first page button.
 * @param {boolean} props.lastPageDisabled - Flag to disable the last page button.
 * @param {function} props.startPrevPageTimer - Function to start the previous page timer.
 * @param {function} props.stopPrevPageTimer - Function to stop the previous page timer.
 * @param {function} props.startNextPageTimer - Function to start the next page timer.
 * @param {function} props.stopNextPageTimer - Function to stop the next page timer.
 * @param {function} props.handleFirstPage - Function to handle navigating to the first page.
 * @param {function} props.handleLastPage - Function to handle navigating to the last page.
 * @param {function} props.handlePrevPage - Function to handle navigating to the previous page.
 * @param {function} props.handleNextPage - Function to handle navigating to the next page.
 * @param {number} props.pageNumber - Current page number.
 * @param {number} props.totalPages - Total number of pages in the document.
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
}) => (
  <>
    <button onClick={handleFirstPage} aria-label="First page" title="First page" disabled={firstPageDisabled}>
      <span className="material-icons">first_page</span>
    </button>
    <button
      onMouseDown={() => startPrevPageTimer('prev')}
      onMouseUp={stopPrevPageTimer}
      onMouseLeave={stopPrevPageTimer}
      aria-label="Previous page"
      title="Previous page"
      disabled={prevPageDisabled}
    >
      <span className="material-icons">chevron_left</span>
    </button>
    <div className="page-info">
      <div>Page</div>
      <div>{pageNumber} / {totalPages}</div>
    </div>
    <button
      onMouseDown={() => startNextPageTimer('next')}
      onMouseUp={stopNextPageTimer}
      onMouseLeave={stopNextPageTimer}
      aria-label="Next page"
      title="Next page"
      disabled={nextPageDisabled}
    >
      <span className="material-icons">chevron_right</span>
    </button>
    <button onClick={handleLastPage} aria-label="Last page" title="Last page" disabled={lastPageDisabled}>
      <span className="material-icons">last_page</span>
    </button>
  </>
);

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

export default PageNavigationButtons;
