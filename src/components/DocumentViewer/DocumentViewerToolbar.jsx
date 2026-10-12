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
 * @property {'off'|'pending'|'ready'|'active'|'warning'|'error'} runtimeStatusLedState
 * @property {string} runtimeStatusLedTitle
 * @property {number} pageNumber - Current visible page ordinal.
 * @property {number} pageNumberDisplay - Current original session page number.
 * @property {number} totalPages - Total visible pages.
 * @property {boolean} isDocumentLoading
 * @property {Object=} pageLoadState
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
 * @property {function(): void} fitToCustomWidth
 * @property {function(): void} fitToWidth
 * @property {number} zoom
 * @property {{ mode: ('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM'), scale: number }} zoomState
 * @property {function(string): void} setZoomMode - Accepts FIT_PAGE, FIT_WIDTH, FIT_CUSTOM, ACTUAL_SIZE, or CUSTOM.
 * @property {number} customFitWidthFactorPercent
 * @property {{ widthFactorPercent:number, heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }} customFitSizeLimits
 * @property {{ widthFactorPercent:number, heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }} configuredCustomFitSizeLimits
 * @property {{ widthFactorPercent:(number|null), heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }} userCustomFitSizeLimits
 * @property {number} configuredCustomFitWidthFactorPercent
 * @property {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|null)} userDefaultZoomMode
 * @property {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')} configuredDefaultZoomMode
 * @property {function(number): void} setCustomFitWidthFactorPercent
 * @property {function({ widthFactorPercent:*, heightFactorPercent:*, actualSizeFactorPercent:* }): void} setCustomFitSizeLimits
 * @property {function((string|null)): void} setDefaultZoomModePreference
 * @property {function(number): void} setZoom
 * @property {RefLike} documentRenderRef
 * @property {Object} printPipeline The shared print pipeline (DocumentToolbar/usePrintPipeline.js).
 * @property {boolean=} printSelectionSequenceLocked
 * @property {boolean=} printSelectionWorkspaceEnabled
 * @property {boolean=} printSelectionWorkspaceActive
 * @property {Object|null=} printSelectionWorkspaceToolbarState
 * @property {boolean=} canOpenPrintSelectionWorkspace
 * @property {function(): void=} openPrintSelectionWorkspace
 * @property {Array<*>} allPages
 * @property {boolean} documentNavigationEnabled
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }} primaryDocumentNavigation
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }} compareDocumentNavigation
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
 * @property {'primary'|'compare'} activePane
 * @property {(number|null)} comparePageNumber - Current visible compare-page ordinal.
 * @property {(number|null)} comparePageNumberDisplay - Current original session compare-page number.
 * @property {{ shift:boolean, ctrl:boolean }} navigationModifierState
 * @property {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} primaryImageProperties
 * @property {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} compareImageProperties
 * @property {{ primary:Object, compare:Object }=} compareTransforms
 * @property {function(number, string=): void} handleRotationChange
 * @property {function(*, string=): void} handleBrightnessChange
 * @property {function(*, string=): void} handleContrastChange
 * @property {function(string=): void} resetImageProperties
 * @property {boolean} isExpanded
 * @property {SetBooleanState} setIsExpanded
 * @property {boolean} prevPageDisabled
 * @property {boolean} nextPageDisabled
 * @property {boolean} firstPageDisabled
 * @property {boolean} lastPageDisabled
 * @property {(Object|null)=} signatureSummary - Signed-document totals for the toolbar overview button (null when nothing loaded is signed).
 * @property {function(HTMLElement=): void=} onOpenSignatureOverview - Opens the signature overview dialog; receives the button for focus return.
 * @property {boolean=} canOpenCompareOverlay - True in compare mode with two pages shown.
 * @property {function(): void=} openCompareOverlay - Opens the overlay view of the two compared pages.
 * @property {boolean=} compareCalibrated - True when the overlay view has calibrated the two pages.
 * @property {function(): void=} openCompareCurtain - Opens the curtain view of the calibrated pages.
 * @property {{ primary:boolean, compare:boolean }=} compareAdjustPanelsExpanded - Expanded state of the per-pane adjustment panels.
 */

