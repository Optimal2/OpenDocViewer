/**
 * File: src/hooks/usePageTimer.js
 *
 * OpenDocViewer — Continuous Page Navigation Timer (React hook)
 *
 * PURPOSE
 *   Provide a tiny utility for press-and-hold page navigation:
 *     - Invokes a caller-supplied callback immediately (leading edge)
 *       and then repeatedly after an initial delay.
 *     - Keeps interval cadence modest (default ~20Hz) to remain responsive.
 *     - Cleans up automatically on unmount.
 *
 * API
 *   usePageTimer(initialDelay, handlePageChange) -> { startPageTimer, stopPageTimer }
 *
 *   - initialDelay: number (ms) — wait time before repeating kicks in.
 *   - handlePageChange: (direction: 'prev'|'next') => void
 *       Called once immediately (leading edge) and then repeatedly.
 *
 *   Returned functions:
 *     - startPageTimer(direction: 'prev'|'next'): void
 *     - stopPageTimer(): void
 *
 * SAFETY & LOGGING
 *   - Errors in the callback are caught to prevent UI crashes.
 *   - We log only coarse events (start/stop), never per-interval (avoid spam).
 *
 * IMPORTANT PROJECT REMINDER
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With file-type v21 the '/browser' subpath is not
 *     exported for bundlers and will break the Vite build.
 *
 * Source input (baseline) for this file: :contentReference[oaicite:0]{index=0}
 */

import { useRef, useEffect, useCallback } from 'react';
import logger from '../LogController';

/** @typedef {'prev'|'next'} PageDirection */

/** Default repeat cadence (ms). Keep modest to balance CPU and responsiveness. */
const DEFAULT_REPEAT_INTERVAL_MS = 50;

/**
 * Custom hook to handle page change with a timer for continuous navigation.
 *
 * @param {number} initialDelay
 *        Initial delay before continuous navigation starts, in milliseconds.
 * @param {(direction: PageDirection) => void} handlePageChange
 *        Function that performs a single page step in the given direction.
 * @returns {{ startPageTimer: (direction: PageDirection) => void, stopPageTimer: () => void }}
 *        Functions to start and stop the page timer.
 */
const usePageTimer = (initialDelay, handlePageChange) => {
  /** @type {React.MutableRefObject<number | null>} */
  const delayTimerRef = useRef(null);
  /** @type {React.MutableRefObject<number | null>} */
  const intervalRef = useRef(null);

  /**
   * Start the timer for continuous page navigation.
   * Leading-edge behavior: we invoke the handler once immediately.
   *
   * @param {PageDirection} direction
   */
  const startPageTimer = useCallback(
    (direction) => {
      // If a timer is already running, stop it before starting a new one.
      try {
        if (delayTimerRef.current != null || intervalRef.current != null) {
          logger.info('Restarting page timer', { direction });
          clearTimeout(delayTimerRef.current);
          clearInterval(intervalRef.current);
          delayTimerRef.current = null;
          intervalRef.current = null;
        } else {
          logger.info('Starting page timer', { direction });
        }

        // Leading edge: perform one step right away (snappy UX).
        try {
          handlePageChange(direction);
        } catch (error) {
          logger.error('Error during initial page step', { error: String(error?.message || error), direction });
        }

        // After the initial delay, begin repeating at a steady cadence.
        delayTimerRef.current = setTimeout(() => {
          delayTimerRef.current = null; // delay consumed
          intervalRef.current = setInterval(() => {
            try {
              handlePageChange(direction);
            } catch (error) {
              // Log once and keep going; consumers can stop the timer externally if desired.
              logger.error('Error during repeated page step', { error: String(error?.message || error), direction });
            }
          }, DEFAULT_REPEAT_INTERVAL_MS);
        }, Math.max(0, Number(initialDelay) || 0));
      } catch (error) {
        logger.error('Error starting page timer', { error: String(error?.message || error), direction });
      }
    },
    [handlePageChange, initialDelay]
  );

  /**
   * Stop any active delay or interval timer (idempotent).
   */
  const stopPageTimer = useCallback(() => {
    if (delayTimerRef.current != null || intervalRef.current != null) {
      logger.info('Stopping page timer');
    }
    try {
      if (delayTimerRef.current != null) clearTimeout(delayTimerRef.current);
      if (intervalRef.current != null) clearInterval(intervalRef.current);
    } catch (error) {
      logger.error('Error stopping page timer', { error: String(error?.message || error) });
    } finally {
      delayTimerRef.current = null;
      intervalRef.current = null;
    }
  }, []);

  // Clean up the timers when the owning component unmounts.
  useEffect(() => {
    return () => stopPageTimer();
  }, [stopPageTimer]);

  return { startPageTimer, stopPageTimer };
};

export default usePageTimer;
