// File: src/hooks/usePageNavigation.js
/**
 * File: src/hooks/usePageNavigation.js
 *
 * OpenDocViewer — Page Navigation Hook (React)
 *
 * PURPOSE
 *   Provide memoized handlers for page navigation (first/prev/next/last) and
 *   continuous navigation timers suitable for press-and-hold UI (e.g., mousedown).
 *
 * DESIGN NOTES
 *   - Page indices are 1-based in the viewer.
 *   - Logging:
 *       • Wrapper handlers log user-initiated actions (single-step).
 *       • Timer-driven handlers avoid logging at high frequency to prevent noise.
 *   - Safety:
 *       • All handlers are wrapped in try/catch to prevent UI crashes.
 *       • totalPages is validated by utilities prior to changing page.
 *
 * USAGE
 *   const {
 *     handlePrevPageWrapper,
 *     handleNextPageWrapper,
 *     handleFirstPageWrapper,
 *     handleLastPageWrapper,
 *     startPrevPageTimer,
 *     stopPrevPageTimer,
 *     startNextPageTimer,
 *     stopNextPageTimer,
 *   } = usePageNavigation(setPageNumber, totalPages);
 *
 * IMPORTANT PROJECT REMINDER
 *   Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *   'file-type/browser'. With file-type v21 the '/browser' subpath is not
 *   exported for bundlers and will break Vite builds.
 *
 * Source: :contentReference[oaicite:0]{index=0}
 */

import { useCallback } from 'react';
import logger from '../LogController';
import usePageTimer from './usePageTimer';
import {
  handlePrevPage,
  handleNextPage,
  handleFirstPage,
  handleLastPage,
} from '../utils/navigationUtils';

/**
 * API returned by usePageNavigation.
 * @typedef {Object} PageNavigationAPI
 * @property {function(): void} handlePrevPageWrapper
 * @property {function(): void} handleNextPageWrapper
 * @property {function(): void} handleFirstPageWrapper
 * @property {function(): void} handleLastPageWrapper
 * @property {function(PageDirection): void} startPrevPageTimer
 * @property {function(): void} stopPrevPageTimer
 * @property {function(PageDirection): void} startNextPageTimer
 * @property {function(): void} stopNextPageTimer
 */

/**
 * Custom hook to handle document page navigation with keyboard/mouse.
 *
 * @param {SetPageNumber} setPageNumber  React state setter for the current page (1-based).
 * @param {number} totalPages            Total number of pages (must be >= 1 for next/last).
 * @returns {PageNavigationAPI}
 */
const usePageNavigation = (setPageNumber, totalPages) => {
  // Initial delay before the timer begins repeating (ms).
  // Subsequent cadence is controlled inside usePageTimer (e.g., ~20 Hz).
  const initialDelay = 500;

  /**
   * Wrapper: go to previous page (logs once per user action).
   * @returns {void}
   */
  const handlePrevPageWrapper = useCallback(() => {
    logger.info('Handling previous page navigation');
    try {
      handlePrevPage(setPageNumber);
    } catch (error) {
      logger.error('Error during previous page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber]);

  /**
   * Wrapper: go to next page (logs once per user action).
   * @returns {void}
   */
  const handleNextPageWrapper = useCallback(() => {
    logger.info('Handling next page navigation');
    try {
      handleNextPage(setPageNumber, totalPages);
    } catch (error) {
      logger.error('Error during next page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber, totalPages]);

  /**
   * Wrapper: go to first page.
   * @returns {void}
   */
  const handleFirstPageWrapper = useCallback(() => {
    logger.info('Handling first page navigation');
    try {
      handleFirstPage(setPageNumber);
    } catch (error) {
      logger.error('Error during first page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber]);

  /**
   * Wrapper: go to last page.
   * @returns {void}
   */
  const handleLastPageWrapper = useCallback(() => {
    logger.info('Handling last page navigation');
    try {
      handleLastPage(setPageNumber, totalPages);
    } catch (error) {
      logger.error('Error during last page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber, totalPages]);

  // ---------------------------------------------------------------------------
  // Timer-driven navigation (non-logging to avoid console spam at high frequency)
  // ---------------------------------------------------------------------------

  /** Fast step: previous (used by timers). */
  const fastPrev = useCallback(() => {
    try {
      handlePrevPage(setPageNumber);
    } catch (error) {
      logger.error('Error during fast previous page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber]);

  /** Fast step: next (used by timers). */
  const fastNext = useCallback(() => {
    try {
      handleNextPage(setPageNumber, totalPages);
    } catch (error) {
      logger.error('Error during fast next page navigation', { error: String(error?.message || error) });
    }
  }, [setPageNumber, totalPages]);

  /**
   * Timer for "prev" press-and-hold.
   * `usePageTimer` invokes our callback with a direction argument; we route accordingly.
   */
  const { startPageTimer: startPrevPageTimer, stopPageTimer: stopPrevPageTimer } = usePageTimer(
    initialDelay,
    (direction) => {
      if (direction === 'prev') fastPrev();
    }
  );

  /**
   * Timer for "next" press-and-hold.
   */
  const { startPageTimer: startNextPageTimer, stopPageTimer: stopNextPageTimer } = usePageTimer(
    initialDelay,
    (direction) => {
      if (direction === 'next') fastNext();
    }
  );

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