/**
 * Renders the toolbar for the document viewer by delegating to <DocumentToolbar />.
 * @param {DocumentViewerToolbarProps} props
 * @returns {JSX.Element}
 */
const DocumentViewerToolbar = ({
  runtimeStatusLedState,
  runtimeStatusLedTitle,
  pageNumber,
  pageNumberDisplay,
  totalPages,
  isDocumentLoading,
  pageLoadState,
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
  fitToCustomWidth,
  fitToWidth,
  zoom,
  zoomState,
  setZoomMode,
  customFitWidthFactorPercent,
  customFitSizeLimits,
  configuredCustomFitSizeLimits,
  userCustomFitSizeLimits,
  configuredCustomFitWidthFactorPercent,
  userDefaultZoomMode,
  configuredDefaultZoomMode,
  setCustomFitWidthFactorPercent,
  setCustomFitSizeLimits,
  setDefaultZoomModePreference,
  setZoom,
  handleCompare,
  isComparing,
  activePane,
  comparePageNumber,
  comparePageNumberDisplay,
  navigationModifierState,
  primaryImageProperties,
  compareImageProperties,
  compareTransforms = undefined,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  documentRenderRef,
  printPipeline,
  printSelectionSequenceLocked = false,
  printSelectionWorkspaceEnabled = false,
  printSelectionWorkspaceActive = false,
  printSelectionWorkspaceToolbarState = null,
  canOpenPrintSelectionWorkspace = false,
  openPrintSelectionWorkspace,
  allPages,
  documentNavigationEnabled,
  primaryDocumentNavigation,
  compareDocumentNavigation,
  isExpanded,
  setIsExpanded,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  signatureSummary = null,
  onOpenSignatureOverview,
  canOpenCompareOverlay = false,
  openCompareOverlay,
  compareCalibrated = false,
  openCompareCurtain,
  compareAdjustPanelsExpanded = undefined,
}) => {
  return (
    <DocumentToolbar
      runtimeStatusLedState={runtimeStatusLedState}
      runtimeStatusLedTitle={runtimeStatusLedTitle}
      pageNumber={pageNumber}
      pageNumberDisplay={pageNumberDisplay}
      totalPages={totalPages}
      isDocumentLoading={isDocumentLoading}
      pageLoadState={pageLoadState}
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
      fitToCustomWidth={fitToCustomWidth}
      fitToWidth={fitToWidth}
      setZoom={setZoom}
      customFitWidthFactorPercent={customFitWidthFactorPercent}
      customFitSizeLimits={customFitSizeLimits}
      configuredCustomFitSizeLimits={configuredCustomFitSizeLimits}
      userCustomFitSizeLimits={userCustomFitSizeLimits}
      configuredCustomFitWidthFactorPercent={configuredCustomFitWidthFactorPercent}
      userDefaultZoomMode={userDefaultZoomMode}
      configuredDefaultZoomMode={configuredDefaultZoomMode}
      setCustomFitWidthFactorPercent={setCustomFitWidthFactorPercent}
      setCustomFitSizeLimits={setCustomFitSizeLimits}
      setDefaultZoomModePreference={setDefaultZoomModePreference}
      documentRenderRef={documentRenderRef}
      printPipeline={printPipeline}
      printSelectionSequenceLocked={printSelectionSequenceLocked}
      printSelectionWorkspaceEnabled={printSelectionWorkspaceEnabled}
      printSelectionWorkspaceActive={printSelectionWorkspaceActive}
      printSelectionWorkspaceToolbarState={printSelectionWorkspaceToolbarState}
      canOpenPrintSelectionWorkspace={canOpenPrintSelectionWorkspace}
      openPrintSelectionWorkspace={openPrintSelectionWorkspace}
      allPages={allPages || []}
      documentNavigationEnabled={documentNavigationEnabled}
      primaryDocumentNavigation={primaryDocumentNavigation}
      compareDocumentNavigation={compareDocumentNavigation}
      handleCompare={handleCompare}
      isComparing={isComparing}
      activePane={activePane}
      comparePageNumber={comparePageNumber}
      comparePageNumberDisplay={comparePageNumberDisplay}
      navigationModifierState={navigationModifierState}
      primaryImageProperties={primaryImageProperties}
      compareImageProperties={compareImageProperties}
      compareTransforms={compareTransforms}
      handleRotationChange={handleRotationChange}
      handleBrightnessChange={handleBrightnessChange}
      handleContrastChange={handleContrastChange}
      resetImageProperties={resetImageProperties}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      prevPageDisabled={prevPageDisabled}
      nextPageDisabled={nextPageDisabled}
      firstPageDisabled={firstPageDisabled}
      lastPageDisabled={lastPageDisabled}
      signatureSummary={signatureSummary}
      onOpenSignatureOverview={onOpenSignatureOverview}
      canOpenCompareOverlay={canOpenCompareOverlay}
      openCompareOverlay={openCompareOverlay}
      compareCalibrated={compareCalibrated}
      openCompareCurtain={openCompareCurtain}
      compareAdjustPanelsExpanded={compareAdjustPanelsExpanded}
    />
  );
};

