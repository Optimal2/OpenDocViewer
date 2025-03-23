// File: src/hooks/usePageNavigation.js

import { useCallback } from 'react';
import logger from '../LogController';
import usePageTimer from './usePageTimer';
import { handlePrevPage, handleNextPage, handleFirstPage, handleLastPage } from '../utils/navigationUtils';

/**
 * Custom hook to handle document page navigation with keyboard and mouse.
 * @param {function} setPageNumber - Function to set the current page number.
 * @param {number} totalPages - Total number of pages.
 * @returns {Object} Navigation handlers and timers for continuous navigation.
 */
const usePageNavigation = (setPageNumber, totalPages) => {
  const initialDelay = 500;

  /**
   * Wrapper function to handle previous page navigation with logging.
   */
  const handlePrevPageWrapper = useCallback(() => {
    logger.info('Handling previous page navigation');
    try {
      handlePrevPage(setPageNumber);
    } catch (error) {
      logger.error('Error during previous page navigation', { error });
    }
  }, [setPageNumber]);

  /**
   * Wrapper function to handle next page navigation with logging.
   */
  const handleNextPageWrapper = useCallback(() => {
    logger.info('Handling next page navigation');
    try {
      handleNextPage(setPageNumber, totalPages);
    } catch (error) {
      logger.error('Error during next page navigation', { error });
    }
  }, [setPageNumber, totalPages]);

  /**
   * Wrapper function to handle first page navigation with logging.
   */
  const handleFirstPageWrapper = useCallback(() => {
    logger.info('Handling first page navigation');
    try {
      handleFirstPage(setPageNumber);
    } catch (error) {
      logger.error('Error during first page navigation', { error });
    }
  }, [setPageNumber]);

  /**
   * Wrapper function to handle last page navigation with logging.
   */
  const handleLastPageWrapper = useCallback(() => {
    logger.info('Handling last page navigation');
    try {
      handleLastPage(setPageNumber, totalPages);
    } catch (error) {
      logger.error('Error during last page navigation', { error });
    }
  }, [setPageNumber, totalPages]);

  // Timer hooks for continuous navigation
  const { startPageTimer: startPrevPageTimer, stopPageTimer: stopPrevPageTimer } = usePageTimer(initialDelay, (direction) => {
    if (direction === 'prev') handlePrevPageWrapper();
  });

  const { startPageTimer: startNextPageTimer, stopPageTimer: stopNextPageTimer } = usePageTimer(initialDelay, (direction) => {
    if (direction === 'next') handleNextPageWrapper();
  });

  return {
    handlePrevPageWrapper,
    handleNextPageWrapper,
    handleFirstPageWrapper,
    handleLastPageWrapper,
    startPrevPageTimer,
    stopPrevPageTimer,
    startNextPageTimer,
    stopNextPageTimer,
  };
};

export default usePageNavigation;
