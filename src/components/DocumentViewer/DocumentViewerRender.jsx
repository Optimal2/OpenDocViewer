// File: src/components/DocumentViewer/DocumentViewerRender.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewerRender.jsx
 *
 * OpenDocViewer — Main Viewer Rendering Wrapper
 *
 * PURPOSE
 *   Render the primary document pane (and optional comparison pane) by delegating
 *   all heavy lifting to <DocumentRender />. This wrapper keeps layout decisions
 *   and prop wiring in one place so the parent viewer stays clean.
 *
 * ACCESSIBILITY
 *   - The actual canvas/img elements are labeled and handled inside <DocumentRender />.
 *   - This wrapper simply provides a flexible container layout.
 *
 * DESIGN NOTES / GOTCHAS
 *   - Base zoom remains global/shared. In compare mode each page also has a free transform
 *     { scale, dx, dy, rotation } (utils/compareTransform.js, docs-src/compare-transform.md),
 *     applied as a CSS transform on the page stage so fine steps never re-rasterise the page.
 *     The per-pane ±0.1 zoom buttons and the 90° buttons are presets on that transform.
 *   - While a pane's fine-tuning bar is expanded, dragging the page and Ctrl+wheel over it change
 *     the transform instead of scrolling or changing the shared zoom.
 *   - Sticky fit modes are still honored after each pane renders.
 *   - Per-pane floating zoom controls are rendered above the pane viewport so the
 *     scrollable document surface never overlaps the controls.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentRender from '../DocumentRender.jsx';
import CompareZoomOverlay from './CompareZoomOverlay.jsx';
import CompareTransformControls from './CompareTransformControls.jsx';
import ViewerContext from '../../contexts/viewerContext.js';
import { IDENTITY_COMPARE_TRANSFORM, buildCompareTransformCss } from '../../utils/compareTransform.js';
import { needsCanvas } from '../../utils/imageAdjustments.js';
import { bundleDocumentHasMetadata } from '../../utils/documentMetadata.js';

/**
 * @typedef {'primary'|'compare'} ViewerPaneKey
 */

/**
 * @typedef {Object} ViewerContextMenuState
 * @property {number} x
 * @property {number} y
 * @property {number} originalIndex
 * @property {number} documentNumber
 * @property {number} totalDocuments
 * @property {(string|undefined)} [documentId]
 * @property {ViewerPaneKey} pane
 */

/**
 * @param {Array<any>} allPages
 * @param {number} originalPageNumber
 * @returns {{ originalIndex:number, documentNumber:number, totalDocuments:number, documentId:(string|undefined) } | null}
 */
function getPageSelectionContext(allPages, originalPageNumber) {
  const safePageNumber = Math.max(1, Math.floor(Number(originalPageNumber) || 0));
  const page = Array.isArray(allPages) ? (allPages[safePageNumber - 1] || null) : null;
  if (!page) return null;

  return {
    originalIndex: safePageNumber - 1,
    documentNumber: Math.max(1, Number(page?.documentNumber) || 1),
    totalDocuments: Math.max(1, Number(page?.totalDocuments) || 1),
    documentId: String(page?.documentId || '').trim() || undefined,
  };
}

const EDGE_SCROLL_DIRECTION_PREVIOUS = 'previous';
const EDGE_SCROLL_DIRECTION_NEXT = 'next';
const PAN_POINTER_MOVE_THRESHOLD_PX = 3;

/**
 * @param {*} target
 * @returns {boolean}
 */
function isPaneInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '.compare-zoom-zone, .odv-pane-selector, button, output, input, textarea, select, [contenteditable="true"], [data-odv-shortcuts="off"], [data-odv-allow-native-contextmenu="true"]'
  );
}

/**
 * @param {(HTMLElement|null)} viewport
 * @returns {boolean}
 */
function isPannableViewport(viewport) {
  if (!(viewport instanceof HTMLElement)) return false;
  return viewport.scrollWidth > viewport.clientWidth + 1
    || viewport.scrollHeight > viewport.clientHeight + 1;
}

/**
 * @param {*} event
 * @param {(HTMLElement|null)} viewport
 * @returns {boolean}
 */
function isPointerOnViewportScrollbar(event, viewport) {
  if (!(viewport instanceof HTMLElement)) return false;
  const rect = viewport.getBoundingClientRect();
  const verticalScrollbarWidth = Math.max(0, viewport.offsetWidth - viewport.clientWidth);
  const horizontalScrollbarHeight = Math.max(0, viewport.offsetHeight - viewport.clientHeight);
  const clientX = Number(event?.clientX) || 0;
  const clientY = Number(event?.clientY) || 0;

  const onVerticalScrollbar = verticalScrollbarWidth > 0
    && clientX >= rect.right - verticalScrollbarWidth
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom - horizontalScrollbarHeight;
  const onHorizontalScrollbar = horizontalScrollbarHeight > 0
    && clientY >= rect.bottom - horizontalScrollbarHeight
    && clientY <= rect.bottom
    && clientX >= rect.left
    && clientX <= rect.right - verticalScrollbarWidth;

  return onVerticalScrollbar || onHorizontalScrollbar;
}

/**
 * @param {WheelEvent|React.WheelEvent} event
 * @param {HTMLElement} viewport
 * @returns {number}
 */
function getWheelDeltaYPx(event, viewport) {
  const raw = Number(event?.deltaY || 0);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (event?.deltaMode === 1) return raw * 48;
  if (event?.deltaMode === 2) return raw * Math.max(1, Number(viewport?.clientHeight) || 1);
  return raw;
}

/**
 * @param {HTMLElement} viewport
 * @returns {boolean}
 */
function isAtScrollTop(viewport) {
  return Number(viewport?.scrollTop || 0) <= 1;
}

/**
 * @param {HTMLElement} viewport
 * @returns {boolean}
 */
function isAtScrollBottom(viewport) {
  const scrollTop = Number(viewport?.scrollTop || 0);
  const clientHeight = Number(viewport?.clientHeight || 0);
  const scrollHeight = Number(viewport?.scrollHeight || 0);
  return scrollTop + clientHeight >= scrollHeight - 1;
}

/**
 * @param {*} event
 * @returns {void}
 */
function preventDefaultIfCancelable(event) {
  if (typeof event?.preventDefault !== 'function') return;
  if (event?.cancelable === false) return;
  event.preventDefault();
}

