// File: src/ViewerContext.jsx
/**
 * src/ViewerContext.jsx
 *
 * OpenDocViewer — Viewer state context (React)
 *
 * PURPOSE
 *   Centralized, minimal state for the viewer:
 *     - `allPages`: array of page entries (sparse allowed; indexes map to visual order)
 *     - `error`: fatal/operational error string (UI decides how to present)
 *     - `workerCount`: number of active workers (for diagnostics/perf HUD)
 *     - `messageQueue`: transient messages (perf overlay / debug console)
 *
 * IMPORTANT IMPLEMENTATION NOTES
 *   - We deliberately allow **sparse arrays** in `allPages`. A loader may insert
 *     page entries out-of-order; consumers must tolerate `undefined` slots.
 *   - Logging inside hot paths (e.g., `insertPageAtIndex`) is set to **info** by default.
 *     This is useful in development but can become noisy if you enable backend logging.
 *     Consider lowering to `debug` in production (`LogController` honors levels).
 *   - Do **not** mutate `allPages` in-place; always copy before insert to play nicely with React.
 *
 * GOTCHAS (project-wide reminders):
 *   - `file-type` import: elsewhere we import from `'file-type'` (root), *not* `'file-type/browser'`,
 *     because v21 does not export that subpath for bundlers. Changing this will break builds.
 */

import React, { createContext, useState, useCallback, useMemo } from 'react';
import logger from './LogController';

/**
 * @typedef {Object} PageEntry
 * @property {string}  fullSizeUrl       Object URL or absolute URL to the rendered page image
 * @property {string}  thumbnailUrl      Object URL or absolute URL to a small preview
 * @property {boolean} loaded            Whether the page content is fully ready
 * @property {number}  status            1=ok, 0=placeholder/pending, -1=failed
 * @property {string}  fileExtension     'pdf' | 'tiff' | 'tif' | 'png' | 'jpg' | 'jpeg' | ...
 * @property {number}  fileIndex         Index of the source file within the document set
 * @property {number}  pageIndex         Page index within the source file (0-based)
 * @property {(number|undefined)} allPagesIndex   Global index in the flattened page list (0-based)
 */

/**
 * @typedef {Object} ViewerContextValue
 * @property {Array.<(PageEntry|undefined)>} allPages
 * @property {function(PageEntry, number): void} insertPageAtIndex
 * @property {(string|null)} error
 * @property {function((string|null)): void} setError
 * @property {number} workerCount
 * @property {function(number): void} setWorkerCount
 * @property {Array.<string>} messageQueue
 * @property {function(string): void} addMessage
 */

/** Create the Viewer context (default value is narrowed at runtime by the Provider). */
export const ViewerContext = createContext(/** @type {ViewerContextValue} */ ({}));

/**
 * ViewerProvider
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export const ViewerProvider = ({ children }) => {
  const [allPages, setAllPages] = useState([]);
  const [error, setError] = useState(/** @type {(string|null)} */(null));
  const [workerCount, setWorkerCount] = useState(0);
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
    // INFO: This is intentionally chatty for dev visibility; consider lowering to debug in prod.
    logger.info('Inserted page at index', { index, ext: page?.fileExtension, fileIndex: page?.fileIndex, pageIndex: page?.pageIndex });
  }, []);

  /**
   * Enqueue a UI/diagnostic message.
   * Keep messages short; consumers may cap list length if displaying in a HUD.
   *
   * @param {string} message
   * @returns {void}
   */
  const addMessage = useCallback((message) => {
    setMessageQueue((prevQueue) => [...prevQueue, String(message)]);
    // INFO: Timer-driven callers should prefer a non-logging fast path (see usePageNavigation).
    logger.info('Message added to queue', { message });
  }, []);

  /** Memoize the context shape to avoid unnecessary re-renders in consumers. */
  const contextValue = useMemo(() => (
    /** @type {ViewerContextValue} */ ({
      allPages,
      insertPageAtIndex,
      error,
      setError,
      workerCount,
      setWorkerCount,
      messageQueue,
      addMessage,
    })
  ), [allPages, insertPageAtIndex, error, workerCount, messageQueue, addMessage]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
