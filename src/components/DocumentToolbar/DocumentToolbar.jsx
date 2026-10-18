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
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import SplitToolbarButton from './SplitToolbarButton.jsx';
import LanguageMenuButton from './LanguageMenuButton.jsx';
import ThemeMenuButton from './ThemeMenuButton.jsx';
import PrintPipelineDialogs from './PrintPipelineDialogs.jsx';
import { normalizeToolbarPageNumber } from './usePrintPipeline.js';
import HelpMenuButton from './HelpMenuButton.jsx';
import ManualOverlayDialog from './ManualOverlayDialog.jsx';
import AboutOverlayDialog from './AboutOverlayDialog.jsx';
import {
  getCompareAdjustToolbarMode,
  getRuntimeConfig,
  isCompareCurtainEnabled,
  isCompareOverlayEnabled,
  isFineTuneEnabled,
} from '../../utils/runtimeConfig.js';
import { hasImageAdjustment } from '../../utils/imageAdjustments.js';
import { isIdentityCompareTransform, selectCompareTransform } from '../../utils/compareTransform.js';
import {
  clearPrintDefaultModePreference,
  getPrintDefaultModePreference,
  setPrintDefaultModePreference,
} from '../../utils/viewerPreferences.js';
import ViewerContext from '../../contexts/viewerContext.js';
import StatusLed from '../common/StatusLed.jsx';
import SignatureOverviewButton from '../SignatureOverviewButton.jsx';
import CompareCurtainButton from '../DocumentViewer/CompareCurtainButton.jsx';
import { isPdfBenchmarkEnabled, runPdfGenerationBenchmark } from '../../utils/pdfBenchmark.js';
import { isRenderDecodeBenchmarkEnabled, runRenderDecodeBenchmark } from '../../utils/renderDecodeBenchmark.js';

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
 * @property {'FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM'} [mode]
 * @property {number} [scale]
 */

/**
 * Props for {@link DocumentToolbar}.
 * @typedef {Object} DocumentToolbarProps
 * @property {number} pageNumber
 * @property {number} pageNumberDisplay
 * @property {number} totalPages
 * @property {boolean} isDocumentLoading
 * @property {Object=} pageLoadState
 * @property {boolean} prevPageDisabled
 * @property {boolean} nextPageDisabled
 * @property {boolean} firstPageDisabled
 * @property {boolean} lastPageDisabled
 * @property {PageNumberSetter} setPageNumber
 * @property {PageNumberSetter=} setVisiblePageNumber
 * @property {PageNumberSetter} [setComparePageNumber]
 * @property {PageNumberSetter=} [setVisibleComparePageNumber]
 * @property {function(string=): void} [goToPreviousPage]
 * @property {function(string=): void} [goToNextPage]
 * @property {function(string=): void} [goToFirstPage]
 * @property {function(string=): void} [goToLastPage]
 * @property {function(string=): void} [goToPreviousDocument]
 * @property {function(string=): void} [goToNextDocument]
 * @property {function(string=): void} [goToFirstDocument]
 * @property {function(string=): void} [goToLastDocument]
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void=} actualSize
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToCustomWidth
 * @property {function(): void} fitToWidth
 * @property {AnyRef} documentRenderRef
 * @property {Object} printPipeline The shared print pipeline (usePrintPipeline.js), owned by DocumentViewer.
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
 * @property {'primary'|'compare'=} activePane
 * @property {(number|null)=} comparePageNumber
 * @property {(number|null)=} comparePageNumberDisplay
 * @property {{ shift:boolean, ctrl:boolean }=} navigationModifierState
 * @property {ImageProperties} primaryImageProperties
 * @property {ImageProperties} compareImageProperties
 * @property {{ primary:Object, compare:Object }=} compareTransforms
 * @property {function(number, ('primary'|'compare')=): void} handleRotationChange
 * @property {function({ target: { value: number } }, ('primary'|'compare')=): void} handleBrightnessChange
 * @property {function({ target: { value: number } }, ('primary'|'compare')=): void} handleContrastChange
 * @property {function(('primary'|'compare')=): void} resetImageProperties
 * @property {number=} zoom
 * @property {ZoomState=} zoomState
 * @property {function(*): void=} setZoomMode
 * @property {number=} customFitWidthFactorPercent
 * @property {{ widthFactorPercent:number, heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }=} customFitSizeLimits
 * @property {{ widthFactorPercent:number, heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }=} configuredCustomFitSizeLimits
 * @property {{ widthFactorPercent:(number|null), heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }=} userCustomFitSizeLimits
 * @property {number=} configuredCustomFitWidthFactorPercent
 * @property {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|null)=} userDefaultZoomMode
 * @property {('FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE')=} configuredDefaultZoomMode
 * @property {function(number): void=} setCustomFitWidthFactorPercent
 * @property {function({ widthFactorPercent:*, heightFactorPercent:*, actualSizeFactorPercent:* }): void=} setCustomFitSizeLimits
 * @property {function((string|null)): void=} setDefaultZoomModePreference
 * @property {function(number): void=} setZoom
 * @property {boolean=} printSelectionSequenceLocked
 * @property {boolean=} printSelectionWorkspaceEnabled
 * @property {boolean=} printSelectionWorkspaceActive
 * @property {Object|null=} printSelectionWorkspaceToolbarState
 * @property {boolean=} canOpenPrintSelectionWorkspace
 * @property {function(): void=} openPrintSelectionWorkspace
 * @property {Array<*>=} allPages
 * @property {boolean=} documentNavigationEnabled
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }=} primaryDocumentNavigation
 * @property {{ canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }=} compareDocumentNavigation
 * @property {boolean=} canOpenCompareOverlay True in compare mode with two pages shown.
 * @property {function(): void=} openCompareOverlay Opens the overlay view of the two compared pages.
 * @property {boolean=} compareCalibrated True when the overlay view has calibrated the two pages.
 * @property {function(): void=} openCompareCurtain Opens the curtain view of the calibrated pages.
 * @property {{ primary:boolean, compare:boolean }=} compareAdjustPanelsExpanded Which compare panes have
 *   their adjustment panel (CompareTransformControls) expanded; drives `compare.adjust.toolbarMode: 'hide'`.
 */