/**
 * DocumentViewerRender
 * Renders the main document pane and, if enabled, a comparison pane.
 *
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.zoom
 * @param {SetNumberState} props.setZoom
 * @param {boolean} props.isComparing
 * @param {ViewerPaneKey=} props.activePane
 * @param {ViewerPaneKey=} props.effectivePane
 * @param {function(ViewerPaneKey): void=} props.onSetActivePane
 * @param {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} props.primaryImageProperties
 * @param {{ rotation:number, brightness:number, contrast:number, grayscale:number, invert:boolean }} props.compareImageProperties
 * @param {RefLike} props.documentRenderRef
 * @param {(number|null)} props.comparePageNumber
 * @param {number} props.primaryVisiblePageNumber
 * @param {(number|null)} props.compareVisiblePageNumber
 * @param {number} props.totalVisiblePages
 * @param {RefLike} props.compareRef
 * @param {Array} props.allPages
 * @param {'FIT_PAGE'|'FIT_WIDTH'|'FIT_CUSTOM'|'ACTUAL_SIZE'|'CUSTOM'} [props.zoomMode='CUSTOM']
 * @param {{ widthFactorPercent:number, heightFactorPercent:(number|null), actualSizeFactorPercent:(number|null) }=} props.customFitSizeLimits
 * @param {function(): void=} props.onToggleFitZoomMode
 * @param {{ enabled:boolean, thresholdPx:number, quietMs:number, decayMs:number }=} props.edgeScrollPageTurnConfig
 * @param {function(ViewerPaneKey): void=} props.onEdgeScrollPreviousPage
 * @param {function(ViewerPaneKey): void=} props.onEdgeScrollNextPage
 * @param {number} props.postZoomLeft
 * @param {number} props.postZoomRight
 * @param {function(number): void} props.bumpPostZoomLeft
 * @param {function(number): void} props.bumpPostZoomRight
 * @param {Object=} props.compareImageHandlers Image adjustment handlers for the per-page compare
 *   panels (hooks/usePaneImageAdjustments.js).
 * @param {function(Object): void=} props.onPrimaryDisplayStateChange
 * @param {boolean=} props.selectionPanelEnabled
 * @param {function(number): boolean=} props.onHidePageFromSelection
 * @param {function(number): boolean=} props.onHideDocumentFromSelection
 * @param {function(number): boolean=} [props.onOpenDocumentMetadata]
 * @param {function(): void=} props.closeCompare
 * @param {{ primary:boolean, compare:boolean }=} props.transformBarsExpanded Expanded state of the two
 *   per-pane panels when the parent owns it (the main toolbar reads it for compare.adjust.toolbarMode).
 * @param {function(('primary'|'compare'), boolean): void=} props.onTransformBarExpandedChange Setter
 *   paired with `transformBarsExpanded`; without both the renderer keeps the state itself.
 * @returns {React.ReactElement}
 */
