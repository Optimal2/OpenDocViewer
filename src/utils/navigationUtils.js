// File: src/utils/navigationUtils.js
/**
 * File: src/utils/navigationUtils.js
 *
 * OpenDocViewer — Navigation Utilities
 *
 * PURPOSE
 *   Centralized helpers for page navigation in the document viewer.
 *   All functions are UI-agnostic and operate purely through a provided
 *   React-like state setter (`setPageNumber`) and optional `totalPages`.
 *
 * DESIGN NOTES
 *   - Page numbers are 1-based.
 *   - We guard against invalid inputs and keep the current page unchanged when
 *     navigation is impossible (e.g., already at first/last page, or totalPages invalid).
 *   - Logging is concise and structured to aid diagnostics without spamming the console.
 *
 * PROJECT GOTCHA (reminder for future reviewers):
 *   - Elsewhere in the app we import from the **root** 'file-type' package, not
 *     'file-type/browser' (v21 does not export that subpath for bundlers, which breaks Vite).
 */

import logger from '../LogController';

/**
 * Coerce a value to a positive integer (minimum 1).
 * @param {*} n
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveInt(n, fallback = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.floor(v);
  return i >= 1 ? i : fallback;
}

/**
 * Check whether totalPages looks valid (>= 1).
 * @param {*} totalPages
 * @returns {boolean}
 */
function isValidTotalPages(totalPages) {
  return Number.isFinite(totalPages) && Number(totalPages) >= 1;
}

/**
 * Clamp a page number into [1, totalPages].
 * If totalPages is invalid, returns the current page unchanged.
 * @param {number} page
 * @param {number} totalPages
 * @returns {number}
 */
function clampPage(page, totalPages) {
  if (!isValidTotalPages(totalPages)) return page;
  const p = toPositiveInt(page, 1);
  const t = Math.floor(totalPages);
  if (p < 1) return 1;
  if (p > t) return t;
  return p;
}

/**
 * Navigate to the previous page (no-op if already at page 1).
 *
 * @param {SetPageNumber} setPageNumber  React-like state setter for the current page (1-based).
 * @returns {void}
 */
export const handlePrevPage = (setPageNumber) => {
  if (typeof setPageNumber !== 'function') {
    logger.warn('handlePrevPage called without a valid setPageNumber');
    return;
  }

  setPageNumber(function (prev) {
    const curr = toPositiveInt(prev, 1);
    if (curr > 1) {
      const next = curr - 1;
      logger.info('Navigated to previous page', { from: curr, to: next });
      return next;
    }
    logger.info('Already at the first page', { page: curr });
    return curr;
  });
};

/**
 * Navigate to the next page (no-op if already at the last page).
 *
 * @param {SetPageNumber} setPageNumber  React-like state setter for the current page (1-based).
 * @param {number} totalPages            Total number of pages (must be >= 1).
 * @returns {void}
 */
export const handleNextPage = (setPageNumber, totalPages) => {
  if (typeof setPageNumber !== 'function') {
    logger.warn('handleNextPage called without a valid setPageNumber');
    return;
  }
  if (!isValidTotalPages(totalPages)) {
    logger.warn('handleNextPage called with invalid totalPages', { totalPages });
    return;
  }

  const t = Math.floor(totalPages);

  setPageNumber(function (prev) {
    const curr = toPositiveInt(prev, 1);
    if (curr < t) {
      const next = curr + 1;
      logger.info('Navigated to next page', { from: curr, to: next, totalPages: t });
      return next;
    }
    logger.info('Already at the last page', { page: curr, totalPages: t });
    return curr;
  });
};

/**
 * Navigate to the first page (always sets page to 1).
 *
 * @param {SetPageNumber} setPageNumber  React-like state setter for the current page (1-based).
 * @returns {void}
 */
export const handleFirstPage = (setPageNumber) => {
  if (typeof setPageNumber !== 'function') {
    logger.warn('handleFirstPage called without a valid setPageNumber');
    return;
  }

  setPageNumber(function (prev) {
    const next = 1;
    const curr = toPositiveInt(prev, 1);
    if (curr !== next) {
      logger.info('Navigated to first page', { from: curr, to: next });
    } else {
      logger.info('Already at the first page', { page: curr });
    }
    return next;
  });
};

/**
 * Navigate to the last page (no-op if totalPages invalid).
 *
 * @param {SetPageNumber} setPageNumber  React-like state setter for the current page (1-based).
 * @param {number} totalPages            Total number of pages (must be >= 1).
 * @returns {void}
 */
export const handleLastPage = (setPageNumber, totalPages) => {
  if (typeof setPageNumber !== 'function') {
    logger.warn('handleLastPage called without a valid setPageNumber');
    return;
  }
  if (!isValidTotalPages(totalPages)) {
    logger.warn('handleLastPage called with invalid totalPages', { totalPages });
    return;
  }

  const last = Math.floor(totalPages);

  setPageNumber(function (prev) {
    const curr = toPositiveInt(prev, 1);
    const next = clampPage(last, last);
    if (curr !== next) {
      logger.info('Navigated to last page', { from: curr, to: next, totalPages: last });
    } else {
      logger.info('Already at the last page', { page: curr, totalPages: last });
    }
    return next;
  });
};
