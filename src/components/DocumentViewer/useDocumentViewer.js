// File: src/components/DocumentViewer/useDocumentViewer.js
/**
 * File: src/components/DocumentViewer/useDocumentViewer.js
 *
 * Primary viewer-state hook.
 *
 * Responsibilities:
 * - own local viewer interaction state such as page number, zoom, compare mode, and image adjustments
 * - expose memoized handlers consumed by the viewer shell and toolbar
 * - coordinate with helper hooks that manage effects and per-pane post-zoom behavior
 *
 * This is the main public hook for viewer interaction state. Helper hooks may be split further, but the
 * returned API from this module should remain stable unless a deliberate consumer-facing refactor is made.
 */

import { useState, useRef, useMemo, useEffect, useCallback, useContext } from 'react';
import logger from '../../logging/systemLogger.js';
import ViewerContext from '../../contexts/viewerContext.js';
import ThemeContext from '../../contexts/themeContext.js';
import { getKeyboardPrintShortcutBehavior } from '../../utils/runtimeConfig.js';
import { useViewerPostZoom } from './hooks/useViewerPostZoom.js';
import { useViewerEffects } from './hooks/useViewerEffects.js';

/**
 * Clamp a 1-based page number into [1, total].
 * @param {number} n
 * @param {number} total
 * @returns {number}
 */
function clampPage(n, total) {
  if (!Number.isFinite(total) || total < 1) return 1;
  const v = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(v, total);
}

/**
 * Normalize a rotation angle into the canonical 0..359 range used by the canvas renderer.
 *
 * JavaScript modulo keeps negative signs, so repeated 90-degree counter-clockwise rotation would
 * otherwise produce -90 and -180. The edit canvas expects positive quarter-turn values when it
 * decides whether width/height should be swapped.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeRotationDegrees(value) {
  const numeric = Math.round(Number(value) || 0);
  return ((numeric % 360) + 360) % 360;
}

/**
 * @param {(Array<boolean>|null|undefined)} mask
 * @param {number} total
 * @returns {Array<boolean>}
 */
function normalizeSelectionMask(mask, total) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const base = Array(safeTotal).fill(true);
  if (!Array.isArray(mask) || mask.length <= 0) return base;

  for (let index = 0; index < safeTotal; index += 1) {
    if (index < mask.length && mask[index] === false) base[index] = false;
  }
  return base;
}

/**
 * @param {Array<boolean>} mask
 * @param {number} total
 * @returns {boolean}
 */
function hasExcludedPages(mask, total) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  for (let index = 0; index < safeTotal; index += 1) {
    if (mask[index] === false) return true;
  }
  return false;
}

/**
 * @param {Array<boolean>} a
 * @param {Array<boolean>} b
 * @param {number} total
 * @returns {boolean}
 */
function masksEqual(a, b, total) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  for (let index = 0; index < safeTotal; index += 1) {
    if (!!a[index] !== !!b[index]) return false;
  }
  return true;
}

/**
 * Resolve the nearest visible page number for a requested original page index.
 * Exact matches win. Otherwise the function prefers the first visible page after the requested
 * original index and falls back to the nearest visible page before it.
 *
 * @param {Array<number>} visibleOriginalIndexes
 * @param {number} originalIndex
 * @returns {number}
 */
function findNearestVisiblePageNumber(visibleOriginalIndexes, originalIndex) {
  if (!Array.isArray(visibleOriginalIndexes) || visibleOriginalIndexes.length <= 0) return 1;

  const safeOriginalIndex = Math.max(0, Math.floor(Number(originalIndex) || 0));
  let fallbackBefore = -1;

  for (let visibleIndex = 0; visibleIndex < visibleOriginalIndexes.length; visibleIndex += 1) {
    const currentOriginalIndex = Math.max(0, Math.floor(Number(visibleOriginalIndexes[visibleIndex]) || 0));
    if (currentOriginalIndex === safeOriginalIndex) return visibleIndex + 1;
    if (currentOriginalIndex > safeOriginalIndex) return visibleIndex + 1;
    fallbackBefore = visibleIndex;
  }

  return fallbackBefore >= 0 ? fallbackBefore + 1 : 1;
}

/**
 * @param {Array<any>} pages
 * @returns {Array<{ key:string, documentNumber:number, totalDocuments:number, startOriginalIndex:number, endOriginalIndex:number, pageCount:number, pages:Array<{ originalIndex:number, originalPageNumber:number, documentPageNumber:number, label:string }> }>}
 */