/** Range (±) around 100% where sliders snap back to the neutral value. */
const SLIDER_CENTER_RANGE = 20;
/** Epsilon for considering zoom ≈ 100% (0.5%). */
const ONE_TO_ONE_EPS = 0.005;
const PRINT_SELECTION_THUMBNAIL_SLIDER_MIN = -100;
const PRINT_SELECTION_THUMBNAIL_SLIDER_MAX = 100;
const PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT = 120;

function thumbnailPercentToSliderValue(percent) {
  const safePercent = Math.max(70, Math.min(320, Math.round(Number(percent) || PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT)));
  if (safePercent < PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT) {
    return Math.round((safePercent - PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT) / 0.5);
  }
  return Math.round((safePercent - PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT) / 2);
}

function thumbnailSliderValueToPercent(value) {
  const safeValue = Math.max(
    PRINT_SELECTION_THUMBNAIL_SLIDER_MIN,
    Math.min(PRINT_SELECTION_THUMBNAIL_SLIDER_MAX, Math.round(Number(value) || 0))
  );
  return safeValue < 0
    ? Math.round(PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT + (safeValue * 0.5))
    : Math.round(PRINT_SELECTION_THUMBNAIL_STANDARD_PERCENT + (safeValue * 2));
}

/**
 * @param {*} page
 * @returns {string}
 */
function makePdfResolutionPageKey(page) {
  const sourceKey = String(page?.sourceKey || '');
  const sourcePageIndex = Math.max(0, Number(page?.pageIndex) || 0);
  return sourceKey ? `${sourceKey}:${sourcePageIndex}` : '';
}

/**
 * @param {*} page
 * @returns {boolean}
 */
