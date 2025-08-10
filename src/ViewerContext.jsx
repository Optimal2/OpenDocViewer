// File: src/ViewerContext.js

import React, { createContext, useState, useCallback, useMemo } from 'react';
import logger from './LogController';

// Create the Viewer context
export const ViewerContext = createContext();

/**
 * ViewerProvider component to manage and provide viewer-related state and functions.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - The child components that will consume the viewer context.
 * @returns {JSX.Element} The ViewerProvider component.
 */
export const ViewerProvider = ({ children }) => {
  const [allPages, setAllPages] = useState([]);
  const [error, setError] = useState(null);
  const [workerCount, setWorkerCount] = useState(0);
  const [messageQueue, setMessageQueue] = useState([]);

  /**
   * Insert a page at the specified index in the allPages array.
   * @param {Object} page - The page object to insert.
   * @param {number} index - The index at which to insert the page.
   */
  const insertPageAtIndex = useCallback((page, index) => {
    setAllPages((prevPages) => {
      const updatedPages = [...prevPages];
      updatedPages[index] = page;
      return updatedPages;
    });
    logger.info(`Inserted page at index: ${index}`);
  }, []);

  /**
   * Add a message to the message queue.
   * @param {string} message - The message to add to the queue.
   */
  const addMessage = useCallback((message) => {
    setMessageQueue((prevQueue) => [...prevQueue, message]);
    logger.info(`Message added to queue: ${message}`);
  }, []);

  const contextValue = useMemo(() => ({
    allPages,
    insertPageAtIndex,
    error,
    setError,
    workerCount,
    setWorkerCount,
    messageQueue,
    addMessage,
  }), [
    allPages, insertPageAtIndex, error, workerCount, messageQueue, addMessage
  ]);

  return (
    <ViewerContext.Provider value={contextValue}>
      {children}
    </ViewerContext.Provider>
  );
};
