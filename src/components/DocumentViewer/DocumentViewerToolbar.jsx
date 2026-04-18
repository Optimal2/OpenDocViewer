// File: src/components/DocumentViewer/DocumentViewerToolbar.jsx
/**
 * Toolbar adapter for the document viewer.
 *
 * Keeps the container/viewer layer decoupled from the concrete toolbar implementation by translating
 * viewer state and handlers into the prop shape expected by `DocumentToolbar`.
 */

import React from 'react';
import PropTypes from 'prop-types';
import DocumentToolbar from '../DocumentToolbar/DocumentToolbar.jsx';

/**
 * Ref-like shape used for imperative handles.
 * @typedef {Object} RefLike
 * @property {*} current
 */

/**
 * State setter that accepts a boolean or an updater callback.
 * @callback SetBooleanState
 * @param {(boolean|function(boolean): boolean)} next
 * @returns {void}
 */

/**
 * React-like numeric/original page setter used by the toolbar adapter.
 * Numeric values are interpreted as original session page numbers while updater functions operate on
 * the filtered visible page ordinal.
 *
 * @callback PageNumberSetter
 * @param {(number|function(number): number)} next
 * @returns {void}
 */

/**
 * Props consumed by DocumentViewerToolbar.
 * @typedef {Object} DocumentViewerToolbarProps
 * @property {number} pageNumber - Current visible page ordinal.
 * @property {number} pageNumberDisplay - Current original session page number.
 * @property {number} totalPages - Total visible pages.
 * @property {number} totalPagesDisplay - Total original session pages.
 * @property {boolean} isDocumentLoading
 * @property {PageNumberSetter} setPageNumber
 * @property {PageNumberSetter} setVisiblePageNumber
 * @property {PageNumberSetter} setComparePageNumber
 * @property {PageNumberSetter} setVisibleComparePageNumber
 * @property {function(string=): void} goToPreviousPage
 * @property {function(string=): void} goToNextPage
 * @property {function(string=): void} goToFirstPage
 * @property {function(string=): void} goToLastPage
 * @property {function(string=): void} goToPreviousDocument
 * @property {function(string=): void} goToNextDocument
 * @property {function(string=): void} goToFirstDocument
 * @property {function(string=): void} goToLastDocument
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void} actualSize
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToWidth
 * @property {number} zoom
 * @property {{ mode: ('FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'), scale: number }} zoomState
 * @property {function(string): void} setZoomMode - Accepts FIT_PAGE, FIT_WIDTH, ACTUAL_SIZE, or CUSTOM.
 * @property {function(number): void} setZoom
 * @property {RefLike} viewerContainerRef
 * @property {RefLike} documentRenderRef
 * @property {boolean} isPrintDialogOpen
 * @property {function(): void} openPrintDialog
 * @property {function(): void} closePrintDialog
 * @property {boolean} hasActiveSelection
 * @property {Array<number>} visibleOriginalPageNumbers
 * @property {number} selectionIncludedCount
 * @property {number} sessionTotalPages
 * @property {boolean} documentNavigationEnabled
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }} primaryDocumentNavigation
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }} compareDocumentNavigation
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
 * @property {(number|null)} comparePageNumber - Current visible compare-page ordinal.
 * @property {{ rotation:number, brightness:number, contrast:number }} imageProperties
 * @property {function(number): void} handleRotationChange
 * @property {function(*): void} handleBrightnessChange
 * @property {function(*): void} handleContrastChange
 * @property {function(): void} resetImageProperties
 * @property {boolean} isExpanded
 * @property {SetBooleanState} setIsExpanded
 * @property {boolean} prevPageDisabled
 * @property {boolean} nextPageDisabled
 * @property {boolean} firstPageDisabled
 * @property {boolean} lastPageDisabled
 */

/**
 * Renders the toolbar for the document viewer by delegating to <DocumentToolbar />.
 * @param {DocumentViewerToolbarProps} props
 * @returns {JSX.Element}
 */
