// File: src/components/DocumentToolbar/DocumentToolbar.jsx
/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * Main toolbar UI for page navigation, zoom, compare/edit toggles, theme switching, and print entry.
 *
 * Responsibilities:
 * - render the visible toolbar controls and local dialog state
 * - delegate page-number behavior to the navigation hook
 * - delegate actual print work to `src/utils/print*.js`
 * - keep the visible control state aligned with the current viewer state
 *
 * This component should stay mostly presentational/orchestration-oriented. Core print logic, page
 * insertion, and zoom math belong in dedicated helpers or hooks.
 */

import React, { useContext, useCallback, useMemo, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import logger from '../../logging/systemLogger.js';
import userLog from '../../logging/userLogger.js';
import ThemeContext from '../../contexts/themeContext.js';
import usePageNavigation from '../../hooks/usePageNavigation.js';
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import ThemeToggleButton from './ThemeToggleButton.jsx';
import { handlePrint, handlePrintAll, handlePrintRange, handlePrintSequence } from '../../utils/printUtils.js';
import PrintRangeDialog from './PrintRangeDialog.jsx';


/**
 * Detail payload emitted by the print dialog.
 * @typedef {Object} PrintSubmitDetail
 * @property {'active'|'all'|'range'|'advanced'} mode
 * @property {number=} from
 * @property {number=} to
 * @property {Array<number>=} sequence
 * @property {'selection'|'session'=} allScope
 * @property {string=} reason
 * @property {string=} forWhom
 */

/**
 * Mutable ref-like object used by the toolbar.
 * @typedef {Object} AnyRef
 * @property {*} current
 */

/**
 * Editable image state shown by the toolbar.
 * @typedef {Object} ImageProperties
 * @property {number} rotation
 * @property {number} brightness
 * @property {number} contrast
 */

/**
 * React-like numeric page setter used by the toolbar.
 * @callback PageNumberSetter
 * @param {(number|function(number): number)} next
 * @returns {void}
 */

/**
 * Zoom display state used by the newer toolbar UX paths.
 * @typedef {Object} ZoomState
 * @property {'FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'} [mode]
 * @property {number} [scale]
 */

/**
 * Props for {@link DocumentToolbar}.
 * @typedef {Object} DocumentToolbarProps
 * @property {number} pageNumber
 * @property {number} pageNumberDisplay
 * @property {number} totalPages
 * @property {number} totalPagesDisplay
 * @property {boolean} isDocumentLoading
 * @property {boolean} prevPageDisabled
 * @property {boolean} nextPageDisabled
 * @property {boolean} firstPageDisabled
 * @property {boolean} lastPageDisabled
 * @property {PageNumberSetter} setPageNumber
 * @property {PageNumberSetter} [setComparePageNumber]
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void=} actualSize
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToWidth
 * @property {AnyRef} documentRenderRef
 * @property {AnyRef} viewerContainerRef
 * @property {boolean} isPrintDialogOpen
 * @property {function(): void} openPrintDialog
 * @property {function(): void} closePrintDialog
 * @property {function(): void} handleCompare
 * @property {function(): void=} closeCompare
 * @property {boolean} isComparing
 * @property {(number|null)=} comparePageNumber
 * @property {ImageProperties} imageProperties
 * @property {function(number): void} handleRotationChange
 * @property {function({ target: { value: number } }): void} handleBrightnessChange
 * @property {function({ target: { value: number } }): void} handleContrastChange
 * @property {function(): void} resetImageProperties
 * @property {boolean} isExpanded
 * @property {function(*): void} setIsExpanded
 * @property {number=} zoom
 * @property {ZoomState=} zoomState
 * @property {function(*): void=} setZoomMode
 * @property {function(number): void=} setZoom
 * @property {boolean=} compareDisabled
 * @property {boolean=} editDisabled
 * @property {boolean=} hasActiveSelection
 * @property {Array<number>=} visibleOriginalPageNumbers
 * @property {number=} selectionIncludedCount
 * @property {number=} sessionTotalPages
 */

/** Range (±) around 100% where sliders snap back to the neutral value. */
const SLIDER_CENTER_RANGE = 20;
/** Epsilon for considering zoom ≈ 100% (0.5%). */
const ONE_TO_ONE_EPS = 0.005;

/**
 * Clamp a page number into the valid viewer range while preserving a safe fallback.
 *
 * @param {*} value
 * @param {number} totalPages
 * @param {number=} fallbackPage
 * @returns {number}
 */
function normalizeToolbarPageNumber(value, totalPages, fallbackPage = 1) {
  const total = Math.max(1, Number(totalPages) || 1);
  const fallback = Math.max(1, Math.min(total, Math.floor(Number(fallbackPage) || 1)));
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(total, numeric));
}

