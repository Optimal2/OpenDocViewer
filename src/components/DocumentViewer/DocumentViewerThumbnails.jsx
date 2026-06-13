// File: src/components/DocumentViewer/DocumentViewerThumbnails.jsx
/**
 * OpenDocViewer — Document Viewer Thumbnails (Wrapper)
 *
 * Provides the deterministic thumbnail list and local width controls for the viewer shell.
 */
import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentThumbnailList from '../DocumentThumbnailList.jsx';

/**
 * @param {Object} props
 * @param {Array.<{ thumbnailUrl: string, status: number }>} props.allPages
 * @param {number} props.pageNumber - Original 1-based selected page number.
 * @param {function(number): void} props.setPageNumber - Accepts original 1-based page number.
 * @param {Object} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {function(number, Object=): void} [props.selectForCompare]
 * @param {boolean} [props.isComparing]
 * @param {(number|null)} [props.comparePageNumber]
 * @param {'primary'|'compare'} [props.activePane]
 * @param {{ shift:boolean, ctrl:boolean }} props.navigationModifierState
 * @param {boolean} props.selectionPanelEnabled
 * @param {boolean} props.draftSelectionDirty
 * @param {boolean} props.selectionActive
 * @param {function(): void} props.clearSelectionFilter
 * @param {function(number): boolean} props.hidePageFromSelection
 * @param {function(number): boolean} props.hideDocumentFromSelection
 * @param {function(number): boolean} [props.onOpenDocumentMetadata]
 * @param {number} props.minWidth
 * @param {number} props.maxWidth
 * @param {number} props.defaultWidth
 * @param {function(): void} props.onSetMinWidth
 * @param {function(): void} props.onResetWidth
 * @param {function(): void} props.onSetMaxWidth
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
  activePane = 'primary',
  navigationModifierState,
  selectionPanelEnabled,
  draftSelectionDirty,
  selectionActive,
  clearSelectionFilter,
  hidePageFromSelection,
  hideDocumentFromSelection,
  onOpenDocumentMetadata,
  minWidth,
  maxWidth,
  defaultWidth,
  onSetMinWidth,
  onResetWidth,
  onSetMaxWidth,
  onIncreaseWidth,
  onDecreaseWidth,
  onHide,
}) => {
  const { t } = useTranslation('common');
  const widthAtMin = width <= minWidth;
  const widthAtMax = width >= maxWidth;
  const widthAtDefault = width === defaultWidth;
  const canClearSelection = selectionActive || draftSelectionDirty;

  return (
    <div className="thumbnail-pane-shell" style={{ width: `${width}px`, minWidth: `${width}px` }}>
      <div className="thumbnail-pane-toolbar-stack" aria-label={t('thumbnails.controls.groupLabel', { defaultValue: 'Thumbnail pane controls' })}>
        <div className="thumbnail-pane-toolbar-row is-actions">
          <div className="thumbnail-pane-toolbar-actions">
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSetMinWidth}
              aria-label={t('thumbnails.controls.minimumWidth', { defaultValue: 'Set thumbnail pane to minimum width' })}
              title={t('thumbnails.controls.minimumWidth', { defaultValue: 'Set thumbnail pane to minimum width' })}
              disabled={widthAtMin}
            >
              <span className="material-icons" aria-hidden="true">keyboard_double_arrow_left</span>
            </button>
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onDecreaseWidth}
              aria-label={t('thumbnails.controls.narrower', { defaultValue: 'Make thumbnail pane narrower' })}
              title={t('thumbnails.controls.narrower', { defaultValue: 'Make thumbnail pane narrower' })}
              disabled={widthAtMin}
            >
              <span className="material-icons" aria-hidden="true">chevron_left</span>
            </button>
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onResetWidth}
              aria-label={t('thumbnails.controls.resetWidth', { defaultValue: 'Reset thumbnail pane to default width' })}
              title={t('thumbnails.controls.resetWidth', { defaultValue: 'Reset thumbnail pane to default width' })}
              disabled={widthAtDefault}
            >
              <span className="material-icons" aria-hidden="true">restart_alt</span>
            </button>
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onIncreaseWidth}
              aria-label={t('thumbnails.controls.wider', { defaultValue: 'Make thumbnail pane wider' })}
              title={t('thumbnails.controls.wider', { defaultValue: 'Make thumbnail pane wider' })}
              disabled={widthAtMax}
            >
              <span className="material-icons" aria-hidden="true">chevron_right</span>
            </button>
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSetMaxWidth}
              aria-label={t('thumbnails.controls.maximumWidth', { defaultValue: 'Set thumbnail pane to maximum width' })}
              title={t('thumbnails.controls.maximumWidth', { defaultValue: 'Set thumbnail pane to maximum width' })}
              disabled={widthAtMax}
            >
              <span className="material-icons" aria-hidden="true">keyboard_double_arrow_right</span>
            </button>
            <button
              type="button"
              className="thumbnail-pane-toolbar-button is-compact"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onHide}
              aria-label={t('thumbnails.controls.hidePane', { defaultValue: 'Hide thumbnails' })}
              title={t('thumbnails.controls.hidePane', { defaultValue: 'Hide thumbnails' })}
            >
              <span className="material-icons" aria-hidden="true">visibility_off</span>
            </button>
            {canClearSelection ? (
              <button
                type="button"
                className="thumbnail-pane-toolbar-button is-compact is-warning"
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearSelectionFilter}
                aria-label={t('thumbnails.selection.clearFilter', { defaultValue: 'Clear the selection filter and show all pages' })}
                title={t('thumbnails.selection.clearFilter', { defaultValue: 'Clear the selection filter and show all pages' })}
              >
                <span className="material-icons" aria-hidden="true">filter_alt_off</span>
              </button>
            ) : null}
          </div>
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
        activePane={activePane}
        navigationModifierState={navigationModifierState}
        selectionPanelEnabled={selectionPanelEnabled}
        onHidePageFromSelection={hidePageFromSelection}
        onHideDocumentFromSelection={hideDocumentFromSelection}
        onOpenDocumentMetadata={onOpenDocumentMetadata}
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
  activePane: PropTypes.oneOf(['primary', 'compare']),
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }).isRequired,
  selectionPanelEnabled: PropTypes.bool.isRequired,
  draftSelectionDirty: PropTypes.bool.isRequired,
  selectionActive: PropTypes.bool.isRequired,
  clearSelectionFilter: PropTypes.func.isRequired,
  hidePageFromSelection: PropTypes.func.isRequired,
  hideDocumentFromSelection: PropTypes.func.isRequired,
  onOpenDocumentMetadata: PropTypes.func,
  minWidth: PropTypes.number.isRequired,
  maxWidth: PropTypes.number.isRequired,
  defaultWidth: PropTypes.number.isRequired,
  onSetMinWidth: PropTypes.func.isRequired,
  onResetWidth: PropTypes.func.isRequired,
  onSetMaxWidth: PropTypes.func.isRequired,
  onIncreaseWidth: PropTypes.func.isRequired,
  onDecreaseWidth: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
};

export default React.memo(DocumentViewerThumbnails);