const DocumentViewerToolbar = ({
  pageNumber,
  pageNumberDisplay,
  totalPages,
  totalPagesDisplay,
  isDocumentLoading,
  setPageNumber,
  setVisiblePageNumber,
  setComparePageNumber,
  setVisibleComparePageNumber,
  goToPreviousPage,
  goToNextPage,
  goToFirstPage,
  goToLastPage,
  goToPreviousDocument,
  goToNextDocument,
  goToFirstDocument,
  goToLastDocument,
  zoomIn,
  zoomOut,
  actualSize,
  fitToScreen,
  fitToWidth,
  zoom,
  zoomState,
  setZoomMode,
  setZoom,
  viewerContainerRef,
  handleCompare,
  isComparing,
  comparePageNumber,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  documentRenderRef,
  isPrintDialogOpen,
  openPrintDialog,
  closePrintDialog,
  hasActiveSelection,
  visibleOriginalPageNumbers,
  selectionIncludedCount,
  sessionTotalPages,
  documentNavigationEnabled,
  primaryDocumentNavigation,
  compareDocumentNavigation,
  isExpanded,
  setIsExpanded,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
}) => {
  const compareDisabled = isExpanded;
  const editDisabled = isComparing;

  return (
    <DocumentToolbar
      pageNumber={pageNumber}
      pageNumberDisplay={pageNumberDisplay}
      totalPages={totalPages}
      totalPagesDisplay={totalPagesDisplay}
      isDocumentLoading={isDocumentLoading}
      setPageNumber={setPageNumber}
      setVisiblePageNumber={setVisiblePageNumber}
      setComparePageNumber={setComparePageNumber}
      setVisibleComparePageNumber={setVisibleComparePageNumber}
      goToPreviousPage={goToPreviousPage}
      goToNextPage={goToNextPage}
      goToFirstPage={goToFirstPage}
      goToLastPage={goToLastPage}
      goToPreviousDocument={goToPreviousDocument}
      goToNextDocument={goToNextDocument}
      goToFirstDocument={goToFirstDocument}
      goToLastDocument={goToLastDocument}
      zoom={zoom}
      zoomState={zoomState}
      setZoomMode={setZoomMode}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      actualSize={actualSize}
      fitToScreen={fitToScreen}
      fitToWidth={fitToWidth}
      setZoom={setZoom}
      viewerContainerRef={viewerContainerRef}
      documentRenderRef={documentRenderRef}
      isPrintDialogOpen={isPrintDialogOpen}
      openPrintDialog={openPrintDialog}
      closePrintDialog={closePrintDialog}
      hasActiveSelection={hasActiveSelection}
      visibleOriginalPageNumbers={visibleOriginalPageNumbers}
      selectionIncludedCount={selectionIncludedCount}
      sessionTotalPages={sessionTotalPages}
      documentNavigationEnabled={documentNavigationEnabled}
      primaryDocumentNavigation={primaryDocumentNavigation}
      compareDocumentNavigation={compareDocumentNavigation}
      handleCompare={handleCompare}
      isComparing={isComparing}
      comparePageNumber={comparePageNumber}
      imageProperties={imageProperties}
      handleRotationChange={handleRotationChange}
      handleBrightnessChange={handleBrightnessChange}
      handleContrastChange={handleContrastChange}
      resetImageProperties={resetImageProperties}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      compareDisabled={compareDisabled}
      editDisabled={editDisabled}
      prevPageDisabled={prevPageDisabled}
      nextPageDisabled={nextPageDisabled}
      firstPageDisabled={firstPageDisabled}
      lastPageDisabled={lastPageDisabled}
    />
  );
};

DocumentViewerToolbar.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  pageNumberDisplay: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  totalPagesDisplay: PropTypes.number.isRequired,
  isDocumentLoading: PropTypes.bool.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  setVisiblePageNumber: PropTypes.func.isRequired,
  setComparePageNumber: PropTypes.func.isRequired,
  setVisibleComparePageNumber: PropTypes.func.isRequired,
  goToPreviousPage: PropTypes.func.isRequired,
  goToNextPage: PropTypes.func.isRequired,
  goToFirstPage: PropTypes.func.isRequired,
  goToLastPage: PropTypes.func.isRequired,
  goToPreviousDocument: PropTypes.func.isRequired,
  goToNextDocument: PropTypes.func.isRequired,
  goToFirstDocument: PropTypes.func.isRequired,
  goToLastDocument: PropTypes.func.isRequired,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  actualSize: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  zoom: PropTypes.number.isRequired,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'ACTUAL_SIZE', 'CUSTOM']).isRequired,
    scale: PropTypes.number.isRequired,
  }).isRequired,
  setZoomMode: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  viewerContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  comparePageNumber: PropTypes.number,
  imageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.isRequired,
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  isPrintDialogOpen: PropTypes.bool.isRequired,
  openPrintDialog: PropTypes.func.isRequired,
  closePrintDialog: PropTypes.func.isRequired,
  hasActiveSelection: PropTypes.bool.isRequired,
  visibleOriginalPageNumbers: PropTypes.arrayOf(PropTypes.number).isRequired,
  selectionIncludedCount: PropTypes.number.isRequired,
  sessionTotalPages: PropTypes.number.isRequired,
  documentNavigationEnabled: PropTypes.bool.isRequired,
  primaryDocumentNavigation: PropTypes.shape({
    canGoPrevious: PropTypes.bool.isRequired,
    canGoNext: PropTypes.bool.isRequired,
    canGoFirst: PropTypes.bool.isRequired,
    canGoLast: PropTypes.bool.isRequired,
  }).isRequired,
  compareDocumentNavigation: PropTypes.shape({
    canGoPrevious: PropTypes.bool.isRequired,
    canGoNext: PropTypes.bool.isRequired,
    canGoFirst: PropTypes.bool.isRequired,
    canGoLast: PropTypes.bool.isRequired,
  }).isRequired,
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
};

export default React.memo(DocumentViewerToolbar);