function buildDocumentSelectionModel(pages) {
  const sourcePages = Array.isArray(pages) ? pages : [];
  if (sourcePages.length <= 0) return [];

  /** @type {Array<{ key:string, documentNumber:number, totalDocuments:number, startOriginalIndex:number, endOriginalIndex:number, pageCount:number, pages:Array<{ originalIndex:number, originalPageNumber:number, documentPageNumber:number, label:string }> }>}
   */
  const documents = [];

  for (let originalIndex = 0; originalIndex < sourcePages.length; originalIndex += 1) {
    const page = sourcePages[originalIndex] || null;
    const documentNumber = Math.max(1, Number(page?.documentNumber) || 1);
    const totalDocuments = Math.max(documentNumber, Number(page?.totalDocuments) || 1);
    const documentId = String(page?.documentId || '').trim();
    const key = documentId || `doc:${documentNumber}`;
    const documentPageNumber = Math.max(
      1,
      Number(page?.documentPageNumber)
      || ((documents[documents.length - 1]?.documentNumber === documentNumber
        ? documents[documents.length - 1].pages.length
        : 0) + 1)
    );

    let current = documents[documents.length - 1] || null;
    if (!current || current.key !== key) {
      current = {
        key,
        documentNumber,
        totalDocuments,
        startOriginalIndex: originalIndex,
        endOriginalIndex: originalIndex,
        pageCount: Math.max(1, Number(page?.documentPageCount) || 0),
        pages: [],
      };
      documents.push(current);
    }

    current.endOriginalIndex = originalIndex;
    current.pageCount = Math.max(current.pageCount, Number(page?.documentPageCount) || (current.pages.length + 1));
    current.pages.push({
      originalIndex,
      originalPageNumber: originalIndex + 1,
      documentPageNumber,
      label: `S ${documentPageNumber} · T ${originalIndex + 1}`,
    });
  }

  return documents.map((document, index) => ({
    ...document,
    documentNumber: Math.max(1, Number(document.documentNumber) || index + 1),
    totalDocuments: Math.max(1, Number(document.totalDocuments) || documents.length),
    pageCount: Math.max(document.pages.length, Number(document.pageCount) || document.pages.length || 1),
  }));
}

const THUMBNAIL_WIDTH_MIN = 160;
const THUMBNAIL_WIDTH_MAX = 520;
const THUMBNAIL_WIDTH_STEP = 48;
const THUMBNAIL_WIDTH_DEFAULT = 220;

/**
 * Image adjustment properties for canvas edit mode.
 * @typedef {Object} ImageProperties
 * @property {number} rotation       Degrees, positive clockwise. 0 is neutral.
 * @property {number} brightness     0..200 (100 = neutral)
 * @property {number} contrast       0..200 (100 = neutral)
 */

/**
 * Sticky zoom modes used by the viewer (subset is used here).
 * @typedef {'FIT_PAGE'|'FIT_WIDTH'|'CUSTOM'|'ACTUAL_SIZE'} ZoomMode
 */

/**
 * Zoom state (mode + current numeric scale).
 * @typedef {Object} ZoomState
 * @property {ZoomMode} mode
 * @property {number} scale
 */

/** @typedef {'primary'|'compare'} ViewerPageTarget */

/**
 * Hook that centralizes viewer UI state and event handlers.
 * Public entry – returns the full API consumed by the viewer.
 *
 * The hook now exposes explicit primary/compare navigation helpers so keyboard shortcuts,
 * toolbar buttons, and thumbnail interactions can share the exact same page-target logic.
 * That keeps compare mode deterministic and avoids accidentally steering the wrong pane.
 *
 * Page selection/filtering keeps the render layer bound to original session page numbers while the
 * thumbnail pane and navigation helpers may operate on the filtered visible subset.
 *
 * @returns {Object} Returns the viewer API object (see returned keys below).
 */