DocumentViewerToolbar.propTypes = {
  runtimeStatusLedState: PropTypes.oneOf(['off', 'pending', 'ready', 'active', 'warning', 'error']).isRequired,
  runtimeStatusLedTitle: PropTypes.string.isRequired,
  pageNumber: PropTypes.number.isRequired,
  pageNumberDisplay: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  isDocumentLoading: PropTypes.bool.isRequired,
  pageLoadState: PropTypes.object,
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
  fitToCustomWidth: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  zoom: PropTypes.number.isRequired,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', 'CUSTOM']).isRequired,
    scale: PropTypes.number.isRequired,
  }).isRequired,
  setZoomMode: PropTypes.func.isRequired,
  customFitWidthFactorPercent: PropTypes.number.isRequired,
  customFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }).isRequired,
  configuredCustomFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }).isRequired,
  userCustomFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }).isRequired,
  configuredCustomFitWidthFactorPercent: PropTypes.number.isRequired,
  userDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', null]),
  configuredDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE']).isRequired,
  setCustomFitWidthFactorPercent: PropTypes.func.isRequired,
  setCustomFitSizeLimits: PropTypes.func.isRequired,
  setDefaultZoomModePreference: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  activePane: PropTypes.oneOf(['primary', 'compare']).isRequired,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  comparePageNumberDisplay: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }).isRequired,
  primaryImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
    grayscale: PropTypes.number,
    invert: PropTypes.bool,
  }).isRequired,
  compareImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
    grayscale: PropTypes.number,
    invert: PropTypes.bool,
  }).isRequired,
  compareTransforms: PropTypes.shape({
    primary: PropTypes.shape({
      scale: PropTypes.number,
      dx: PropTypes.number,
      dy: PropTypes.number,
      rotation: PropTypes.number,
    }),
    compare: PropTypes.shape({
      scale: PropTypes.number,
      dx: PropTypes.number,
      dy: PropTypes.number,
      rotation: PropTypes.number,
    }),
  }),
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.isRequired,
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  printPipeline: PropTypes.object.isRequired,
  printSelectionSequenceLocked: PropTypes.bool,
  printSelectionWorkspaceEnabled: PropTypes.bool,
  printSelectionWorkspaceActive: PropTypes.bool,
  printSelectionWorkspaceToolbarState: PropTypes.object,
  canOpenPrintSelectionWorkspace: PropTypes.bool,
  openPrintSelectionWorkspace: PropTypes.func,
  allPages: PropTypes.arrayOf(PropTypes.any),
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
  signatureSummary: PropTypes.shape({
    documentCount: PropTypes.number,
    signatureCount: PropTypes.number,
    severity: PropTypes.oneOf(['ok', 'warning', 'error']),
  }),
  onOpenSignatureOverview: PropTypes.func,
  canOpenCompareOverlay: PropTypes.bool,
  openCompareOverlay: PropTypes.func,
  compareCalibrated: PropTypes.bool,
  openCompareCurtain: PropTypes.func,
  compareAdjustPanelsExpanded: PropTypes.shape({
    primary: PropTypes.bool,
    compare: PropTypes.bool,
  }),
};

export default React.memo(DocumentViewerToolbar);
