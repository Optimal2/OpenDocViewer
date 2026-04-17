// File: src/components/DocumentThumbnailList.jsx
/**
 * OpenDocViewer — Deterministic thumbnail strip.
 *
 * The thumbnail pane always exposes a stable scrollbar whose total height depends only on the number
 * of pages. Asset generation may still be on demand, but the DOM height never changes while the user
 * scrolls.
 *
 * In wide panes the visible/current/compare thumbnails may temporarily upgrade to full page assets
 * when the active runtime policy allows it. That keeps the pane crisp without forcing the entire
 * document into full-resolution thumbnail mode.
 */

import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ViewerContext from '../contexts/viewerContext.js';
import logger from '../logging/systemLogger.js';
import LoadingSpinner from './LoadingSpinner.jsx';
import {
  getDocumentLoadingConfig,
  shouldUseFullImagesForThumbnails,
} from '../utils/documentLoadingConfig.js';

/**
 * @typedef {Object} ThumbnailRowProps
 * @property {*} page
 * @property {number} index
 * @property {number} rowHeight
 * @property {number} imageStageHeight
 * @property {boolean} isPrimarySelected
 * @property {boolean} isCompareSelected
 * @property {boolean} isCompareMode
 * @property {boolean} preferFullAssetPreview
 * @property {number} totalPages
 * @property {number} containerWidth
 * @property {boolean} documentGroupingActive
 * @property {function(number, *): void} onActivate
 * @property {function(*, number): void} onKeyActivate
 * @property {function(number, ('full'|'thumbnail')): void} onImageLoad
 * @property {boolean} fullyRenderOffscreenRows
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {*} renderConfig
 * @param {number} totalCount
 * @returns {boolean}
 */
function shouldWarmAllThumbnails(renderConfig, totalCount) {
  const strategy = String(renderConfig?.thumbnailLoadingStrategy || 'adaptive').toLowerCase();
  const threshold = Math.max(1, Number(renderConfig?.thumbnailEagerPageThreshold) || 1);
  if (strategy === 'eager') return true;
  if (strategy === 'viewport') return false;
  return totalCount > 0 && totalCount <= threshold;
}

/**
 * @param {*} renderConfig
 * @param {number} paneWidth
 * @param {boolean} documentGroupingActive
 * @returns {{ rowHeight:number, imageStageHeight:number }}
 */
function getThumbnailLayout(renderConfig, paneWidth, documentGroupingActive) {
  const configuredMaxWidth = Math.max(80, Number(renderConfig?.thumbnailMaxWidth) || 220);
  const configuredMaxHeight = Math.max(96, Number(renderConfig?.thumbnailMaxHeight) || 310);
  const safePaneWidth = Math.max(160, Number(paneWidth) || 0);
  const stageWidth = Math.max(88, safePaneWidth - 28);
  const usableWidth = Math.min(stageWidth, Math.max(configuredMaxWidth, Math.round(stageWidth * 0.96)));
  const imageAspectRatio = configuredMaxHeight / Math.max(1, configuredMaxWidth);
  const imageStageHeight = Math.max(120, Math.round(usableWidth * imageAspectRatio));
  const rowHeight = imageStageHeight + (documentGroupingActive ? 80 : 56);

  return {
    rowHeight,
    imageStageHeight,
  };
}

/**
 * @param {number} index
 * @param {{ start:number, end:number }} range
 * @returns {boolean}
 */
function isIndexInRange(index, range) {
  return index >= Number(range?.start) && index <= Number(range?.end);
}

/**
 * Build a center-out thumbnail warm-up order so the pane feels responsive around the user's
 * current scroll target instead of always starting from page 1.
 *
 * @param {number} totalCount
 * @param {number} focusIndex
 * @param {Set<number>} excluded
 * @returns {Array<number>}
 */
function buildCenterOutQueue(totalCount, focusIndex, excluded) {
  const queue = [];
  const safeTotal = Math.max(0, Number(totalCount) || 0);
  if (!safeTotal) return queue;

  const center = clamp(focusIndex, 0, Math.max(0, safeTotal - 1));
  for (let offset = 0; offset < safeTotal; offset += 1) {
    const left = center - offset;
    const right = center + offset;

    if (left >= 0 && !excluded.has(left)) queue.push(left);
    if (offset > 0 && right < safeTotal && !excluded.has(right)) queue.push(right);
  }

  return queue;
}

