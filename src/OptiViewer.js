// File: src/OpenDocViewer.js

import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import logger from './LogController';
import { ThemeProvider } from './ThemeContext';
import { ViewerProvider } from './ViewerContext';
import PerformanceMonitor from './PerformanceMonitor';
import DocumentConsumerWrapper from './components/DocumentConsumerWrapper';

/**
 * OpenDocViewer component.
 * Initializes the application and manages the theme, viewer, and performance monitoring contexts.
 * 
 * @param {Object} props - Component props.
 * @param {string} props.folder - The folder containing the documents.
 * @param {string} props.extension - The extension of the document files.
 * @param {number} props.endNumber - The number of documents to load.
 * @returns {JSX.Element} The OpenDocViewer component.
 */
const OpenDocViewer = ({ folder, extension, endNumber }) => {
  const [initialized, setInitialized] = useState(false);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 600);

  /**
   * Handle window resize event.
   */
  const handleResize = useCallback(() => {
    setIsMobileView(window.innerWidth < 600);
    logger.debug('Window resized', { isMobileView: window.innerWidth < 600 });
  }, []);

  useEffect(() => {
    logger.debug('Initializing OpenDocViewer');
    setInitialized(true);
    logger.info('OpenDocViewer initialized');

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => {
      window.removeEventListener('resize', handleResize);
    };
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
