// File: src/contexts/ViewerProvider.jsx
/**
 * src/contexts/ViewerProvider.jsx
 *
 * OpenDocViewer — Viewer state context (React)
 *
 * PURPOSE
 *   Centralized, minimal state for the viewer:
 *     - `allPages`: array of page entries (sparse allowed; indexes map to visual order)
 *     - `error`: fatal/operational error string (UI decides how to present)
 *     - `workerCount`: number of active workers (for diagnostics/perf HUD)
 *     - `loadingRunActive`: true while the current loader run is still discovering/scheduling work
 *     - `plannedPageCount`: number of pages expected from the current run
 *     - `messageQueue`: transient messages (perf overlay / debug console)
 */

import { useState, useCallback, useMemo } from 'react';
import logger from '../logging/systemLogger.js';
import ViewerContext from './viewerContext.js';

/**
 * @typedef {Object} PageEntry
 * @property {string}  fullSizeUrl
 * @property {string}  thumbnailUrl
 * @property {boolean} loaded
 * @property {number}  status
 * @property {string}  fileExtension
 * @property {number}  fileIndex
 * @property {number}  pageIndex
 * @property {(number|undefined)} allPagesIndex
 */

/**
 * ViewerProvider
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export const ViewerProvider = ({ children }) => {
  const [allPages, setAllPages] = useState([]);
  const [error, setError] = useState(/** @type {(string|null)} */ (null));
  const [workerCount, setWorkerCount] = useState(0);
  const [loadingRunActive, setLoadingRunActive] = useState(false);
  const [plannedPageCount, setPlannedPageCount] = useState(0);
  const [messageQueue, setMessageQueue] = useState([]);

  /**
   * Insert a page at the specified global index.
   * NOTE: This may create a sparse array if `index` skips ahead (by design).
   *
   * @param {PageEntry} page
   * @param {number} index
   * @returns {void}
   */
  const insertPageAtIndex = useCallback((page, index) => {
    setAllPages((prevPages) => {
      const updatedPages = prevPages.slice();
      updatedPages[index] = page;
      return updatedPages;
    });
    logger.info('Inserted page at index', { index, ext: page?.fileExtension, fileIndex: page?.fileIndex, pageIndex: page?.pageIndex });
  }, []);

  /**
   * Enqueue a UI/diagnostic message.
   * @param {string} message
   * @returns {void}
   */
  const addMessage = useCallback((message) => {
    setMessageQueue((prevQueue) => [...prevQueue, String(message)]);
    logger.info('Message added to queue', { message });
  }, []);

  const contextValue = useMemo(() => (
    {
      allPages,
      insertPageAtIndex,
      error,
      setError,
      workerCount,
      setWorkerCount,
      loadingRunActive,
      setLoadingRunActive,
      plannedPageCount,
      setPlannedPageCount,
      messageQueue,
      addMessage,
    }
  ), [
    allPages,
    insertPageAtIndex,
    error,
    workerCount,
    loadingRunActive,
    plannedPageCount,
    messageQueue,
    addMessage,
  ]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
