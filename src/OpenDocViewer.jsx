// File: src/OpenDocViewer.js

import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import logger from './LogController';
import { ThemeProvider } from './ThemeContext';
import { ViewerProvider } from './ViewerContext';
import PerformanceMonitor from './PerformanceMonitor';
import DocumentConsumerWrapper from './components/DocumentConsumerWrapper';

/**
 * Main viewer component for OpenDocViewer.
 * Manages theme, responsive layout, and initializes document viewing contexts.
 *
 * @param {Object} props - Component properties.
 * @param {string} props.folder - Directory path containing documents.
 * @param {string} props.extension - File extension of documents to view.
 * @param {number} props.endNumber - Total number of documents to load.
 * @returns {JSX.Element} Rendered OpenDocViewer component.
 */
const OpenDocViewer = ({ folder, extension, endNumber }) => {
  const [initialized, setInitialized] = useState(false);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 600);

  /**
   * Updates mobile view state based on window width.
   */
  const handleResize = useCallback(() => {
    const mobileView = window.innerWidth < 600;
    setIsMobileView(mobileView);
    logger.debug('Window resized', { isMobileView: mobileView });
  }, []);

  useEffect(() => {
    logger.debug('Initializing OpenDocViewer');
    setInitialized(true);
    logger.info('OpenDocViewer initialization complete');

    window.addEventListener('resize', handleResize);
    handleResize(); // Perform initial size check

    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  return (
    <ThemeProvider>
      <ViewerProvider>
        <DocumentConsumerWrapper
          folder={folder}
          extension={extension}
          endNumber={endNumber}
          isMobileView={isMobileView}
          initialized={initialized}
        />
        <PerformanceMonitor />
      </ViewerProvider>
    </ThemeProvider>
  );
};

OpenDocViewer.propTypes = {
  folder: PropTypes.string.isRequired,
  extension: PropTypes.string.isRequired,
  endNumber: PropTypes.number.isRequired,
};

export default OpenDocViewer;