/**
 * @param {*} page
 * @returns {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number, documentPageNumber:number, documentPageCount:number, isDocumentStart:boolean, isDocumentEnd:boolean }}
 */
function getPageDocumentContext(page) {
  const documentNumber = Math.max(0, Number(page?.documentNumber) || 0);
  const totalDocuments = Math.max(0, Number(page?.totalDocuments) || 0);
  const documentPageNumber = Math.max(0, Number(page?.documentPageNumber) || 0);
  const documentPageCount = Math.max(0, Number(page?.documentPageCount) || 0);
  const hasMultipleDocuments = totalDocuments > 1 && documentNumber > 0 && documentPageNumber > 0;

  return {
    hasMultipleDocuments,
    documentNumber,
    totalDocuments,
    documentPageNumber,
    documentPageCount,
    isDocumentStart: hasMultipleDocuments && (!!page?.isDocumentStart || documentPageNumber === 1),
    isDocumentEnd: hasMultipleDocuments && (
      !!page?.isDocumentEnd
      || (documentPageCount > 0 && documentPageNumber === documentPageCount)
    ),
  };
}

/**
 * @param {Function} t
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number, documentPageNumber:number, documentPageCount:number }} documentContext
 * @returns {{ totalPageTitle:string, documentTitle:string, documentPageTitle:string, combinedTitle:string }}
 */
function getMetricTitles(t, pageNumber, totalPages, documentContext) {
  const totalPageTitle = t('thumbnails.metrics.totalPageTitle', {
    page: pageNumber,
    total: totalPages,
    defaultValue: `Page ${pageNumber} of ${totalPages}`,
  });

  if (!documentContext.hasMultipleDocuments) {
    return {
      totalPageTitle,
      documentTitle: '',
      documentPageTitle: '',
      combinedTitle: totalPageTitle,
    };
  }

  const documentTitle = t('thumbnails.metrics.documentTitle', {
    document: documentContext.documentNumber,
    total: documentContext.totalDocuments,
    defaultValue: `Document ${documentContext.documentNumber} of ${documentContext.totalDocuments}`,
  });
  const documentPageTitle = documentContext.documentPageCount > 0
    ? t('thumbnails.metrics.documentPageTitle', {
        page: documentContext.documentPageNumber,
        total: documentContext.documentPageCount,
        document: documentContext.documentNumber,
        defaultValue: `Page ${documentContext.documentPageNumber} of ${documentContext.documentPageCount} in document ${documentContext.documentNumber}`,
      })
    : t('thumbnails.metrics.documentPageTitleNoTotal', {
        page: documentContext.documentPageNumber,
        document: documentContext.documentNumber,
        defaultValue: `Page ${documentContext.documentPageNumber} in document ${documentContext.documentNumber}`,
      });

  return {
    totalPageTitle,
    documentTitle,
    documentPageTitle,
    combinedTitle: [totalPageTitle, documentTitle, documentPageTitle].filter(Boolean).join(' • '),
  };
}

/**
 * @param {ThumbnailRowProps} props
 * @returns {React.ReactElement}
 */
