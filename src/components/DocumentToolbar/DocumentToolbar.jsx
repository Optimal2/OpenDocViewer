// File: src/components/DocumentToolbar/DocumentToolbar.jsx
/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * Main toolbar UI for page navigation, zoom, comparison, image adjustments, help, language, and print entry.
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

import React, { useCallback, useMemo, useEffect, useRef, useState, useContext } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import userLog from '../../logging/userLogger.js';
import logger from '../../logging/systemLogger.js';
import usePageNavigation from '../../hooks/usePageNavigation.js';
import usePageTimer from '../../hooks/usePageTimer.js';
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import LanguageMenuButton from './LanguageMenuButton.jsx';
import ThemeMenuButton from './ThemeMenuButton.jsx';
import { handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintRange, handlePrintSequence, handlePrintWarmFrame, handlePdfOutput, handlePdfCurrent, handlePdfCurrentComparison } from '../../utils/printUtils.js';
import PrintRangeDialog from './PrintRangeDialog.jsx';
import HelpMenuButton from './HelpMenuButton.jsx';
import ManualOverlayDialog from './ManualOverlayDialog.jsx';
import AboutOverlayDialog from './AboutOverlayDialog.jsx';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import ViewerContext from '../../contexts/viewerContext.js';
import StatusLed from '../common/StatusLed.jsx';
import { createWarmPrintFrame, disposeWarmPrintFrame, shouldEnableWarmPrintFrame } from '../../utils/printWarmFrame.js';

const EMPTY_PDF_PROGRESS = Object.freeze({ open: false, action: '', phase: '', current: 0, progressValue: 0, page: 0, total: 0, error: '' });

/**
 * @param {*} error
 * @returns {boolean}
 */
function isPdfAbortError(error) {
  return String(error?.name || '') === 'AbortError';
}

/**
 * @param {function(string,Object=): string} t
 * @param {{ phase:string, current:number, page:number, total:number }} progress
 * @returns {string}
 */
function formatPdfProgressBody(t, progress) {
  if (progress.phase === 'loading-library') {
    return t('printDialog.pdfProgress.loadingLibrary', {
      defaultValue: 'Preparing PDF engine…',
    });
  }
  if (progress.phase === 'loading-images') {
    return t('printDialog.pdfProgress.loadingImages', {
      current: progress.current,
      total: progress.total,
      defaultValue: `Preparing pages: ${progress.current} of ${progress.total}.`,
    });
  }
  if (progress.phase === 'generating-page' && progress.page > 0) {
    return t('printDialog.pdfProgress.generatingPage', {
      current: progress.current,
      page: progress.page,
      total: progress.total,
      defaultValue: `Generated ${progress.current} of ${progress.total} pages. Processing page ${progress.page}.`,
    });
  }
  if (progress.phase === 'finalizing') {
    return t('printDialog.pdfProgress.finalizing', {
      defaultValue: 'Finalizing PDF file…',
    });
  }
  if (progress.phase === 'opening-preview') {
    return t('printDialog.pdfProgress.openingPreview', {
      defaultValue: 'Opening PDF preview…',
    });
  }
  if (progress.phase === 'downloading') {
    return t('printDialog.pdfProgress.downloading', {
      defaultValue: 'Preparing PDF download…',
    });
  }
  return t('printDialog.pdfProgress.body', {
    current: progress.current,
    total: progress.total,
    phase: progress.phase,
    defaultValue: `Generated ${progress.current} of ${progress.total} pages.`,
  });
}

/**
 * @param {{ current:number, progressValue:number, total:number }} progress
 * @returns {number}
 */
function getPdfProgressPercent(progress) {
  const total = Math.max(1, Number(progress.total) || 1);
  const rawValue = Number(progress.progressValue);
  const value = Number.isFinite(rawValue) ? rawValue : progress.current;
  return Math.max(4, Math.min(100, Math.round((Math.max(0, Math.min(total, value)) / total) * 100)));
}


