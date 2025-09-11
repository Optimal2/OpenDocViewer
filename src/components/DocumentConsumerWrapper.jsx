// File: src/components/DocumentConsumerWrapper.jsx
/**
 * File: src/components/DocumentConsumerWrapper.jsx
 *
 * OpenDocViewer — Consumer Wrapper for Loader + Viewer
 *
 * PURPOSE
 *   Orchestrates the document loading pipeline and the main viewer UI:
 *     • Pattern mode:     { folder, extension, endNumber }
 *     • Explicit-list:    { sourceList: [{ url, ext?, fileIndex? }, ...] }
 *     • Demo mode (new):  { demoMode, demoStrategy, demoCount, demoFormats }
 *
 * ACCESSIBILITY
 *   - Suspense fallback announces loading state.
 *
 * PERFORMANCE
 *   - Uses React.lazy + Suspense to split large viewer/loader bundles.
 */

import React, {
  useEffect,
  useContext,
  useRef,
  lazy,
  Suspense,
} from 'react';
import PropTypes from 'prop-types';
import { ViewerContext } from '../ViewerContext';
import logger from '../LogController';

// Lazy-load heavy subtrees to keep initial bundle small
const DocumentViewer = lazy(() => import('./DocumentViewer/DocumentViewer'));
const DocumentLoader = lazy(() => import('./DocumentLoader/DocumentLoader'));
const DocumentThumbnailList = lazy(() => import('./DocumentThumbnailList'));

/**
 * An item for explicit-list mode.
 * @typedef {Object} SourceItem
 * @property {string} url
 * @property {(string|undefined)} ext
 * @property {(number|undefined)} fileIndex
 */

/**
 * DocumentConsumerWrapper
 * Wraps DocumentLoader + DocumentViewer and switches between full viewer and a
 * thumbnail-only presentation on small/mobile layouts.
 *
 * @param {Object} props
 * @param {string} [props.folder]                Pattern mode: base folder/path for assets
 * @param {string} [props.extension]             Pattern mode: file extension (e.g., "png", "tiff")
 * @param {number} [props.endNumber]             Pattern mode: last page/file number (1..N)
 * @param {Array.<SourceItem>} [props.sourceList]
 *        Explicit-list mode: ordered list of source items
 * @param {boolean} props.isMobileView           Whether to render the thumbnail-only view
 * @param {boolean} props.initialized            Delay mounting until basic app init completes
 * @param {(boolean|undefined)} [props.demoMode]         Demo mode: use public '/sample.*' files
 * @param {"repeat"|"mix"}      [props.demoStrategy]     Demo strategy (default handled in loader)
 * @param {(number|undefined)}  [props.demoCount]        Demo count
 * @param {Array.<string>=}     [props.demoFormats]      Demo formats
 * @returns {React.ReactElement}
 */
const DocumentConsumerWrapper = ({
  folder,
  extension,
  endNumber,
  sourceList,
  isMobileView,
  initialized,
  // NEW demo props (optional):
  demoMode,
  demoStrategy,
  demoCount,
  demoFormats,
}) => {
  const { allPages } = useContext(ViewerContext);
  const thumbnailsContainerRef = useRef(null);

  useEffect(() => {
    // Keep this lightweight; avoid logging large arrays.
    logger.debug('DocumentConsumerWrapper mounted/updated', {
      totalPages: Array.isArray(allPages) ? allPages.length : 0,
      isMobileView,
      initialized,
      mode: Array.isArray(sourceList) && sourceList.length > 0 ? 'explicit-list' : (demoMode ? 'demo' : 'pattern'),
    });
  }, [allPages, isMobileView, initialized, sourceList, demoMode]);

  // Best-effort width for thumbnails container (SSR-safe)
  const thumbWidth = (() => {
    try { return Math.max(240, Math.min(420, Math.floor(window.innerWidth))); } catch { return 320; }
  })();

  return (
    <div className={`OpenDocViewer ${isMobileView ? 'mobile-view' : ''}`}>
      <Suspense
        fallback={
          <div className="loading-container" role="status" aria-live="polite">
            <div className="initial-loading-text">Loading viewer…</div>
          </div>
        }
      >
        {initialized && (
          <DocumentLoader
            folder={folder}
            extension={extension}
            endNumber={endNumber}
            sourceList={sourceList || null}
            placeholderImage="placeholder.png"
            sameBlob={true}
            // Forward NEW demo props (undefined values are harmless):
            demoMode={demoMode}
            demoStrategy={demoStrategy}
            demoCount={demoCount}
            demoFormats={demoFormats}
          >
            {isMobileView ? (
              <div className="thumbnail-only-view">
                {Array.isArray(allPages) && allPages.length > 0 ? (
                  <DocumentThumbnailList
                    allPages={allPages}
                    pageNumber={1}                  // read-only gallery in this compact view
                    setPageNumber={() => {}}        // no-op: full viewer handles navigation
                    thumbnailsContainerRef={thumbnailsContainerRef}
                    width={thumbWidth}
                  />
                ) : (
                  <div className="initial-loading-text">No documents loaded</div>
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
  sourceList: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.string.isRequired,
      ext: PropTypes.string,
      fileIndex: PropTypes.number,
    })
  ),
  isMobileView: PropTypes.bool.isRequired,
  initialized: PropTypes.bool.isRequired,
  // NEW demo props
  demoMode: PropTypes.bool,
  demoStrategy: PropTypes.oneOf(['repeat', 'mix']),
  demoCount: PropTypes.number,
  demoFormats: PropTypes.arrayOf(PropTypes.string),
};

export default DocumentConsumerWrapper;
