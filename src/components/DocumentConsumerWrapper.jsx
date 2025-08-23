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
 * DocumentConsumerWrapper
 * Wraps DocumentLoader + DocumentViewer and passes through either:
 *  - Pattern mode: { folder, extension, endNumber }
 *  - Explicit-list mode: { sourceList }  (array of { url, ext?, fileIndex? })
 */
const DocumentConsumerWrapper = ({
  folder,
  extension,
  endNumber,
  sourceList, // optional
  isMobileView,
  initialized,
}) => {
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
            endNumber={endNumber}
            sourceList={sourceList || null}
            placeholderImage="placeholder.png"
            sameBlob={true}
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
                    setPageNumber={() => {}}
                    thumbnailsContainerRef={React.createRef()}
                    width={window.innerWidth}
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
  // Pattern mode (optional when explicit-list mode is used)
  folder: PropTypes.string,
  extension: PropTypes.string,
  endNumber: PropTypes.number,
  // Explicit-list mode (optional)
  sourceList: PropTypes.arrayOf(PropTypes.shape({
    url: PropTypes.string.isRequired,
    ext: PropTypes.string,
    fileIndex: PropTypes.number,
  })),
  isMobileView: PropTypes.bool.isRequired,
  initialized: PropTypes.bool.isRequired,
};

export default DocumentConsumerWrapper;
