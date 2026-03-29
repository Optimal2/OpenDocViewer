// File: src/components/DocumentViewer/DocumentViewerThumbnails.jsx
/**
 * OpenDocViewer — Document Viewer Thumbnails (Wrapper)
 *
 * Provides the deterministic thumbnail list plus local width controls that sit directly next to the
 * pane they affect.
 */
import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentThumbnailList from '../DocumentThumbnailList.jsx';

/**
 * @param {Object} props
 * @param {Array.<{ thumbnailUrl: string, status: number }>} props.allPages
 * @param {number} props.pageNumber
 * @param {function(number): void} props.setPageNumber
 * @param {Object} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {function(number): void} [props.selectForCompare]
 * @param {boolean} [props.isComparing]
 * @param {(number|null)} [props.comparePageNumber]
 * @param {function(): void} props.onIncreaseWidth
 * @param {function(): void} props.onDecreaseWidth
 * @param {function(): void} props.onHide
 * @returns {React.ReactElement}
 */
const DocumentViewerThumbnails = ({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
  selectForCompare,
  isComparing = false,
  comparePageNumber = null,
  onIncreaseWidth,
  onDecreaseWidth,
  onHide,
}) => {
  const { t } = useTranslation('common');

  return (
    <div className="thumbnail-pane-shell" style={{ width: `${width}px`, minWidth: `${width}px` }}>
      <div className="thumbnail-pane-toolbar" aria-label={t('thumbnails.controls.groupLabel', { defaultValue: 'Thumbnail pane controls' })}>
        <div className="thumbnail-pane-toolbar-title">
          {t('thumbnails.panelTitle', { defaultValue: 'Pages' })}
        </div>
        <div className="thumbnail-pane-toolbar-actions">
          <button
            type="button"
            className="thumbnail-pane-toolbar-button"
            onClick={onDecreaseWidth}
            aria-label={t('thumbnails.controls.narrower', { defaultValue: 'Make thumbnail pane narrower' })}
            title={t('thumbnails.controls.narrower', { defaultValue: 'Make thumbnail pane narrower' })}
          >
            <span className="material-icons" aria-hidden="true">chevron_left</span>
          </button>
          <button
            type="button"
            className="thumbnail-pane-toolbar-button"
            onClick={onIncreaseWidth}
            aria-label={t('thumbnails.controls.wider', { defaultValue: 'Make thumbnail pane wider' })}
            title={t('thumbnails.controls.wider', { defaultValue: 'Make thumbnail pane wider' })}
          >
            <span className="material-icons" aria-hidden="true">chevron_right</span>
          </button>
          <button
            type="button"
            className="thumbnail-pane-toolbar-button"
            onClick={onHide}
            aria-label={t('thumbnails.controls.hidePane', { defaultValue: 'Hide thumbnails' })}
            title={t('thumbnails.controls.hidePane', { defaultValue: 'Hide thumbnails' })}
          >
            <span className="material-icons" aria-hidden="true">visibility_off</span>
          </button>
        </div>
      </div>

      <DocumentThumbnailList
        allPages={allPages}
        pageNumber={pageNumber}
        setPageNumber={setPageNumber}
        thumbnailsContainerRef={thumbnailsContainerRef}
        width={width}
        selectForCompare={selectForCompare}
        isComparing={isComparing}
        comparePageNumber={comparePageNumber}
      />
    </div>
  );
};

DocumentViewerThumbnails.propTypes = {
  allPages: PropTypes.arrayOf(
    PropTypes.shape({
      thumbnailUrl: PropTypes.string,
      status: PropTypes.number.isRequired,
    })
  ).isRequired,
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  thumbnailsContainerRef: PropTypes.shape({
    current: PropTypes.any,
  }).isRequired,
  width: PropTypes.number.isRequired,
  selectForCompare: PropTypes.func,
  isComparing: PropTypes.bool,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  onIncreaseWidth: PropTypes.func.isRequired,
  onDecreaseWidth: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
};

export default React.memo(DocumentViewerThumbnails);
