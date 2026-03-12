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
 * Props consumed by DocumentViewerToolbar.
 * @typedef {Object} DocumentViewerToolbarProps
 * @property {number} pageNumber
 * @property {number} totalPages
 * @property {boolean} isDocumentLoading
 * @property {function(number): void} setPageNumber
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToWidth
 * @property {number} zoom
 * @property {{ mode: ('FIT_PAGE'|'FIT_WIDTH'|'CUSTOM'), scale: number }} zoomState
 * @property {function(string): void} setZoomMode - Accepts FIT_PAGE, FIT_WIDTH, or CUSTOM.
 * @property {function(number): void} setZoom
 * @property {RefLike} viewerContainerRef
 * @property {RefLike} documentRenderRef
 * @property {boolean} isPrintDialogOpen
 * @property {function(): void} openPrintDialog
 * @property {function(): void} closePrintDialog
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
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
 * @property {boolean} needsViewerFocusHint
 * @property {function(): void} focusViewer
 */

/**
 * Renders the toolbar for the document viewer by delegating to <DocumentToolbar />.
 * @param {DocumentViewerToolbarProps} props
 * @returns {JSX.Element}
 */
const DocumentViewerToolbar = ({
  pageNumber,
  totalPages,
  isDocumentLoading,
  setPageNumber,
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  zoom,
  zoomState,
  setZoomMode,
  setZoom,
  viewerContainerRef,
  handleCompare,
  isComparing,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  documentRenderRef,
  isPrintDialogOpen,
  openPrintDialog,
  closePrintDialog,
  isExpanded,
  setIsExpanded,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  needsViewerFocusHint,
  focusViewer,
}) => {
  const compareDisabled = isExpanded;
  const editDisabled = isComparing;

  return (
    <DocumentToolbar
      pageNumber={pageNumber}
      totalPages={totalPages}
      isDocumentLoading={isDocumentLoading}
      setPageNumber={setPageNumber}
      zoom={zoom}
      zoomState={zoomState}
      setZoomMode={setZoomMode}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToScreen={fitToScreen}
      fitToWidth={fitToWidth}
      setZoom={setZoom}
      viewerContainerRef={viewerContainerRef}
      documentRenderRef={documentRenderRef}
      isPrintDialogOpen={isPrintDialogOpen}
      openPrintDialog={openPrintDialog}
      closePrintDialog={closePrintDialog}
      handleCompare={handleCompare}
      isComparing={isComparing}
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
      needsViewerFocusHint={needsViewerFocusHint}
      focusViewer={focusViewer}
    />
  );
};

DocumentViewerToolbar.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  isDocumentLoading: PropTypes.bool.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  zoom: PropTypes.number.isRequired,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'CUSTOM']).isRequired,
    scale: PropTypes.number.isRequired,
  }).isRequired,
  setZoomMode: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  viewerContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
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
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  needsViewerFocusHint: PropTypes.bool.isRequired,
  focusViewer: PropTypes.func.isRequired,
};

export default React.memo(DocumentViewerToolbar);
