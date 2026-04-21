// File: src/components/DocumentViewer/DocumentViewerThumbnails.jsx
/**
 * OpenDocViewer — Document Viewer Thumbnails / Selection Pane (Wrapper)
 *
 * Provides the deterministic thumbnail list, local width controls, and the document/page selection
 * editor that can hide pages from the viewer flow once the user saves a selection.
 */
import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentThumbnailList from '../DocumentThumbnailList.jsx';
import DocumentSelectionPanel from '../DocumentSelectionPanel.jsx';

/**
 * @param {Object} props
 * @param {Array.<{ thumbnailUrl: string, status: number }>} props.allPages
 * @param {number} props.pageNumber - Original 1-based selected page number.
 * @param {function(number): void} props.setPageNumber - Accepts original 1-based page number.
 * @param {Object} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {number} props.sessionTotalPages
 * @param {function(number): void} [props.selectForCompare]
 * @param {boolean} [props.isComparing]
 * @param {(number|null)} [props.comparePageNumber]
 * @param {{ shift:boolean, ctrl:boolean }} props.navigationModifierState
 * @param {'thumbnails'|'selection'} props.paneMode
 * @param {function(string): void} props.setPaneMode
 * @param {boolean} props.selectionPanelEnabled
 * @param {Object} props.pageLoadState
 * @param {Array} props.selectionDocuments
 * @param {Array<boolean>} props.draftSelectionMask
 * @param {boolean} props.draftSelectionDirty
 * @param {boolean} props.selectionActive
 * @param {number} props.draftIncludedCount
 * @param {function(boolean): void} props.toggleDraftSelectAll
 * @param {function(string, boolean): void} props.toggleDraftDocument
 * @param {function(number, boolean): void} props.toggleDraftPage
 * @param {function(): void} props.saveDraftSelection
 * @param {function(): void} props.cancelDraftSelection
 * @param {function(): void} props.clearSelectionFilter
 * @param {function(number): boolean} props.hidePageFromSelection
 * @param {function(number): boolean} props.hideDocumentFromSelection
 * @param {boolean} [props.canOpenMetadataMatrix]
 * @param {function(): boolean} [props.onOpenMetadataMatrix]
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
  sessionTotalPages,
  selectForCompare,
  isComparing = false,
  comparePageNumber = null,
  navigationModifierState,
  paneMode,
  setPaneMode,
  selectionPanelEnabled,
  pageLoadState,
  selectionDocuments,
  draftSelectionMask,
  draftSelectionDirty,
  selectionActive,
  draftIncludedCount,
  toggleDraftSelectAll,
  toggleDraftDocument,
  toggleDraftPage,
  saveDraftSelection,
  cancelDraftSelection,
  clearSelectionFilter,
  hidePageFromSelection,
  hideDocumentFromSelection,
  onOpenDocumentMetadata,
  canOpenMetadataMatrix = false,
  onOpenMetadataMatrix = undefined,
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

  React.useEffect(() => {
    if (selectionPanelEnabled) return;
    if (paneMode === 'selection') setPaneMode('thumbnails');
  }, [paneMode, selectionPanelEnabled, setPaneMode]);

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
          </div>
        </div>

        <div className="thumbnail-pane-toolbar-row is-tabs">
          <div className="thumbnail-pane-mode-switch" role="tablist" aria-label={t('thumbnails.selection.tabGroup', { defaultValue: 'Thumbnail pane content' })}>
            <button
              type="button"
              role="tab"
              aria-selected={paneMode === 'thumbnails'}
              className={`thumbnail-pane-mode-button ${paneMode === 'thumbnails' ? 'is-active' : ''}`}
              onClick={() => setPaneMode('thumbnails')}
              title={t('thumbnails.selection.thumbnailsTab', { defaultValue: 'Thumbnails' })}
            >
              {t('thumbnails.selection.thumbnailsTab', { defaultValue: 'Thumbnails' })}
            </button>
            <div className={`thumbnail-pane-mode-button-wrap ${canClearSelection ? 'has-inline-tool' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={paneMode === 'selection'}
                aria-disabled={!selectionPanelEnabled}
                className={[
                  'thumbnail-pane-mode-button',
                  paneMode === 'selection' ? 'is-active' : '',
                  selectionActive ? 'has-selection' : '',
                  canClearSelection ? 'has-inline-tool' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => { if (selectionPanelEnabled) setPaneMode('selection'); }}
                title={selectionPanelEnabled
                  ? t('thumbnails.selection.selectionTab', { defaultValue: 'Selection' })
                  : t('thumbnails.selection.loadingStatusShort', {
                      ready: Number(pageLoadState?.readyPages) || 0,
                      total: Math.max(Number(pageLoadState?.expectedPages) || 0, Number(sessionTotalPages) || 0),
                      defaultValue: 'Selection will be available when all pages are fully loaded.',
                    })}
                disabled={!selectionPanelEnabled}
              >
                <span className="thumbnail-pane-mode-button-label">
                  {t('thumbnails.selection.selectionTab', { defaultValue: 'Selection' })}
                </span>
              </button>
              {canClearSelection ? (
                <button
                  type="button"
                  className="thumbnail-pane-mode-inline-tool is-danger"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); clearSelectionFilter(); }}
                  aria-label={t('thumbnails.selection.clearFilter', { defaultValue: 'Clear selection filter and show all pages' })}
                  title={t('thumbnails.selection.clearFilter', { defaultValue: 'Clear selection filter and show all pages' })}
                >
                  <span className="material-icons" aria-hidden="true">close</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {paneMode === 'selection' ? (
        <DocumentSelectionPanel
          enabled={selectionPanelEnabled}
          pageLoadState={pageLoadState}
          documents={selectionDocuments}
          draftSelectionMask={draftSelectionMask}
          draftSelectionDirty={draftSelectionDirty}
          selectionActive={selectionActive}
          draftIncludedCount={draftIncludedCount}
          totalSessionPages={sessionTotalPages}
          onToggleAll={toggleDraftSelectAll}
          onToggleDocument={toggleDraftDocument}
          onTogglePage={toggleDraftPage}
          onSave={saveDraftSelection}
          onCancel={cancelDraftSelection}
          canOpenMetadataMatrix={canOpenMetadataMatrix}
          onOpenMetadataMatrix={onOpenMetadataMatrix}
        />
      ) : (
        <DocumentThumbnailList
          allPages={allPages}
          pageNumber={pageNumber}
          setPageNumber={setPageNumber}
          thumbnailsContainerRef={thumbnailsContainerRef}
          width={width}
          selectForCompare={selectForCompare}
          isComparing={isComparing}
          comparePageNumber={comparePageNumber}
          navigationModifierState={navigationModifierState}
          selectionPanelEnabled={selectionPanelEnabled}
          onHidePageFromSelection={hidePageFromSelection}
          onHideDocumentFromSelection={hideDocumentFromSelection}
          onOpenDocumentMetadata={onOpenDocumentMetadata}
        />
      )}
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
  sessionTotalPages: PropTypes.number.isRequired,
  selectForCompare: PropTypes.func,
  isComparing: PropTypes.bool,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }).isRequired,
  paneMode: PropTypes.oneOf(['thumbnails', 'selection']).isRequired,
  setPaneMode: PropTypes.func.isRequired,
  selectionPanelEnabled: PropTypes.bool.isRequired,
  pageLoadState: PropTypes.object,
  selectionDocuments: PropTypes.array.isRequired,
  draftSelectionMask: PropTypes.arrayOf(PropTypes.bool).isRequired,
  draftSelectionDirty: PropTypes.bool.isRequired,
  selectionActive: PropTypes.bool.isRequired,
  draftIncludedCount: PropTypes.number.isRequired,
  toggleDraftSelectAll: PropTypes.func.isRequired,
  toggleDraftDocument: PropTypes.func.isRequired,
  toggleDraftPage: PropTypes.func.isRequired,
  saveDraftSelection: PropTypes.func.isRequired,
  cancelDraftSelection: PropTypes.func.isRequired,
  clearSelectionFilter: PropTypes.func.isRequired,
  hidePageFromSelection: PropTypes.func.isRequired,
  hideDocumentFromSelection: PropTypes.func.isRequired,
  onOpenDocumentMetadata: PropTypes.func,
  canOpenMetadataMatrix: PropTypes.bool,
  onOpenMetadataMatrix: PropTypes.func,
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
