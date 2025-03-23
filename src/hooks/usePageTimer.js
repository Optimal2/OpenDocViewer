// File: src/hooks/usePageTimer.js

import { useRef, useEffect, useCallback } from 'react';
import logger from '../LogController';

/**
 * Custom hook to handle page change with a timer for continuous navigation.
 * @param {number} initialDelay - Initial delay before the continuous navigation starts, in milliseconds.
 * @param {function} handlePageChange - Function to handle the page change. It receives the direction ('prev' or 'next') as its argument.
 * @returns {Object} - Functions to start and stop the page timer.
 */
const usePageTimer = (initialDelay, handlePageChange) => {
  const pageTimerRef = useRef(null);

  /**
   * Start the timer for continuous page navigation
   * @param {string} direction - The direction of the page change ('prev' or 'next').
   */
  const startPageTimer = useCallback((direction) => {
    logger.info('Starting page timer', { direction });
    try {
      handlePageChange(direction); // Execute the page change once immediately
      pageTimerRef.current = setTimeout(() => {
        logger.info('Starting continuous page change', { direction });
        pageTimerRef.current = setInterval(() => handlePageChange(direction), 50); // Set continuous page change interval
      }, initialDelay);
    } catch (error) {
      logger.error('Error starting page timer', { message: error.message, direction });
    }
  }, [handlePageChange, initialDelay]);

  /**
   * Stop the timer for continuous page navigation
   */
  const stopPageTimer = useCallback(() => {
    if (pageTimerRef.current !== null) {
      logger.info('Stopping page timer');
      try {
        clearTimeout(pageTimerRef.current);
        clearInterval(pageTimerRef.current);
        pageTimerRef.current = null;
      } catch (error) {
        logger.error('Error stopping page timer', { message: error.message });
      }
    }
  }, []);

  // Clean up the timer when the component using this hook unmounts
  useEffect(() => {
    return () => stopPageTimer();
  }, [stopPageTimer]);

  return { startPageTimer, stopPageTimer };
};

export default usePageTimer;
