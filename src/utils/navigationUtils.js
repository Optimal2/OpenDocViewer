// File: src/utils/navigationUtils.js

import logger from '../LogController';

/**
 * Navigate to the previous page.
 * @param {function} setPageNumber - Function to set the current page number.
 */
export const handlePrevPage = (setPageNumber) => {
  setPageNumber(prevPageNumber => {
    if (prevPageNumber > 1) {
      const newPageNumber = prevPageNumber - 1;
      logger.info('Navigated to previous page', { newPageNumber });
      return newPageNumber;
    }
    logger.info('Already at the first page', { prevPageNumber });
    return prevPageNumber;
  });
};

/**
 * Navigate to the next page.
 * @param {function} setPageNumber - Function to set the current page number.
 * @param {number} totalPages - Total number of pages.
 */
export const handleNextPage = (setPageNumber, totalPages) => {
  setPageNumber(prevPageNumber => {
    if (prevPageNumber < totalPages) {
      const newPageNumber = prevPageNumber + 1;
      logger.info('Navigated to next page', { newPageNumber });
      return newPageNumber;
    }
    logger.info('Already at the last page', { prevPageNumber });
    return prevPageNumber;
  });
};

/**
 * Navigate to the first page.
 * @param {function} setPageNumber - Function to set the current page number.
 */
export const handleFirstPage = (setPageNumber) => {
  setPageNumber(() => {
    const newPageNumber = 1;
    logger.info('Navigated to first page', { newPageNumber });
    return newPageNumber;
  });
};

/**
 * Navigate to the last page.
 * @param {function} setPageNumber - Function to set the current page number.
 * @param {number} totalPages - Total number of pages.
 */
export const handleLastPage = (setPageNumber, totalPages) => {
  if (totalPages > 0) {
    setPageNumber(() => {
      const newPageNumber = totalPages;
      logger.info('Navigated to last page', { newPageNumber });
      return newPageNumber;
    });
  } else {
    logger.warn('Invalid total pages value', { totalPages });
  }
};
