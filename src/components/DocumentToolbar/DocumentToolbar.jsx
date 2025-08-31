/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * OpenDocViewer — Document Toolbar
 *
 * Single print entry point + dialog that collects:
 *  - Page selection (active / all / range / advanced)
 *  - User-print metadata (reason, forWhom) when enabled by config
 *
 * The dialog submits a detail object; we forward reason/forWhom to
 * UserLogController in a non-blocking way before starting the print job.
 */

/**
 * JSDoc typedefs for the print dialog payload (avoid TS-style unions).
 * @typedef {Object} PrintSubmitDetail
 * @property {string} mode  Allowed values: "active" | "all" | "range" | "advanced".
 * @property {number} [from]
 * @property {number} [to]
 * @property {Array<number>} [sequence]
 * @property {?string} [reason]
 * @property {?string} [forWhom]
 */

import React, { useContext, useCallback, useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import logger from '../../LogController.js';
import userLog from '../../UserLogController.js';
import { ThemeContext } from '../../ThemeContext.jsx';
import usePageNavigation from '../../hooks/usePageNavigation.js';
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import ThemeToggleButton from './ThemeToggleButton.jsx';
import { handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence } from '../../utils/printUtils.js';
import PrintRangeDialog from './PrintRangeDialog.jsx';

/** Range (±) around 100% where sliders snap back to the neutral value. */
const SLIDER_CENTER_RANGE = 20;

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

  // Initialize optional context for user logging (iframe id, app version)
  useEffect(() => {
    try {
      const iframeId = typeof window !== 'undefined' && window.frameElement ? (window.frameElement.id || null) : null;
      userLog.initContext({ iframeId });
    } catch {}
    try {
      // If the host/build injects a version variable, attach it.
      const ver =
        (typeof window !== 'undefined' && (window.__ODV_APP_VERSION__ || window.__APP_VERSION__)) ||
        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_VERSION) ||
        null;
      if (ver) userLog.setViewerVersion(String(ver));
    } catch {}
  }, []);

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

  /**
   * Build a compact "pages" descriptor for logging:
   *  - 'all'
   *  - current page number for 'active'
   *  - 'from-to' for range
   *  - comma-joined sequence for advanced
   * @param {PrintSubmitDetail} detail
   * @returns {?string}
   */
  const toPagesString = useCallback((detail) => {
    if (!detail) return null;
    if (detail.mode === 'all') return 'all';
    if (detail.mode === 'active') return String(pageNumber);
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return `${detail.from}-${detail.to}`;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      return detail.sequence.join(',');
    }
    return null;
  }, [pageNumber]);

  /**
   * Fire-and-forget user print log. Must never block the print action.
   * @param {PrintSubmitDetail} detail
   */
  const submitUserPrintLog = useCallback((detail) => {
    try {
      userLog.submitPrint({
        action: 'print',
        reason: detail?.reason ?? null,
        forWhom: detail?.forWhom ?? null,
        docId: null,         // supply if you have a stable id
        fileName: null,      // supply if available
        pageCount: totalPages ?? null,
        pages: toPagesString(detail),
        copies: 1
      });
    } catch {
      /* never throw */
    }
  }, [toPagesString, totalPages]);

  /**
   * Callback when the print dialog submits.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const handlePrintSubmit = useCallback((detail) => {
    setPrintDialogOpen(false);

    // Kick off user-log submission first (non-blocking).
    submitUserPrintLog(detail);

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
      return;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      handlePrintSequence(documentRenderRef, detail.sequence, { viewerContainerRef });
      return;
    }
  }, [documentRenderRef, viewerContainerRef, submitUserPrintLog]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Document controls">
      {/* Print button → opens dialog */}
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

      {/* Modal for print selection + reason/forWhom */}
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
