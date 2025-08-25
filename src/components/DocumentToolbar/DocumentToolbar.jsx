// File: src/components/DocumentToolbar/DocumentToolbar.jsx
/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * OpenDocViewer — Document Toolbar
 *
 * NOTE: Single print entry point with a dialog that supports:
 *  - Active page (default)
 *  - All pages
 *  - Page range (inclusive)
 */

import React, { useContext, useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import logger from '../../LogController.js';
import { ThemeContext } from '../../ThemeContext.jsx';
import usePageNavigation from '../../hooks/usePageNavigation.js';
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import ThemeToggleButton from './ThemeToggleButton.jsx';
import { handlePrint, handlePrintAll, handlePrintRange } from '../../utils/printUtils.js';
import PrintRangeDialog from './PrintRangeDialog.jsx';

/** Range (±) around 100% where sliders snap back to the neutral value. */
const SLIDER_CENTER_RANGE = 20;

/**
 * DocumentToolbar component.
 *
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.totalPages
 * @param {boolean} props.prevPageDisabled
 * @param {boolean} props.nextPageDisabled
 * @param {boolean} props.firstPageDisabled
 * @param {boolean} props.lastPageDisabled
 * @param {SetPageNumber} props.setPageNumber
 * @param {function(): void} props.zoomIn
 * @param {function(): void} props.zoomOut
 * @param {function(): void} props.fitToScreen
 * @param {function(): void} props.fitToWidth
 * @param {RefLike} props.documentRenderRef
 * @param {RefLike} props.viewerContainerRef
 * @param {function(): void} props.handleCompare
 * @param {boolean} props.isComparing
 * @param {{ rotation:number, brightness:number, contrast:number }} props.imageProperties
 * @param {function(number): void} props.handleRotationChange
 * @param {function({target:{value:*}}): void} props.handleBrightnessChange
 * @param {function({target:{value:*}}): void} props.handleContrastChange
 * @param {function(): void} props.resetImageProperties
 * @param {boolean} props.isExpanded
 * @param {SetBooleanState} props.setIsExpanded
 * @returns {React.ReactElement}
 */
const DocumentToolbar = ({
  pageNumber,
  totalPages,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  setPageNumber,
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  documentRenderRef,
  viewerContainerRef,
  handleCompare,
  isComparing,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  isExpanded,
  setIsExpanded,
}) => {
  const { toggleTheme } = useContext(ThemeContext);

  // Navigation helpers (single-step handlers + press-and-hold timers)
  const {
    handlePrevPageWrapper,
    handleNextPageWrapper,
    handleFirstPageWrapper,
    handleLastPageWrapper,
    startPrevPageTimer,
    stopPrevPageTimer,
    startNextPageTimer,
    stopNextPageTimer,
  } = usePageNavigation(setPageNumber, totalPages);

  // Print dialog state
  const [isPrintDialogOpen, setPrintDialogOpen] = useState(false);

  // Snap slider values near 100% to exactly 100% to make "neutral" easy to hit.
  const snapToZero = useMemo(
    () => (value) => (Math.abs(Number(value) - 100) <= SLIDER_CENTER_RANGE ? 100 : Number(value)),
    []
  );

  const handleBrightnessSliderChange = useCallback(
    (event) => {
      const raw = parseInt(event?.target?.value, 10);
      const value = Number.isFinite(raw) ? snapToZero(raw) : 100;
      handleBrightnessChange({ target: { value } });
    },
    [handleBrightnessChange, snapToZero]
  );

  const handleContrastSliderChange = useCallback(
    (event) => {
      const raw = parseInt(event?.target?.value, 10);
      const value = Number.isFinite(raw) ? snapToZero(raw) : 100;
      handleContrastChange({ target: { value } });
    },
    [handleContrastChange, snapToZero]
  );

  /** Toggle the canvas editing tools. Reset adjustments when turning the tools off. */
  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      resetImageProperties();
    }
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) {
        logger.info('Enabling canvas tools and forcing render');
        try { documentRenderRef.current?.forceRender?.(); } catch {}
      }
      return next;
    });
  }, [isExpanded, resetImageProperties, documentRenderRef, setIsExpanded]);

  /** Callback when the print dialog submits. */
  const handlePrintSubmit = useCallback((detail /* {mode:'active'|'all'|'range', from?:number, to?:number} */) => {
    setPrintDialogOpen(false);
    if (!detail || detail.mode === 'active') {
      handlePrint(documentRenderRef, { viewerContainerRef });
      return;
    }
    if (detail.mode === 'all') {
      handlePrintAll(documentRenderRef, { viewerContainerRef });
      return;
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      handlePrintRange(documentRenderRef, detail.from, detail.to, { viewerContainerRef });
    }
  }, [documentRenderRef, viewerContainerRef]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Document controls">
      {/* Single Print button → opens dialog (Active | All | Range) */}
      <button
        type="button"
        onClick={() => setPrintDialogOpen(true)}
        aria-label="Print"
        title="Print"
        className="odv-btn"
      >
        <span className="material-icons" aria-hidden="true">print</span>
      </button>

      <div className="separator" />

      {/* Paging controls */}
      <PageNavigationButtons
        prevPageDisabled={prevPageDisabled}
        nextPageDisabled={nextPageDisabled}
        firstPageDisabled={firstPageDisabled}
        lastPageDisabled={lastPageDisabled}
        startPrevPageTimer={startPrevPageTimer}
        stopPrevPageTimer={stopPrevPageTimer}
        startNextPageTimer={startNextPageTimer}
        stopNextPageTimer={stopNextPageTimer}
        handleFirstPage={handleFirstPageWrapper}
        handleLastPage={handleLastPageWrapper}
        handlePrevPage={handlePrevPageWrapper}
        handleNextPage={handleNextPageWrapper}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />

      <div className="separator" />

      {/* Zoom & fit */}
      <ZoomButtons
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
      />

      <div className="separator" />

      {/* Compare mode */}
      <button
        type="button"
        onClick={handleCompare}
        aria-label={isComparing ? 'Disable compare mode' : 'Enable compare mode'}
        title={isComparing ? 'Disable compare mode' : 'Enable compare mode'}
        className={`odv-btn compare-button ${isComparing ? 'compare-enabled' : 'compare-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">compare</span>
      </button>

      <div className="separator" />

      {/* Canvas editing tools toggle */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-label={isExpanded ? 'Disable canvas tools' : 'Enable canvas tools'}
        title={isExpanded ? 'Disable canvas tools' : 'Enable canvas tools'}
        className={`odv-btn editing-button ${isExpanded ? 'editing-enabled' : 'editing-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">edit</span>
      </button>

      {/* Editing controls (visible only when canvas tools are enabled) */}
      {isExpanded && (
        <div className="editing-tools" aria-label="Image adjustments">
          <button
            type="button"
            onClick={() => handleRotationChange(-90)}
            aria-label="Rotate left 90°"
            title="Rotate left 90°"
            className="odv-btn"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={() => handleRotationChange(90)}
            aria-label="Rotate right 90°"
            title="Rotate right 90°"
            className="odv-btn"
          >
            ⟳
          </button>

          <label className="slider-label">
            Brightness
            <input
              type="range"
              min="0"
              max="200"
              value={imageProperties.brightness}
              onChange={handleBrightnessSliderChange}
              className={imageProperties.brightness === 100 ? 'resting' : 'active'}
              aria-valuemin={0}
              aria-valuemax={200}
              aria-valuenow={imageProperties.brightness}
              aria-label="Adjust brightness"
            />
          </label>

          <label className="slider-label">
            Contrast
            <input
              type="range"
              min="0"
              max="200"
              value={imageProperties.contrast}
              onChange={handleContrastSliderChange}
              className={imageProperties.contrast === 100 ? 'resting' : 'active'}
              aria-valuemin={0}
              aria-valuemax={200}
              aria-valuenow={imageProperties.contrast}
              aria-label="Adjust contrast"
            />
          </label>
        </div>
      )}

      <div className="separator" />

      {/* Theme toggle */}
      <ThemeToggleButton toggleTheme={toggleTheme} />

      {/* Modal for print selection */}
      <PrintRangeDialog
        isOpen={isPrintDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        onSubmit={handlePrintSubmit}
        totalPages={totalPages}
      />
    </div>
  );
};

DocumentToolbar.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
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
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
};

export default React.memo(DocumentToolbar);