function isPdfPage(page) {
  return String(page?.fileExtension || '').toLowerCase() === 'pdf';
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
  runtimeStatusLedState = 'off',
  runtimeStatusLedTitle = '',
  pageNumber,
  pageNumberDisplay = pageNumber,
  totalPages,
  isDocumentLoading = false,
  pageLoadState = null,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
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
  documentRenderRef,
  printPipeline,
  handleCompare,
  isComparing,
  activePane = 'primary',
  comparePageNumber = null,
  comparePageNumberDisplay = null,
  navigationModifierState = { shift: false, ctrl: false },
  primaryImageProperties,
  compareImageProperties,
  compareTransforms = undefined,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  // Optional zoom-display state used by newer toolbar UX paths.
  zoom,
  zoomState,
  setZoomMode,
  customFitWidthFactorPercent = 70,
  customFitSizeLimits,
  configuredCustomFitSizeLimits,
  userCustomFitSizeLimits,
  configuredCustomFitWidthFactorPercent = 70,
  userDefaultZoomMode = null,
  configuredDefaultZoomMode = 'FIT_WIDTH',
  setCustomFitWidthFactorPercent,
  setCustomFitSizeLimits,
  setDefaultZoomModePreference,
  setZoom,
  printSelectionSequenceLocked = false,
  printSelectionWorkspaceEnabled = false,
  printSelectionWorkspaceActive = false,
  printSelectionWorkspaceToolbarState = null,
  canOpenPrintSelectionWorkspace = false,
  openPrintSelectionWorkspace,
  allPages = [],
  documentNavigationEnabled = false,
  primaryDocumentNavigation = undefined,
  compareDocumentNavigation = undefined,
  signatureSummary = null,
  onOpenSignatureOverview,
  canOpenCompareOverlay = false,
  openCompareOverlay,
  compareCalibrated = false,
  openCompareCurtain,
  compareAdjustPanelsExpanded = undefined,
  fineTuneVisible = false,
  onToggleFineTune,
}) => {
  const { t } = useTranslation('common');
  const viewerContext = useContext(ViewerContext);
  // Compare-view entries: each view has its own runtime switch; compare mode itself has none.
  const showCompareOverlayEntry = canOpenCompareOverlay && isCompareOverlayEnabled()
    && typeof openCompareOverlay === 'function';
  const showCompareCurtainEntry = canOpenCompareOverlay && isCompareCurtainEnabled()
    && typeof openCompareCurtain === 'function';
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [openAdjustmentMenu, setOpenAdjustmentMenu] = useState(/** @type {(null|'brightness'|'contrast')} */ (null));
  const [printPreferenceRevision, setPrintPreferenceRevision] = useState(0);
  const brightnessButtonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const contrastButtonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const brightnessMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contrastMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  // Help button that opened the manual; focus returns to it when the manual closes.
  const manualOpenerRef = useRef(/** @type {(HTMLElement|null)} */ (null));
  const isShiftPressed = navigationModifierState.shift;
  const isCtrlPressed = navigationModifierState.ctrl;
  const compareTargetAvailable = typeof setComparePageNumber === 'function' && totalPages > 0;
  const comparePaneVisible = compareTargetAvailable && isComparing && Number.isFinite(comparePageNumber);
  // compare.adjust.toolbarMode 'hide': the coarse image controls give way while ANY shown pane's
  // panel is expanded - not only the pane the toolbar targets, which flips with Shift and the active
  // pane and would make the controls flicker. Outside compare mode the key has no effect.
  const anyComparePanelExpanded = !!compareAdjustPanelsExpanded?.primary
    || (comparePaneVisible && !!compareAdjustPanelsExpanded?.compare);
  const hideCoarseAdjustments = !!isComparing && anyComparePanelExpanded
    && getCompareAdjustToolbarMode() === 'hide';

  useEffect(() => {
    if (hideCoarseAdjustments) setOpenAdjustmentMenu(null);
  }, [hideCoarseAdjustments]);

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

  const activeNavigationPane = comparePaneVisible && activePane === 'compare' ? 'compare' : 'primary';
  const resolvePaneTarget = useCallback((shift) => {
    if (!comparePaneVisible) return 'primary';
    if (!shift) return activeNavigationPane;
    return activeNavigationPane === 'compare' ? 'primary' : 'compare';
  }, [activeNavigationPane, comparePaneVisible]);

  const wantsCompareTarget = useCallback(
    (event) => resolvePaneTarget(getEffectiveModifierState(event).shift) === 'compare',
    [getEffectiveModifierState, resolvePaneTarget]
  );
  const wantsDocumentScope = useCallback(
    (event) => getEffectiveModifierState(event).ctrl && !!documentNavigationEnabled,
    [documentNavigationEnabled, getEffectiveModifierState]
  );

  const canTargetCompare = useCallback((event) => (
    !wantsCompareTarget(event) || comparePaneVisible
  ), [comparePaneVisible, wantsCompareTarget]);

  const resolveNavigationTarget = useCallback((event) => {
    const modifierState = getEffectiveModifierState(event);
    return resolvePaneTarget(modifierState.shift);
  }, [getEffectiveModifierState, resolvePaneTarget]);

  const resolveNavigationScope = useCallback((event) => (
    wantsDocumentScope(event) ? 'document' : 'page'
  ), [wantsDocumentScope]);

  const resolveEditingTarget = useCallback((event) => {
    const modifierState = getEffectiveModifierState(event);
    return resolvePaneTarget(modifierState.shift);
  }, [getEffectiveModifierState, resolvePaneTarget]);

  const blockUnavailableCompareTarget = useCallback((event) => {
    if (!wantsCompareTarget(event)) return false;
    if (canTargetCompare(event)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }, [canTargetCompare, wantsCompareTarget]);

  const invokePageNavigationForTarget = useCallback((target, direction) => {
    const safeTarget = target === 'compare' ? 'compare' : 'primary';
    if (direction === 'prev') { goToPreviousPage?.(safeTarget); return; }
    if (direction === 'next') { goToNextPage?.(safeTarget); return; }
    if (direction === 'first') { goToFirstPage?.(safeTarget); return; }
    goToLastPage?.(safeTarget);
  }, [
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPreviousPage,
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
  const navigationTargetMode = resolvePaneTarget(!!isShiftPressed);
  const navigationScopeMode = isCtrlPressed && documentNavigationEnabled ? 'document' : 'page';
  const activeNavigationPageNumber = navigationTargetMode === 'compare'
    ? compareNavigationPage
    : normalizeToolbarPageNumber(pageNumber, totalPages, 1);
  const editingTargetMode = comparePaneVisible && navigationTargetMode === 'compare' ? 'compare' : 'primary';
  const editingProperties = editingTargetMode === 'compare' ? compareImageProperties : primaryImageProperties;
  const editingPageNumber = editingTargetMode === 'compare' ? compareNavigationPageDisplay : pageNumberDisplay;
  const editingPageIndex = Math.max(0, Math.floor(Number(editingPageNumber) || 1) - 1);
  const editingPage = Array.isArray(allPages) ? (allPages[editingPageIndex] || null) : null;
  const editingPageResolutionKey = makePdfResolutionPageKey(editingPage);
  const pdfResolutionBoostedKeys = viewerContext?.pdfResolutionBoostState?.boostedKeys || [];
  const pdfResolutionPendingKeys = viewerContext?.pdfResolutionBoostState?.pendingKeys || [];
  const pdfResolutionMaxedKeys = viewerContext?.pdfResolutionBoostState?.maxedKeys || [];
  const isEditingPdfPage = isPdfPage(editingPage);
  const isPdfResolutionBoosted = !!editingPageResolutionKey && pdfResolutionBoostedKeys.includes(editingPageResolutionKey);
  const isPdfResolutionPending = !!editingPageResolutionKey && pdfResolutionPendingKeys.includes(editingPageResolutionKey);
  const isPdfResolutionMaxed = !!editingPageResolutionKey && pdfResolutionMaxedKeys.includes(editingPageResolutionKey);
  const canBoostPdfResolution = isEditingPdfPage
    && !isPdfResolutionBoosted
    && !isPdfResolutionPending
    && !isPdfResolutionMaxed
    && typeof viewerContext?.enhancePdfPageResolution === 'function';
  const editingGroupTitle = editingTargetMode === 'compare'
    ? t('toolbar.editingTargetCompare', { defaultValue: 'Editing the right compare page' })
    : t('toolbar.editingTargetPrimary', { defaultValue: 'Editing the primary / left page' });
  // Fine tuning exists only in compare mode, so only there does the tooltip say the 90° step keeps it.
  const rotateLeftTitle = isComparing
    ? t('toolbar.rotateLeft90KeepsFine', { defaultValue: 'Rotates −90° and keeps the fine tuning (4.6° → −85.4°)' })
    : t('toolbar.rotateLeft90');
  const rotateRightTitle = isComparing
    ? t('toolbar.rotateRight90KeepsFine', { defaultValue: 'Rotates 90° and keeps the fine tuning (4.6° → 94.6°)' })
    : t('toolbar.rotateRight90');
  // In compare mode the reset is the panel's full reset (hooks/usePaneImageAdjustments.js), so it says so.
  const resetAdjustmentsLabel = isComparing
    ? t('compareTransform.resetAll', { defaultValue: 'Reset all (layout and image)' })
    : t('toolbar.resetAdjustments', { defaultValue: 'Reset adjustments' });
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
  const handleEnhancePdfResolutionClick = useCallback((event) => {
    const target = resolveEditingTarget(event);
    const targetPageNumber = target === 'compare' ? compareNavigationPageDisplay : pageNumberDisplay;
    const targetPageIndex = Math.max(0, Math.floor(Number(targetPageNumber) || 1) - 1);
    const page = Array.isArray(allPages) ? (allPages[targetPageIndex] || null) : null;
    if (!isPdfPage(page)) return;
    void viewerContext?.enhancePdfPageResolution?.(targetPageIndex);
  }, [allPages, compareNavigationPageDisplay, pageNumberDisplay, resolveEditingTarget, viewerContext]);

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

  const isBrightnessAdjusted = Number(editingProperties?.brightness ?? 100) !== 100;
  const isContrastAdjusted = Number(editingProperties?.contrast ?? 100) !== 100;
  // In compare mode the toolbar mirrors the pane panel, so it shows the target pane's live values:
  // a value chip on brightness/contrast, and the reset marked while anything it resets is set
  // (including grayscale and invert, which have no toolbar control of their own).
  const brightnessValue = Number(editingProperties?.brightness ?? 100);
  const contrastValue = Number(editingProperties?.contrast ?? 100);
  const brightnessTitle = isComparing
    ? `${t('toolbar.adjustBrightness')} (${brightnessValue} %)`
    : t('toolbar.adjustBrightness');
  const contrastTitle = isComparing
    ? `${t('toolbar.adjustContrast')} (${contrastValue} %)`
    : t('toolbar.adjustContrast');
  const isPaneAdjusted = !!isComparing && (
    hasImageAdjustment(editingProperties) || (Number(editingProperties?.rotation) || 0) % 360 !== 0
    // The compare-mode reset is the panel's full reset, so the marker lights while the target
    // pane's transform is non-identity; a missing prop reads as identity.
    || !isIdentityCompareTransform(selectCompareTransform(compareTransforms, editingTargetMode))
  );
  const enhancePdfResolutionTitle = isPdfResolutionPending
    ? t('toolbar.enhancePdfResolutionPending', { defaultValue: 'Increasing PDF page resolution…' })
    : isPdfResolutionBoosted
      ? t('toolbar.enhancePdfResolutionDone', { defaultValue: 'Resolution boost already applied to this PDF page' })
      : isPdfResolutionMaxed
        ? t('toolbar.enhancePdfResolutionMaxed', { defaultValue: 'This PDF page already renders at the maximum safe resolution' })
      : isEditingPdfPage
        ? t('toolbar.enhancePdfResolution', { defaultValue: 'Increase PDF page resolution' })
        : t('toolbar.enhancePdfResolutionUnavailable', { defaultValue: 'Resolution boost is available only for PDF pages' });

  const {
    openPrintDialog,
    toolbarPrintEnabled,
    isPdfOutputLocked,
    pdfPrebuildStatus,
    makePrintOptions,
    resolvePrintPageNumbers,
  } = printPipeline;

  const printLedState = useMemo(() => {
    if (!toolbarPrintEnabled) return 'off';
    if (pdfPrebuildStatus.state && pdfPrebuildStatus.state !== 'off') return pdfPrebuildStatus.state;
    return 'off';
  }, [pdfPrebuildStatus.state, toolbarPrintEnabled]);

  const printLedTitle = useMemo(() => {
    if (!toolbarPrintEnabled) return t('toolbar.printDisabledLoading', {
      defaultValue: 'Printing becomes available when all pages are fully loaded.',
    });
    if (pdfPrebuildStatus.paused === true) {
      return t('toolbar.printPrebuild.paused', {
        count: pdfPrebuildStatus.completed,
        total: pdfPrebuildStatus.total,
        defaultValue: `Print cache paused (${pdfPrebuildStatus.completed}/${pdfPrebuildStatus.total}).`,
      });
    }
    if (pdfPrebuildStatus.state === 'ready') {
      return t('toolbar.printPrebuild.ready', {
        count: pdfPrebuildStatus.completed,
        defaultValue: 'Prepared print cache ready',
      });
    }
    if (pdfPrebuildStatus.state === 'pending') {
      return t('toolbar.printPrebuild.pending', {
        count: pdfPrebuildStatus.completed,
        total: pdfPrebuildStatus.total,
        defaultValue: 'Preparing print cache…',
      });
    }
    if (pdfPrebuildStatus.state === 'warning') {
      return t('toolbar.printPrebuild.warning', {
        count: pdfPrebuildStatus.completed,
        total: pdfPrebuildStatus.total,
        defaultValue: 'Print cache partially ready',
      });
    }
    if (pdfPrebuildStatus.state === 'error') {
      return t('toolbar.printPrebuild.error', { defaultValue: 'Print cache failed' });
    }
    return t('toolbar.printPrebuild.off', { defaultValue: 'Print cache inactive' });
  }, [pdfPrebuildStatus.completed, pdfPrebuildStatus.paused, pdfPrebuildStatus.state, pdfPrebuildStatus.total, t, toolbarPrintEnabled]);

  const pdfBenchmarkEnabled = useMemo(() => isPdfBenchmarkEnabled(getRuntimeConfig()), []);
  const renderBenchmarkEnabled = useMemo(() => isRenderDecodeBenchmarkEnabled(getRuntimeConfig()), []);
  const handleRunPdfBenchmark = useCallback(async ({ onProgress } = {}) => {
    const detail = {
      mode: 'all',
      allScope: 'session',
      printBackend: 'pdf',
      printAction: 'benchmark',
    };
    const pageNumbers = resolvePrintPageNumbers(detail);
    return runPdfGenerationBenchmark({
      documentRenderRef,
      pageNumbers,
      baseOptions: makePrintOptions(detail),
      config: getRuntimeConfig(),
      onProgress,
    });
  }, [documentRenderRef, makePrintOptions, resolvePrintPageNumbers]);

  const handleRunRenderBenchmark = useCallback(async ({ onProgress, signal } = {}) => runRenderDecodeBenchmark({
    allPages,
    viewerContext,
    config: getRuntimeConfig(),
    onProgress,
    signal,
  }), [allPages, viewerContext]);

  const printActionTitle = isPdfOutputLocked
    ? t('toolbar.printBusy', { defaultValue: 'A PDF is already being prepared.' })
    : toolbarPrintEnabled
      ? t('toolbar.print')
      : t('toolbar.printDisabledLoading', {
          defaultValue: 'Printing becomes available when all pages are fully loaded.',
        });
  const printSelectionWorkspaceTitle = canOpenPrintSelectionWorkspace
    ? t('toolbar.printSelectionWorkspace.open', { defaultValue: 'Manage the pages shown and printed' })
    : t('toolbar.printSelectionWorkspace.openDisabled', {
        defaultValue: 'Selection management is available when all pages are fully loaded.',
      });

  const printDefaultSettings = useMemo(() => {
    void printPreferenceRevision;
    const userDefaultMode = getPrintDefaultModePreference();
    return {
      userDefaultMode,
    };
  }, [printPreferenceRevision]);

  const getPrintModeLabel = useCallback((mode) => (
    mode === 'all'
      ? t('printDialog.modes.all', { defaultValue: 'All pages' })
      : t('printDialog.modes.active', { defaultValue: 'Active page' })
  ), [t]);

  const updatePrintDefaultModePreference = useCallback((mode) => {
    if (mode === 'active' || mode === 'all') setPrintDefaultModePreference(mode);
    else clearPrintDefaultModePreference();
    setPrintPreferenceRevision((current) => current + 1);
  }, []);

  // Derived display values (safe defaults if optional props are absent)
  const zoomPercent = Number.isFinite(zoom) ? Math.round(Number(zoom) * 100) : undefined;
  const zoomMode = zoomState?.mode || 'CUSTOM';

  // 1:1 active when NOT in a FIT mode and zoom ≈ 1.0
  const isOneToOneActive =
    (zoomMode !== 'FIT_PAGE' && zoomMode !== 'FIT_WIDTH' && zoomMode !== 'FIT_CUSTOM') &&
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

  if (printSelectionWorkspaceActive) {
    const state = printSelectionWorkspaceToolbarState || {};
    const thumbnailPercent = Math.max(0, Number(state.thumbnailPercent) || 0);
    const thumbnailSliderValue = thumbnailPercentToSliderValue(thumbnailPercent);

    return (
      <div className="toolbar toolbar--selection-workspace" role="toolbar" aria-label={t('toolbar.aria.documentControls')}>
        {printSelectionWorkspaceToolbarState ? (
          <div className="print-selection-toolbar-controls">
            <div className="print-selection-mode-toggle" aria-label={t('printSelectionWorkspace.modeLabel', { defaultValue: 'Mode' })}>
              <label
                className={state.documentModeAvailable ? '' : 'is-disabled'}
                title={state.documentModeAvailable
                  ? t('printSelectionWorkspace.documentModeTitle', { defaultValue: 'Respect document boundaries' })
                  : t('printSelectionWorkspace.documentModeUnavailableTitle', {
                      defaultValue: 'Document mode requires explicit document metadata from the host application.',
                    })}
              >
                <input
                  type="radio"
                  name="print-selection-workspace-mode-toolbar"
                  checked={state.workspaceMode === 'documents'}
                  disabled={!state.documentModeAvailable}
                  onChange={() => state.onWorkspaceModeChange?.('documents')}
                />
                <span>{t('printSelectionWorkspace.documentMode', { defaultValue: 'Documents' })}</span>
              </label>
              <label title={t('printSelectionWorkspace.pageModeTitle', { defaultValue: 'Free page placement' })}>
                <input
                  type="radio"
                  name="print-selection-workspace-mode-toolbar"
                  checked={state.workspaceMode === 'pages'}
                  onChange={() => state.onWorkspaceModeChange?.('pages')}
                />
                <span>{t('printSelectionWorkspace.pageMode', { defaultValue: 'Pages' })}</span>
              </label>
            </div>

            <div className="print-selection-panel-mode-actions" aria-label={t('printSelectionWorkspace.panelModeLabel', { defaultValue: 'Panel layout' })}>
              <button
                type="button"
                className={state.panelMode === 'both' ? 'is-active' : ''}
                onClick={() => state.onPanelModeChange?.('both')}
                title={t('printSelectionWorkspace.showBothPanels', { defaultValue: 'Show both panels' })}
                aria-label={t('printSelectionWorkspace.showBothPanels', { defaultValue: 'Show both panels' })}
              >
                <span className="material-icons" aria-hidden="true">view_week</span>
              </button>
              <button
                type="button"
                className={state.panelMode === 'right' ? 'is-active' : ''}
                onClick={() => state.onPanelModeChange?.('right')}
                title={t('printSelectionWorkspace.showRightPanel', { defaultValue: 'Show selected pages' })}
                aria-label={t('printSelectionWorkspace.showRightPanel', { defaultValue: 'Show selected pages' })}
              >
                <span className="material-icons" aria-hidden="true">align_horizontal_right</span>
              </button>
            </div>

            <div className="print-selection-thumbnail-slider-inline">
              <span className="material-icons" aria-hidden="true">search</span>
              <input
                type="range"
                min={PRINT_SELECTION_THUMBNAIL_SLIDER_MIN}
                max={PRINT_SELECTION_THUMBNAIL_SLIDER_MAX}
                step="5"
                value={thumbnailSliderValue}
                title={t('printSelectionWorkspace.thumbnailSizeLabel', { defaultValue: 'Thumbnail size' })}
                aria-label={t('printSelectionWorkspace.thumbnailSizeLabel', { defaultValue: 'Thumbnail size' })}
                aria-valuetext={t('printSelectionWorkspace.thumbnailSizeValue', {
                  percent: thumbnailPercent,
                  defaultValue: `${thumbnailPercent}%`,
                })}
                onChange={(event) => state.onThumbnailSizeChange?.(thumbnailSliderValueToPercent(event.target.value))}
              />
            </div>

            <button
              type="button"
              className="print-selection-secondary print-selection-history-action"
              onClick={() => state.onUndoDraftChange?.()}
              disabled={!state.canUndoDraftChange}
              title={state.undoActionTitle || t('printSelectionWorkspace.undoTitle', { defaultValue: 'Undo the latest print-selection change.' })}
              aria-label={state.undoActionTitle || t('printSelectionWorkspace.undoTitle', { defaultValue: 'Undo the latest print-selection change.' })}
            >
              <span className="material-icons" aria-hidden="true">undo</span>
            </button>

            <button
              type="button"
              className="print-selection-secondary print-selection-history-action"
              onClick={() => state.onRedoDraftChange?.()}
              disabled={!state.canRedoDraftChange}
              title={state.redoActionTitle || t('printSelectionWorkspace.redoTitle', { defaultValue: 'Redo the latest undone print-selection change.' })}
              aria-label={state.redoActionTitle || t('printSelectionWorkspace.redoTitle', { defaultValue: 'Redo the latest undone print-selection change.' })}
            >
              <span className="material-icons" aria-hidden="true">redo</span>
            </button>
          </div>
        ) : null}

        <div className="toolbar-spacer" />

        <div className="toolbar-end-actions print-selection-toolbar-end-actions">
          <button
            type="button"
            className="print-selection-secondary print-selection-reset-draft-action"
            onClick={() => state.onResetDraftChanges?.()}
            disabled={!state.canResetDraftChanges}
            title={state.resetDraftChangesTitle || t('printSelectionWorkspace.resetDraftChangesTitle', { defaultValue: 'Discard unsaved changes and return to the latest saved page selection.' })}
            aria-label={state.resetDraftChangesTitle || t('printSelectionWorkspace.resetDraftChangesTitle', { defaultValue: 'Discard unsaved changes and return to the latest saved page selection.' })}
          >
            <span className="material-icons" aria-hidden="true">restart_alt</span>
          </button>
          <button
            type="button"
            className="print-selection-primary print-selection-save-action"
            onClick={() => state.onSaveDraftChange?.()}
            disabled={!state.canSaveDraftChange}
            title={t('printSelectionWorkspace.saveChangesTitle', { defaultValue: 'Save the current page selection without leaving edit mode.' })}
            aria-label={t('printSelectionWorkspace.saveChangesTitle', { defaultValue: 'Save the current page selection without leaving edit mode.' })}
          >
            <span className="material-icons" aria-hidden="true">save</span>
            {t('printSelectionWorkspace.save', { defaultValue: 'Save' })}
          </button>
          <button
            type="button"
            className="print-selection-secondary print-selection-leave-action"
            onClick={() => state.onLeaveWorkspace?.()}
            title={t('printSelectionWorkspace.leaveEditingTitle', { defaultValue: 'Leave selection editing.' })}
            aria-label={t('printSelectionWorkspace.leaveEditingTitle', { defaultValue: 'Leave selection editing.' })}
          >
            <span className="material-icons" aria-hidden="true">exit_to_app</span>
            {t('printSelectionWorkspace.leaveEditing', { defaultValue: 'Leave' })}
          </button>
        </div>

        <ManualOverlayDialog
          isOpen={isManualDialogOpen}
          onClose={() => setIsManualDialogOpen(false)}
          returnFocusRef={manualOpenerRef}
        />

        <AboutOverlayDialog
          isOpen={isAboutDialogOpen}
          onClose={() => setIsAboutDialogOpen(false)}
          benchmarkEnabled={pdfBenchmarkEnabled}
          onRunPdfBenchmark={handleRunPdfBenchmark}
          renderBenchmarkEnabled={renderBenchmarkEnabled}
          onRunRenderBenchmark={handleRunRenderBenchmark}
        />
      </div>
    );
  }

  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.aria.documentControls')}>
      {/* Print button → opens dialog */}
      <SplitToolbarButton
        onClick={() => { if (toolbarPrintEnabled && !isPdfOutputLocked) openPrintDialog(); }}
        aria-label={printActionTitle}
        title={printActionTitle}
        menuLabel={t('toolbar.printDefault.openMenu', { defaultValue: 'Print defaults' })}
        mainClassName="odv-btn--with-status-led"
        menuClassName="toolbar-popup-menu--align-left"
        disabled={!toolbarPrintEnabled || isPdfOutputLocked}
        menuChildren={({ closeMenu }) => (
          <div className="toolbar-split-menu-section">
            <div className="toolbar-split-menu-title">
              {t('toolbar.printDefault.title', { defaultValue: 'Default print scope' })}
            </div>
            {['active', 'all'].map((mode) => {
              const selected = printDefaultSettings.userDefaultMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`toolbar-popup-menu-item toolbar-split-menu-row${selected ? ' is-selected' : ''}`}
                  onClick={() => {
                    updatePrintDefaultModePreference(selected ? null : mode);
                    closeMenu();
                  }}
                >
                  <span className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`} aria-hidden="true">
                    {selected ? 'check' : ''}
                  </span>
                  <span>{getPrintModeLabel(mode)}</span>
                </button>
              );
            })}
          </div>
        )}
      >
        <span className="material-icons" aria-hidden="true">print</span>
        <StatusLed state={printLedState} size="xs" title={printLedTitle} className="odv-toolbar-print-led" />
      </SplitToolbarButton>

      {printSelectionWorkspaceEnabled ? (
        <button
          type="button"
          onClick={() => {
            if (canOpenPrintSelectionWorkspace) openPrintSelectionWorkspace?.();
          }}
          aria-label={printSelectionWorkspaceTitle}
          title={printSelectionWorkspaceTitle}
          className={`odv-btn${printSelectionSequenceLocked ? ' is-active' : ''}`}
          disabled={!canOpenPrintSelectionWorkspace}
        >
          <span className="material-icons" aria-hidden="true">playlist_add_check</span>
        </button>
      ) : null}

      <div className="separator" />

      {/* Paging controls (now include editable page field inside the group) */}
      <PageNavigationButtons
        prevPageDisabled={effectivePrevPageDisabled}
        nextPageDisabled={effectiveNextPageDisabled}
        firstPageDisabled={effectiveFirstPageDisabled}
        lastPageDisabled={effectiveLastPageDisabled}
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
        pageLoadState={pageLoadState}
      />

      <div className="separator" />

      {/* Zoom & fit */}
      <ZoomButtons
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToCustomWidth={fitToCustomWidth}
        fitToWidth={fitToWidth}
        onActualSize={handleActualSize}
        zoomMode={zoomMode}
        zoomPercent={zoomPercent}
        isOneToOneActive={isOneToOneActive}
        onPercentApply={handlePercentApply}
        customFitWidthFactorPercent={customFitWidthFactorPercent}
        customFitSizeLimits={customFitSizeLimits}
        configuredCustomFitSizeLimits={configuredCustomFitSizeLimits}
        userCustomFitSizeLimits={userCustomFitSizeLimits}
        configuredCustomFitWidthFactorPercent={configuredCustomFitWidthFactorPercent}
        onCustomFitWidthFactorChange={setCustomFitWidthFactorPercent}
        onCustomFitSizeLimitsChange={setCustomFitSizeLimits}
        userDefaultZoomMode={userDefaultZoomMode}
        configuredDefaultZoomMode={configuredDefaultZoomMode}
        onDefaultZoomModeChange={setDefaultZoomModePreference}
      />

      <div className="separator" />

      {/* Fine-tuning visibility is shared by ordinary single and two-page viewing. */}
      {isFineTuneEnabled() && typeof onToggleFineTune === 'function' ? (
        <button
          type="button"
          className="odv-btn fine-tune-toggle"
          aria-label={t('toolbar.fineTune.label', { defaultValue: 'Fine tuning' })}
          aria-pressed={fineTuneVisible}
          aria-expanded={fineTuneVisible}
          title={fineTuneVisible
            ? t('toolbar.fineTune.hide', { defaultValue: 'Hide fine tuning; keep page adjustments' })
            : t('toolbar.fineTune.show', { defaultValue: 'Show fine tuning for zoom, position, rotation and image' })}
          onClick={onToggleFineTune}
        >
          <span className="material-icons" aria-hidden="true">tune</span>
        </button>
      ) : null}
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

      {/* Overlay view: only in compare mode with two pages shown, unless compare.overlay.enabled is false */}
      {showCompareOverlayEntry ? (
        <button
          type="button"
          onClick={() => openCompareOverlay()}
          aria-label={t('toolbar.compareOverlay.open', { defaultValue: 'Overlay the two pages (transparency)' })}
          title={t('toolbar.compareOverlay.open', { defaultValue: 'Overlay the two pages (transparency)' })}
          className="odv-btn compare-overlay-button"
        >
          <span className="material-icons" aria-hidden="true">layers</span>
        </button>
      ) : null}

      {/* Curtain view: same condition, unless compare.curtain.enabled is false; disabled with an
          explanation until the overlay view calibrated (ready at once when the overlay is off) */}
      {showCompareCurtainEntry ? (
        <CompareCurtainButton calibrated={compareCalibrated} onOpen={openCompareCurtain} />
      ) : null}

      <div className="separator" />

      {/* Editing controls are visible except in compare mode with toolbarMode 'hide' while a pane panel is
          expanded. Canvas rendering activates only when a non-neutral adjustment exists. */}
      <div
        className={`zoom-fixed-group editing-tools ${editingTargetMode === 'compare' ? 'editing-target-compare' : 'editing-target-primary'}`}
        aria-label={t('toolbar.imageAdjustments')}
        title={editingGroupTitle}
      >
        {hideCoarseAdjustments ? null : (<>
        <button
          type="button"
          onClick={(event) => handleRotationButtonClick(event, -90)}
          aria-label={t('toolbar.rotateLeft90')}
          title={rotateLeftTitle}
          className="odv-btn"
        >
          <span className="material-icons" aria-hidden="true">rotate_left</span>
        </button>
        <button
          type="button"
          onClick={(event) => handleRotationButtonClick(event, 90)}
          aria-label={t('toolbar.rotateRight90')}
          title={rotateRightTitle}
          className="odv-btn"
        >
          <span className="material-icons" aria-hidden="true">rotate_right</span>
        </button>
        </>)}

        <button
          type="button"
          onClick={handleEnhancePdfResolutionClick}
          aria-label={enhancePdfResolutionTitle}
          title={enhancePdfResolutionTitle}
          className={`odv-btn${isPdfResolutionBoosted || isPdfResolutionPending ? ' is-active' : ''}`}
          disabled={!canBoostPdfResolution}
        >
          <span className="material-icons" aria-hidden="true">high_quality</span>
        </button>

        {hideCoarseAdjustments ? null : (<>
        <div className="toolbar-menu-shell toolbar-adjustment-shell">
          <button
            ref={brightnessButtonRef}
            type="button"
            onClick={() => toggleAdjustmentMenu('brightness')}
            aria-label={t('toolbar.adjustBrightness')}
            title={brightnessTitle}
            aria-haspopup="dialog"
            aria-expanded={openAdjustmentMenu === 'brightness'}
            className={`odv-btn toolbar-adjustment-button${isBrightnessAdjusted ? ' is-active' : ''}`}
          >
            <span className="material-icons" aria-hidden="true">brightness_6</span>
            {isComparing && isBrightnessAdjusted ? (
              <span className="toolbar-adjustment-value" aria-hidden="true">{brightnessValue}</span>
            ) : null}
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
            title={contrastTitle}
            aria-haspopup="dialog"
            aria-expanded={openAdjustmentMenu === 'contrast'}
            className={`odv-btn toolbar-adjustment-button${isContrastAdjusted ? ' is-active' : ''}`}
          >
            <span className="material-icons" aria-hidden="true">tonality</span>
            {isComparing && isContrastAdjusted ? (
              <span className="toolbar-adjustment-value" aria-hidden="true">{contrastValue}</span>
            ) : null}
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
          aria-label={resetAdjustmentsLabel}
          title={resetAdjustmentsLabel}
          className={`odv-btn toolbar-reset-adjustments${isPaneAdjusted ? ' is-active' : ''}`}
        >
          <span className="material-icons" aria-hidden="true">restart_alt</span>
        </button>
        </>)}
      </div>

      <div className="toolbar-spacer" />

      {signatureSummary && typeof onOpenSignatureOverview === 'function' ? (
        <SignatureOverviewButton summary={signatureSummary} onOpen={onOpenSignatureOverview} />
      ) : null}

      <div className="toolbar-end-actions">
        <ThemeMenuButton />
        <LanguageMenuButton />
        <HelpMenuButton
          onOpenManual={(opener) => {
            manualOpenerRef.current = opener || null;
            setIsManualDialogOpen(true);
          }}
          onOpenAbout={() => setIsAboutDialogOpen(true)}
          statusLedState={runtimeStatusLedState}
          statusLedTitle={runtimeStatusLedTitle}
        />
      </div>

      {/* Print dialog and PDF progress of the shared print pipeline (also hosted by the compare views) */}
      <PrintPipelineDialogs pipeline={printPipeline} />


      <ManualOverlayDialog
        isOpen={isManualDialogOpen}
        onClose={() => setIsManualDialogOpen(false)}
        returnFocusRef={manualOpenerRef}
      />

      <AboutOverlayDialog
        isOpen={isAboutDialogOpen}
        onClose={() => setIsAboutDialogOpen(false)}
        benchmarkEnabled={pdfBenchmarkEnabled}
        onRunPdfBenchmark={handleRunPdfBenchmark}
        renderBenchmarkEnabled={renderBenchmarkEnabled}
        onRunRenderBenchmark={handleRunRenderBenchmark}
      />

    </div>
  );
};

DocumentToolbar.propTypes = {
  fineTuneVisible: PropTypes.bool,
  onToggleFineTune: PropTypes.func,
  runtimeStatusLedState: PropTypes.oneOf(['off', 'pending', 'ready', 'active', 'warning', 'error']),
  runtimeStatusLedTitle: PropTypes.string,
  pageNumber: PropTypes.number.isRequired,
  pageNumberDisplay: PropTypes.number,
  totalPages: PropTypes.number.isRequired,
  isDocumentLoading: PropTypes.bool,
  pageLoadState: PropTypes.object,
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
  fitToCustomWidth: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  printPipeline: PropTypes.shape({
    openPrintDialog: PropTypes.func.isRequired,
    toolbarPrintEnabled: PropTypes.bool.isRequired,
    isPdfOutputLocked: PropTypes.bool.isRequired,
    pdfPrebuildStatus: PropTypes.object.isRequired,
    makePrintOptions: PropTypes.func.isRequired,
    resolvePrintPageNumbers: PropTypes.func.isRequired,
  }).isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  activePane: PropTypes.oneOf(['primary', 'compare']),
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  comparePageNumberDisplay: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }),
  goToPreviousPage: PropTypes.func,
  goToNextPage: PropTypes.func,
  goToFirstPage: PropTypes.func,
  goToLastPage: PropTypes.func,
  goToPreviousDocument: PropTypes.func,
  goToNextDocument: PropTypes.func,
  goToFirstDocument: PropTypes.func,
  goToLastDocument: PropTypes.func,
  documentNavigationEnabled: PropTypes.bool,
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
  zoom: PropTypes.number,
  zoomState: PropTypes.shape({
    mode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', 'CUSTOM']),
    scale: PropTypes.number,
  }),
  setZoomMode: PropTypes.func,
  customFitWidthFactorPercent: PropTypes.number,
  customFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }),
  configuredCustomFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }),
  userCustomFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }),
  configuredCustomFitWidthFactorPercent: PropTypes.number,
  userDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', null]),
  configuredDefaultZoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE']),
  setCustomFitWidthFactorPercent: PropTypes.func,
  setCustomFitSizeLimits: PropTypes.func,
  setDefaultZoomModePreference: PropTypes.func,
  setZoom: PropTypes.func,
  printSelectionSequenceLocked: PropTypes.bool,
  printSelectionWorkspaceEnabled: PropTypes.bool,
  printSelectionWorkspaceActive: PropTypes.bool,
  printSelectionWorkspaceToolbarState: PropTypes.object,
  canOpenPrintSelectionWorkspace: PropTypes.bool,
  openPrintSelectionWorkspace: PropTypes.func,
  allPages: PropTypes.arrayOf(PropTypes.any),
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

export default React.memo(DocumentToolbar);