const ThumbnailRow = React.memo(function ThumbnailRow({
  page,
  index,
  rowHeight,
  imageStageHeight,
  isPrimarySelected,
  isCompareSelected,
  isCompareMode,
  preferFullAssetPreview,
  totalPages,
  containerWidth,
  documentGroupingActive,
  onActivate,
  onKeyActivate,
  onImageLoad,
  fullyRenderOffscreenRows,
}) {
  const { t } = useTranslation('common');
  const pageNumber = index + 1;
  const forceVisibleFullAsset = !!preferFullAssetPreview
    && page?.fullSizeStatus === 1
    && typeof page?.fullSizeUrl === 'string'
    && !!page.fullSizeUrl;
  const usesFullAsset = forceVisibleFullAsset || !!page?.thumbnailUsesFullAsset;
  const thumbnailStatus = page?.status === -1
    ? -1
    : usesFullAsset
      ? (page?.fullSizeStatus === -1 ? -1 : (page?.fullSizeStatus === 1 && page?.fullSizeUrl ? 1 : 0))
      : (typeof page?.thumbnailStatus === 'number' ? page.thumbnailStatus : 0);
  const thumbnailUrl = usesFullAsset
    ? (typeof page?.fullSizeUrl === 'string' ? page.fullSizeUrl : '')
    : (typeof page?.thumbnailUrl === 'string' ? page.thumbnailUrl : '');
  const isDualSelected = isPrimarySelected && isCompareSelected;
  const hasSelectionBadges = isCompareMode && (isPrimarySelected || isCompareSelected);
  const documentContext = getPageDocumentContext(page);
  const metricTitles = getMetricTitles(t, pageNumber, totalPages, documentContext);
  const showExtendedMetrics = documentContext.hasMultipleDocuments
    && containerWidth >= (hasSelectionBadges ? 280 : 208);

  const rowShellClassName = [
    'thumbnail-row-shell',
    documentGroupingActive ? 'document-aware' : '',
    documentContext.isDocumentStart ? 'has-document-start' : '',
    documentContext.isDocumentEnd ? 'has-document-end' : '',
  ].filter(Boolean).join(' ');

  const wrapperClassName = [
    'thumbnail-wrapper',
    isPrimarySelected ? 'selected-primary' : '',
    isCompareSelected ? 'selected-compare' : '',
    isDualSelected ? 'selected-dual' : '',
  ].filter(Boolean).join(' ');

  const navigationTitle = isDualSelected
    ? t('thumbnails.goToPageBothPanes', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (shown in both panes)` })
    : isCompareSelected
      ? t('thumbnails.goToPageRightPane', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (right pane)` })
      : isPrimarySelected
        ? t('thumbnails.goToPageLeftPane', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (left pane)` })
        : t('thumbnails.goToPage', { page: pageNumber });

  const rowTitle = documentContext.hasMultipleDocuments
    ? `${navigationTitle} — ${metricTitles.combinedTitle}`
    : navigationTitle;

  return (
    <div
      className={rowShellClassName}
      style={{
        height: `${rowHeight}px`,
        ...(fullyRenderOffscreenRows
          ? {}
          : {
              contentVisibility: 'auto',
              containIntrinsicSize: `${rowHeight}px`,
            }),
      }}
    >
      {documentGroupingActive && documentContext.isDocumentStart ? (
        <div className="thumbnail-document-boundary start" aria-hidden="true">
          <span className="thumbnail-document-boundary-line" />
          <span className="thumbnail-document-boundary-label">
            {t('thumbnails.documentBoundaryStartShort', {
              document: documentContext.documentNumber,
              total: documentContext.totalDocuments,
              defaultValue: `Doc ${documentContext.documentNumber}/${documentContext.totalDocuments}`,
            })}
          </span>
          <span className="thumbnail-document-boundary-line" />
        </div>
      ) : null}

      <div
        id={`thumbnail-${pageNumber}`}
        className={wrapperClassName}
        onClick={(event) => onActivate(pageNumber, event)}
        onKeyDown={(event) => onKeyActivate(event, pageNumber)}
        role="option"
        tabIndex={isPrimarySelected ? 0 : -1}
        aria-label={rowTitle}
        aria-selected={isPrimarySelected}
        title={rowTitle}
      >
        <div className="thumbnail-number-bar">
          <div className="thumbnail-metric-cluster" aria-hidden="true">
            <span
              className="thumbnail-number"
              title={showExtendedMetrics ? metricTitles.totalPageTitle : metricTitles.combinedTitle}
            >
              {pageNumber}
            </span>
            {showExtendedMetrics ? (
              <>
                <span className="thumbnail-metric-badge secondary" title={metricTitles.documentTitle}>
                  <span className="thumbnail-metric-prefix">D</span>
                  <span>{documentContext.documentNumber}</span>
                </span>
                <span className="thumbnail-metric-badge secondary" title={metricTitles.documentPageTitle}>
                  <span className="thumbnail-metric-prefix">#</span>
                  <span>{documentContext.documentPageNumber}</span>
                </span>
              </>
            ) : null}
          </div>
          {isCompareMode && (isPrimarySelected || isCompareSelected) && (
            <div className="thumbnail-selection-badges" aria-hidden="true">
              {isPrimarySelected && (
                <span className="thumbnail-selection-badge primary">
                  {t('thumbnails.leftPaneBadge', { defaultValue: 'Left' })}
                </span>
              )}
              {isCompareSelected && (
                <span className="thumbnail-selection-badge compare">
                  {t('thumbnails.rightPaneBadge', { defaultValue: 'Right' })}
                </span>
              )}
            </div>
          )}
        </div>

        <div
          className={`thumbnail-image-stage ${thumbnailStatus === 0 ? 'is-loading' : ''}`}
          style={{ height: `${imageStageHeight}px` }}
        >
          {thumbnailStatus === 0 && <LoadingSpinner />}
          {thumbnailStatus === -1 && (
            <img
              src="lost.png"
              alt={t('thumbnails.pageFailedAlt', { page: pageNumber })}
              className="thumbnail"
              decoding="async"
              draggable={false}
            />
          )}
          {thumbnailStatus === 1 && thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt={t('viewer.pageAlt', { page: pageNumber })}
              className="thumbnail"
              decoding="async"
              draggable={false}
              onLoad={() => onImageLoad(index, usesFullAsset ? 'full' : 'thumbnail')}
            />
          )}
        </div>
      </div>

      {documentGroupingActive && documentContext.isDocumentEnd ? (
        <div className="thumbnail-document-boundary end" aria-hidden="true">
          <span className="thumbnail-document-boundary-line" />
          <span className="thumbnail-document-boundary-label end-label">
            {t('thumbnails.documentBoundaryEndShort', { defaultValue: 'End' })}
          </span>
          <span className="thumbnail-document-boundary-line" />
        </div>
      ) : null}
    </div>
  );
});

/**
 * @param {Object} props
 * @param {Array<any>} props.allPages
 * @param {number} props.pageNumber
 * @param {function(number): void} props.setPageNumber
 * @param {{ current:(HTMLElement|null) }} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {function(number): void} [props.selectForCompare]
 * @param {boolean=} props.isComparing
 * @param {(number|null)=} props.comparePageNumber
 * @returns {React.ReactElement}
 */
const DocumentThumbnailList = React.memo(function DocumentThumbnailList({
  allPages,
  pageNumber,
  setPageNumber,
  thumbnailsContainerRef,
  width,
  selectForCompare,
  isComparing = false,
  comparePageNumber = null,
}) {
  const { t } = useTranslation('common');
  const {
    ensurePageAsset,
    touchPageAsset,
    documentLoadingConfig,
    memoryPressureStage,
  } = useContext(ViewerContext);
  const fallbackConfig = useMemo(() => getDocumentLoadingConfig(), []);
  const activeConfig = documentLoadingConfig || fallbackConfig;
  const renderConfig = activeConfig.render;
  const overscan = Math.max(0, Number(renderConfig.visibleThumbnailOverscan) || 0);

  const containerRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const scrollSyncRafRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollReleaseRafRef = useRef(0);
  const lastKnownScrollTopRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(Math.max(160, Number(width) || 0));

  const totalCount = Array.isArray(allPages) ? allPages.length : 0;
  const documentGroupingActive = useMemo(
    () => Array.isArray(allPages) && allPages.some((page) => (Number(page?.totalDocuments) || 0) > 1 && (Number(page?.documentNumber) || 0) > 0),
    [allPages]
  );
  const layout = useMemo(
    () => getThumbnailLayout(renderConfig, containerWidth || width, documentGroupingActive),
    [containerWidth, documentGroupingActive, renderConfig, width]
  );
  const totalHeight = totalCount * layout.rowHeight;
  const warmAllThumbnails = useMemo(
    () => shouldWarmAllThumbnails(renderConfig, totalCount),
    [renderConfig, totalCount]
  );
  const fullyRenderOffscreenRows = warmAllThumbnails;
  const activeDescendantId = totalCount > 0 && pageNumber >= 1 && pageNumber <= totalCount
    ? `thumbnail-${pageNumber}`
    : undefined;
  const selectedIndexForAutoScroll = useMemo(
    () => (totalCount > 0 ? clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1)) : -1),
    [pageNumber, totalCount]
  );

  const visibleRange = useMemo(() => {
    if (totalCount <= 0) return { start: 0, end: -1 };
    const rawStart = Math.floor(scrollTop / layout.rowHeight) - overscan;
    const rawEnd = Math.ceil((scrollTop + Math.max(viewportHeight, layout.rowHeight)) / layout.rowHeight) + overscan;
    return {
      start: clamp(rawStart, 0, Math.max(0, totalCount - 1)),
      end: clamp(rawEnd, 0, Math.max(0, totalCount - 1)),
    };
  }, [layout.rowHeight, overscan, scrollTop, totalCount, viewportHeight]);

  const visibleCenterIndex = useMemo(() => {
    if (visibleRange.end < visibleRange.start || totalCount <= 0) return -1;
    return clamp(
      Math.round((visibleRange.start + visibleRange.end) / 2),
      0,
      Math.max(0, totalCount - 1)
    );
  }, [totalCount, visibleRange.end, visibleRange.start]);

  const widePaneThreshold = Math.max(320, Number(renderConfig.thumbnailMaxWidth || 220) + 96);
  const allowWidePaneFullPreview = containerWidth >= widePaneThreshold
    && String(renderConfig.thumbnailSourceStrategy || 'auto').toLowerCase() !== 'dedicated'
    && String(memoryPressureStage || 'normal').toLowerCase() !== 'hard';

  const preferredFullPreviewIndexes = useMemo(() => {
    if (!allowWidePaneFullPreview || totalCount <= 0) return new Set();

    const indexes = new Set();
    const currentIndex = clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1));
    const compareIndex = isComparing && Number.isFinite(comparePageNumber)
      ? clamp(Number(comparePageNumber) - 1, 0, Math.max(0, totalCount - 1))
      : -1;

    indexes.add(currentIndex);
    if (compareIndex >= 0) indexes.add(compareIndex);
    for (let index = visibleRange.start; index <= visibleRange.end; index += 1) indexes.add(index);

    return new Set(Array.from(indexes).filter((index) => {
      const page = allPages[index];
      return !!page && shouldUseFullImagesForThumbnails(activeConfig, page, totalCount);
    }));
  }, [activeConfig, allPages, allowWidePaneFullPreview, comparePageNumber, isComparing, pageNumber, totalCount, visibleRange.end, visibleRange.start]);

  /**
   * @param {(HTMLDivElement|null)} node
   * @returns {void}
   */
  const setContainerRef = useCallback((node) => {
    containerRef.current = node;
    thumbnailsContainerRef.current = node;
    if (node) {
      const nextViewportHeight = node.clientHeight || 0;
      const nextScrollTop = node.scrollTop || 0;
      const nextContainerWidth = node.clientWidth || Math.max(160, Number(width) || 0);
      lastKnownScrollTopRef.current = nextScrollTop;
      setViewportHeight(nextViewportHeight);
      setScrollTop(nextScrollTop);
      setContainerWidth(nextContainerWidth);
    }
  }, [thumbnailsContainerRef, width]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateMeasurements = () => {
      const nextViewportHeight = node.clientHeight || 0;
      const nextScrollTop = node.scrollTop || 0;
      const nextContainerWidth = node.clientWidth || Math.max(160, Number(width) || 0);
      lastKnownScrollTopRef.current = nextScrollTop;
      setViewportHeight(nextViewportHeight);
      setScrollTop(nextScrollTop);
      setContainerWidth(nextContainerWidth);
    };

    updateMeasurements();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateMeasurements)
      : null;
    resizeObserver?.observe(node);

    return () => {
      if (programmaticScrollReleaseRafRef.current) {
        window.cancelAnimationFrame(programmaticScrollReleaseRafRef.current);
        programmaticScrollReleaseRafRef.current = 0;
      }
      programmaticScrollRef.current = false;
      resizeObserver?.disconnect();
    };
  }, [width]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || selectedIndexForAutoScroll < 0) return undefined;

    const rafId = window.requestAnimationFrame(() => {
      const viewportTop = Number(node.scrollTop || 0);
      const viewportHeightNow = Number(node.clientHeight || 0);
      const rowTop = selectedIndexForAutoScroll * layout.rowHeight;
      const rowBottom = rowTop + layout.rowHeight;
      let nextScrollTop = viewportTop;

      if (rowTop < viewportTop) {
        nextScrollTop = rowTop;
      } else if (rowBottom > viewportTop + viewportHeightNow) {
        nextScrollTop = Math.max(0, rowBottom - viewportHeightNow);
      }

      if (Math.abs(nextScrollTop - viewportTop) >= 1) {
        if (programmaticScrollReleaseRafRef.current) {
          window.cancelAnimationFrame(programmaticScrollReleaseRafRef.current);
          programmaticScrollReleaseRafRef.current = 0;
        }
        programmaticScrollRef.current = true;
        lastKnownScrollTopRef.current = nextScrollTop;
        setScrollTop((current) => (Math.abs(current - nextScrollTop) >= 1 ? nextScrollTop : current));
        node.scrollTop = nextScrollTop;
        programmaticScrollReleaseRafRef.current = window.requestAnimationFrame(() => {
          programmaticScrollReleaseRafRef.current = 0;
          programmaticScrollRef.current = false;
          const actualScrollTop = Number(node.scrollTop || 0);
          lastKnownScrollTopRef.current = actualScrollTop;
          setScrollTop((current) => (Math.abs(current - actualScrollTop) >= 1 ? actualScrollTop : current));
        });
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [layout.rowHeight, selectedIndexForAutoScroll]);

  useEffect(() => {
    if (!totalCount) return;

    const requested = new Map();
    const ranks = { critical: 4, high: 3, normal: 2, low: 1 };
    const isThumbnailReady = (page) => !!page && (page.thumbnailUsesFullAsset
      ? (page.fullSizeStatus === 1 && !!page.fullSizeUrl)
      : page.thumbnailStatus === 1 && !!page.thumbnailUrl);
    const pushIndex = (index, priority) => {
      if (index < 0 || index >= totalCount) return;
      const page = allPages[index];
      if (!page || page.status === -1 || page.thumbnailStatus === -1 || !page.sourceKey || isThumbnailReady(page)) return;
      const previous = requested.get(index);
      const previousRank = previous ? (ranks[previous] || 0) : 0;
      const nextRank = ranks[priority] || 0;
      if (nextRank > previousRank) requested.set(index, priority);
    };

    const currentIndex = clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1));
    const compareIndex = isComparing && Number.isFinite(comparePageNumber)
      ? clamp(Number(comparePageNumber) - 1, 0, Math.max(0, totalCount - 1))
      : -1;
    const visibleHasPages = visibleRange.end >= visibleRange.start;
    const focusIndex = visibleHasPages && visibleCenterIndex >= 0 ? visibleCenterIndex : currentIndex;
    const currentIsVisible = isIndexInRange(currentIndex, visibleRange);
    const compareIsVisible = compareIndex >= 0 && isIndexInRange(compareIndex, visibleRange);

    pushIndex(focusIndex, 'critical');
    touchPageAsset(focusIndex, allPages[focusIndex]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');

    if (currentIndex >= 0) {
      pushIndex(currentIndex, currentIsVisible ? 'critical' : 'normal');
      touchPageAsset(currentIndex, allPages[currentIndex]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');
    }

    if (compareIndex >= 0) {
      pushIndex(compareIndex, compareIsVisible ? 'high' : 'normal');
      touchPageAsset(compareIndex, allPages[compareIndex]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');
    }

    for (let index = visibleRange.start; index <= visibleRange.end; index += 1) {
      const priority = index === focusIndex
        ? 'critical'
        : index === currentIndex
          ? 'high'
          : index === compareIndex
            ? 'high'
            : 'high';
      pushIndex(index, priority);
      touchPageAsset(index, allPages[index]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');
    }

    const ahead = Math.max(0, Number(renderConfig.lookAheadPageCount) || 0);
    const behind = Math.max(0, Number(renderConfig.lookBehindPageCount) || 0);
    for (let offset = 1; offset <= ahead; offset += 1) pushIndex(focusIndex + offset, 'normal');
    for (let offset = 1; offset <= behind; offset += 1) pushIndex(focusIndex - offset, 'normal');
    if (currentIndex !== focusIndex) {
      for (let offset = 1; offset <= Math.min(2, ahead); offset += 1) pushIndex(currentIndex + offset, 'low');
      for (let offset = 1; offset <= Math.min(2, behind); offset += 1) pushIndex(currentIndex - offset, 'low');
    }
    if (compareIndex >= 0 && compareIndex !== focusIndex) {
      for (let offset = 1; offset <= Math.min(2, ahead); offset += 1) pushIndex(compareIndex + offset, 'low');
      for (let offset = 1; offset <= Math.min(2, behind); offset += 1) pushIndex(compareIndex - offset, 'low');
    }

    for (const [index, priority] of requested.entries()) {
      void ensurePageAsset(index, 'thumbnail', { priority }).catch(() => {});
    }
  }, [
    allPages,
    comparePageNumber,
    ensurePageAsset,
    isComparing,
    pageNumber,
    renderConfig.lookAheadPageCount,
    renderConfig.lookBehindPageCount,
    totalCount,
    touchPageAsset,
    visibleCenterIndex,
    visibleRange,
  ]);

  useEffect(() => {
    if (!allowWidePaneFullPreview || preferredFullPreviewIndexes.size <= 0) return;

    preferredFullPreviewIndexes.forEach((index) => {
      const page = allPages[index];
      if (!page || page.status === -1 || !page.sourceKey || page.fullSizeStatus === -1) return;
      if (page.fullSizeStatus === 1 && page.fullSizeUrl) {
        touchPageAsset(index, 'full');
        return;
      }

      const priority = index === pageNumber - 1
        ? 'critical'
        : (isComparing && comparePageNumber === index + 1 ? 'high' : 'normal');
      void ensurePageAsset(index, 'full', { priority }).catch(() => {});
    });
  }, [
    allPages,
    allowWidePaneFullPreview,
    comparePageNumber,
    ensurePageAsset,
    isComparing,
    pageNumber,
    preferredFullPreviewIndexes,
    touchPageAsset,
  ]);

  useEffect(() => {
    return () => {
      if (scrollSyncRafRef.current) {
        window.cancelAnimationFrame(scrollSyncRafRef.current);
        scrollSyncRafRef.current = 0;
      }
      if (programmaticScrollReleaseRafRef.current) {
        window.cancelAnimationFrame(programmaticScrollReleaseRafRef.current);
        programmaticScrollReleaseRafRef.current = 0;
      }
      programmaticScrollRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!warmAllThumbnails || totalCount <= 0) return undefined;

    let cancelled = false;
    let timeoutId = 0;
    const currentIndex = clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1));
    const compareIndex = isComparing && Number.isFinite(comparePageNumber)
      ? clamp(Number(comparePageNumber) - 1, 0, Math.max(0, totalCount - 1))
      : -1;
    const focusIndex = visibleCenterIndex >= 0 ? visibleCenterIndex : currentIndex;

    const excluded = new Set();
    if (currentIndex >= 0) excluded.add(currentIndex);
    if (compareIndex >= 0) excluded.add(compareIndex);
    for (let index = visibleRange.start; index <= visibleRange.end; index += 1) {
      if (index >= 0) excluded.add(index);
    }

    const queue = buildCenterOutQueue(totalCount, focusIndex, excluded);

    const pump = () => {
      if (cancelled) return;
      const batchSize = Math.max(1, Number(renderConfig.maxConcurrentAssetRenders) || 1);
      const batch = queue.splice(0, batchSize);
      for (const index of batch) {
        const page = allPages[index];
        const isThumbnailReady = !!page && (page.thumbnailUsesFullAsset
          ? (page.fullSizeStatus === 1 && !!page.fullSizeUrl)
          : page.thumbnailStatus === 1 && !!page.thumbnailUrl);
        if (!page || page.status === -1 || page.thumbnailStatus === -1 || !page.sourceKey || isThumbnailReady) continue;
        void ensurePageAsset(index, 'thumbnail', { priority: 'low' }).catch(() => {});
      }
      if (queue.length > 0) timeoutId = window.setTimeout(pump, 16);
    };

    timeoutId = window.setTimeout(pump, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    allPages,
    comparePageNumber,
    ensurePageAsset,
    isComparing,
    pageNumber,
    renderConfig.maxConcurrentAssetRenders,
    totalCount,
    visibleCenterIndex,
    visibleRange.end,
    visibleRange.start,
    warmAllThumbnails,
  ]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handleScroll = useCallback((event) => {
    const next = Number(event?.currentTarget?.scrollTop || 0);
    lastKnownScrollTopRef.current = next;
    if (programmaticScrollRef.current) return;
    if (scrollSyncRafRef.current) window.cancelAnimationFrame(scrollSyncRafRef.current);
    scrollSyncRafRef.current = window.requestAnimationFrame(() => {
      scrollSyncRafRef.current = 0;
      setScrollTop((current) => {
        const safeRowHeight = Math.max(1, Number(layout.rowHeight) || 1);
        const safeViewportHeight = Math.max(viewportHeight, safeRowHeight);
        const currentStart = Math.floor(current / safeRowHeight);
        const currentEnd = Math.ceil((current + safeViewportHeight) / safeRowHeight);
        const nextStart = Math.floor(next / safeRowHeight);
        const nextEnd = Math.ceil((next + safeViewportHeight) / safeRowHeight);

        if (currentStart === nextStart && currentEnd === nextEnd) return current;
        return Math.abs(current - next) >= 1 ? next : current;
      });
    });
  }, [layout.rowHeight, viewportHeight]);

  /**
   * @param {number} nextPageNumber
   * @param {*} event
   * @returns {void}
   */
  const handleActivate = useCallback((nextPageNumber, event) => {
    try {
      if (event?.shiftKey && typeof selectForCompare === 'function') {
        event.preventDefault?.();
        event.stopPropagation?.();
        selectForCompare(nextPageNumber);
        logger.info('Thumbnail SHIFT-activated for compare', { pageNumber: nextPageNumber });
        return;
      }
      setPageNumber(nextPageNumber);
    } catch (error) {
      logger.error('Failed to activate thumbnail', {
        pageNumber: nextPageNumber,
        error: String(error?.message || error),
      });
    }
  }, [selectForCompare, setPageNumber]);

  /**
   * @param {*} event
   * @param {number} nextPageNumber
   * @returns {void}
   */
  const handleKeyActivate = useCallback((event, nextPageNumber) => {
    const key = String(event?.key || '');
    if (key !== 'Enter' && key !== ' ') return;
    event.preventDefault?.();
    handleActivate(nextPageNumber, event);
  }, [handleActivate]);

  /**
   * @param {number} index
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const handleImageLoad = useCallback((index, variant) => {
    touchPageAsset(index, variant);
  }, [touchPageAsset]);

  const rows = [];
  for (let index = 0; index < totalCount; index += 1) {
    const pageId = index + 1;
    rows.push(
      <ThumbnailRow
        key={index}
        page={allPages[index] || null}
        index={index}
        rowHeight={layout.rowHeight}
        imageStageHeight={layout.imageStageHeight}
        isPrimarySelected={pageNumber === pageId}
        isCompareSelected={!!isComparing && comparePageNumber === pageId}
        isCompareMode={!!isComparing}
        preferFullAssetPreview={preferredFullPreviewIndexes.has(index)}
        totalPages={totalCount}
        containerWidth={containerWidth}
        documentGroupingActive={documentGroupingActive}
        onActivate={handleActivate}
        onKeyActivate={handleKeyActivate}
        onImageLoad={handleImageLoad}
        fullyRenderOffscreenRows={fullyRenderOffscreenRows}
      />
    );
  }

  return (
    <div
      className="thumbnails-container"
      ref={setContainerRef}
      role="listbox"
      aria-label={t('thumbnails.aria.container')}
      aria-activedescendant={activeDescendantId}
      onScroll={handleScroll}
      style={{
        width: `${Math.max(0, Number(width) || 0)}px`,
        minWidth: `${Math.max(0, Number(width) || 0)}px`,
      }}
    >
      <div
        className="thumbnails-static-list"
        style={{
          position: 'relative',
          width: '100%',
          minHeight: `${Math.max(totalHeight, viewportHeight)}px`,
        }}
      >
        {rows}
      </div>
    </div>
  );
});

ThumbnailRow.propTypes = {
  page: PropTypes.any,
  index: PropTypes.number.isRequired,
  rowHeight: PropTypes.number.isRequired,
  imageStageHeight: PropTypes.number.isRequired,
  isPrimarySelected: PropTypes.bool.isRequired,
  isCompareSelected: PropTypes.bool.isRequired,
  isCompareMode: PropTypes.bool.isRequired,
  preferFullAssetPreview: PropTypes.bool.isRequired,
  totalPages: PropTypes.number.isRequired,
  containerWidth: PropTypes.number.isRequired,
  documentGroupingActive: PropTypes.bool.isRequired,
  onActivate: PropTypes.func.isRequired,
  onKeyActivate: PropTypes.func.isRequired,
  onImageLoad: PropTypes.func.isRequired,
  fullyRenderOffscreenRows: PropTypes.bool.isRequired,
};

DocumentThumbnailList.propTypes = {
  allPages: PropTypes.array.isRequired,
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  thumbnailsContainerRef: PropTypes.shape({
    current: PropTypes.any,
  }).isRequired,
  width: PropTypes.number.isRequired,
  selectForCompare: PropTypes.func,
  isComparing: PropTypes.bool,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
};

export default DocumentThumbnailList;