const DocumentViewerRender = ({
  pageNumber,
  zoom,
  setZoom,
  isComparing,
  activePane = 'primary',
  effectivePane = 'primary',
  onSetActivePane,
  primaryImageProperties,
  compareImageProperties,
  documentRenderRef,
  comparePageNumber,
  primaryVisiblePageNumber,
  compareVisiblePageNumber,
  totalVisiblePages,
  compareRef,
  allPages,
  zoomMode = 'CUSTOM',
  customFitSizeLimits = null,
  onToggleFitZoomMode,
  edgeScrollPageTurnConfig,
  onEdgeScrollPreviousPage,
  onEdgeScrollNextPage,
  postZoomLeft = 1.0,
  postZoomRight = 1.0,
  bumpPostZoomLeft,
  bumpPostZoomRight,
  primaryTransform = IDENTITY_COMPARE_TRANSFORM,
  compareTransform = IDENTITY_COMPARE_TRANSFORM,
  onCompareTransformAction,
  compareImageHandlers,
  onPrimaryDisplayStateChange,
  selectionPanelEnabled = false,
  onHidePageFromSelection,
  onHideDocumentFromSelection,
  onOpenDocumentMetadata,
  closeCompare,
  transformBarsExpanded: controlledTransformBarsExpanded,
  onTransformBarExpandedChange,
}) => {
  const { t } = useTranslation('common');
  const { bundle } = useContext(ViewerContext);
  const contextMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const primaryPaneRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const comparePaneRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const edgeScrollQuietTimerRef = useRef(0);
  const edgeScrollDecayRafRef = useRef(0);
  const edgeScrollProgressRef = useRef(0);
  const edgeScrollPendingResetRef = useRef(/** @type {Partial<Record<ViewerPaneKey, 'top'|'bottom'>>} */ ({}));
  const handlePaneWheelCaptureRef = useRef(/** @type {(null|function(WheelEvent, ViewerPaneKey): void)} */ (null));
  const panStateRef = useRef(/** @type {(null|{
    pane: ViewerPaneKey,
    pointerId: number,
    viewport: HTMLElement,
    captureElement: HTMLElement,
    startX: number,
    startY: number,
    startScrollLeft: number,
    startScrollTop: number,
    moved: boolean
  })} */ (null));
  const [contextMenuState, setContextMenuState] = useState(
    /** @type {(ViewerContextMenuState|null)} */ (null)
  );
  const [edgeScrollState, setEdgeScrollState] = useState(
    /** @type {{ pane:(ViewerPaneKey|null), direction:('previous'|'next'|null), progress:number }} */ ({
      pane: null,
      direction: null,
      progress: 0,
    })
  );
  const [pannablePanes, setPannablePanes] = useState(
    /** @type {Record<ViewerPaneKey, boolean>} */ ({ primary: false, compare: false })
  );
  const [activePanPane, setActivePanPane] = useState(/** @type {(ViewerPaneKey|null)} */ (null));
  // Expanded fine-tuning bars; an expanded pane turns drag and Ctrl+wheel into transform changes.
  const [ownTransformBarsExpanded, setOwnTransformBarsExpanded] = useState(
    /** @type {Record<ViewerPaneKey, boolean>} */ ({ primary: false, compare: false })
  );
  const isTransformBarStateControlled = !!controlledTransformBarsExpanded
    && typeof onTransformBarExpandedChange === 'function';
  const transformBarsExpanded = isTransformBarStateControlled
    ? controlledTransformBarsExpanded
    : ownTransformBarsExpanded;
  const transformDragRef = useRef(/** @type {(null|{
    pane: ViewerPaneKey,
    pointerId: number,
    stage: HTMLElement,
    captureElement: HTMLElement,
    transform: { scale:number, dx:number, dy:number, rotation:number },
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    moved: boolean,
    captured: boolean
  })} */ (null));
  const transformPropsRef = useRef({ primaryTransform, compareTransform, onCompareTransformAction, isComparing, transformBarsExpanded });
  transformPropsRef.current = { primaryTransform, compareTransform, onCompareTransformAction, isComparing, transformBarsExpanded };

  const isTransformPaneActive = useCallback((pane) => {
    const current = transformPropsRef.current;
    return !!current.isComparing
      && !!current.transformBarsExpanded[pane]
      && typeof current.onCompareTransformAction === 'function';
  }, []);

  const setTransformBarExpanded = useCallback((pane, expanded) => {
    if (isTransformBarStateControlled) {
      onTransformBarExpandedChange(pane, expanded);
      return;
    }
    setOwnTransformBarsExpanded((current) => (current[pane] === expanded ? current : { ...current, [pane]: expanded }));
  }, [isTransformBarStateControlled, onTransformBarExpandedChange]);

  /**
   * Ctrl/Cmd+wheel over a pane whose fine-tuning bar is expanded: ±1 % page scale per notch.
   * @param {WheelEvent} event
   * @param {ViewerPaneKey} pane
   * @returns {boolean} true when the event was consumed.
   */
  const handleTransformWheel = useCallback((event, pane) => {
    if (!(event.ctrlKey || event.metaKey) || !isTransformPaneActive(pane)) return false;
    event.preventDefault();
    event.stopPropagation();
    const deltaY = Number(event.deltaY) || 0;
    if (deltaY !== 0) {
      transformPropsRef.current.onCompareTransformAction({
        type: 'nudge',
        target: pane,
        field: 'scale',
        delta: deltaY < 0 ? 0.01 : -0.01,
      });
    }
    return true;
  }, [isTransformPaneActive]);

  const primaryCanvasEnabled = needsCanvas(primaryImageProperties);
  const compareCanvasEnabled = needsCanvas(compareImageProperties);

  const handlePrimaryRendered = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') {
      documentRenderRef?.current?.fitToScreen?.();
    } else if (zoomMode === 'FIT_WIDTH') {
      documentRenderRef?.current?.fitToWidth?.();
    } else if (zoomMode === 'FIT_CUSTOM') {
      documentRenderRef?.current?.fitToCustomWidth?.();
    }
  }, [documentRenderRef, zoomMode]);

  const handleCompareRendered = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') {
      compareRef?.current?.fitToScreen?.();
    } else if (zoomMode === 'FIT_WIDTH') {
      compareRef?.current?.fitToWidth?.();
    } else if (zoomMode === 'FIT_CUSTOM') {
      compareRef?.current?.fitToCustomWidth?.();
    }
  }, [compareRef, zoomMode]);

  const resetEdgeScrollProgress = useCallback(() => {
    if (edgeScrollQuietTimerRef.current) {
      window.clearTimeout(edgeScrollQuietTimerRef.current);
      edgeScrollQuietTimerRef.current = 0;
    }
    if (edgeScrollDecayRafRef.current) {
      window.cancelAnimationFrame(edgeScrollDecayRafRef.current);
      edgeScrollDecayRafRef.current = 0;
    }
    edgeScrollProgressRef.current = 0;
    setEdgeScrollState({ pane: null, direction: null, progress: 0 });
  }, []);

  const getPaneElement = useCallback((pane) => (
    pane === 'compare' ? comparePaneRef.current : primaryPaneRef.current
  ), []);

  const getPaneViewport = useCallback((pane) => {
    const paneElement = getPaneElement(pane);
    const viewport = paneElement?.querySelector?.('.document-render-viewport');
    return viewport instanceof HTMLElement ? viewport : null;
  }, [getPaneElement]);

  const setPanePannable = useCallback((pane, nextValue) => {
    const next = !!nextValue;
    setPannablePanes((current) => (
      current[pane] === next ? current : { ...current, [pane]: next }
    ));
  }, []);

  const updatePanePannability = useCallback((pane) => {
    const next = isPannableViewport(getPaneViewport(pane));
    setPanePannable(pane, next);
    return next;
  }, [getPaneViewport, setPanePannable]);

  const applyPaneScrollPosition = useCallback((pane, position) => {
    const viewport = getPaneViewport(pane);
    if (!viewport) return;
    viewport.scrollTop = position === 'bottom'
      ? Math.max(0, Number(viewport.scrollHeight || 0))
      : 0;
  }, [getPaneViewport]);

  const schedulePaneScrollPosition = useCallback((pane, position) => {
    edgeScrollPendingResetRef.current[pane] = position;
    const apply = () => applyPaneScrollPosition(pane, position);
    window.requestAnimationFrame(apply);
    window.setTimeout(apply, 80);
    window.setTimeout(apply, 220);
  }, [applyPaneScrollPosition]);

  const startEdgeScrollDecay = useCallback(() => {
    if (edgeScrollDecayRafRef.current) {
      window.cancelAnimationFrame(edgeScrollDecayRafRef.current);
      edgeScrollDecayRafRef.current = 0;
    }

    const startProgress = edgeScrollProgressRef.current;
    if (startProgress <= 0) {
      resetEdgeScrollProgress();
      return;
    }

    const startTime = performance.now();
    const decayMs = Math.max(100, Number(edgeScrollPageTurnConfig?.decayMs) || 650);
    const tick = (now) => {
      const ratio = Math.max(0, 1 - ((now - startTime) / decayMs));
      const nextProgress = startProgress * ratio;
      edgeScrollProgressRef.current = nextProgress;
      setEdgeScrollState((current) => ({
        pane: current.pane,
        direction: current.direction,
        progress: nextProgress,
      }));

      if (nextProgress > 0.01) {
        edgeScrollDecayRafRef.current = window.requestAnimationFrame(tick);
      } else {
        resetEdgeScrollProgress();
      }
    };

    edgeScrollDecayRafRef.current = window.requestAnimationFrame(tick);
  }, [edgeScrollPageTurnConfig?.decayMs, resetEdgeScrollProgress]);

  useEffect(() => () => {
    if (edgeScrollQuietTimerRef.current) window.clearTimeout(edgeScrollQuietTimerRef.current);
    if (edgeScrollDecayRafRef.current) window.cancelAnimationFrame(edgeScrollDecayRafRef.current);
  }, []);

  const canTurnFromPaneEdge = useCallback((pane, direction) => {
    const total = Math.max(0, Number(totalVisiblePages) || 0);
    const page = pane === 'compare'
      ? Math.max(0, Number(compareVisiblePageNumber) || 0)
      : Math.max(0, Number(primaryVisiblePageNumber) || 0);
    if (total <= 0 || page <= 0) return false;
    if (direction === EDGE_SCROLL_DIRECTION_PREVIOUS) return page > 1;
    return page < total;
  }, [compareVisiblePageNumber, primaryVisiblePageNumber, totalVisiblePages]);

  /**
   * @param {*} event
   * @param {ViewerPaneKey} pane
   * @returns {void}
   */
  const handlePaneWheelCapture = useCallback((event, pane) => {
    if (edgeScrollPageTurnConfig?.enabled !== true) return;
    if (event?.ctrlKey || event?.metaKey || event?.altKey) return;
    if (event?.target?.closest?.('.compare-zoom-zone, button, input, textarea, select, [contenteditable="true"]')) return;

    const paneElement = getPaneElement(pane);
    const viewport = getPaneViewport(pane);
    if (!paneElement || !viewport) return;

    const absX = Math.abs(Number(event?.deltaX || 0));
    const deltaY = getWheelDeltaYPx(event, viewport);
    const absY = Math.abs(deltaY);
    if (absY <= 0 || absX > absY) return;

    const direction = deltaY < 0 ? EDGE_SCROLL_DIRECTION_PREVIOUS : EDGE_SCROLL_DIRECTION_NEXT;
    const atRelevantEdge = direction === EDGE_SCROLL_DIRECTION_PREVIOUS
      ? isAtScrollTop(viewport)
      : isAtScrollBottom(viewport);

    if (!atRelevantEdge || !canTurnFromPaneEdge(pane, direction)) {
      if (!atRelevantEdge) resetEdgeScrollProgress();
      return;
    }

    preventDefaultIfCancelable(event);
    event.stopPropagation?.();

    if (edgeScrollQuietTimerRef.current) {
      window.clearTimeout(edgeScrollQuietTimerRef.current);
      edgeScrollQuietTimerRef.current = 0;
    }
    if (edgeScrollDecayRafRef.current) {
      window.cancelAnimationFrame(edgeScrollDecayRafRef.current);
      edgeScrollDecayRafRef.current = 0;
    }

    const thresholdPx = Math.max(120, Number(edgeScrollPageTurnConfig?.thresholdPx) || 720);
    const sameGesture = edgeScrollState.pane === pane && edgeScrollState.direction === direction;
    const baseProgress = sameGesture ? edgeScrollProgressRef.current : 0;
    const nextProgress = Math.min(1, baseProgress + (Math.min(absY, thresholdPx * 0.45) / thresholdPx));
    edgeScrollProgressRef.current = nextProgress;
    setEdgeScrollState({ pane, direction, progress: nextProgress });

    if (nextProgress >= 1) {
      resetEdgeScrollProgress();
      if (direction === EDGE_SCROLL_DIRECTION_PREVIOUS) {
        onEdgeScrollPreviousPage?.(pane);
        schedulePaneScrollPosition(pane, 'bottom');
      } else {
        onEdgeScrollNextPage?.(pane);
        schedulePaneScrollPosition(pane, 'top');
      }
      return;
    }

    edgeScrollQuietTimerRef.current = window.setTimeout(
      startEdgeScrollDecay,
      Math.max(0, Number(edgeScrollPageTurnConfig?.quietMs) || 140)
    );
  }, [
    canTurnFromPaneEdge,
    edgeScrollPageTurnConfig?.enabled,
    edgeScrollPageTurnConfig?.quietMs,
    edgeScrollPageTurnConfig?.thresholdPx,
    edgeScrollState.direction,
    edgeScrollState.pane,
    getPaneElement,
    getPaneViewport,
    onEdgeScrollNextPage,
    onEdgeScrollPreviousPage,
    resetEdgeScrollProgress,
    schedulePaneScrollPosition,
    startEdgeScrollDecay,
  ]);

  useEffect(() => {
    handlePaneWheelCaptureRef.current = handlePaneWheelCapture;
  }, [handlePaneWheelCapture]);

  // Compare panes: expose the page viewport's scrollbar width so the centred page-turn indicator
  // stays clear of the scrollbar (layout.css, .odv-edge-scroll-page-turn).
  useEffect(() => {
    if (!isComparing || typeof ResizeObserver !== 'function') return undefined;
    const frames = [primaryPaneRef.current, comparePaneRef.current].filter((frame) => frame instanceof HTMLElement);
    const update = () => {
      frames.forEach((frame) => {
        const viewport = frame.querySelector('.document-render-viewport');
        const width = viewport ? Math.max(0, viewport.offsetWidth - viewport.clientWidth) : 0;
        frame.style.setProperty('--odv-pane-scrollbar-width', `${width}px`);
      });
    };
    update();
    const observer = new ResizeObserver(update);
    frames.forEach((frame) => {
      const viewport = frame.querySelector('.document-render-viewport');
      if (!viewport) return;
      observer.observe(viewport);
      Array.from(viewport.children).forEach((child) => observer.observe(child));
    });
    return () => observer.disconnect();
  }, [comparePageNumber, isComparing, pageNumber]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const listenerOptions = { capture: true, passive: false };
    const removeOptions = { capture: true };
    const entries = [
      { pane: 'primary', element: primaryPaneRef.current },
      ...(isComparing && comparePageNumber !== null
        ? [{ pane: 'compare', element: comparePaneRef.current }]
        : []),
    ];
    const listeners = entries
      .filter((entry) => entry.element instanceof HTMLElement)
      .map((entry) => {
        const listener = (event) => {
          if (handleTransformWheel(event, entry.pane)) return;
          handlePaneWheelCaptureRef.current?.(event, entry.pane);
        };
        entry.element.addEventListener('wheel', listener, listenerOptions);
        return { element: entry.element, listener };
      });

    return () => {
      for (const { element, listener } of listeners) {
        element.removeEventListener('wheel', listener, removeOptions);
      }
    };
  }, [comparePageNumber, handleTransformWheel, isComparing]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const frameId = window.requestAnimationFrame(() => {
      updatePanePannability('primary');
      if (isComparing) updatePanePannability('compare');
      else setPanePannable('compare', false);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    compareImageProperties?.rotation,
    comparePageNumber,
    isComparing,
    pageNumber,
    postZoomLeft,
    postZoomRight,
    primaryImageProperties?.rotation,
    setPanePannable,
    updatePanePannability,
    zoom,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => {
      updatePanePannability('primary');
      if (isComparing) updatePanePannability('compare');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isComparing, updatePanePannability]);

  const closeContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  const handlePanePointerDown = useCallback((event, pane) => {
    if (event?.button !== 0) return;
    if (event?.pointerType === 'touch') return;
    if (event?.isPrimary === false) return;
    if (isPaneInteractiveTarget(event?.target)) return;

    closeContextMenu();
    if (isComparing) onSetActivePane?.(pane);

    const paneElement = getPaneElement(pane);
    const viewport = getPaneViewport(pane);

    // Fine-tuning: the drag moves the page transform. The stage is updated directly while dragging
    // (no React render per pointer move) and the offset is committed to the viewer context on release.
    if (isTransformPaneActive(pane)) {
      const stage = viewport?.querySelector?.('.document-render-container');
      if (!paneElement || !(stage instanceof HTMLElement)) return;
      if (isPointerOnViewportScrollbar(event, viewport)) return;
      const current = transformPropsRef.current;
      const transform = pane === 'compare' ? current.compareTransform : current.primaryTransform;
      transformDragRef.current = {
        pane,
        pointerId: Number(event.pointerId),
        stage,
        captureElement: paneElement,
        transform,
        startX: Number(event.clientX) || 0,
        startY: Number(event.clientY) || 0,
        dx: transform.dx,
        dy: transform.dy,
        moved: false,
        captured: false,
      };
      return;
    }

    const canPan = isPannableViewport(viewport);
    setPanePannable(pane, canPan);
    if (!paneElement || !viewport || !canPan) return;
    if (isPointerOnViewportScrollbar(event, viewport)) return;

    panStateRef.current = {
      pane,
      pointerId: Number(event.pointerId),
      viewport,
      captureElement: paneElement,
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      startScrollLeft: Number(viewport.scrollLeft) || 0,
      startScrollTop: Number(viewport.scrollTop) || 0,
      moved: false,
      captured: false,
    };
  }, [closeContextMenu, getPaneElement, getPaneViewport, isComparing, isTransformPaneActive, onSetActivePane, setPanePannable]);

  const handlePanePointerMove = useCallback((event, pane) => {
    const drag = transformDragRef.current;
    if (drag && drag.pane === pane && drag.pointerId === Number(event?.pointerId)) {
      const moveX = (Number(event.clientX) || 0) - drag.startX;
      const moveY = (Number(event.clientY) || 0) - drag.startY;
      if (!drag.moved && Math.hypot(moveX, moveY) < PAN_POINTER_MOVE_THRESHOLD_PX) return;
      drag.moved = true;
      if (!drag.captured) {
        drag.captured = true;
        setActivePanPane(pane);
        try { drag.captureElement?.setPointerCapture?.(drag.pointerId); } catch {}
      }
      // dx/dy are CSS px at transform scale 1, so a screen move of N px is N / scale.
      const scale = drag.transform.scale || 1;
      drag.dx = drag.transform.dx + moveX / scale;
      drag.dy = drag.transform.dy + moveY / scale;
      drag.stage.style.transform = buildCompareTransformCss({ ...drag.transform, dx: drag.dx, dy: drag.dy }) || 'none';
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }

    const state = panStateRef.current;
    if (!state || state.pane !== pane || state.pointerId !== Number(event?.pointerId)) return;

    const dx = (Number(event.clientX) || 0) - state.startX;
    const dy = (Number(event.clientY) || 0) - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < PAN_POINTER_MOVE_THRESHOLD_PX) return;

    state.moved = true;
    if (!state.captured) {
      state.captured = true;
      setActivePanPane(pane);
      try { state.captureElement?.setPointerCapture?.(state.pointerId); } catch {}
    }
    state.viewport.scrollLeft = state.startScrollLeft - dx;
    state.viewport.scrollTop = state.startScrollTop - dy;
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }, []);

  const finishPanePan = useCallback((event, pane) => {
    const drag = transformDragRef.current;
    if (drag && drag.pane === pane && drag.pointerId === Number(event?.pointerId)) {
      transformDragRef.current = null;
      setActivePanPane(null);
      try {
        if (drag.captureElement?.hasPointerCapture?.(drag.pointerId)) {
          drag.captureElement.releasePointerCapture(drag.pointerId);
        }
      } catch {}
      if (drag.moved) {
        transformPropsRef.current.onCompareTransformAction?.({
          type: 'set',
          target: pane,
          transform: { dx: drag.dx, dy: drag.dy },
        });
        event?.preventDefault?.();
        event?.stopPropagation?.();
      }
      return;
    }

    const state = panStateRef.current;
    if (!state || state.pane !== pane || state.pointerId !== Number(event?.pointerId)) return;

    panStateRef.current = null;
    setActivePanPane(null);
    updatePanePannability(pane);

    try {
      if (state.captureElement?.hasPointerCapture?.(state.pointerId)) {
        state.captureElement.releasePointerCapture(state.pointerId);
      }
    } catch {}

    if (state.moved) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }
  }, [updatePanePannability]);

  // A native drag-and-drop started under the pointer (e.g. the loading indicator image) makes Chromium send
  // pointercancel, which would end a pan or fine-tuning drag after its first step.
  const handlePaneDragStart = useCallback((event) => {
    if (transformDragRef.current || panStateRef.current) event.preventDefault();
  }, []);

  useEffect(() => {
    const pending = edgeScrollPendingResetRef.current.primary;
    if (!pending) return undefined;
    edgeScrollPendingResetRef.current.primary = undefined;
    const timeoutId = window.setTimeout(() => applyPaneScrollPosition('primary', pending), 0);
    return () => window.clearTimeout(timeoutId);
  }, [applyPaneScrollPosition, pageNumber]);

  useEffect(() => {
    const pending = edgeScrollPendingResetRef.current.compare;
    if (!pending) return undefined;
    edgeScrollPendingResetRef.current.compare = undefined;
    const timeoutId = window.setTimeout(() => applyPaneScrollPosition('compare', pending), 0);
    return () => window.clearTimeout(timeoutId);
  }, [applyPaneScrollPosition, comparePageNumber]);

  useEffect(() => {
    closeContextMenu();
  }, [closeContextMenu, comparePageNumber, pageNumber]);

  useEffect(() => {
    if (!contextMenuState) return undefined;

    /** @param {*} event */
    const handlePointerDown = (event) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(event?.target)) return;
      closeContextMenu();
    };

    /** @param {KeyboardEvent} event */
    const handleKeyDown = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      closeContextMenu();
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('touchstart', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', closeContextMenu, true);
    window.addEventListener('scroll', closeContextMenu, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('touchstart', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', closeContextMenu, true);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, [closeContextMenu, contextMenuState]);

  /**
   * @param {*} event
   * @param {(number|null|undefined)} originalPageNumber
   * @param {ViewerPaneKey} pane
   * @returns {void}
   */
  const handlePaneContextMenu = useCallback((event, originalPageNumber, pane) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const hasSelectionActions = !!selectionPanelEnabled
      && (typeof onHidePageFromSelection === 'function' || typeof onHideDocumentFromSelection === 'function');
    const hasCompareCloseAction = pane === 'compare' && isComparing && typeof closeCompare === 'function';
    const hasMetadataAction = typeof onOpenDocumentMetadata === 'function'
      && bundleDocumentHasMetadata(bundle, Array.isArray(allPages) ? allPages[Math.max(0, (Number(originalPageNumber) || 1) - 1)]?.documentId : undefined);

    if (!hasSelectionActions && !hasCompareCloseAction && !hasMetadataAction) {
      closeContextMenu();
      return;
    }

    const selectionContext = getPageSelectionContext(allPages, Number(originalPageNumber) || 0);
    if (!selectionContext) {
      closeContextMenu();
      return;
    }

    setContextMenuState({
      x: Math.max(8, Number(event?.clientX) || 0),
      y: Math.max(8, Number(event?.clientY) || 0),
      pane,
      ...selectionContext,
    });
  }, [allPages, bundle, closeCompare, closeContextMenu, isComparing, onHideDocumentFromSelection, onHidePageFromSelection, onOpenDocumentMetadata, selectionPanelEnabled]);

  const handleHidePageFromContextMenu = useCallback(() => {
    if (!contextMenuState || typeof onHidePageFromSelection !== 'function') return;
    onHidePageFromSelection(contextMenuState.originalIndex);
    closeContextMenu();
  }, [closeContextMenu, contextMenuState, onHidePageFromSelection]);

  const handleHideDocumentFromContextMenu = useCallback(() => {
    if (!contextMenuState || typeof onHideDocumentFromSelection !== 'function') return;
    onHideDocumentFromSelection(contextMenuState.originalIndex);
    closeContextMenu();
  }, [closeContextMenu, contextMenuState, onHideDocumentFromSelection]);

  const handleOpenMetadataFromContextMenu = useCallback(() => {
    if (!contextMenuState || typeof onOpenDocumentMetadata !== 'function') return;
    const opened = onOpenDocumentMetadata(contextMenuState.originalIndex);
    if (opened !== false) closeContextMenu();
  }, [closeContextMenu, contextMenuState, onOpenDocumentMetadata]);

  const handleCloseCompareFromContextMenu = useCallback(() => {
    if (!contextMenuState || contextMenuState.pane !== 'compare' || typeof closeCompare !== 'function') return;
    closeCompare();
    closeContextMenu();
  }, [closeCompare, closeContextMenu, contextMenuState]);

  // The per-page compare transform (scale, offset, fine rotation) is a CSS transform on the page
  // stage; both panes keep laying out at the shared base zoom.
  const primarySurfaceTransform = isComparing ? buildCompareTransformCss(primaryTransform) : '';
  const compareSurfaceTransform = isComparing ? buildCompareTransformCss(compareTransform) : '';
  const primaryTransformActive = isComparing && transformBarsExpanded.primary && typeof onCompareTransformAction === 'function';
  const compareTransformActive = isComparing && transformBarsExpanded.compare && typeof onCompareTransformAction === 'function';
  const normalizedActivePane = isComparing && activePane === 'compare' ? 'compare' : 'primary';
  const normalizedEffectivePane = isComparing && effectivePane === 'compare' ? 'compare' : 'primary';
  const canHidePageFromSelection = !!selectionPanelEnabled && typeof onHidePageFromSelection === 'function';
  const canHideDocumentFromSelection = !!selectionPanelEnabled && typeof onHideDocumentFromSelection === 'function';
  const canOpenMetadataFromContextMenu = !!contextMenuState
    && typeof onOpenDocumentMetadata === 'function'
    && bundleDocumentHasMetadata(bundle, contextMenuState.documentId);
  const canCloseCompareFromContextMenu = !!contextMenuState && contextMenuState.pane === 'compare' && isComparing && typeof closeCompare === 'function';
  const contextMenuLeft = contextMenuState
    ? Math.max(8, Math.min(contextMenuState.x, Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : contextMenuState.x + 240) - 248)))
    : 0;
  const contextMenuTop = contextMenuState
    ? Math.max(8, Math.min(contextMenuState.y, Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : contextMenuState.y + 256) - 256)))
    : 0;

  /**
   * @param {ViewerPaneKey} pane
   * @returns {(React.ReactElement|null)}
   */
  const renderEdgeScrollIndicator = (pane) => {
    if (edgeScrollPageTurnConfig?.enabled !== true) return null;
    if (edgeScrollState.pane !== pane || !edgeScrollState.direction || edgeScrollState.progress <= 0) return null;
    const progress = Math.max(0, Math.min(1, Number(edgeScrollState.progress) || 0));
    return (
      <div
        className={`odv-edge-scroll-page-turn ${edgeScrollState.direction === EDGE_SCROLL_DIRECTION_PREVIOUS ? 'is-previous' : 'is-next'}`}
        aria-hidden="true"
      >
        <div
          className="odv-edge-scroll-page-turn-track"
          style={{ '--odv-edge-scroll-progress': progress }}
        >
          <div className="odv-edge-scroll-page-turn-fill" />
        </div>
      </div>
    );
  };

  /**
   * @param {ViewerPaneKey} pane
   * @returns {React.ReactElement}
   */
  const renderPaneSelector = (pane) => {
    const isComparePane = pane === 'compare';
    const isActivePane = normalizedActivePane === pane;
    const isEffectivePane = normalizedEffectivePane === pane;
    const label = isComparePane
      ? t('viewer.paneSelector.compare', { defaultValue: 'Use right compare pane' })
      : t('viewer.paneSelector.primary', { defaultValue: 'Use primary / left pane' });
    const activeLabel = isComparePane
      ? t('viewer.paneSelector.compareActive', { defaultValue: 'Right compare pane is the default target' })
      : t('viewer.paneSelector.primaryActive', { defaultValue: 'Primary / left pane is the default target' });
    const temporaryLabel = isEffectivePane && !isActivePane
      ? t('viewer.paneSelector.temporaryTarget', { defaultValue: 'Shift is temporarily targeting this pane' })
      : '';
    const title = [isActivePane ? activeLabel : label, temporaryLabel].filter(Boolean).join(' - ');

    return (
      <button
        type="button"
        className={[
          'odv-pane-selector',
          isComparePane ? 'is-compare' : 'is-primary',
          isActivePane ? 'is-active' : '',
          isEffectivePane ? 'is-effective' : '',
        ].filter(Boolean).join(' ')}
        aria-label={title}
        aria-pressed={isActivePane}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSetActivePane?.(pane);
        }}
      >
        <span className="material-icons" aria-hidden="true">
          {isActivePane ? 'radio_button_checked' : 'radio_button_unchecked'}
        </span>
      </button>
    );
  };

  return (
    <>
      <div className="viewer-section" style={{ display: 'flex', padding: '15px' }}>
        {/* LEFT / PRIMARY PANE */}
        <div
          className={isComparing ? 'document-render-container-comparison' : 'document-render-container-single'}
          style={{ position: 'relative' }}
        >
          {isComparing && typeof onCompareTransformAction === 'function' && (
            <CompareTransformControls
              pane="primary"
              transform={primaryTransform}
              imageProperties={primaryImageProperties}
              imageHandlers={compareImageHandlers}
              expanded={transformBarsExpanded.primary}
              onExpandedChange={(expanded) => setTransformBarExpanded('primary', expanded)}
              onAction={onCompareTransformAction}
            />
          )}
          <div
            ref={primaryPaneRef}
            className={[
              'document-pane-frame',
              isComparing ? 'is-primary-pane' : 'is-single-pane',
              pannablePanes.primary ? 'is-pannable' : '',
              primaryTransformActive ? 'is-transform-active' : '',
              activePanPane === 'primary' ? 'is-panning' : '',
            ].filter(Boolean).join(' ')}
            data-odv-transform-wheel={primaryTransformActive ? 'on' : undefined}
            onContextMenu={(event) => handlePaneContextMenu(event, pageNumber, 'primary')}
            onPointerEnter={() => updatePanePannability('primary')}
            onPointerDownCapture={(event) => handlePanePointerDown(event, 'primary')}
            onDragStart={handlePaneDragStart}
            onPointerMoveCapture={(event) => handlePanePointerMove(event, 'primary')}
            onPointerUpCapture={(event) => finishPanePan(event, 'primary')}
            onPointerCancelCapture={(event) => finishPanePan(event, 'primary')}
            onLostPointerCapture={(event) => finishPanePan(event, 'primary')}
          >
            {isComparing && (
              <CompareZoomOverlay
                pane="primary"
                marker={renderPaneSelector('primary')}
                value={postZoomLeft}
                onInc={() => bumpPostZoomLeft?.(1)}
                onDec={() => bumpPostZoomLeft?.(-1)}
              />
            )}
            {renderEdgeScrollIndicator('primary')}

            <DocumentRender
              ref={documentRenderRef}
              pageNumber={pageNumber}
              zoom={zoom}
              surfaceTransform={primarySurfaceTransform}
              initialRenderDone={() => {}}
              onRender={handlePrimaryRendered}
              setZoom={setZoom}
              imageProperties={primaryImageProperties}
              isCanvasEnabled={primaryCanvasEnabled}
              allPages={allPages}
              zoomMode={zoomMode}
              customFitSizeLimits={customFitSizeLimits}
              onToggleFitZoomMode={onToggleFitZoomMode}
              onDisplayStateChange={onPrimaryDisplayStateChange}
            />
          </div>
        </div>

        {/* RIGHT / COMPARE PANE */}
        {isComparing && comparePageNumber !== null && (
          <div className="document-render-container-comparison" style={{ position: 'relative' }}>
            {typeof onCompareTransformAction === 'function' && (
              <CompareTransformControls
                pane="compare"
                transform={compareTransform}
                imageProperties={compareImageProperties}
                imageHandlers={compareImageHandlers}
                expanded={transformBarsExpanded.compare}
                onExpandedChange={(expanded) => setTransformBarExpanded('compare', expanded)}
                onAction={onCompareTransformAction}
              />
            )}
            <div
              ref={comparePaneRef}
              className={[
                'document-pane-frame',
                'is-compare-pane',
                pannablePanes.compare ? 'is-pannable' : '',
                compareTransformActive ? 'is-transform-active' : '',
                activePanPane === 'compare' ? 'is-panning' : '',
              ].filter(Boolean).join(' ')}
              data-odv-transform-wheel={compareTransformActive ? 'on' : undefined}
              onContextMenu={(event) => handlePaneContextMenu(event, comparePageNumber, 'compare')}
              onPointerEnter={() => updatePanePannability('compare')}
              onPointerDownCapture={(event) => handlePanePointerDown(event, 'compare')}
              onDragStart={handlePaneDragStart}
              onPointerMoveCapture={(event) => handlePanePointerMove(event, 'compare')}
              onPointerUpCapture={(event) => finishPanePan(event, 'compare')}
              onPointerCancelCapture={(event) => finishPanePan(event, 'compare')}
              onLostPointerCapture={(event) => finishPanePan(event, 'compare')}
            >
              <CompareZoomOverlay
                pane="compare"
                marker={renderPaneSelector('compare')}
                value={postZoomRight}
                onInc={() => bumpPostZoomRight?.(1)}
                onDec={() => bumpPostZoomRight?.(-1)}
              />
              {renderEdgeScrollIndicator('compare')}

              <DocumentRender
                ref={compareRef}
                pageNumber={comparePageNumber}
                zoom={zoom}
                surfaceTransform={compareSurfaceTransform}
                initialRenderDone={() => {}}
                onRender={handleCompareRendered}
                setZoom={setZoom}
                imageProperties={compareImageProperties}
                isCanvasEnabled={compareCanvasEnabled}
                allPages={allPages}
                zoomMode={zoomMode}
                customFitSizeLimits={customFitSizeLimits}
                onToggleFitZoomMode={onToggleFitZoomMode}
              />
            </div>
          </div>
        )}
      </div>

      {contextMenuState ? (
        <div
          ref={contextMenuRef}
          className="odv-context-menu"
          role="menu"
          style={{ left: `${contextMenuLeft}px`, top: `${contextMenuTop}px` }}
        >
          {canOpenMetadataFromContextMenu ? (
            <button
              type="button"
              className="odv-context-menu-item"
              role="menuitem"
              onClick={handleOpenMetadataFromContextMenu}
              title={t('thumbnails.contextMenu.showDocumentMetadata', {
                defaultValue: 'Show metadata for this document',
              })}
            >
              <span className="material-icons" aria-hidden="true">table_view</span>
              <span>
                {t('thumbnails.contextMenu.showDocumentMetadataLabel', {
                  defaultValue: 'Show document metadata',
                })}
              </span>
            </button>
          ) : null}
          {canHidePageFromSelection ? (
            <button
              type="button"
              className="odv-context-menu-item"
              role="menuitem"
              onClick={handleHidePageFromContextMenu}
              title={t('thumbnails.contextMenu.hidePageFromSelection', {
                defaultValue: 'Hide this page from the current selection',
              })}
            >
              <span className="material-icons" aria-hidden="true">remove_circle_outline</span>
              <span>
                {t('thumbnails.contextMenu.hidePageFromSelectionLabel', {
                  defaultValue: 'Hide this page',
                })}
              </span>
            </button>
          ) : null}
          {canHideDocumentFromSelection ? (
            <button
              type="button"
              className="odv-context-menu-item"
              role="menuitem"
              onClick={handleHideDocumentFromContextMenu}
              title={t('thumbnails.contextMenu.hideDocumentFromSelection', {
                document: contextMenuState.documentNumber || 1,
                total: contextMenuState.totalDocuments || 1,
                defaultValue: `Hide document ${contextMenuState.documentNumber || 1}/${contextMenuState.totalDocuments || 1} from the current selection`,
              })}
            >
              <span className="material-icons" aria-hidden="true">folder_off</span>
              <span>
                {`${t('thumbnails.contextMenu.hideDocumentFromSelectionLabelPrefix', {
                  defaultValue: 'Hide document',
                })} ${contextMenuState.documentNumber || 1}/${contextMenuState.totalDocuments || 1}`}
              </span>
            </button>
          ) : null}
          {canCloseCompareFromContextMenu ? (
            <button
              type="button"
              className="odv-context-menu-item"
              role="menuitem"
              onClick={handleCloseCompareFromContextMenu}
              title={t('thumbnails.contextMenu.closeCompare', {
                defaultValue: 'Close compare view',
              })}
            >
              <span className="material-icons" aria-hidden="true">close_fullscreen</span>
              <span>
                {t('thumbnails.contextMenu.closeCompareLabel', {
                  defaultValue: 'Close comparison',
                })}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
};

DocumentViewerRender.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  setZoom: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  activePane: PropTypes.oneOf(['primary', 'compare']),
  effectivePane: PropTypes.oneOf(['primary', 'compare']),
  onSetActivePane: PropTypes.func,
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
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  primaryVisiblePageNumber: PropTypes.number.isRequired,
  compareVisiblePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  totalVisiblePages: PropTypes.number.isRequired,
  compareRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  allPages: PropTypes.array.isRequired,
  zoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'FIT_CUSTOM', 'ACTUAL_SIZE', 'CUSTOM']),
  customFitSizeLimits: PropTypes.shape({
    widthFactorPercent: PropTypes.number,
    heightFactorPercent: PropTypes.number,
    actualSizeFactorPercent: PropTypes.number,
  }),
  onToggleFitZoomMode: PropTypes.func,
  edgeScrollPageTurnConfig: PropTypes.shape({
    enabled: PropTypes.bool.isRequired,
    thresholdPx: PropTypes.number.isRequired,
    quietMs: PropTypes.number.isRequired,
    decayMs: PropTypes.number.isRequired,
  }),
  onEdgeScrollPreviousPage: PropTypes.func,
  onEdgeScrollNextPage: PropTypes.func,
  postZoomLeft: PropTypes.number.isRequired,
  postZoomRight: PropTypes.number.isRequired,
  bumpPostZoomLeft: PropTypes.func.isRequired,
  bumpPostZoomRight: PropTypes.func.isRequired,
  primaryTransform: PropTypes.shape({
    scale: PropTypes.number.isRequired,
    dx: PropTypes.number.isRequired,
    dy: PropTypes.number.isRequired,
    rotation: PropTypes.number.isRequired,
  }),
  compareTransform: PropTypes.shape({
    scale: PropTypes.number.isRequired,
    dx: PropTypes.number.isRequired,
    dy: PropTypes.number.isRequired,
    rotation: PropTypes.number.isRequired,
  }),
  onCompareTransformAction: PropTypes.func,
  compareImageHandlers: PropTypes.object,
  onPrimaryDisplayStateChange: PropTypes.func,
  selectionPanelEnabled: PropTypes.bool,
  onHidePageFromSelection: PropTypes.func,
  onHideDocumentFromSelection: PropTypes.func,
  onOpenDocumentMetadata: PropTypes.func,
  closeCompare: PropTypes.func,
  transformBarsExpanded: PropTypes.shape({
    primary: PropTypes.bool,
    compare: PropTypes.bool,
  }),
  onTransformBarExpandedChange: PropTypes.func,
};

export default React.memo(DocumentViewerRender);