export function useDocumentViewer() {
  const { allPages, pageLoadState } = useContext(ViewerContext);
  const { toggleTheme } = useContext(ThemeContext);
  const totalSessionPages = Array.isArray(allPages) ? allPages.length : 0;
  const keyboardPrintShortcutBehavior = getKeyboardPrintShortcutBehavior();

  // --- Core viewer interaction state ----------------------------------------------
  const [pageNumberRaw, setPageNumberRaw] = useState(1); // original 1-based page number
  const pageNumberRef = useRef(1);
  pageNumberRef.current = pageNumberRaw;
  const [thumbnailPaneMode, setThumbnailPaneMode] = useState('thumbnails');
  const [appliedSelectionMask, setAppliedSelectionMask] = useState(/** @type {(Array<boolean>|null)} */ (null));
  const [draftSelectionMask, setDraftSelectionMask] = useState(/** @type {Array<boolean>} */ ([]));
  const lastRequestedOriginalIndexRef = useRef(0);
  const lastRequestedCompareOriginalIndexRef = useRef(0);

  const pageStructureSignature = useMemo(() => {
    if (!Array.isArray(allPages) || allPages.length <= 0) return '0';
    const firstPage = allPages[0] || null;
    const lastPage = allPages[allPages.length - 1] || null;
    return [
      allPages.length,
      String(firstPage?.sourceKey || ''),
      String(firstPage?.documentId || ''),
      String(lastPage?.sourceKey || ''),
      String(lastPage?.documentId || ''),
    ].join('|');
  }, [allPages]);

  useEffect(() => {
    const nextMask = Array(totalSessionPages).fill(true);
    setAppliedSelectionMask(null);
    setDraftSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
  }, [pageStructureSignature, totalSessionPages]);

  const normalizedAppliedSelectionMask = useMemo(
    () => normalizeSelectionMask(appliedSelectionMask, totalSessionPages),
    [appliedSelectionMask, totalSessionPages]
  );
  const normalizedDraftSelectionMask = useMemo(
    () => normalizeSelectionMask(draftSelectionMask, totalSessionPages),
    [draftSelectionMask, totalSessionPages]
  );
  const selectionActive = useMemo(
    () => hasExcludedPages(normalizedAppliedSelectionMask, totalSessionPages),
    [normalizedAppliedSelectionMask, totalSessionPages]
  );
  const draftSelectionDirty = useMemo(
    () => !masksEqual(normalizedDraftSelectionMask, normalizedAppliedSelectionMask, totalSessionPages),
    [normalizedAppliedSelectionMask, normalizedDraftSelectionMask, totalSessionPages]
  );
  const draftIncludedCount = useMemo(
    () => normalizedDraftSelectionMask.reduce((count, included) => count + (included === false ? 0 : 1), 0),
    [normalizedDraftSelectionMask]
  );
  const selectionPanelEnabled = !!pageLoadState?.allPagesReady && totalSessionPages > 0;

  const visibleOriginalIndexes = useMemo(() => {
    const indexes = [];
    for (let originalIndex = 0; originalIndex < totalSessionPages; originalIndex += 1) {
      if (normalizedAppliedSelectionMask[originalIndex] === false) continue;
      if (!allPages[originalIndex]) continue;
      indexes.push(originalIndex);
    }
    return indexes;
  }, [allPages, normalizedAppliedSelectionMask, totalSessionPages]);

  const visiblePages = useMemo(
    () => visibleOriginalIndexes.map((originalIndex) => allPages[originalIndex]).filter(Boolean),
    [allPages, visibleOriginalIndexes]
  );
  const totalPages = visiblePages.length; // visible pages
  const originalIndexToVisiblePageNumber = useMemo(() => {
    const map = new Map();
    visibleOriginalIndexes.forEach((originalIndex, visibleIndex) => {
      map.set(originalIndex, visibleIndex + 1);
    });
    return map;
  }, [visibleOriginalIndexes]);
  const selectionDocuments = useMemo(
    () => buildDocumentSelectionModel(allPages),
    [allPages]
  );
  const visibleOriginalPageNumbers = useMemo(
    () => visibleOriginalIndexes.map((index) => index + 1),
    [visibleOriginalIndexes]
  );

  const currentOriginalPageNumber = clampPage(pageNumberRaw, Math.max(1, totalSessionPages || 1));
  const currentOriginalPageIndex = Math.max(0, currentOriginalPageNumber - 1);
  const currentVisiblePageNumber = useMemo(() => {
    const direct = originalIndexToVisiblePageNumber.get(currentOriginalPageIndex);
    if (Number.isFinite(direct)) return direct;
    return findNearestVisiblePageNumber(visibleOriginalIndexes, currentOriginalPageIndex);
  }, [currentOriginalPageIndex, originalIndexToVisiblePageNumber, visibleOriginalIndexes]);

  useEffect(() => {
    lastRequestedOriginalIndexRef.current = currentOriginalPageIndex;
  }, [currentOriginalPageIndex]);

  const [primaryDisplayState, setPrimaryDisplayState] = useState({
    requestedPageNumber: 1,
    displayedPageNumber: 0,
    pending: false,
    blockingLoading: false,
    hasError: false,
  });
  const [zoom, setZoom] = useState(1);
  const [zoomState, setZoomState] = useState(/** @type {ZoomState} */({ mode: 'FIT_PAGE', scale: 1 }));

  const [isComparing, setIsComparing] = useState(false);
  const [comparePageNumberRaw, setComparePageNumberRaw] = useState(/** @type {(number|null)} */ (null)); // original 1-based
  const [isPrintDialogOpen, setPrintDialogOpen] = useState(false);

  const compareOriginalPageNumber = comparePageNumberRaw == null
    ? null
    : clampPage(comparePageNumberRaw, Math.max(1, totalSessionPages || 1));
  const compareOriginalPageIndex = compareOriginalPageNumber == null ? -1 : Math.max(0, compareOriginalPageNumber - 1);
  const compareVisiblePageNumber = useMemo(() => {
    if (compareOriginalPageIndex < 0) return null;
    const direct = originalIndexToVisiblePageNumber.get(compareOriginalPageIndex);
    if (Number.isFinite(direct)) return direct;
    return findNearestVisiblePageNumber(visibleOriginalIndexes, compareOriginalPageIndex);
  }, [compareOriginalPageIndex, originalIndexToVisiblePageNumber, visibleOriginalIndexes]);

  useEffect(() => {
    if (compareOriginalPageIndex >= 0) lastRequestedCompareOriginalIndexRef.current = compareOriginalPageIndex;
  }, [compareOriginalPageIndex]);

  /**
   * @param {number} originalIndex
   * @returns {number}
   */
  const resolveNearestVisibleOriginalPageNumber = useCallback((originalIndex) => {
    if (visibleOriginalIndexes.length <= 0) return 1;
    const visiblePageNumber = findNearestVisiblePageNumber(visibleOriginalIndexes, originalIndex);
    const resolvedOriginalIndex = visibleOriginalIndexes[Math.max(0, visiblePageNumber - 1)] ?? visibleOriginalIndexes[0] ?? 0;
    return resolvedOriginalIndex + 1;
  }, [visibleOriginalIndexes]);

  useEffect(() => {
    if (totalPages <= 0) {
      if (pageNumberRaw !== 1) setPageNumberRaw(1);
      if (comparePageNumberRaw !== null) setComparePageNumberRaw(null);
      if (isComparing) setIsComparing(false);
      return;
    }

    if (!originalIndexToVisiblePageNumber.has(currentOriginalPageIndex)) {
      const nextPrimaryPage = resolveNearestVisibleOriginalPageNumber(lastRequestedOriginalIndexRef.current);
      if (pageNumberRaw !== nextPrimaryPage) setPageNumberRaw(nextPrimaryPage);
    }

    if (!isComparing) return;
    if (compareOriginalPageIndex < 0 || !originalIndexToVisiblePageNumber.has(compareOriginalPageIndex)) {
      const nextComparePage = resolveNearestVisibleOriginalPageNumber(lastRequestedCompareOriginalIndexRef.current);
      if (comparePageNumberRaw !== nextComparePage) setComparePageNumberRaw(nextComparePage);
    }
  }, [
    compareOriginalPageIndex,
    comparePageNumberRaw,
    currentOriginalPageIndex,
    isComparing,
    originalIndexToVisiblePageNumber,
    pageNumberRaw,
    resolveNearestVisibleOriginalPageNumber,
    totalPages,
  ]);

  const [imageProperties, setImageProperties] = useState(/** @type {ImageProperties} */ ({
    rotation: 0, brightness: 100, contrast: 100,
  }));

  const [isExpandedRaw, setIsExpandedRaw] = useState(false); // raw edit-mode flag
  const isExpanded = isExpandedRaw;

  const [thumbnailWidth, setThumbnailWidth] = useState(THUMBNAIL_WIDTH_DEFAULT);

  // Refs shared with the renderer layer and the effect helpers.
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type {{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type {{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type {{ current: any }} */ const compareRef = useRef(null);

  // --- Post-zoom (compare panes) -------------------------------------------------
  const {
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  } = useViewerPostZoom(isComparing);

  // --- Selection helpers ---------------------------------------------------------
  const toggleDraftSelectAll = useCallback((checked) => {
    const next = Array(totalSessionPages).fill(!!checked);
    setDraftSelectionMask(next);
  }, [totalSessionPages]);

  const toggleDraftDocument = useCallback((documentKey, checked) => {
    const key = String(documentKey || '');
    setDraftSelectionMask((current) => {
      const base = normalizeSelectionMask(current, totalSessionPages);
      const document = selectionDocuments.find((item) => item.key === key);
      if (!document) return base;
      const next = base.slice();
      document.pages.forEach((page) => {
        next[page.originalIndex] = !!checked;
      });
      return next;
    });
  }, [selectionDocuments, totalSessionPages]);

  const toggleDraftPage = useCallback((originalIndex, checked) => {
    const safeOriginalIndex = Math.max(0, Math.floor(Number(originalIndex) || 0));
    setDraftSelectionMask((current) => {
      const base = normalizeSelectionMask(current, totalSessionPages);
      if (safeOriginalIndex >= base.length) return base;
      const next = base.slice();
      next[safeOriginalIndex] = !!checked;
      return next;
    });
  }, [totalSessionPages]);

  const saveDraftSelection = useCallback(() => {
    const nextMask = normalizeSelectionMask(normalizedDraftSelectionMask, totalSessionPages);
    const includedCount = nextMask.reduce((count, included) => count + (included === false ? 0 : 1), 0);
    if (includedCount <= 0) return;
    if (masksEqual(nextMask, normalizedAppliedSelectionMask, totalSessionPages)) return;
    setAppliedSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
  }, [normalizedAppliedSelectionMask, normalizedDraftSelectionMask, totalSessionPages]);

  const cancelDraftSelection = useCallback(() => {
    setDraftSelectionMask(normalizedAppliedSelectionMask.slice());
  }, [normalizedAppliedSelectionMask]);

  // --- Page navigation -----------------------------------------------------------
  /**
   * Resolve the next original 1-based page number from a visible-page update.
   *
   * @param {ViewerPageTarget} target
   * @param {(number|function(number): number)} next
   * @returns {number}
   */
  const resolveTargetOriginalPageNumber = useCallback((target, next) => {
    if (totalPages <= 0 || visibleOriginalIndexes.length <= 0) return 1;

    const compareBase = compareVisiblePageNumber == null ? currentVisiblePageNumber : compareVisiblePageNumber;
    const currentBase = target === 'compare' ? compareBase : currentVisiblePageNumber;
    const safeBase = clampPage(currentBase, totalPages);
    const proposedVisiblePageNumber = clampPage(
      typeof next === 'function' ? next(safeBase) : next,
      totalPages
    );
    const resolvedOriginalIndex = visibleOriginalIndexes[Math.max(0, proposedVisiblePageNumber - 1)] ?? 0;
    return resolvedOriginalIndex + 1;
  }, [compareVisiblePageNumber, currentVisiblePageNumber, totalPages, visibleOriginalIndexes]);

  /**
   * Generic primary/compare page setter that accepts either a visible-page updater function or a
   * concrete original page number.
   *
   * - updater functions operate on the current filtered visible page ordinal and are used by the
   *   toolbar press-and-hold navigation hooks
   * - numeric values are interpreted as original session page numbers and are used by direct input
   *   and by thumbnail activation
   *
   * @param {ViewerPageTarget} target
   * @param {(number|function(number): number)} next
   * @returns {void}
   */
  const updatePageTarget = useCallback((target, next) => {
    if (target === 'compare' && isExpanded) return;

    const numericNext = typeof next === 'function'
      ? resolveTargetOriginalPageNumber(target, next)
      : clampPage(next, Math.max(1, totalSessionPages || 1));
    const finalOriginalPage = typeof next === 'function'
      ? numericNext
      : resolveNearestVisibleOriginalPageNumber(Math.max(0, numericNext - 1));

    if (target === 'compare') {
      lastRequestedCompareOriginalIndexRef.current = Math.max(0, numericNext - 1);
      setComparePageNumberRaw(finalOriginalPage);
      setIsComparing(true);
      return;
    }

    lastRequestedOriginalIndexRef.current = Math.max(0, numericNext - 1);
    setPageNumberRaw(finalOriginalPage);
  }, [isExpanded, resolveNearestVisibleOriginalPageNumber, resolveTargetOriginalPageNumber, totalSessionPages]);

  /**
   * Change the primary page using an original page number (or a visible-page updater function when
   * called from navigation helpers).
   * @param {(number|function(number): number)} next
   * @returns {void}
   */
  const handlePageNumberChange = useCallback((next) => {
    updatePageTarget('primary', next);
  }, [updatePageTarget]);

  /**
   * Change the primary page by a visible page number from the thumbnail strip.
   * @param {number} nextVisiblePageNumber
   * @returns {void}
   */
  const handleVisiblePageNumberChange = useCallback((nextVisiblePageNumber) => {
    if (totalPages <= 0) return;
    const resolvedOriginalPage = resolveTargetOriginalPageNumber('primary', nextVisiblePageNumber);
    lastRequestedOriginalIndexRef.current = Math.max(0, resolvedOriginalPage - 1);
    setPageNumberRaw(resolvedOriginalPage);
  }, [resolveTargetOriginalPageNumber, totalPages]);

  /**
   * Change the compare page using an original page number (or a visible-page updater function when
   * called from compare navigation helpers).
   * @param {(number|function(number): number)} next
   * @returns {void}
   */
  const setComparePageNumber = useCallback((next) => {
    updatePageTarget('compare', next);
  }, [updatePageTarget]);

  /**
   * Keep requested-page state and the actually displayed page synchronized for diagnostics. The
   * thumbnail highlight now follows the requested page immediately, but this state is still useful
   * for overlays, logging, and future UI affordances.
   *
   * @param {{ requestedPageNumber:number, displayedPageNumber:number, pending:boolean, blockingLoading:boolean, hasError:boolean }} nextState
   * @returns {void}
   */
  const handlePrimaryDisplayStateChange = useCallback((nextState) => {
    setPrimaryDisplayState((current) => {
      const normalized = {
        requestedPageNumber: Math.max(1, Number(nextState?.requestedPageNumber || current.requestedPageNumber || 1)),
        displayedPageNumber: Math.max(0, Number(nextState?.displayedPageNumber || 0)),
        pending: !!nextState?.pending,
        blockingLoading: !!nextState?.blockingLoading,
        hasError: !!nextState?.hasError,
      };

      if (
        current.requestedPageNumber === normalized.requestedPageNumber
        && current.displayedPageNumber === normalized.displayedPageNumber
        && current.pending === normalized.pending
        && current.blockingLoading === normalized.blockingLoading
        && current.hasError === normalized.hasError
      ) {
        return current;
      }
      return normalized;
    });
  }, []);

  /**
   * The thumbnail pane should react immediately when the user changes page. The large pane now
   * switches either directly to the requested page or to an explicit loading overlay, so keeping the
   * thumbnail highlight on the requested page no longer causes the old mismatch bug.
   */
  const thumbnailSelectionPageNumber = currentOriginalPageNumber;
  const compareThumbnailPageNumber = compareOriginalPageNumber;

  /**
   * Move one page backward in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToPreviousPage = useCallback((target = 'primary') => {
    updatePageTarget(target, (current) => current - 1);
  }, [updatePageTarget]);

  /**
   * Move one page forward in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToNextPage = useCallback((target = 'primary') => {
    updatePageTarget(target, (current) => current + 1);
  }, [updatePageTarget]);

  /**
   * Jump to the first visible page in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToFirstPage = useCallback((target = 'primary') => {
    updatePageTarget(target, () => 1);
  }, [updatePageTarget]);

  /**
   * Jump to the last visible page in the requested target pane.
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToLastPage = useCallback((target = 'primary') => {
    updatePageTarget(target, () => Math.max(1, totalPages || 1));
  }, [totalPages, updatePageTarget]);

  // --- Print dialog --------------------------------------------------------------
  const openPrintDialog = useCallback(() => {
    setPrintDialogOpen(true);
  }, []);

  const closePrintDialog = useCallback(() => {
    setPrintDialogOpen(false);
  }, []);

  // --- Zoom helpers --------------------------------------------------------------
  const zoomIn = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try { if (documentRenderRef.current?.zoomIn) { documentRenderRef.current.zoomIn(); return; } } catch (error) {
      logger.warn('DocumentRender zoomIn failed; using state fallback', { error: String(error?.message || error) });
    }
    setZoom((z) => Math.min(8, Math.round((z * 1.1) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
    try { if (documentRenderRef.current?.zoomOut) { documentRenderRef.current.zoomOut(); return; } } catch (error) {
      logger.warn('DocumentRender zoomOut failed; using state fallback', { error: String(error?.message || error) });
    }
    setZoom((z) => Math.max(0.1, Math.round((z / 1.1) * 100) / 100));
  }, []);

  const actualSize = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'ACTUAL_SIZE', scale: 1 });
    setZoom(1);
  }, [resetPostZoom]);

  const fitToScreen = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'FIT_PAGE', scale: zoom });
    try { documentRenderRef.current?.fitToScreen?.(); } catch (error) {
      logger.warn('DocumentRender fitToScreen failed', { error: String(error?.message || error) });
    }
  }, [resetPostZoom, zoom]);

  const fitToWidth = useCallback(() => {
    resetPostZoom();
    setZoomState({ mode: 'FIT_WIDTH', scale: zoom });
    try { documentRenderRef.current?.fitToWidth?.(); } catch (error) {
      logger.warn('DocumentRender fitToWidth failed', { error: String(error?.message || error) });
    }
  }, [resetPostZoom, zoom]);

  /** Set zoom mode directly ('FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'). */
  const setZoomMode = useCallback((mode) => {
    if (mode === 'FIT_PAGE') {
      fitToScreen();
      return;
    }
    if (mode === 'FIT_WIDTH') {
      fitToWidth();
      return;
    }
    if (mode === 'ACTUAL_SIZE') {
      actualSize();
      return;
    }
    setZoomState((s) => ({ ...s, mode: 'CUSTOM' }));
  }, [actualSize, fitToScreen, fitToWidth]);

  // --- Compare/Edit mutual exclusivity + handlers --------------------------------
  /**
   * Guarded setter for edit mode: refuses to enable while compare is active.
   * Supports boolean or updater function forms.
   * @param {boolean|Function} next
   */
  const setIsExpanded = useCallback((next) => {
    const resolve = (curr) => (typeof next === 'function' ? next(curr) : next);
    setIsExpandedRaw((curr) => {
      const wanted = resolve(curr);
      if (wanted && isComparing) {
        // Disallow enabling edit when compare is active.
        return curr;
      }
      return !!wanted;
    });
  }, [isComparing]);

  /** Toggle compare mode; blocked if edit mode is active. */
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
      if (!prev && isExpanded) return prev;
      const next = !prev;
      if (next) {
        const fallbackOriginalPage = compareOriginalPageNumber != null
          ? compareOriginalPageNumber
          : currentOriginalPageNumber;
        setComparePageNumberRaw(fallbackOriginalPage);
      }
      return next;
    });
  }, [compareOriginalPageNumber, currentOriginalPageNumber, isExpanded]);

  /**
   * Close compare mode without affecting the left page.
   * @returns {void}
   */
  const closeCompare = useCallback(() => {
    setIsComparing(false);
  }, []);

  /**
   * Select a page for the right-hand compare pane.
   * If compare is OFF, enables it unless edit mode is active (then no-op).
   * If compare is ON, just replaces the right-hand page.
   *
   * @param {number} page
   * @returns {void}
   */
  const selectForCompare = useCallback((page) => {
    if (isExpanded) return; // blocked by active edit mode
    setComparePageNumber(page);
    logger.info('Compare selection updated', { comparePage: page });
  }, [setComparePageNumber, isExpanded]);

  // --- Image adjustments ---------------------------------------------------------
  const handleRotationChange = useCallback((delta) => {
    const d = Number(delta || 0);
    setImageProperties((state) => ({
      ...state,
      rotation: normalizeRotationDegrees((Number(state.rotation) || 0) + d),
    }));
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((state) => ({ ...state, brightness: v }));
  }, []);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e) => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    setImageProperties((state) => ({ ...state, contrast: v }));
  }, []);

  const resetImageProperties = useCallback(() => {
    setImageProperties({ rotation: 0, brightness: 100, contrast: 100 });
  }, []);

  // --- Thumbnail resizer ---------------------------------------------------------
  /**
   * Mouse down handler for the thumbnail resizer; listens for mousemove/up on window.
   * @param {MouseEvent} e
   * @returns {void}
   */
  const applyThumbnailWidth = useCallback((next) => {
    const numeric = Number(next);
    if (!Number.isFinite(numeric)) return;
    if (numeric <= 0) {
      setThumbnailWidth(0);
      return;
    }
    setThumbnailWidth(Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, Math.round(numeric))));
  }, []);

  const increaseThumbnailWidth = useCallback(() => {
    setThumbnailWidth((current) => {
      const base = current > 0 ? current : THUMBNAIL_WIDTH_DEFAULT;
      return Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, base + THUMBNAIL_WIDTH_STEP));
    });
  }, []);

  const decreaseThumbnailWidth = useCallback(() => {
    setThumbnailWidth((current) => {
      if (current <= THUMBNAIL_WIDTH_MIN) return THUMBNAIL_WIDTH_MIN;
      return Math.max(THUMBNAIL_WIDTH_MIN, current - THUMBNAIL_WIDTH_STEP);
    });
  }, []);

  const hideThumbnailPane = useCallback(() => {
    setThumbnailWidth(0);
  }, []);

  const showThumbnailPane = useCallback(() => {
    setThumbnailWidth((current) => {
      if (current > 0) return current;
      return THUMBNAIL_WIDTH_DEFAULT;
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = Math.max(THUMBNAIL_WIDTH_MIN, thumbnailWidth || THUMBNAIL_WIDTH_DEFAULT);

    /** @param {MouseEvent} ev */
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const next = Math.max(THUMBNAIL_WIDTH_MIN, Math.min(THUMBNAIL_WIDTH_MAX, startWidth + dx));
      setThumbnailWidth(next);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [thumbnailWidth]);

  /**
   * Intentionally a no-op. The outer viewer shell keeps an explicit click handler slot so the
   * container API shape stays stable while focus/selection behavior is evaluated separately from
   * page activation, compare toggling, and edit-mode interactions.
   */
  const handleContainerClick = useCallback(function handleContainerClick() {}, []);

  // --- Effects: sticky fit, global wheel, hotkeys --------------------------------
  useViewerEffects({
    zoom,
    zoomState,
    setZoomState,
    documentRenderRef,
    viewerContainerRef,
    imageRotation: imageProperties.rotation,
    isComparing,
    thumbnailWidth,
    pageNumber: currentOriginalPageNumber,
    totalPages,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    closeCompare,
    zoomIn,
    zoomOut,
    actualSize,
    fitToScreen,
    fitToWidth,
    handleCompare,
    setIsExpandedGuarded: setIsExpanded,
    onOpenPrintDialog: openPrintDialog,
    onToggleTheme: toggleTheme,
    keyboardPrintShortcutBehavior,
  });

  // --- Public API ---------------------------------------------------------------
  return {
    // viewer/render page numbers
    pageNumber: currentVisiblePageNumber,
    pageNumberDisplay: currentOriginalPageNumber,
    renderPageNumber: currentOriginalPageNumber,
    setPageNumber: handlePageNumberChange,
    setVisiblePageNumber: handleVisiblePageNumberChange,

    // compare page numbers
    setComparePageNumber,
    comparePageNumber: compareVisiblePageNumber,
    renderComparePageNumber: compareOriginalPageNumber,

    thumbnailSelectionPageNumber,
    compareThumbnailPageNumber,
    primaryDisplayState,
    zoom,
    setZoom,
    isComparing,
    isPrintDialogOpen,
    openPrintDialog,
    closePrintDialog,
    imageProperties,
    isExpanded,
    thumbnailWidth,
    applyThumbnailWidth,
    increaseThumbnailWidth,
    decreaseThumbnailWidth,
    hideThumbnailPane,
    showThumbnailPane,
    viewerContainerRef,
    thumbnailsContainerRef,
    documentRenderRef,
    compareRef,
    handlePrimaryDisplayStateChange,
    handlePageNumberChange,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    zoomIn,
    zoomOut,
    actualSize,
    fitToScreen,
    fitToWidth,
    handleContainerClick,
    handleCompare,
    closeCompare,
    handleRotationChange,
    handleBrightnessChange,
    handleContrastChange,
    resetImageProperties,
    handleMouseDown,
    selectForCompare,
    setIsExpanded, // guarded setter
    zoomState,
    setZoomMode,

    // visible/selection data
    viewerPages: visiblePages,
    totalPages,
    totalPagesDisplay: totalSessionPages,
    visibleOriginalPageNumbers,
    selectionPanelEnabled,
    selectionDocuments,
    selectionActive,
    draftSelectionMask: normalizedDraftSelectionMask,
    draftSelectionDirty,
    draftIncludedCount,
    thumbnailPaneMode,
    setThumbnailPaneMode,
    toggleDraftSelectAll,
    toggleDraftDocument,
    toggleDraftPage,
    saveDraftSelection,
    cancelDraftSelection,

    // per-pane post-zoom
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  };
}
