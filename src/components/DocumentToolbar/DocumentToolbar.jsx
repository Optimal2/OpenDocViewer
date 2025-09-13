// File: src/components/DocumentToolbar/DocumentToolbar.jsx
/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * OpenDocViewer — Document Toolbar
 *
 * Renders the top toolbar with print, navigation, zoom, compare, and
 * canvas-editing controls. Integrates with i18n for labels/tooltips and
 * forwards print selections (including reason/forWhom) to the print pipeline.
 *
 * This component is memoized for performance.
 *
 * @component
 * @param {Object} props
 * @param {number} props.pageNumber - The currently active page (1-based).
 * @param {number} props.totalPages - Total number of pages in the document.
 * @param {boolean} props.prevPageDisabled - Disable the "previous page" button.
 * @param {boolean} props.nextPageDisabled - Disable the "next page" button.
 * @param {boolean} props.firstPageDisabled - Disable the "first page" button.
 * @param {boolean} props.lastPageDisabled - Disable the "last page" button.
 * @param {SetPageNumber} props.setPageNumber - State setter for page number (see jsdoc-types.js).
 * @param {function():void} props.zoomIn - Zoom in handler.
 * @param {function():void} props.zoomOut - Zoom out handler.
 * @param {function():void} props.fitToScreen - Fit-to-screen handler.
 * @param {function():void} props.fitToWidth - Fit-to-width handler.
 * @param {RefLike} props.documentRenderRef - Imperative handle to the renderer (see jsdoc-types.js).
 * @param {RefLike} props.viewerContainerRef - Ref to the viewer container element.
 * @param {function():void} props.handleCompare - Toggle compare mode.
 * @param {boolean} props.isComparing - Whether compare mode is active.
 * @param {{rotation:number,brightness:number,contrast:number}} props.imageProperties - Current canvas adjustments.
 * @param {function(number):void} props.handleRotationChange - Apply rotation delta in degrees (e.g., ±90).
 * @param {function(*):void} props.handleBrightnessChange - Brightness slider change handler (event-like).
 * @param {function(*):void} props.handleContrastChange - Contrast slider change handler (event-like).
 * @param {function():void} props.resetImageProperties - Reset brightness/contrast/rotation to defaults.
 * @param {boolean} props.isExpanded - Whether the canvas editing tool panel is open.
 * @param {SetBooleanState} props.setIsExpanded - Toggle state setter for the editing panel (see jsdoc-types.js).
 * @returns {JSX.Element}
 */

import React, { useContext, useCallback, useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

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

  /**
   * Handle brightness slider changes with neutral snapping at 100.
   * @param {*} event - Change event or event-like object with target.value
   * @returns {void}
   */
  const handleBrightnessSliderChange = useCallback(
    (event) => {
      const raw = parseInt(event?.target?.value, 10);
      const value = Number.isFinite(raw) ? snapToZero(raw) : 100;
      handleBrightnessChange({ target: { value } });
    },
    [handleBrightnessChange, snapToZero]
  );

  /**
   * Handle contrast slider changes with neutral snapping at 100.
   * @param {*} event - Change event or event-like object with target.value
   * @returns {void}
   */
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
   * Build a compact "pages" descriptor for logging.
   * @param {PrintSubmitDetail} detail
   * @returns {(string|null)} A string like "all", "3", "2-5", or "7,6,5".
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
   * @returns {void}
   */
  const submitUserPrintLog = useCallback((detail) => {
    try {
      userLog.submitPrint({
        action: 'print',
        reason: detail?.reason ?? null,
        forWhom: detail?.forWhom ?? null,
        docId: null,
        fileName: null,
        pageCount: totalPages ?? null,
        pages: toPagesString(detail),
        copies: 1
      });
    } catch { /* never throw */ }
  }, [toPagesString, totalPages]);

  /**
   * Handle the dialog submit event and dispatch the correct print action.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const handlePrintSubmit = useCallback((detail) => {
    setPrintDialogOpen(false);

    // Kick off user-log submission first (non-blocking).
    submitUserPrintLog(detail);

    // Common options passed to print helpers to enable header token substitution.
    const commonOpts = {
      viewerContainerRef,
      reason: detail?.reason || '',
      forWhom: detail?.forWhom || ''
    };

    if (!detail || detail.mode === 'active') {
      handlePrint(documentRenderRef, commonOpts);
      return;
    }
    if (detail.mode === 'all') {
      handlePrintAll(documentRenderRef, commonOpts);
      return;
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      handlePrintRange(documentRenderRef, detail.from, detail.to, commonOpts);
      return;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      handlePrintSequence(documentRenderRef, detail.sequence, commonOpts);
      return;
    }
  }, [documentRenderRef, viewerContainerRef, submitUserPrintLog]);

  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.aria.documentControls')}>
      {/* Print button → opens dialog */}
      <button
        type="button"
        onClick={() => setPrintDialogOpen(true)}
        aria-label={t('toolbar.print')}
        title={t('toolbar.print')}
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
        aria-label={t(isComparing ? 'toolbar.compare.disable' : 'toolbar.compare.enable')}
        title={t(isComparing ? 'toolbar.compare.disable' : 'toolbar.compare.enable')}
        className={`odv-btn compare-button ${isComparing ? 'compare-enabled' : 'compare-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">compare</span>
      </button>

      <div className="separator" />

      {/* Canvas editing tools toggle */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-label={t(isExpanded ? 'toolbar.editing.disable' : 'toolbar.editing.enable')}
        title={t(isExpanded ? 'toolbar.editing.disable' : 'toolbar.editing.enable')}
        className={`odv-btn editing-button ${isExpanded ? 'editing-enabled' : 'editing-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">edit</span>
      </button>

      {/* Editing controls (visible only when canvas tools are enabled) */}
      {isExpanded && (
        <div className="editing-tools" aria-label={t('toolbar.imageAdjustments')}>
          <button
            type="button"
            onClick={() => handleRotationChange(-90)}
            aria-label={t('toolbar.rotateLeft90')}
            title={t('toolbar.rotateLeft90')}
            className="odv-btn"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={() => handleRotationChange(90)}
            aria-label={t('toolbar.rotateRight90')}
            title={t('toolbar.rotateRight90')}
            className="odv-btn"
          >
            ⟳
          </button>

          <label className="slider-label">
            {t('toolbar.brightness')}
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
              aria-label={t('toolbar.adjustBrightness')}
            />
          </label>

          <label className="slider-label">
            {t('toolbar.contrast')}
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
              aria-label={t('toolbar.adjustContrast')}
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
