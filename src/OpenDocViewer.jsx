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
 * Supports two input styles:
 *  1) Folder pattern: { folder, extension, endNumber }
 *  2) Explicit source list: { sourceList, bundle }
 */
const OpenDocViewer = ({ folder, extension, endNumber, sourceList, bundle }) => {
  const [initialized, setInitialized] = useState(false);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 600);

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
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Pass-through: existing props AND new explicit-list props (if present).
  return (
    <ThemeProvider>
      <ViewerProvider>
        <DocumentConsumerWrapper
          folder={folder}
          extension={extension}
          endNumber={endNumber}
          sourceList={sourceList || null}  // <- tiny seam to forward to DocumentLoader
          bundle={bundle || null}          // optional (metadata later)
          isMobileView={isMobileView}
          initialized={initialized}
        />
        <PerformanceMonitor />
      </ViewerProvider>
    </ThemeProvider>
  );
};

OpenDocViewer.propTypes = {
  // Pattern mode (legacy/demo)
  folder: PropTypes.string,
  extension: PropTypes.string,
  endNumber: PropTypes.number,
  // Explicit-list mode
  sourceList: PropTypes.arrayOf(PropTypes.shape({
    url: PropTypes.string.isRequired,
    ext: PropTypes.string,
    fileIndex: PropTypes.number
  })),
  bundle: PropTypes.object
};

export default OpenDocViewer;
