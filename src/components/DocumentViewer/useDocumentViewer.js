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

/** Neutral per-page image adjustment state. */
const DEFAULT_IMAGE_PROPERTIES = Object.freeze({ rotation: 0, brightness: 100, contrast: 100 });

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
 * @returns {Array<{ key:string, documentNumber:number, totalDocuments:number, startOriginalIndex:number, endOriginalIndex:number, pageCount:number, pages:Array<{ originalIndex:number, originalPageNumber:number, documentPageNumber:number }> }>}
 */
function buildDocumentSelectionModel(pages) {
  const sourcePages = Array.isArray(pages) ? pages : [];
  if (sourcePages.length <= 0) return [];

  /** @type {Array<{ key:string, documentNumber:number, totalDocuments:number, startOriginalIndex:number, endOriginalIndex:number, pageCount:number, pages:Array<{ originalIndex:number, originalPageNumber:number, documentPageNumber:number }> }>}
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
    });
  }

  return documents.map((document, index) => ({
    ...document,
    documentNumber: Math.max(1, Number(document.documentNumber) || index + 1),
    totalDocuments: Math.max(1, Number(document.totalDocuments) || documents.length),
    pageCount: Math.max(document.pages.length, Number(document.pageCount) || document.pages.length || 1),
  }));
}

/**
 * @param {*} page
 * @returns {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number, documentPageNumber:number, documentId:string }}
 */
function getPageDocumentNavigationMeta(page) {
  const documentNumber = Math.max(0, Number(page?.documentNumber) || 0);
  const totalDocuments = Math.max(documentNumber, Number(page?.totalDocuments) || 0);
  const documentPageNumber = Math.max(0, Number(page?.documentPageNumber) || 0);
  const documentId = String(page?.documentId || '').trim();
  const hasMultipleDocuments = totalDocuments > 1 && documentNumber > 0 && documentPageNumber > 0;

  return {
    hasMultipleDocuments,
    documentNumber,
    totalDocuments,
    documentPageNumber,
    documentId,
  };
}

/**
 * Build the visible-document grouping used by document-level navigation.
 *
 * The grouping operates on the currently visible (selection-filtered) pages so document stepping and
 * toolbar/keyboard affordances match what the user can actually see and navigate.
 *
 * @param {Array<any>} pages
 * @param {Array<number>} visibleOriginalIndexes
 * @returns {{ groups:Array<{ key:string, documentNumber:number, totalDocuments:number, firstOriginalIndex:number, firstOriginalPageNumber:number, visiblePageCount:number }>, groupIndexByOriginalIndex: Map<number, number> }}
 */
function buildVisibleDocumentNavigationModel(pages, visibleOriginalIndexes) {
  const sourcePages = Array.isArray(pages) ? pages : [];
  const visibleIndexes = Array.isArray(visibleOriginalIndexes) ? visibleOriginalIndexes : [];
  /** @type {Array<{ key:string, documentNumber:number, totalDocuments:number, firstOriginalIndex:number, firstOriginalPageNumber:number, visiblePageCount:number }>}
   */
  const groups = [];
  const groupIndexByOriginalIndex = new Map();
  let currentKey = '';

  for (const rawOriginalIndex of visibleIndexes) {
    const originalIndex = Math.max(0, Math.floor(Number(rawOriginalIndex) || 0));
    const page = sourcePages[originalIndex] || null;
    const documentMeta = getPageDocumentNavigationMeta(page);
    if (!documentMeta.hasMultipleDocuments) continue;

    const key = documentMeta.documentId || `doc:${documentMeta.documentNumber}`;
    if (!key) continue;

    if (groups.length <= 0 || currentKey !== key) {
      groups.push({
        key,
        documentNumber: documentMeta.documentNumber,
        totalDocuments: documentMeta.totalDocuments,
        firstOriginalIndex: originalIndex,
        firstOriginalPageNumber: originalIndex + 1,
        visiblePageCount: 0,
      });
      currentKey = key;
    }

    const activeGroupIndex = groups.length - 1;
    groups[activeGroupIndex].visiblePageCount += 1;
    groupIndexByOriginalIndex.set(originalIndex, activeGroupIndex);
  }

  return {
    groups,
    groupIndexByOriginalIndex,
  };
}

const THUMBNAIL_WIDTH_MIN = 196;
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
  const printEnabled = !!pageLoadState?.allPagesReady && totalSessionPages > 0;
  const thumbnailWidthMin = THUMBNAIL_WIDTH_MIN;
  const thumbnailWidthMax = THUMBNAIL_WIDTH_MAX;
  const thumbnailWidthDefault = THUMBNAIL_WIDTH_DEFAULT;

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
  const visibleDocumentNavigationModel = useMemo(
    () => buildVisibleDocumentNavigationModel(allPages, visibleOriginalIndexes),
    [allPages, visibleOriginalIndexes]
  );
  const visibleDocumentGroups = visibleDocumentNavigationModel.groups;
  const visibleDocumentGroupIndexByOriginalIndex = visibleDocumentNavigationModel.groupIndexByOriginalIndex;
  const documentNavigationEnabled = visibleDocumentGroups.length > 1;

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
   * Resolve document-navigation state for the requested pane.
   *
   * Ctrl-based navigation operates on the currently visible (selection-filtered) document groups.
   * When the requested pane points inside the first visible document, Ctrl+Previous may still jump
   * back to that document's first page. Forward navigation only advances when another visible
   * document exists.
   *
   * @param {ViewerPageTarget} target
   * @returns {{ enabled:boolean, totalVisibleDocuments:number, currentDocumentNumber:number, currentDocumentStartPageNumber:number, firstDocumentPageNumber:number, lastDocumentPageNumber:number, previousDocumentPageNumber:number, nextDocumentPageNumber:number, canGoPrevious:boolean, canGoNext:boolean, canGoFirst:boolean, canGoLast:boolean }}
   */
  const getDocumentNavigationState = useCallback((target) => {
    const safeTarget = target === 'compare' ? 'compare' : 'primary';
    const baseOriginalPageNumber = safeTarget === 'compare'
      ? (isComparing && compareOriginalPageNumber != null ? compareOriginalPageNumber : currentOriginalPageNumber)
      : currentOriginalPageNumber;
    const baseOriginalIndex = safeTarget === 'compare'
      ? (isComparing && compareOriginalPageIndex >= 0 ? compareOriginalPageIndex : currentOriginalPageIndex)
      : currentOriginalPageIndex;

    if (!documentNavigationEnabled || visibleDocumentGroups.length <= 0) {
      return {
        enabled: false,
        totalVisibleDocuments: 0,
        currentDocumentNumber: 1,
        currentDocumentStartPageNumber: baseOriginalPageNumber,
        firstDocumentPageNumber: 1,
        lastDocumentPageNumber: 1,
        previousDocumentPageNumber: baseOriginalPageNumber,
        nextDocumentPageNumber: baseOriginalPageNumber,
        canGoPrevious: false,
        canGoNext: false,
        canGoFirst: false,
        canGoLast: false,
      };
    }

    const rawGroupIndex = visibleDocumentGroupIndexByOriginalIndex.get(baseOriginalIndex);
    const groupIndex = Number.isFinite(rawGroupIndex) ? rawGroupIndex : 0;
    const currentGroup = visibleDocumentGroups[groupIndex] || visibleDocumentGroups[0];
    const firstGroup = visibleDocumentGroups[0] || currentGroup;
    const lastGroup = visibleDocumentGroups[visibleDocumentGroups.length - 1] || currentGroup;
    const previousGroup = groupIndex > 0 ? visibleDocumentGroups[groupIndex - 1] : currentGroup;
    const nextGroup = groupIndex < visibleDocumentGroups.length - 1
      ? visibleDocumentGroups[groupIndex + 1]
      : currentGroup;
    const currentDocumentStartPageNumber = Math.max(1, Number(currentGroup?.firstOriginalPageNumber) || baseOriginalPageNumber || 1);
    const firstDocumentPageNumber = Math.max(1, Number(firstGroup?.firstOriginalPageNumber) || currentDocumentStartPageNumber);
    const lastDocumentPageNumber = Math.max(1, Number(lastGroup?.firstOriginalPageNumber) || currentDocumentStartPageNumber);
    const currentPageNumber = Math.max(1, Number(baseOriginalPageNumber) || currentDocumentStartPageNumber);

    return {
      enabled: true,
      totalVisibleDocuments: visibleDocumentGroups.length,
      currentDocumentNumber: Math.max(1, Number(currentGroup?.documentNumber) || groupIndex + 1),
      currentDocumentStartPageNumber,
      firstDocumentPageNumber,
      lastDocumentPageNumber,
      previousDocumentPageNumber: Math.max(1, Number(previousGroup?.firstOriginalPageNumber) || currentDocumentStartPageNumber),
      nextDocumentPageNumber: Math.max(1, Number(nextGroup?.firstOriginalPageNumber) || currentPageNumber),
      canGoPrevious: groupIndex > 0 || currentPageNumber !== currentDocumentStartPageNumber,
      canGoNext: groupIndex < visibleDocumentGroups.length - 1,
      canGoFirst: currentPageNumber !== firstDocumentPageNumber,
      canGoLast: currentPageNumber !== lastDocumentPageNumber,
    };
  }, [
    compareOriginalPageIndex,
    compareOriginalPageNumber,
    currentOriginalPageIndex,
    currentOriginalPageNumber,
    documentNavigationEnabled,
    isComparing,
    visibleDocumentGroupIndexByOriginalIndex,
    visibleDocumentGroups,
  ]);

  const primaryDocumentNavigation = useMemo(
    () => getDocumentNavigationState('primary'),
    [getDocumentNavigationState]
  );
  const compareDocumentNavigation = useMemo(
    () => getDocumentNavigationState('compare'),
    [getDocumentNavigationState]
  );

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

  const [primaryImageProperties, setPrimaryImageProperties] = useState(/** @type {ImageProperties} */ ({
    ...DEFAULT_IMAGE_PROPERTIES,
  }));
  const [compareImageProperties, setCompareImageProperties] = useState(/** @type {ImageProperties} */ ({
    ...DEFAULT_IMAGE_PROPERTIES,
  }));

  const [isExpandedRaw, setIsExpandedRaw] = useState(false); // editing-controls visibility
  const isExpanded = isExpandedRaw;

  const [thumbnailWidth, setThumbnailWidth] = useState(THUMBNAIL_WIDTH_DEFAULT);

  // Refs shared with the renderer layer and the effect helpers.
  /** @type {{ current: any }} */ const viewerContainerRef = useRef(null);
  /** @type {{ current: any }} */ const thumbnailsContainerRef = useRef(null);
  /** @type {{ current: any }} */ const documentRenderRef = useRef(null);
  /** @type {{ current: any }} */ const compareRef = useRef(null);
  const previousPrimaryOriginalPageRef = useRef(currentOriginalPageNumber);
  const previousCompareOriginalPageRef = useRef(compareOriginalPageNumber);

  useEffect(() => {
    if (previousPrimaryOriginalPageRef.current === currentOriginalPageNumber) return;
    previousPrimaryOriginalPageRef.current = currentOriginalPageNumber;
    setPrimaryImageProperties({ ...DEFAULT_IMAGE_PROPERTIES });
  }, [currentOriginalPageNumber]);

  useEffect(() => {
    if (!isComparing) {
      previousCompareOriginalPageRef.current = compareOriginalPageNumber;
      setCompareImageProperties({ ...DEFAULT_IMAGE_PROPERTIES });
      return;
    }
    if (previousCompareOriginalPageRef.current === compareOriginalPageNumber) return;
    previousCompareOriginalPageRef.current = compareOriginalPageNumber;
    setCompareImageProperties({ ...DEFAULT_IMAGE_PROPERTIES });
  }, [compareOriginalPageNumber, isComparing]);

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
    if (masksEqual(nextMask, normalizedAppliedSelectionMask, totalSessionPages)) return;
    setAppliedSelectionMask(nextMask);
    setDraftSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
  }, [normalizedAppliedSelectionMask, normalizedDraftSelectionMask, totalSessionPages]);

  const cancelDraftSelection = useCallback(() => {
    setDraftSelectionMask(normalizedAppliedSelectionMask.slice());
  }, [normalizedAppliedSelectionMask]);

  const clearSelectionFilter = useCallback(() => {
    const nextMask = Array(totalSessionPages).fill(true);
    setAppliedSelectionMask(nextMask);
    setDraftSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
  }, [totalSessionPages]);

  /**
   * Immediately exclude a page from the active selection and apply the filtered session.
   * Used by direct thumbnail affordances such as the custom context menu.
   *
   * @param {number} originalIndex
   * @returns {boolean}
   */
  const hidePageFromSelection = useCallback((originalIndex) => {
    if (!selectionPanelEnabled) return false;

    const safeOriginalIndex = Math.max(0, Math.floor(Number(originalIndex) || 0));
    if (safeOriginalIndex < 0 || safeOriginalIndex >= totalSessionPages) return false;

    const base = normalizeSelectionMask(normalizedAppliedSelectionMask, totalSessionPages);
    if (base[safeOriginalIndex] === false) return false;

    const nextMask = base.slice();
    nextMask[safeOriginalIndex] = false;

    setAppliedSelectionMask(nextMask);
    setDraftSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
    return true;
  }, [normalizedAppliedSelectionMask, selectionPanelEnabled, totalSessionPages]);

  /**
   * Immediately exclude every page that belongs to the same document as the provided original page
   * index. Used by the thumbnail context menu. This may intentionally result in an empty active
   * selection so the viewer can present an explicit "no pages in selection" state.
   *
   * @param {number} originalIndex
   * @returns {boolean}
   */
  const hideDocumentFromSelection = useCallback((originalIndex) => {
    if (!selectionPanelEnabled) return false;

    const safeOriginalIndex = Math.max(0, Math.floor(Number(originalIndex) || 0));
    if (safeOriginalIndex < 0 || safeOriginalIndex >= totalSessionPages) return false;

    const sourcePage = allPages[safeOriginalIndex] || null;
    const documentId = String(sourcePage?.documentId || '').trim();
    const documentNumber = Math.max(1, Number(sourcePage?.documentNumber) || 1);
    const base = normalizeSelectionMask(normalizedAppliedSelectionMask, totalSessionPages);
    const nextMask = base.slice();
    let changed = false;

    for (let index = 0; index < totalSessionPages; index += 1) {
      const page = allPages[index] || null;
      const sameDocument = documentId
        ? String(page?.documentId || '').trim() === documentId
        : Math.max(1, Number(page?.documentNumber) || 1) === documentNumber;
      if (!sameDocument || nextMask[index] === false) continue;
      nextMask[index] = false;
      changed = true;
    }

    if (!changed) return false;

    setAppliedSelectionMask(nextMask);
    setDraftSelectionMask(nextMask);
    setThumbnailPaneMode('thumbnails');
    return true;
  }, [allPages, normalizedAppliedSelectionMask, selectionPanelEnabled, totalSessionPages]);

  const hideCurrentPageFromSelection = useCallback((target = 'primary') => {
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    if (updateTarget === 'compare' && (!isComparing || compareOriginalPageNumber == null)) return false;
    const originalPageNumber = updateTarget === 'compare' ? compareOriginalPageNumber : currentOriginalPageNumber;
    if (!Number.isFinite(Number(originalPageNumber)) || Number(originalPageNumber) < 1) return false;
    const originalIndex = Math.max(0, Math.floor(Number(originalPageNumber) || 0) - 1);
    return hidePageFromSelection(originalIndex);
  }, [compareOriginalPageNumber, currentOriginalPageNumber, hidePageFromSelection, isComparing]);

  const hideCurrentDocumentFromSelection = useCallback((target = 'primary') => {
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    if (updateTarget === 'compare' && (!isComparing || compareOriginalPageNumber == null)) return false;
    const originalPageNumber = updateTarget === 'compare' ? compareOriginalPageNumber : currentOriginalPageNumber;
    if (!Number.isFinite(Number(originalPageNumber)) || Number(originalPageNumber) < 1) return false;
    const originalIndex = Math.max(0, Math.floor(Number(originalPageNumber) || 0) - 1);
    return hideDocumentFromSelection(originalIndex);
  }, [compareOriginalPageNumber, currentOriginalPageNumber, hideDocumentFromSelection, isComparing]);

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

    const compareBase = !isComparing || compareVisiblePageNumber == null ? currentVisiblePageNumber : compareVisiblePageNumber;
    const currentBase = target === 'compare' ? compareBase : currentVisiblePageNumber;
    const safeBase = clampPage(currentBase, totalPages);
    const proposedVisiblePageNumber = clampPage(
      typeof next === 'function' ? next(safeBase) : next,
      totalPages
    );
    const resolvedOriginalIndex = visibleOriginalIndexes[Math.max(0, proposedVisiblePageNumber - 1)] ?? 0;
    return resolvedOriginalIndex + 1;
  }, [compareVisiblePageNumber, currentVisiblePageNumber, isComparing, totalPages, visibleOriginalIndexes]);

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
  }, [resolveNearestVisibleOriginalPageNumber, resolveTargetOriginalPageNumber, totalSessionPages]);

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
   * Change the compare page by a visible page number from the toolbar page field.
   *
   * @param {number} nextVisiblePageNumber
   * @returns {void}
   */
  const setVisibleComparePageNumber = useCallback((nextVisiblePageNumber) => {
    if (totalPages <= 0) return;
    const resolvedOriginalPage = resolveTargetOriginalPageNumber('compare', nextVisiblePageNumber);
    lastRequestedCompareOriginalIndexRef.current = Math.max(0, resolvedOriginalPage - 1);
    setComparePageNumberRaw(resolvedOriginalPage);
    setIsComparing(true);
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
  const compareThumbnailPageNumber = isComparing ? compareOriginalPageNumber : null;

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

  /**
   * Jump to the first page of the previous visible document (or to the current document start when
   * the active pane already points inside the first visible document).
   *
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToPreviousDocument = useCallback((target = 'primary') => {
    const navigationState = target === 'compare' ? compareDocumentNavigation : primaryDocumentNavigation;
    if (!navigationState.enabled || !navigationState.canGoPrevious) return;
    updatePageTarget(target, navigationState.previousDocumentPageNumber);
  }, [compareDocumentNavigation, primaryDocumentNavigation, updatePageTarget]);

  /**
   * Jump to the first page of the next visible document.
   *
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToNextDocument = useCallback((target = 'primary') => {
    const navigationState = target === 'compare' ? compareDocumentNavigation : primaryDocumentNavigation;
    if (!navigationState.enabled || !navigationState.canGoNext) return;
    updatePageTarget(target, navigationState.nextDocumentPageNumber);
  }, [compareDocumentNavigation, primaryDocumentNavigation, updatePageTarget]);

  /**
   * Jump to the first page of the first visible document.
   *
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToFirstDocument = useCallback((target = 'primary') => {
    const navigationState = target === 'compare' ? compareDocumentNavigation : primaryDocumentNavigation;
    if (!navigationState.enabled || !navigationState.canGoFirst) return;
    updatePageTarget(target, navigationState.firstDocumentPageNumber);
  }, [compareDocumentNavigation, primaryDocumentNavigation, updatePageTarget]);

  /**
   * Jump to the first page of the last visible document.
   *
   * @param {ViewerPageTarget=} target
   * @returns {void}
   */
  const goToLastDocument = useCallback((target = 'primary') => {
    const navigationState = target === 'compare' ? compareDocumentNavigation : primaryDocumentNavigation;
    if (!navigationState.enabled || !navigationState.canGoLast) return;
    updatePageTarget(target, navigationState.lastDocumentPageNumber);
  }, [compareDocumentNavigation, primaryDocumentNavigation, updatePageTarget]);

  // --- Print dialog --------------------------------------------------------------
  const openPrintDialog = useCallback(() => {
    if (!printEnabled) return;
    setPrintDialogOpen(true);
  }, [printEnabled]);

  const closePrintDialog = useCallback(() => {
    setPrintDialogOpen(false);
  }, []);

  useEffect(() => {
    if (printEnabled) return;
    setPrintDialogOpen(false);
  }, [printEnabled]);

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

  // --- Compare + editing controls -------------------------------------------------
  /**
   * Setter for the editing controls visibility. The controls may now stay open while compare mode
   * is active because each pane keeps its own transient image-adjustment state.
   *
   * @param {boolean|Function} next
   */
  const setIsExpanded = useCallback((next) => {
    const resolve = (curr) => (typeof next === 'function' ? next(curr) : next);
    setIsExpandedRaw((curr) => !!resolve(curr));
  }, []);

  /** Toggle compare mode. */
  const handleCompare = useCallback(() => {
    setIsComparing((prev) => {
      const next = !prev;
      if (next) {
        const fallbackOriginalPage = compareOriginalPageNumber != null
          ? compareOriginalPageNumber
          : currentOriginalPageNumber;
        setComparePageNumberRaw(fallbackOriginalPage);
      }
      return next;
    });
  }, [compareOriginalPageNumber, currentOriginalPageNumber]);

  /**
   * Close compare mode without affecting the left page.
   * @returns {void}
   */
  const closeCompare = useCallback(() => {
    setIsComparing(false);
  }, []);

  /**
   * Select a page for the right-hand compare pane.
   * If compare is OFF, enables it.
   * If compare is ON, just replaces the right-hand page.
   *
   * @param {number} page
   * @returns {void}
   */
  const selectForCompare = useCallback((page) => {
    setComparePageNumber(page);
    logger.info('Compare selection updated', { comparePage: page });
  }, [setComparePageNumber]);

  // --- Image adjustments ---------------------------------------------------------
  /**
   * @param {'primary'|'compare'} target
   * @returns {function((ImageProperties|function(ImageProperties): ImageProperties)): void}
   */
  const getImagePropertiesSetter = useCallback((target) => (
    target === 'compare' ? setCompareImageProperties : setPrimaryImageProperties
  ), []);

  const handleRotationChange = useCallback((delta, target = 'primary') => {
    const d = Number(delta || 0);
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    getImagePropertiesSetter(updateTarget)((state) => ({
      ...state,
      rotation: normalizeRotationDegrees((Number(state.rotation) || 0) + d),
    }));
  }, [getImagePropertiesSetter]);

  /** @param {{target:{value:*}}} e */
  const handleBrightnessChange = useCallback((e, target = 'primary') => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    getImagePropertiesSetter(updateTarget)((state) => ({ ...state, brightness: v }));
  }, [getImagePropertiesSetter]);

  /** @param {{target:{value:*}}} e */
  const handleContrastChange = useCallback((e, target = 'primary') => {
    const raw = Number(e && e.target ? e.target.value : undefined);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    getImagePropertiesSetter(updateTarget)((state) => ({ ...state, contrast: v }));
  }, [getImagePropertiesSetter]);

  const resetImageProperties = useCallback((target = 'primary') => {
    const updateTarget = target === 'compare' ? 'compare' : 'primary';
    getImagePropertiesSetter(updateTarget)({ ...DEFAULT_IMAGE_PROPERTIES });
  }, [getImagePropertiesSetter]);

  const rotateLeftPage = useCallback((target = 'primary') => {
    handleRotationChange(-90, target);
  }, [handleRotationChange]);

  const rotateRightPage = useCallback((target = 'primary') => {
    handleRotationChange(90, target);
  }, [handleRotationChange]);

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

  const setThumbnailPaneToMinimumWidth = useCallback(() => {
    applyThumbnailWidth(THUMBNAIL_WIDTH_MIN);
  }, [applyThumbnailWidth]);

  const resetThumbnailPaneWidth = useCallback(() => {
    applyThumbnailWidth(THUMBNAIL_WIDTH_DEFAULT);
  }, [applyThumbnailWidth]);

  const setThumbnailPaneToMaximumWidth = useCallback(() => {
    applyThumbnailWidth(THUMBNAIL_WIDTH_MAX);
  }, [applyThumbnailWidth]);

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
    imageRotation: (Number(primaryImageProperties.rotation) || 0) + ((Number(compareImageProperties.rotation) || 0) * 1000),
    isComparing,
    thumbnailWidth,
    pageNumber: currentOriginalPageNumber,
    totalPages,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    goToPreviousDocument,
    goToNextDocument,
    goToFirstDocument,
    goToLastDocument,
    documentNavigationEnabled,
    compareNavigationEnabled: true,
    hideCurrentPageFromSelection,
    hideCurrentDocumentFromSelection,
    zoomIn,
    zoomOut,
    actualSize,
    fitToScreen,
    fitToWidth,
    handleCompare,
    rotateLeft: rotateLeftPage,
    rotateRight: rotateRightPage,
    onOpenPrintDialog: openPrintDialog,
    keyboardPrintShortcutBehavior,
    printEnabled,
  });

  // --- Public API ---------------------------------------------------------------
  return {
    // viewer/render page numbers
    pageNumber: totalPages > 0 ? currentVisiblePageNumber : 0,
    pageNumberDisplay: totalPages > 0 ? currentOriginalPageNumber : 0,
    renderPageNumber: currentOriginalPageNumber,
    setPageNumber: handlePageNumberChange,
    setVisiblePageNumber: handleVisiblePageNumberChange,

    // compare page numbers
    setComparePageNumber,
    setVisibleComparePageNumber,
    comparePageNumber: isComparing && totalPages > 0 ? compareVisiblePageNumber : null,
    renderComparePageNumber: isComparing ? compareOriginalPageNumber : null,

    thumbnailSelectionPageNumber,
    compareThumbnailPageNumber,
    primaryDisplayState,
    zoom,
    setZoom,
    isComparing,
    isPrintDialogOpen,
    openPrintDialog,
    closePrintDialog,
    primaryImageProperties,
    compareImageProperties,
    isExpanded,
    thumbnailWidth,
    thumbnailWidthMin,
    thumbnailWidthMax,
    thumbnailWidthDefault,
    applyThumbnailWidth,
    increaseThumbnailWidth,
    decreaseThumbnailWidth,
    setThumbnailPaneToMinimumWidth,
    resetThumbnailPaneWidth,
    setThumbnailPaneToMaximumWidth,
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
    goToPreviousDocument,
    goToNextDocument,
    goToFirstDocument,
    goToLastDocument,
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
    documentNavigationEnabled,
    primaryDocumentNavigation,
    compareDocumentNavigation,
    selectionPanelEnabled,
    printEnabled,
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
    clearSelectionFilter,
    hidePageFromSelection,
    hideDocumentFromSelection,

    // per-pane post-zoom
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    resetPostZoom,
  };
}
