// File: src/components/DocumentConsumerWrapper.js

import React, { useEffect, useContext, lazy, Suspense } from 'react';
import PropTypes from 'prop-types';
import { ViewerContext } from '../ViewerContext';
import logger from '../LogController';

// Lazy load components to optimize performance
const DocumentViewer = lazy(() => import('./DocumentViewer/DocumentViewer'));
const DocumentLoader = lazy(() => import('./DocumentLoader/DocumentLoader'));
const DocumentThumbnailList = lazy(() => import('./DocumentThumbnailList'));

/**
 * DocumentConsumerWrapper component.
 * Wraps the DocumentLoader and DocumentViewer components and handles their initialization and rendering.
 * 
 * @param {Object} props - Component props.
 * @param {string} props.folder - The folder containing the documents.
 * @param {string} props.extension - The extension of the document files.
 * @param {number} props.endNumber - The number of documents to load.
 * @param {boolean} props.isMobileView - Indicates if the mobile view is enabled.
 * @param {boolean} props.initialized - Indicates if the component is initialized.
 */
const DocumentConsumerWrapper = ({ folder, extension, endNumber, isMobileView, initialized }) => {
  const { allPages } = useContext(ViewerContext);

  useEffect(() => {
    logger.debug('All pages state in DocumentConsumerWrapper', { totalPages: allPages.length });
  }, [allPages]);

  return (
    <div className={`OpenDocViewer ${isMobileView ? 'mobile-view' : ''}`}>
      <Suspense fallback={<div className="loading-container"><div className="initial-loading-text">Loading...</div></div>}>
        {initialized && (
          <DocumentLoader
            folder={folder}
            extension={extension}
            placeholderImage="placeholder.png"
            sameBlob={true}
            endNumber={endNumber}
          >
            {isMobileView ? (
              <div className="thumbnail-only-view">
                {allPages.length > 0 ? (
                  <DocumentThumbnailList
                    thumbnails={allPages.map((page, index) => ({
                      pageNumber: index + 1,
                      src: page.thumbnailUrl,
                      loaded: page.loaded,
                      fileIndex: page.fileIndex,
                      pageIndex: page.pageIndex,
                    }))}
                    pageNumber={1}
                    setPageNumber={() => {}} // No-op function for mobile view
                    thumbnailsContainerRef={React.createRef()}
                    width={window.innerWidth} // Set the width to full window width for mobile view
                  />
                ) : (
                  <div>No documents loaded</div>
                )}
              </div>
            ) : (
              <DocumentViewer />
            )}
          </DocumentLoader>
        )}
      </Suspense>
    </div>
  );
};

DocumentConsumerWrapper.propTypes = {
  folder: PropTypes.string.isRequired,
  extension: PropTypes.string.isRequired,
  endNumber: PropTypes.number.isRequired,
  isMobileView: PropTypes.bool.isRequired,
  initialized: PropTypes.bool.isRequired,
};

export default DocumentConsumerWrapper;