/**
 * Detail payload emitted by the print dialog.
 * @typedef {Object} PrintSubmitDetail
 * @property {'active'|'all'|'range'|'advanced'} mode
 * @property {number=} from
 * @property {number=} to
 * @property {Array<number>=} sequence
 * @property {'selection'|'session'=} allScope
 * @property {'primary'|'compare-both'=} activeScope
 * @property {string=} reason
 * @property {string=} forWhom
 * @property {string=} printFormat
 * @property {string=} printFormatValue
 * @property {Object=} reasonSelection
 * @property {Object=} printFormatSelection
 * @property {'html'|'pdf'=} printBackend
 * @property {'print'|'download'=} printAction
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
 * @property {PageNumberSetter=} setVisiblePageNumber
 * @property {PageNumberSetter} [setComparePageNumber]
 * @property {PageNumberSetter=} [setVisibleComparePageNumber]
 * @property {function(string=): void} [goToPreviousDocument]
 * @property {function(string=): void} [goToNextDocument]
 * @property {function(string=): void} [goToFirstDocument]
 * @property {function(string=): void} [goToLastDocument]
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
 * @property {boolean=} printEnabled
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
 * @property {(number|null)=} comparePageNumber
 * @property {(number|null)=} comparePageNumberDisplay
 * @property {{ shift:boolean, ctrl:boolean }=} navigationModifierState
 * @property {ImageProperties} primaryImageProperties
 * @property {ImageProperties} compareImageProperties
 * @property {function(number, ('primary'|'compare')=): void} handleRotationChange
 * @property {function({ target: { value: number } }, ('primary'|'compare')=): void} handleBrightnessChange
 * @property {function({ target: { value: number } }, ('primary'|'compare')=): void} handleContrastChange
 * @property {function(('primary'|'compare')=): void} resetImageProperties
 * @property {number=} zoom
 * @property {ZoomState=} zoomState
 * @property {function(*): void=} setZoomMode
 * @property {function(number): void=} setZoom
 * @property {boolean=} hasActiveSelection
 * @property {Array<number>=} visibleOriginalPageNumbers
 * @property {number=} selectionIncludedCount
 * @property {number=} sessionTotalPages
 * @property {Object|null=} bundle
 * @property {Array<*>=} allPages
 * @property {boolean=} documentNavigationEnabled
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }=} primaryDocumentNavigation
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }=} compareDocumentNavigation
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
 * Toolbar shell for page navigation, zoom, comparison, image adjustments, help, language, and print entry.
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
  setVisiblePageNumber,
  setComparePageNumber,
  setVisibleComparePageNumber,
  goToPreviousDocument,
  goToNextDocument,
  goToFirstDocument,
  goToLastDocument,
  zoomIn,
  zoomOut,
  actualSize,
  fitToScreen,
  fitToWidth,
  documentRenderRef,
  compareRef,
  viewerContainerRef,
  isPrintDialogOpen = false,
  openPrintDialog,
  closePrintDialog,
  printEnabled = true,
  handleCompare,
  isComparing,
  comparePageNumber = null,
  comparePageNumberDisplay = null,
  navigationModifierState = { shift: false, ctrl: false },
  primaryImageProperties,
  compareImageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  // Optional zoom-display state used by newer toolbar UX paths.
  zoom,
  zoomState,
  setZoomMode,
  setZoom,
  hasActiveSelection = false,
  visibleOriginalPageNumbers = [],
  selectionIncludedCount = 0,
  sessionTotalPages = totalPagesDisplay,
  bundle = null,
  allPages = [],
  documentNavigationEnabled = false,
  primaryDocumentNavigation = undefined,
  compareDocumentNavigation = undefined,
}) => {
  const { t, i18n } = useTranslation();
  const viewerContext = useContext(ViewerContext);
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [openAdjustmentMenu, setOpenAdjustmentMenu] = useState(/** @type {(null|'brightness'|'contrast')} */ (null));
  const [pdfProgress, setPdfProgress] = useState(/** @type {{ open:boolean, action:string, phase:string, current:number, progressValue:number, page:number, total:number, error:string }} */ (EMPTY_PDF_PROGRESS));
  const [printWarmFrameStatus, setPrintWarmFrameStatus] = useState(/** @type {'off'|'pending'|'ready'|'warning'|'error'} */ ('off'));
  const warmPrintFrameRef = useRef(/** @type {*} */ (null));
  const warmPrintBuildSeqRef = useRef(0);
  const pdfAbortControllerRef = useRef(/** @type {AbortController|null} */ (null));
  const pdfStartTimeoutRef = useRef(/** @type {number|null} */ (null));
  const pdfRunSeqRef = useRef(0);
  const documentRepeatTargetRef = useRef('primary');
  const brightnessButtonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const contrastButtonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const brightnessMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contrastMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const isShiftPressed = navigationModifierState.shift;
  const isCtrlPressed = navigationModifierState.ctrl;
  const compareTargetAvailable = typeof setComparePageNumber === 'function' && totalPages > 0;
  const comparePaneVisible = compareTargetAvailable && isComparing && Number.isFinite(comparePageNumber);

  useEffect(() => {
    if (!openAdjustmentMenu) return undefined;

    const activeButtonRef = openAdjustmentMenu === 'brightness' ? brightnessButtonRef : contrastButtonRef;
    const activeMenuRef = openAdjustmentMenu === 'brightness' ? brightnessMenuRef : contrastMenuRef;

    /** @param {MouseEvent | TouchEvent} event */
    const handlePointerDown = (event) => {
      const target = event?.target;
      if (activeButtonRef.current && activeButtonRef.current.contains(target)) return;
      if (activeMenuRef.current && activeMenuRef.current.contains(target)) return;
      setOpenAdjustmentMenu(null);
    };

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpenAdjustmentMenu(null);
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [openAdjustmentMenu]);

  useEffect(() => {
    setOpenAdjustmentMenu(null);
  }, [comparePageNumber, isComparing, pageNumber]);

  useEffect(() => {
    if (!isDocumentLoading) return;
    if (isPrintDialogOpen) closePrintDialog?.();
  }, [closePrintDialog, isDocumentLoading, isPrintDialogOpen]);

  // Seed optional user-log context once so later print actions can attach host metadata.
  useEffect(() => {
    try {
      const iframeId = typeof window !== 'undefined' && window.frameElement ? (window.frameElement.id || null) : null;
      userLog.initContext({ iframeId });
    } catch (error) {
      const name = String(error?.name || '');
      logger.info('Could not resolve iframe element context', {
        reason: name || 'unknown',
        crossOriginRestricted: name === 'SecurityError',
      });
    }
    try {
      // If the host/build injects a version variable, attach it.
      const ver =
        (typeof window !== 'undefined' && (window.__ODV_APP_VERSION__ || window.__APP_VERSION__)) ||
        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_VERSION) ||
        null;
      if (ver) userLog.setViewerVersion(String(ver));
    } catch {}
  }, []);

  const normalizedPrimaryDocumentNavigation = useMemo(() => ({
    canGoPrevious: !!primaryDocumentNavigation?.canGoPrevious,
    canGoNext: !!primaryDocumentNavigation?.canGoNext,
    canGoFirst: !!primaryDocumentNavigation?.canGoFirst,
    canGoLast: !!primaryDocumentNavigation?.canGoLast,
  }), [primaryDocumentNavigation]);
  const normalizedCompareDocumentNavigation = useMemo(() => ({
    canGoPrevious: !!compareDocumentNavigation?.canGoPrevious,
    canGoNext: !!compareDocumentNavigation?.canGoNext,
    canGoFirst: !!compareDocumentNavigation?.canGoFirst,
    canGoLast: !!compareDocumentNavigation?.canGoLast,
  }), [compareDocumentNavigation]);

  // Navigation helpers (single-step handlers + press-and-hold timers).
  // Shift steers the right compare pane and can open compare mode on demand. Ctrl switches the
  // scope to whole-document stepping when more than one visible document exists.
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

  const handleDocumentPrevRepeatStep = useCallback(() => {
    const target = documentRepeatTargetRef.current === 'compare' ? 'compare' : 'primary';
    goToPreviousDocument?.(target);
  }, [goToPreviousDocument]);
  const handleDocumentNextRepeatStep = useCallback(() => {
    const target = documentRepeatTargetRef.current === 'compare' ? 'compare' : 'primary';
    goToNextDocument?.(target);
  }, [goToNextDocument]);
  const {
    startPageTimer: startDocumentPrevPageTimer,
    stopPageTimer: stopDocumentPrevPageTimer,
  } = usePageTimer(500, handleDocumentPrevRepeatStep);
  const {
    startPageTimer: startDocumentNextPageTimer,
    stopPageTimer: stopDocumentNextPageTimer,
  } = usePageTimer(500, handleDocumentNextRepeatStep);

  const getEffectiveModifierState = useCallback((event) => {
    const base = navigationModifierState || { shift: false, ctrl: false };
    const shift = typeof event?.shiftKey === 'boolean'
      ? !!event.shiftKey
      : !!base.shift;
    const ctrl = typeof event?.ctrlKey === 'boolean'
      ? (!!event.ctrlKey && !event?.metaKey && !event?.altKey)
      : !!base.ctrl;
    return { shift, ctrl };
  }, [navigationModifierState]);

  const wantsCompareTarget = useCallback(
    (event) => getEffectiveModifierState(event).shift && compareTargetAvailable,
    [compareTargetAvailable, getEffectiveModifierState]
  );
  const wantsDocumentScope = useCallback(
    (event) => getEffectiveModifierState(event).ctrl && !!documentNavigationEnabled,
    [documentNavigationEnabled, getEffectiveModifierState]
  );

  const canTargetCompare = useCallback((event) => wantsCompareTarget(event), [wantsCompareTarget]);

  const resolveNavigationTarget = useCallback((event) => {
    if (wantsCompareTarget(event) && canTargetCompare(event)) return 'compare';
    return 'primary';
  }, [canTargetCompare, wantsCompareTarget]);

  const resolveNavigationScope = useCallback((event) => (
    wantsDocumentScope(event) ? 'document' : 'page'
  ), [wantsDocumentScope]);

  const resolveEditingTarget = useCallback((event) => {
    if (!comparePaneVisible) return 'primary';
    return wantsCompareTarget(event) ? 'compare' : 'primary';
  }, [comparePaneVisible, wantsCompareTarget]);

  const blockUnavailableCompareTarget = useCallback((event) => {
    if (!wantsCompareTarget(event)) return false;
    if (canTargetCompare(event)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }, [canTargetCompare, wantsCompareTarget]);

  const invokePageNavigationForTarget = useCallback((target, direction) => {
    const safeTarget = target === 'compare' ? 'compare' : 'primary';
    if (direction === 'prev') {
      if (safeTarget === 'compare') handleComparePrevPage?.();
      else handlePrimaryPrevPage?.();
      return;
    }
    if (direction === 'next') {
      if (safeTarget === 'compare') handleCompareNextPage?.();
      else handlePrimaryNextPage?.();
      return;
    }
    if (direction === 'first') {
      if (safeTarget === 'compare') handleCompareFirstPage?.();
      else handlePrimaryFirstPage?.();
      return;
    }
    if (safeTarget === 'compare') handleCompareLastPage?.();
    else handlePrimaryLastPage?.();
  }, [
    handleCompareFirstPage,
    handleCompareLastPage,
    handleCompareNextPage,
    handleComparePrevPage,
    handlePrimaryFirstPage,
    handlePrimaryLastPage,
    handlePrimaryNextPage,
    handlePrimaryPrevPage,
  ]);

  const invokeDocumentNavigationForTarget = useCallback((target, direction) => {
    const safeTarget = target === 'compare' ? 'compare' : 'primary';
    if (direction === 'prev') { goToPreviousDocument?.(safeTarget); return; }
    if (direction === 'next') { goToNextDocument?.(safeTarget); return; }
    if (direction === 'first') { goToFirstDocument?.(safeTarget); return; }
    goToLastDocument?.(safeTarget);
  }, [goToFirstDocument, goToLastDocument, goToNextDocument, goToPreviousDocument]);

  const invokeNavigation = useCallback((event, direction) => {
    if (blockUnavailableCompareTarget(event)) return;
    const target = resolveNavigationTarget(event);
    const scope = resolveNavigationScope(event);
    if (scope === 'document') {
      invokeDocumentNavigationForTarget(target, direction);
      return;
    }
    invokePageNavigationForTarget(target, direction);
  }, [
    blockUnavailableCompareTarget,
    invokeDocumentNavigationForTarget,
    invokePageNavigationForTarget,
    resolveNavigationScope,
    resolveNavigationTarget,
  ]);

  const handlePrevPage = useCallback((event) => {
    invokeNavigation(event, 'prev');
  }, [invokeNavigation]);

  const handleNextPage = useCallback((event) => {
    invokeNavigation(event, 'next');
  }, [invokeNavigation]);

  const handleFirstPage = useCallback((event) => {
    invokeNavigation(event, 'first');
  }, [invokeNavigation]);

  const handleLastPage = useCallback((event) => {
    invokeNavigation(event, 'last');
  }, [invokeNavigation]);

  const startPrevPageTimer = useCallback((direction, event) => {
    if (blockUnavailableCompareTarget(event)) return;
    const target = resolveNavigationTarget(event);
    const scope = resolveNavigationScope(event);
    if (scope === 'document') {
      documentRepeatTargetRef.current = target;
      startDocumentPrevPageTimer(direction);
      return;
    }
    if (target === 'compare') startComparePrevPageTimer(direction);
    else startPrimaryPrevPageTimer(direction);
  }, [
    blockUnavailableCompareTarget,
    resolveNavigationScope,
    resolveNavigationTarget,
    startComparePrevPageTimer,
    startDocumentPrevPageTimer,
    startPrimaryPrevPageTimer,
  ]);

  const stopPrevPageTimer = useCallback(() => {
    stopPrimaryPrevPageTimer();
    stopComparePrevPageTimer();
    stopDocumentPrevPageTimer();
  }, [stopComparePrevPageTimer, stopDocumentPrevPageTimer, stopPrimaryPrevPageTimer]);

  const startNextPageTimer = useCallback((direction, event) => {
    if (blockUnavailableCompareTarget(event)) return;
    const target = resolveNavigationTarget(event);
    const scope = resolveNavigationScope(event);
    if (scope === 'document') {
      documentRepeatTargetRef.current = target;
      startDocumentNextPageTimer(direction);
      return;
    }
    if (target === 'compare') startCompareNextPageTimer(direction);
    else startPrimaryNextPageTimer(direction);
  }, [
    blockUnavailableCompareTarget,
    resolveNavigationScope,
    resolveNavigationTarget,
    startCompareNextPageTimer,
    startDocumentNextPageTimer,
    startPrimaryNextPageTimer,
  ]);

  const stopNextPageTimer = useCallback(() => {
    stopPrimaryNextPageTimer();
    stopCompareNextPageTimer();
    stopDocumentNextPageTimer();
  }, [stopCompareNextPageTimer, stopDocumentNextPageTimer, stopPrimaryNextPageTimer]);

  const compareNavigationPage = useMemo(
    () => normalizeToolbarPageNumber(comparePageNumber, totalPages, pageNumber),
    [comparePageNumber, pageNumber, totalPages]
  );
  const compareNavigationPageDisplay = useMemo(
    () => (Number.isFinite(comparePageNumberDisplay)
      ? Math.max(1, Number(comparePageNumberDisplay))
      : compareNavigationPage),
    [compareNavigationPage, comparePageNumberDisplay]
  );
  const navigationTargetMode = isShiftPressed && compareTargetAvailable ? 'compare' : 'primary';
  const navigationScopeMode = isCtrlPressed && documentNavigationEnabled ? 'document' : 'page';
  const activeNavigationPageNumber = navigationTargetMode === 'compare'
    ? compareNavigationPage
    : normalizeToolbarPageNumber(pageNumber, totalPages, 1);
  const editingTargetMode = comparePaneVisible && navigationTargetMode === 'compare' ? 'compare' : 'primary';
  const editingProperties = editingTargetMode === 'compare' ? compareImageProperties : primaryImageProperties;
  const editingGroupTitle = editingTargetMode === 'compare'
    ? t('toolbar.editingTargetCompare', { defaultValue: 'Editing the right compare page (Shift)' })
    : t('toolbar.editingTargetPrimary', { defaultValue: 'Editing the primary / left page' });
  const activeDocumentNavigation = navigationTargetMode === 'compare'
    ? normalizedCompareDocumentNavigation
    : normalizedPrimaryDocumentNavigation;
  const useComparePageDisabledState = navigationScopeMode === 'page'
    && navigationTargetMode === 'compare'
    && comparePaneVisible;

  const effectivePrevPageDisabled = navigationScopeMode === 'document'
    ? !activeDocumentNavigation.canGoPrevious
    : (useComparePageDisabledState ? compareNavigationPage <= 1 : !!prevPageDisabled);
  const effectiveNextPageDisabled = navigationScopeMode === 'document'
    ? !activeDocumentNavigation.canGoNext
    : (useComparePageDisabledState ? compareNavigationPage >= Math.max(1, totalPages || 1) : !!nextPageDisabled);
  const effectiveFirstPageDisabled = navigationScopeMode === 'document'
    ? !activeDocumentNavigation.canGoFirst
    : (useComparePageDisabledState ? compareNavigationPage <= 1 : !!firstPageDisabled);
  const effectiveLastPageDisabled = navigationScopeMode === 'document'
    ? !activeDocumentNavigation.canGoLast
    : (useComparePageDisabledState ? compareNavigationPage >= Math.max(1, totalPages || 1) : !!lastPageDisabled);

  const navigationModeTitle = useMemo(() => {
    const scopeLabel = navigationScopeMode === 'document'
      ? t('toolbar.navigation.scopeDocument', { defaultValue: 'Document navigation' })
      : t('toolbar.navigation.scopePage', { defaultValue: 'Page navigation' });
    const targetLabel = navigationTargetMode === 'compare'
      ? t('toolbar.navigation.targetCompare', { defaultValue: 'right compare pane' })
      : t('toolbar.navigation.targetPrimary', { defaultValue: 'primary / left pane' });
    return t('toolbar.navigation.modeTitle', {
      scope: scopeLabel,
      target: targetLabel,
      defaultValue: `${scopeLabel} · ${targetLabel}`,
    });
  }, [navigationScopeMode, navigationTargetMode, t]);

  const navigationButtonTitles = useMemo(() => ({
    first: navigationScopeMode === 'document'
      ? t('toolbar.firstDocument', { defaultValue: 'First document' })
      : t('toolbar.firstPage'),
    previous: navigationScopeMode === 'document'
      ? t('toolbar.previousDocument', { defaultValue: 'Previous document' })
      : t('toolbar.previousPage'),
    next: navigationScopeMode === 'document'
      ? t('toolbar.nextDocument', { defaultValue: 'Next document' })
      : t('toolbar.nextPage'),
    last: navigationScopeMode === 'document'
      ? t('toolbar.lastDocument', { defaultValue: 'Last document' })
      : t('toolbar.lastPage'),
  }), [navigationScopeMode, t]);

  const handleGoToPageInput = useCallback((nextVisiblePageNumber) => {
    if (navigationTargetMode === 'compare' && compareTargetAvailable && typeof setVisibleComparePageNumber === 'function') {
      setVisibleComparePageNumber(nextVisiblePageNumber);
      return;
    }
    if (typeof setVisiblePageNumber === 'function') {
      setVisiblePageNumber(nextVisiblePageNumber);
      return;
    }
    setPageNumber(nextVisiblePageNumber);
  }, [compareTargetAvailable, navigationTargetMode, setPageNumber, setVisibleComparePageNumber, setVisiblePageNumber]);

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
      handleBrightnessChange({ target: { value } }, resolveEditingTarget(event));
    },
    [handleBrightnessChange, resolveEditingTarget, snapToZero]
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
      handleContrastChange({ target: { value } }, resolveEditingTarget(event));
    },
    [handleContrastChange, resolveEditingTarget, snapToZero]
  );

  /**
   * @param {*} event
   * @param {number} delta
   * @returns {void}
   */
  const handleRotationButtonClick = useCallback((event, delta) => {
    handleRotationChange(delta, resolveEditingTarget(event));
  }, [handleRotationChange, resolveEditingTarget]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handleResetAdjustmentsClick = useCallback((event) => {
    resetImageProperties(resolveEditingTarget(event));
    setOpenAdjustmentMenu(null);
  }, [resetImageProperties, resolveEditingTarget]);

  /**
   * @param {'brightness'|'contrast'} menuKey
   * @returns {void}
   */
  const toggleAdjustmentMenu = useCallback((menuKey) => {
    setOpenAdjustmentMenu((current) => (current === menuKey ? null : menuKey));
  }, []);

  const handleBrightnessReset = useCallback((event) => {
    handleBrightnessChange({ target: { value: 100 } }, resolveEditingTarget(event));
  }, [handleBrightnessChange, resolveEditingTarget]);

  const handleContrastReset = useCallback((event) => {
    handleContrastChange({ target: { value: 100 } }, resolveEditingTarget(event));
  }, [handleContrastChange, resolveEditingTarget]);

  const isBrightnessAdjusted = Number(editingProperties?.brightness || 100) !== 100;
  const isContrastAdjusted = Number(editingProperties?.contrast || 100) !== 100;

  /**
   * Build a compact "pages" descriptor for logging.
   * @param {PrintSubmitDetail} detail
   * @returns {(string|null)} A string like "all", "3", "2-5", or "7,6,5".
   */
  const toPagesString = useCallback((detail) => {
    if (!detail) return null;
    if (detail.mode === 'all') return detail.allScope === 'selection' ? 'selection' : 'all';
    if (detail.mode === 'active') return detail.activeScope === 'compare-both'
      ? `${pageNumberDisplay},${compareNavigationPageDisplay ?? pageNumberDisplay}`
      : String(pageNumberDisplay);
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return `${detail.from}-${detail.to}`;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      return detail.sequence.join(',');
    }
    return null;
  }, [compareNavigationPageDisplay, pageNumberDisplay]);

  /**
   * Estimate the number of pages the user is about to print.
   * @param {PrintSubmitDetail} detail
   * @returns {(number|null)}
   */
  const resolvePrintPageCount = useCallback((detail) => {
    if (!detail) return 1;
    if (detail.mode === 'active') return detail.activeScope === 'compare-both' ? 2 : 1;
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
   * Resolve page metadata objects aligned with the printed page sequence.
   * Page numbers are 1-based original session page numbers.
   * @param {Array<number>} pageNumbers
   * @returns {Array<*>}
   */
  const resolvePrintPageContexts = useCallback((pageNumbers) => {
    if (!Array.isArray(pageNumbers) || !pageNumbers.length) return [];
    const pages = Array.isArray(allPages) ? allPages : [];
    return pageNumbers.map((pageNumber) => {
      const index = Math.floor(Number(pageNumber) || 0) - 1;
      const page = index >= 0 ? (pages[index] || null) : null;
      return page ? { ...page, originalPageNumber: index + 1 } : { originalPageNumber: index + 1 };
    });
  }, [allPages]);

  /**
   * @param {PrintSubmitDetail} detail
   * @returns {Array<number>}
   */
  const resolvePrintPageNumbers = useCallback((detail) => {
    if (!detail || detail.mode === 'active') {
      if (detail?.activeScope === 'compare-both' && isComparing) {
        return [pageNumberDisplay, compareNavigationPageDisplay]
          .map((value) => Math.floor(Number(value) || 0))
          .filter((value) => value > 0);
      }
      const active = Math.floor(Number(pageNumberDisplay) || 0);
      return active > 0 ? [active] : [];
    }
    if (detail.mode === 'all') {
      if (detail.allScope === 'selection' && Array.isArray(visibleOriginalPageNumbers) && visibleOriginalPageNumbers.length) {
        return visibleOriginalPageNumbers.slice();
      }
      return Array.from({ length: Math.max(0, Math.floor(Number(sessionTotalPages) || 0)) }, (_value, index) => index + 1);
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      const total = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
      const from = Math.max(1, Math.min(total, Math.floor(Number(detail.from) || 1)));
      const to = Math.max(1, Math.min(total, Math.floor(Number(detail.to) || 1)));
      const out = [];
      if (from <= to) {
        for (let n = from; n <= to; n += 1) out.push(n);
      } else {
        for (let n = from; n >= to; n -= 1) out.push(n);
      }
      return out;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence)) return detail.sequence.slice();
    return [];
  }, [compareNavigationPageDisplay, isComparing, pageNumberDisplay, sessionTotalPages, visibleOriginalPageNumbers]);

  /**
   * @param {PrintSubmitDetail} detail
   * @returns {Object}
   */
  const makePrintOptions = useCallback((detail) => {
    const pageNumbers = resolvePrintPageNumbers(detail);
    return {
      viewerContainerRef,
      documentRenderRef,
      reason: detail?.reason || '',
      forWhom: detail?.forWhom || '',
      printFormat: detail?.printFormat || '',
      reasonSelection: detail?.reasonSelection || null,
      printFormatSelection: detail?.printFormatSelection || null,
      bundle: bundle || null,
      pageNumbers,
      pageContexts: resolvePrintPageContexts(pageNumbers),
      printHeaderCfg: getRuntimeConfig().printHeader || {},
      printFooterCfg: getRuntimeConfig().printFooter || {},
      printFormatCfg: getRuntimeConfig().print?.format || {},
      pdfCfg: getRuntimeConfig().print?.pdf || {},
      action: detail?.printAction === 'download' ? 'download' : 'print',
      filename: getRuntimeConfig().print?.pdf?.filename || 'opendocviewer-print.pdf',
    };
  }, [bundle, documentRenderRef, resolvePrintPageContexts, resolvePrintPageNumbers, viewerContainerRef]);

  /**
   * Fire-and-forget user print log. Must never block the print action.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const submitUserPrintLog = useCallback((detail) => {
    try {
      userLog.submitPrint({
        action: detail?.printAction === 'download' ? 'download-pdf' : (detail?.printBackend === 'pdf' ? 'print-pdf' : 'print'),
        reason: detail?.reason ?? null,
        forWhom: detail?.forWhom ?? null,
        printFormat: detail?.printFormat ?? null,
        printFormatValue: detail?.printFormatValue ?? null,
        docId: null,
        fileName: null,
        pageCount: resolvePrintPageCount(detail),
        pages: toPagesString(detail),
        copies: 1
      });
    } catch { /* never throw */ }
  }, [resolvePrintPageCount, toPagesString]);


  const allSessionPageContexts = useMemo(() => {
    const count = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
    if (count <= 0) return [];
    return resolvePrintPageContexts(Array.from({ length: count }, (_value, index) => index + 1));
  }, [resolvePrintPageContexts, sessionTotalPages]);

  const warmPrintFrameTitle = useMemo(() => {
    if (!printEnabled) return t('toolbar.printPrewarm.off', { defaultValue: 'Print cache unavailable' });
    if (printWarmFrameStatus === 'ready') return t('toolbar.printPrewarm.ready', { defaultValue: 'Print cache ready' });
    if (printWarmFrameStatus === 'pending') return t('toolbar.printPrewarm.pending', { defaultValue: 'Preparing print cache…' });
    if (printWarmFrameStatus === 'warning') return t('toolbar.printPrewarm.warning', { defaultValue: 'Print cache fallback active' });
    if (printWarmFrameStatus === 'error') return t('toolbar.printPrewarm.error', { defaultValue: 'Print cache failed' });
    return t('toolbar.printPrewarm.off', { defaultValue: 'Print cache inactive' });
  }, [printEnabled, printWarmFrameStatus, t]);

  const getWarmCompatibleIndexes = useCallback((detail) => {
    if (!detail || detail.mode === 'active') return null;
    const pageNumbers = resolvePrintPageNumbers(detail);
    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) return null;
    const indexes = [];
    let previous = -1;
    const seen = new Set();
    const total = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
    for (const rawPageNumber of pageNumbers) {
      const pageNumberValue = Math.floor(Number(rawPageNumber));
      if (!Number.isFinite(pageNumberValue) || pageNumberValue < 1 || pageNumberValue > total) return null;
      const index = pageNumberValue - 1;
      if (seen.has(index) || index <= previous) return null;
      seen.add(index);
      indexes.push(index);
      previous = index;
    }
    return indexes;
  }, [resolvePrintPageNumbers, sessionTotalPages]);

  useEffect(() => {
    const cfg = getRuntimeConfig();
    const pageCount = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
    const memoryPressureStage = String(viewerContext?.memoryPressureStage || 'none');
    const enabled = printEnabled && shouldEnableWarmPrintFrame(cfg, pageCount, memoryPressureStage);
    const currentSeq = warmPrintBuildSeqRef.current + 1;
    warmPrintBuildSeqRef.current = currentSeq;

    disposeWarmPrintFrame(warmPrintFrameRef.current);
    warmPrintFrameRef.current = null;

    if (!enabled || !documentRenderRef?.current || pageCount <= 0) {
      setPrintWarmFrameStatus('off');
      return undefined;
    }

    let cancelled = false;
    setPrintWarmFrameStatus('pending');

    const timeoutId = window.setTimeout(() => {
      (async () => {
        try {
          const handle = documentRenderRef.current;
          const getUrls = handle?.getAllPrintableDataUrls || handle?.exportAllPagesAsDataUrls;
          if (typeof getUrls !== 'function') {
            if (!cancelled && warmPrintBuildSeqRef.current === currentSeq) setPrintWarmFrameStatus('off');
            return;
          }

          const dataUrls = await getUrls.call(handle);
          if (cancelled || warmPrintBuildSeqRef.current !== currentSeq) return;
          if (!Array.isArray(dataUrls) || dataUrls.length !== pageCount) {
            setPrintWarmFrameStatus('warning');
            return;
          }

          const warmFrame = await createWarmPrintFrame({
            dataUrls,
            pageContexts: allSessionPageContexts,
            printHeaderCfg: cfg.printHeader || {},
            printFooterCfg: cfg.printFooter || {},
            printFormatCfg: cfg.print?.format || {},
            key: `${pageCount}:${i18n?.language || ''}`,
          });
          if (cancelled || warmPrintBuildSeqRef.current !== currentSeq) {
            disposeWarmPrintFrame(warmFrame);
            return;
          }
          warmPrintFrameRef.current = warmFrame;
          setPrintWarmFrameStatus('ready');
        } catch (error) {
          if (!cancelled && warmPrintBuildSeqRef.current === currentSeq) {
            logger.warn('Warm print preloading failed', { error: String(error?.message || error) });
            setPrintWarmFrameStatus('error');
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [allSessionPageContexts, documentRenderRef, i18n?.language, printEnabled, sessionTotalPages, viewerContext?.memoryPressureStage]);

  useEffect(() => () => {
    disposeWarmPrintFrame(warmPrintFrameRef.current);
    warmPrintFrameRef.current = null;
  }, []);

  const resetPdfProgress = useCallback(() => {
    setPdfProgress(EMPTY_PDF_PROGRESS);
  }, []);

  const requestCancelPdfProgress = useCallback(() => {
    if (!pdfProgress.open || pdfProgress.error || pdfProgress.phase === 'cancelled' || pdfProgress.phase === 'cancelling') return;
    const confirmed = window.confirm(t('printDialog.pdfProgress.cancelConfirm', {
      defaultValue: 'Cancel PDF generation?',
    }));
    if (!confirmed) return;

    const hadPendingStart = pdfStartTimeoutRef.current !== null;
    if (hadPendingStart) {
      window.clearTimeout(pdfStartTimeoutRef.current);
      pdfStartTimeoutRef.current = null;
    }
    try { pdfAbortControllerRef.current?.abort(); } catch {}
    setPdfProgress((current) => current.open
      ? { ...current, phase: hadPendingStart ? 'cancelled' : 'cancelling', error: '' }
      : current);
    if (hadPendingStart) window.setTimeout(resetPdfProgress, 900);
  }, [pdfProgress.error, pdfProgress.open, pdfProgress.phase, resetPdfProgress, t]);

  useEffect(() => {
    if (!pdfProgress.open || pdfProgress.error || pdfProgress.phase === 'cancelled' || pdfProgress.phase === 'cancelling') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      requestCancelPdfProgress();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pdfProgress.error, pdfProgress.open, pdfProgress.phase, requestCancelPdfProgress]);

  useEffect(() => () => {
    if (pdfStartTimeoutRef.current !== null) {
      window.clearTimeout(pdfStartTimeoutRef.current);
      pdfStartTimeoutRef.current = null;
    }
    try { pdfAbortControllerRef.current?.abort(); } catch {}
  }, []);

  /**
   * Execute the actual print helper after the dialog has resolved the user's choices.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const dispatchPrintRequest = useCallback((detail) => {
    const commonOpts = makePrintOptions(detail);
    const pageNumbers = Array.isArray(commonOpts.pageNumbers) ? commonOpts.pageNumbers : resolvePrintPageNumbers(detail);

    if (detail?.printBackend === 'pdf') {
      const total = Math.max(1, Array.isArray(pageNumbers) && pageNumbers.length ? pageNumbers.length : resolvePrintPageCount(detail));
      const action = detail?.printAction === 'download' ? 'download' : 'print';
      const runSeq = pdfRunSeqRef.current + 1;
      pdfRunSeqRef.current = runSeq;
      try { pdfAbortControllerRef.current?.abort(); } catch {}
      const abortController = new AbortController();
      pdfAbortControllerRef.current = abortController;
      setPdfProgress({ open: true, action, phase: 'starting', current: 0, progressValue: 0, page: 0, total, error: '' });
      const pdfOpts = {
        ...commonOpts,
        signal: abortController.signal,
        onProgress: (event) => {
          if (pdfRunSeqRef.current !== runSeq) return;
          const nextTotal = Math.max(1, Math.floor(Number(event?.total) || total));
          const current = Math.max(0, Math.min(nextTotal, Math.floor(Number(event?.current) || 0)));
          const rawProgressValue = Number(event?.progressValue);
          const progressValue = Math.max(0, Math.min(nextTotal, Number.isFinite(rawProgressValue) ? rawProgressValue : current));
          const rawPage = Number(event?.page);
          const page = Number.isFinite(rawPage) ? Math.max(0, Math.min(nextTotal, Math.floor(rawPage))) : 0;
          setPdfProgress({ open: true, action, phase: String(event?.phase || 'generating'), current, progressValue, page, total: nextTotal, error: '' });
        },
      };
      // Give React/the browser one paint opportunity before PDF generation starts. On fast
      // machines the dynamic import may already be cached, and jsPDF work can otherwise begin
      // before the progress overlay becomes visible.
      pdfStartTimeoutRef.current = window.setTimeout(() => {
        pdfStartTimeoutRef.current = null;
        if (abortController.signal.aborted || pdfRunSeqRef.current !== runSeq) return;
        const pdfTask = detail?.mode === 'active'
          ? (detail?.activeScope === 'compare-both' && isComparing
              ? handlePdfCurrentComparison(documentRenderRef, compareRef, pdfOpts)
              : handlePdfCurrent(documentRenderRef, pdfOpts))
          : handlePdfOutput(documentRenderRef, pageNumbers, pdfOpts);
        pdfTask
          .then(() => {
            if (pdfRunSeqRef.current !== runSeq) return;
            setPdfProgress({ open: true, action, phase: action === 'download' ? 'downloaded' : 'opening-preview', current: total, progressValue: total, page: 0, total, error: '' });
            window.setTimeout(resetPdfProgress, 1800);
          })
          .catch((error) => {
            if (pdfRunSeqRef.current !== runSeq) return;
            if (isPdfAbortError(error)) {
              setPdfProgress({ open: true, action, phase: 'cancelled', current: 0, progressValue: 0, page: 0, total, error: '' });
              window.setTimeout(resetPdfProgress, 900);
              return;
            }
            logger.warn('Generated PDF print failed', { error: String(error?.message || error) });
            setPdfProgress({ open: true, action, phase: 'error', current: 0, progressValue: 0, page: 0, total, error: String(error?.message || error) });
          });
      }, 50);
      return;
    }

    const warmIndexes = getWarmCompatibleIndexes(detail);
    const warmFrame = warmPrintFrameRef.current;
    if (warmIndexes && warmFrame?.status === 'ready') {
      const usedWarmFrame = handlePrintWarmFrame(warmFrame, warmIndexes, commonOpts);
      if (usedWarmFrame) return;
    }

    if (!detail || detail.mode === 'active') {
      if (detail?.activeScope === 'compare-both' && isComparing) {
        handlePrintCurrentComparison(documentRenderRef, compareRef, commonOpts);
        return;
      }
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
    }
  }, [compareRef, documentRenderRef, getWarmCompatibleIndexes, isComparing, makePrintOptions, resetPdfProgress, resolvePrintPageCount, resolvePrintPageNumbers, visibleOriginalPageNumbers]);

  /**
   * Handle the dialog submit event and dispatch the correct print action.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const handlePrintSubmit = useCallback((detail) => {
    closePrintDialog?.();

    submitUserPrintLog(detail);

    window.setTimeout(() => {
      dispatchPrintRequest(detail);
    }, 30);
  }, [closePrintDialog, dispatchPrintRequest, submitUserPrintLog]);

  const printActionTitle = printEnabled
    ? t('toolbar.print')
    : t('toolbar.printDisabledLoading', {
        defaultValue: 'Printing becomes available when all pages are fully loaded.',
      });
  const isPdfProgressCancelling = pdfProgress.phase === 'cancelling';
  const isPdfProgressCancelled = pdfProgress.phase === 'cancelled';

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
        onClick={() => { if (printEnabled) openPrintDialog?.(); }}
        aria-label={printActionTitle}
        title={printActionTitle}
        className="odv-btn odv-btn--with-status-led"
        disabled={!printEnabled}
      >
        <span className="material-icons" aria-hidden="true">print</span>
        <StatusLed state={printEnabled ? printWarmFrameStatus : 'off'} size="xs" title={warmPrintFrameTitle} className="odv-toolbar-print-led" />
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
        pageNumber={activeNavigationPageNumber}
        pageNumberDisplay={activeNavigationPageNumber}
        totalPages={totalPages}
        totalPagesDisplay={totalPages}
        navigationTarget={navigationTargetMode}
        navigationScope={navigationScopeMode}
        navigationGroupTitle={navigationModeTitle}
        firstButtonTitle={navigationButtonTitles.first}
        previousButtonTitle={navigationButtonTitles.previous}
        nextButtonTitle={navigationButtonTitles.next}
        lastButtonTitle={navigationButtonTitles.last}
        onGoToPage={handleGoToPageInput}
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
      >
        <span className="material-icons" aria-hidden="true">compare</span>
      </button>

      <div className="separator" />

      {/* Editing controls are always visible. Canvas rendering activates only when a non-neutral adjustment exists. */}
      <div
        className={`zoom-fixed-group editing-tools ${editingTargetMode === 'compare' ? 'editing-target-compare' : 'editing-target-primary'}`}
        aria-label={t('toolbar.imageAdjustments')}
        title={editingGroupTitle}
      >
        <button
          type="button"
          onClick={(event) => handleRotationButtonClick(event, -90)}
          aria-label={t('toolbar.rotateLeft90')}
          title={t('toolbar.rotateLeft90')}
          className="odv-btn"
        >
          <span className="material-icons" aria-hidden="true">rotate_left</span>
        </button>
        <button
          type="button"
          onClick={(event) => handleRotationButtonClick(event, 90)}
          aria-label={t('toolbar.rotateRight90')}
          title={t('toolbar.rotateRight90')}
          className="odv-btn"
        >
          <span className="material-icons" aria-hidden="true">rotate_right</span>
        </button>

        <div className="toolbar-menu-shell toolbar-adjustment-shell">
          <button
            ref={brightnessButtonRef}
            type="button"
            onClick={() => toggleAdjustmentMenu('brightness')}
            aria-label={t('toolbar.adjustBrightness')}
            title={t('toolbar.adjustBrightness')}
            aria-haspopup="dialog"
            aria-expanded={openAdjustmentMenu === 'brightness'}
            className={`odv-btn toolbar-adjustment-button${isBrightnessAdjusted ? ' is-active' : ''}`}
          >
            <span className="material-icons" aria-hidden="true">brightness_6</span>
          </button>

          {openAdjustmentMenu === 'brightness' ? (
            <div
              ref={brightnessMenuRef}
              className="toolbar-adjustment-menu"
              role="dialog"
              aria-label={t('toolbar.adjustBrightness')}
            >
              <div className="toolbar-adjustment-menu-header">
                <span className="toolbar-adjustment-menu-title">
                  <span className="material-icons" aria-hidden="true">brightness_6</span>
                  <span>{t('toolbar.brightness')}</span>
                </span>
                <div className="toolbar-adjustment-menu-actions">
                  <span className="toolbar-adjustment-current">{editingProperties.brightness}%</span>
                  <button
                    type="button"
                    className="toolbar-adjustment-reset-btn"
                    onClick={handleBrightnessReset}
                    disabled={!isBrightnessAdjusted}
                    aria-label={t('toolbar.resetBrightness', { defaultValue: 'Reset brightness' })}
                    title={t('toolbar.resetBrightness', { defaultValue: 'Reset brightness' })}
                  >
                    <span className="material-icons" aria-hidden="true">restart_alt</span>
                  </button>
                </div>
              </div>

              <input
                type="range"
                min="0"
                max="200"
                value={editingProperties.brightness}
                onChange={handleBrightnessSliderChange}
                onInput={handleBrightnessSliderChange}
                className="toolbar-adjustment-slider"
                aria-valuemin={0}
                aria-valuemax={200}
                aria-valuenow={editingProperties.brightness}
                aria-label={t('toolbar.adjustBrightness')}
              />

              <div className="toolbar-adjustment-scale" aria-hidden="true">
                <span>0</span>
                <span>200</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="toolbar-menu-shell toolbar-adjustment-shell">
          <button
            ref={contrastButtonRef}
            type="button"
            onClick={() => toggleAdjustmentMenu('contrast')}
            aria-label={t('toolbar.adjustContrast')}
            title={t('toolbar.adjustContrast')}
            aria-haspopup="dialog"
            aria-expanded={openAdjustmentMenu === 'contrast'}
            className={`odv-btn toolbar-adjustment-button${isContrastAdjusted ? ' is-active' : ''}`}
          >
            <span className="material-icons" aria-hidden="true">tonality</span>
          </button>

          {openAdjustmentMenu === 'contrast' ? (
            <div
              ref={contrastMenuRef}
              className="toolbar-adjustment-menu"
              role="dialog"
              aria-label={t('toolbar.adjustContrast')}
            >
              <div className="toolbar-adjustment-menu-header">
                <span className="toolbar-adjustment-menu-title">
                  <span className="material-icons" aria-hidden="true">tonality</span>
                  <span>{t('toolbar.contrast')}</span>
                </span>
                <div className="toolbar-adjustment-menu-actions">
                  <span className="toolbar-adjustment-current">{editingProperties.contrast}%</span>
                  <button
                    type="button"
                    className="toolbar-adjustment-reset-btn"
                    onClick={handleContrastReset}
                    disabled={!isContrastAdjusted}
                    aria-label={t('toolbar.resetContrast', { defaultValue: 'Reset contrast' })}
                    title={t('toolbar.resetContrast', { defaultValue: 'Reset contrast' })}
                  >
                    <span className="material-icons" aria-hidden="true">restart_alt</span>
                  </button>
                </div>
              </div>

              <input
                type="range"
                min="0"
                max="200"
                value={editingProperties.contrast}
                onChange={handleContrastSliderChange}
                onInput={handleContrastSliderChange}
                className="toolbar-adjustment-slider"
                aria-valuemin={0}
                aria-valuemax={200}
                aria-valuenow={editingProperties.contrast}
                aria-label={t('toolbar.adjustContrast')}
              />

              <div className="toolbar-adjustment-scale" aria-hidden="true">
                <span>0</span>
                <span>200</span>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleResetAdjustmentsClick}
          aria-label={t('toolbar.resetAdjustments', { defaultValue: 'Reset adjustments' })}
          title={t('toolbar.resetAdjustments', { defaultValue: 'Reset adjustments' })}
          className="odv-btn"
        >
          <span className="material-icons" aria-hidden="true">restart_alt</span>
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-end-actions">
        <ThemeMenuButton />
        <LanguageMenuButton />
        <HelpMenuButton
          onOpenManual={() => setIsManualDialogOpen(true)}
          onOpenAbout={() => setIsAboutDialogOpen(true)}
        />
      </div>

      {/* Modal for print selection + reason/forWhom */}
      <PrintRangeDialog
        isOpen={isPrintDialogOpen}
        onClose={() => closePrintDialog?.()}
        onSubmit={handlePrintSubmit}
        totalPages={totalPagesDisplay}
        isDocumentLoading={isDocumentLoading}
        activePageNumber={pageNumberDisplay}
        comparePageNumber={comparePaneVisible ? compareNavigationPageDisplay : null}
        isComparing={isComparing}
        hasActiveSelection={hasActiveSelection}
        selectionIncludedCount={selectionIncludedCount}
        sessionTotalPages={sessionTotalPages}
      />


      <ManualOverlayDialog
        isOpen={isManualDialogOpen}
        onClose={() => setIsManualDialogOpen(false)}
      />

      <AboutOverlayDialog
        isOpen={isAboutDialogOpen}
        onClose={() => setIsAboutDialogOpen(false)}
      />

      {pdfProgress.open ? (
        <div
          className="odv-print-preparing-backdrop"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-labelledby="odv-pdf-progress-title"
        >
          <div className="odv-print-preparing-dialog odv-pdf-progress-dialog">
            <div className="odv-print-preparing-icon" aria-hidden="true">
              <span className="material-icons">picture_as_pdf</span>
            </div>
            <div className="odv-print-preparing-copy">
              <h3 id="odv-pdf-progress-title">{pdfProgress.action === 'download'
                ? t('printDialog.pdfProgress.downloadTitle', { defaultValue: 'Creating PDF' })
                : t('printDialog.pdfProgress.printTitle', { defaultValue: 'Preparing PDF print' })}</h3>
              <p>{pdfProgress.error
                ? t('printDialog.pdfProgress.error', { error: pdfProgress.error, defaultValue: `PDF generation failed: ${pdfProgress.error}` })
                : isPdfProgressCancelled
                  ? t('printDialog.pdfProgress.cancelled', { defaultValue: 'PDF generation was cancelled.' })
                  : isPdfProgressCancelling
                    ? t('printDialog.pdfProgress.cancelling', { defaultValue: 'Cancelling PDF generation…' })
                    : formatPdfProgressBody(t, pdfProgress)}</p>
              {!pdfProgress.error && !isPdfProgressCancelled ? (
                <div className="odv-pdf-progress-track" aria-hidden="true">
                  <div
                    className="odv-pdf-progress-bar"
                    style={{ width: `${getPdfProgressPercent(pdfProgress)}%` }}
                  />
                </div>
              ) : null}
            </div>
            {pdfProgress.error ? (
              <button
                type="button"
                className="odv-print-preparing-close"
                onClick={resetPdfProgress}
              >
                {t('printDialog.preparing.dismiss', { defaultValue: 'Close' })}
              </button>
            ) : !isPdfProgressCancelled ? (
              <button
                type="button"
                className="odv-print-preparing-close"
                onClick={requestCancelPdfProgress}
                disabled={isPdfProgressCancelling}
              >
                {isPdfProgressCancelling
                  ? t('printDialog.pdfProgress.cancellingButton', { defaultValue: 'Cancelling…' })
                  : t('printDialog.pdfProgress.cancel', { defaultValue: 'Cancel' })}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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
  setVisiblePageNumber: PropTypes.func,
  setComparePageNumber: PropTypes.func,
  setVisibleComparePageNumber: PropTypes.func,
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
  printEnabled: PropTypes.bool,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  comparePageNumberDisplay: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }),
  goToPreviousDocument: PropTypes.func,
  goToNextDocument: PropTypes.func,
  goToFirstDocument: PropTypes.func,
  goToLastDocument: PropTypes.func,
  documentNavigationEnabled: PropTypes.bool,
  compareRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  primaryDocumentNavigation: PropTypes.shape({
    canGoPrevious: PropTypes.bool,
    canGoNext: PropTypes.bool,
    canGoFirst: PropTypes.bool,
    canGoLast: PropTypes.bool,
  }),
  compareDocumentNavigation: PropTypes.shape({
    canGoPrevious: PropTypes.bool,
    canGoNext: PropTypes.bool,
    canGoFirst: PropTypes.bool,
    canGoLast: PropTypes.bool,
  }),
  primaryImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  compareImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.isRequired,
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  zoom: PropTypes.number,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'ACTUAL_SIZE', 'CUSTOM']),
    scale: PropTypes.number,
  }),
  setZoomMode: PropTypes.func,
  setZoom: PropTypes.func,
  hasActiveSelection: PropTypes.bool,
  visibleOriginalPageNumbers: PropTypes.arrayOf(PropTypes.number),
  selectionIncludedCount: PropTypes.number,
  sessionTotalPages: PropTypes.number,
  bundle: PropTypes.object,
  allPages: PropTypes.arrayOf(PropTypes.any),
};

export default React.memo(DocumentToolbar);