/**
 * Toolbar shell for page navigation, zoom, compare/edit toggles, theme switching, and print entry.
 *
 * The component owns only local toolbar UI state. Page rendering, zoom math, and print execution
 * are delegated to dedicated hooks and helper modules.
 *
 * @param {DocumentToolbarProps} props
 * @returns {*}
 */
const DocumentToolbar = ({
  pageNumber,
  pageNumberDisplay = pageNumber,
  totalPages,
  totalPagesDisplay = totalPages,
  isDocumentLoading = false,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  setPageNumber,
  setComparePageNumber,
  zoomIn,
  zoomOut,
  actualSize,
  fitToScreen,
  fitToWidth,
  documentRenderRef,
  viewerContainerRef,
  isPrintDialogOpen = false,
  openPrintDialog,
  closePrintDialog,
  handleCompare,
  isComparing,
  comparePageNumber = null,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  isExpanded,
  setIsExpanded,
  // Optional zoom-display state used by newer toolbar UX paths.
  zoom,
  zoomState,
  setZoomMode,
  setZoom,
  // Optional UI flags that keep Compare and Edit mutually exclusive.
  compareDisabled = false,
  editDisabled = false,
  hasActiveSelection = false,
  visibleOriginalPageNumbers = [],
  selectionIncludedCount = 0,
  sessionTotalPages = totalPagesDisplay,
}) => {
  const { toggleTheme } = useContext(ThemeContext);
  const { t } = useTranslation();
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    /**
     * @param {KeyboardEvent} event
     * @returns {void}
     */
    const syncShiftState = (event) => {
      setIsShiftPressed(!!event?.shiftKey);
    };

    /**
     * @returns {void}
     */
    const clearShiftState = () => {
      setIsShiftPressed(false);
    };

    /**
     * @returns {void}
     */
    const handleVisibilityChange = () => {
      if (document.hidden) clearShiftState();
    };

    window.addEventListener('keydown', syncShiftState, true);
    window.addEventListener('keyup', syncShiftState, true);
    window.addEventListener('blur', clearShiftState, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);

    return () => {
      window.removeEventListener('keydown', syncShiftState, true);
      window.removeEventListener('keyup', syncShiftState, true);
      window.removeEventListener('blur', clearShiftState, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange, true);
    };
  }, []);

  // Seed optional user-log context once so later print actions can attach host metadata.
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

  // Navigation helpers (single-step handlers + press-and-hold timers).
  // Shift steers the right compare pane when compare mode is available. The compare-targeted setter
  // already enables compare mode automatically, so toolbar clicks behave like Shift+thumbnail-click.
  const primaryNavigation = usePageNavigation(setPageNumber, totalPages);
  const compareNavigation = usePageNavigation(setComparePageNumber, totalPages);
  const {
    handlePrevPageWrapper: handlePrimaryPrevPage,
    handleNextPageWrapper: handlePrimaryNextPage,
    handleFirstPageWrapper: handlePrimaryFirstPage,
    handleLastPageWrapper: handlePrimaryLastPage,
    startPrevPageTimer: startPrimaryPrevPageTimer,
    stopPrevPageTimer: stopPrimaryPrevPageTimer,
    startNextPageTimer: startPrimaryNextPageTimer,
    stopNextPageTimer: stopPrimaryNextPageTimer,
  } = primaryNavigation;
  const {
    handlePrevPageWrapper: handleComparePrevPage,
    handleNextPageWrapper: handleCompareNextPage,
    handleFirstPageWrapper: handleCompareFirstPage,
    handleLastPageWrapper: handleCompareLastPage,
    startPrevPageTimer: startComparePrevPageTimer,
    stopPrevPageTimer: stopComparePrevPageTimer,
    startNextPageTimer: startCompareNextPageTimer,
    stopNextPageTimer: stopCompareNextPageTimer,
  } = compareNavigation;

  const wantsCompareTarget = useCallback((event) => !!event?.shiftKey, []);

  const canTargetCompare = useCallback((event) => {
    if (!wantsCompareTarget(event)) return false;
    if (compareDisabled) return false;
    return typeof setComparePageNumber === 'function';
  }, [compareDisabled, setComparePageNumber, wantsCompareTarget]);

  const invokeNavigation = useCallback((event, primaryHandler, compareHandler) => {
    if (wantsCompareTarget(event)) {
      if (canTargetCompare(event)) {
        compareHandler?.();
      } else {
        event?.preventDefault?.();
        event?.stopPropagation?.();
      }
      return;
    }
    primaryHandler?.();
  }, [canTargetCompare, wantsCompareTarget]);

  const handlePrevPage = useCallback((event) => {
    invokeNavigation(event, handlePrimaryPrevPage, handleComparePrevPage);
  }, [handleComparePrevPage, handlePrimaryPrevPage, invokeNavigation]);

  const handleNextPage = useCallback((event) => {
    invokeNavigation(event, handlePrimaryNextPage, handleCompareNextPage);
  }, [handleCompareNextPage, handlePrimaryNextPage, invokeNavigation]);

  const handleFirstPage = useCallback((event) => {
    invokeNavigation(event, handlePrimaryFirstPage, handleCompareFirstPage);
  }, [handleCompareFirstPage, handlePrimaryFirstPage, invokeNavigation]);

  const handleLastPage = useCallback((event) => {
    invokeNavigation(event, handlePrimaryLastPage, handleCompareLastPage);
  }, [handleCompareLastPage, handlePrimaryLastPage, invokeNavigation]);

  const startPrevPageTimer = useCallback((direction, event) => {
    if (wantsCompareTarget(event)) {
      if (canTargetCompare(event)) startComparePrevPageTimer(direction);
      return;
    }
    startPrimaryPrevPageTimer(direction);
  }, [canTargetCompare, startComparePrevPageTimer, startPrimaryPrevPageTimer, wantsCompareTarget]);

  const stopPrevPageTimer = useCallback(() => {
    stopPrimaryPrevPageTimer();
    stopComparePrevPageTimer();
  }, [stopComparePrevPageTimer, stopPrimaryPrevPageTimer]);

  const startNextPageTimer = useCallback((direction, event) => {
    if (wantsCompareTarget(event)) {
      if (canTargetCompare(event)) startCompareNextPageTimer(direction);
      return;
    }
    startPrimaryNextPageTimer(direction);
  }, [canTargetCompare, startCompareNextPageTimer, startPrimaryNextPageTimer, wantsCompareTarget]);

  const stopNextPageTimer = useCallback(() => {
    stopPrimaryNextPageTimer();
    stopCompareNextPageTimer();
  }, [stopCompareNextPageTimer, stopPrimaryNextPageTimer]);

  const compareNavigationEnabled = !compareDisabled && typeof setComparePageNumber === 'function';
  const compareNavigationPage = useMemo(
    () => normalizeToolbarPageNumber(comparePageNumber, totalPages, pageNumber),
    [comparePageNumber, pageNumber, totalPages]
  );
  const useCompareDisabledState = isShiftPressed && compareNavigationEnabled;

  const effectivePrevPageDisabled = useCompareDisabledState
    ? compareNavigationPage <= 1
    : !!prevPageDisabled;
  const effectiveNextPageDisabled = useCompareDisabledState
    ? compareNavigationPage >= Math.max(1, totalPages || 1)
    : !!nextPageDisabled;
  const effectiveFirstPageDisabled = useCompareDisabledState
    ? compareNavigationPage <= 1
    : !!firstPageDisabled;
  const effectiveLastPageDisabled = useCompareDisabledState
    ? compareNavigationPage >= Math.max(1, totalPages || 1)
    : !!lastPageDisabled;


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
      if (next) logger.info('Enabling canvas tools');
      return next;
    });
  }, [isExpanded, resetImageProperties, setIsExpanded]);

  /**
   * Build a compact "pages" descriptor for logging.
   * @param {PrintSubmitDetail} detail
   * @returns {(string|null)} A string like "all", "3", "2-5", or "7,6,5".
   */
  const toPagesString = useCallback((detail) => {
    if (!detail) return null;
    if (detail.mode === 'all') return detail.allScope === 'selection' ? 'selection' : 'all';
    if (detail.mode === 'active') return String(pageNumberDisplay);
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return `${detail.from}-${detail.to}`;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      return detail.sequence.join(',');
    }
    return null;
  }, [pageNumberDisplay]);

  /**
   * Estimate the number of pages the user is about to print.
   * @param {PrintSubmitDetail} detail
   * @returns {(number|null)}
   */
  const resolvePrintPageCount = useCallback((detail) => {
    if (!detail) return 1;
    if (detail.mode === 'active') return 1;
    if (detail.mode === 'all') {
      if (detail.allScope === 'selection' && hasActiveSelection) return visibleOriginalPageNumbers.length;
      return Math.max(0, Number(sessionTotalPages) || 0);
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return Math.abs(Math.floor(detail.to) - Math.floor(detail.from)) + 1;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence)) {
      return detail.sequence.length;
    }
    return null;
  }, [hasActiveSelection, sessionTotalPages, visibleOriginalPageNumbers]);

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
        pageCount: resolvePrintPageCount(detail),
        pages: toPagesString(detail),
        copies: 1
      });
    } catch { /* never throw */ }
  }, [resolvePrintPageCount, toPagesString]);

  /**
   * Handle the dialog submit event and dispatch the correct print action.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const handlePrintSubmit = useCallback((detail) => {
    closePrintDialog?.();

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
      if (detail.allScope === 'selection' && Array.isArray(visibleOriginalPageNumbers) && visibleOriginalPageNumbers.length) {
        handlePrintSequence(documentRenderRef, visibleOriginalPageNumbers, commonOpts);
        return;
      }
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
  }, [closePrintDialog, documentRenderRef, submitUserPrintLog, viewerContainerRef, visibleOriginalPageNumbers]);

  // Derived display values (safe defaults if optional props are absent)
  const zoomPercent = Number.isFinite(zoom) ? Math.round(Number(zoom) * 100) : undefined;
  const zoomMode = zoomState?.mode || 'CUSTOM';

  // 1:1 active when NOT in a FIT mode and zoom ≈ 1.0
  const isOneToOneActive =
    (zoomMode !== 'FIT_PAGE' && zoomMode !== 'FIT_WIDTH') &&
    (typeof zoom === 'number' && Math.abs(zoom - 1) <= ONE_TO_ONE_EPS);

  // Apply typed percent → set zoom and switch to CUSTOM
  const handlePercentApply = useCallback((percentInt) => {
    if (typeof setZoom === 'function') setZoom(percentInt / 100);
    if (typeof setZoomMode === 'function') setZoomMode('CUSTOM');
  }, [setZoom, setZoomMode]);

  // 1:1 click → prefer the dedicated actual-size handler when provided.
  const handleActualSize = useCallback(() => {
    if (typeof actualSize === 'function') {
      actualSize();
      return;
    }
    if (typeof setZoom === 'function') setZoom(1);
    if (typeof setZoomMode === 'function') setZoomMode('ACTUAL_SIZE');
  }, [actualSize, setZoom, setZoomMode]);

  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.aria.documentControls')}>
      {/* Print button → opens dialog */}
      <button
        type="button"
        onClick={() => openPrintDialog?.()}
        aria-label={t('toolbar.print')}
        title={t('toolbar.print')}
        className="odv-btn"
      >
        <span className="material-icons" aria-hidden="true">print</span>
      </button>

      <div className="separator" />

      {/* Paging controls (now include editable page field inside the group) */}
      <PageNavigationButtons
        prevPageDisabled={effectivePrevPageDisabled}
        nextPageDisabled={effectiveNextPageDisabled}
        firstPageDisabled={effectiveFirstPageDisabled}
        lastPageDisabled={effectiveLastPageDisabled}
        startPrevPageTimer={startPrevPageTimer}
        stopPrevPageTimer={stopPrevPageTimer}
        startNextPageTimer={startNextPageTimer}
        stopNextPageTimer={stopNextPageTimer}
        handleFirstPage={handleFirstPage}
        handleLastPage={handleLastPage}
        handlePrevPage={handlePrevPage}
        handleNextPage={handleNextPage}
        pageNumber={pageNumber}
        pageNumberDisplay={pageNumberDisplay}
        totalPages={totalPages}
        totalPagesDisplay={totalPagesDisplay}
        /* NEW: allow manual page entry to apply immediately */
        onGoToPage={setPageNumber}
        isDocumentLoading={isDocumentLoading}
      />

      <div className="separator" />

      {/* Zoom & fit */}
      <ZoomButtons
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
        onActualSize={handleActualSize}
        zoomMode={zoomMode}
        zoomPercent={zoomPercent}
        isOneToOneActive={isOneToOneActive}
        onPercentApply={handlePercentApply}
      />

      <div className="separator" />

      {/* Compare mode */}
      <button
        type="button"
        onClick={handleCompare}
        aria-label={t(isComparing ? 'toolbar.compare.disable' : 'toolbar.compare.enable')}
        title={t(isComparing ? 'toolbar.compare.disable' : 'toolbar.compare.enable')}
        className={`odv-btn compare-button ${isComparing ? 'compare-enabled' : 'compare-disabled'}`}
        disabled={!!compareDisabled}
        aria-disabled={!!compareDisabled}
      >
        <span className="material-icons" aria-hidden="true">compare</span>
      </button>

      {isComparing && (
        <div className="toolbar-inline-hint compare-shortcut-hint" role="note">
          {t('toolbar.compare.shiftHint', {
            defaultValue: 'Shift steers right pane. Shift + Esc closes.'
          })}
        </div>
      )}

      <div className="separator" />

      {/* Canvas editing tools toggle */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-label={t(isExpanded ? 'toolbar.editing.disable' : 'toolbar.editing.enable')}
        title={t(isExpanded ? 'toolbar.editing.disable' : 'toolbar.editing.enable')}
        className={`odv-btn editing-button ${isExpanded ? 'editing-enabled' : 'editing-disabled'}`}
        disabled={!!editDisabled}
        aria-disabled={!!editDisabled}
      >
        <span className="material-icons" aria-hidden="true">edit</span>
      </button>

      {/* Editing controls (visible only when canvas tools are enabled).
          Wrapped in a white "group" to match the zoom/paging clusters. */}
      {isExpanded && (
        <div className="zoom-fixed-group editing-tools" aria-label={t('toolbar.imageAdjustments')}>
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

      {/* Theme toggle (also mapped to key "6") */}
      <ThemeToggleButton toggleTheme={toggleTheme} />



      {/* Modal for print selection + reason/forWhom */}
      <PrintRangeDialog
        isOpen={isPrintDialogOpen}
        onClose={() => closePrintDialog?.()}
        onSubmit={handlePrintSubmit}
        totalPages={totalPagesDisplay}
        isDocumentLoading={isDocumentLoading}
        activePageNumber={pageNumberDisplay}
        hasActiveSelection={hasActiveSelection}
        selectionIncludedCount={selectionIncludedCount}
        sessionTotalPages={sessionTotalPages}
      />
    </div>
  );
};

DocumentToolbar.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  pageNumberDisplay: PropTypes.number,
  totalPages: PropTypes.number.isRequired,
  totalPagesDisplay: PropTypes.number,
  isDocumentLoading: PropTypes.bool,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  setComparePageNumber: PropTypes.func,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  actualSize: PropTypes.func,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  viewerContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  isPrintDialogOpen: PropTypes.bool,
  openPrintDialog: PropTypes.func,
  closePrintDialog: PropTypes.func,
  handleCompare: PropTypes.func.isRequired,
  closeCompare: PropTypes.func,
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
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
  zoom: PropTypes.number,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'ACTUAL_SIZE', 'CUSTOM']),
    scale: PropTypes.number,
  }),
  setZoomMode: PropTypes.func,
  setZoom: PropTypes.func,
  compareDisabled: PropTypes.bool,
  editDisabled: PropTypes.bool,
  hasActiveSelection: PropTypes.bool,
  visibleOriginalPageNumbers: PropTypes.arrayOf(PropTypes.number),
  selectionIncludedCount: PropTypes.number,
  sessionTotalPages: PropTypes.number,
};

export default React.memo(DocumentToolbar);
