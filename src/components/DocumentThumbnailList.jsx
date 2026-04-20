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
import { getPublicAssetUrl } from '../utils/publicAssetUrl.js';
import { bundleDocumentHasMetadata } from '../utils/documentMetadata.js';

/**
 * @typedef {Object} ThumbnailRowProps
 * @property {*} page
 * @property {number} index
 * @property {number} rowHeight
 * @property {number} imageStageHeight
 * @property {boolean} isFocusedSelected
 * @property {boolean} isPrimarySelected
 * @property {boolean} isCompareSelected
 * @property {boolean} isCompareMode
 * @property {boolean} preferFullAssetPreview
 * @property {number} totalPages
 * @property {boolean} documentGroupingActive
 * @property {*} prevPage
 * @property {*} nextPage
 * @property {function(number, *): void} onActivate
 * @property {function(*, number): void} onKeyActivate
 * @property {function(*, number, *): void} onOpenContextMenu
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
  const safePaneWidth = Math.max(196, Number(paneWidth) || 0);
  const stageWidth = Math.max(96, safePaneWidth - 18);
  const usableWidth = Math.min(stageWidth, Math.max(configuredMaxWidth, Math.round(stageWidth * 0.96)));
  const imageAspectRatio = configuredMaxHeight / Math.max(1, configuredMaxWidth);
  const imageStageHeight = Math.max(120, Math.round(usableWidth * imageAspectRatio));
  const rowHeight = imageStageHeight + (documentGroupingActive ? 58 : 34);

  return {
    rowHeight,
    imageStageHeight,
  };
}

/**
 * @param {number} current
 * @param {number} total
 * @returns {string}
 */
function formatMetricFraction(current, total) {
  const safeCurrent = Math.max(0, Number(current) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  return safeTotal > 0 ? `${safeCurrent}/${safeTotal}` : `${safeCurrent}/–`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatMetricValue(value) {
  return String(Math.max(0, Number(value) || 0));
}

/**
 * @param {*} page
 * @param {number} fallbackIndex
 * @returns {number}
 */
function getSessionPageIndex(page, fallbackIndex) {
  const raw = Number(page?.allPagesIndex);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return Math.max(0, Math.floor(Number(fallbackIndex) || 0));
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
 * @returns {string}
 */
function getPageDocumentKey(page) {
  const documentId = String(page?.documentId || '').trim();
  if (documentId) return documentId;
  const documentNumber = Math.max(0, Number(page?.documentNumber) || 0);
  return documentNumber > 0 ? `doc:${documentNumber}` : '';
}

/**
 * @param {*} page
 * @param {*} [prevPage]
 * @param {*} [nextPage]
 * @returns {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number, documentPageNumber:number, documentPageCount:number, isDocumentStart:boolean, isDocumentEnd:boolean }}
 */
function getPageDocumentContext(page, prevPage = null, nextPage = null) {
  const documentNumber = Math.max(0, Number(page?.documentNumber) || 0);
  const totalDocuments = Math.max(0, Number(page?.totalDocuments) || 0);
  const documentPageNumber = Math.max(0, Number(page?.documentPageNumber) || 0);
  const documentPageCount = Math.max(0, Number(page?.documentPageCount) || 0);
  const hasMultipleDocuments = totalDocuments > 1 && documentNumber > 0 && documentPageNumber > 0;
  const currentKey = getPageDocumentKey(page);
  const previousKey = getPageDocumentKey(prevPage);
  const nextKey = getPageDocumentKey(nextPage);

  return {
    hasMultipleDocuments,
    documentNumber,
    totalDocuments,
    documentPageNumber,
    documentPageCount,
    isDocumentStart: hasMultipleDocuments && (!previousKey || previousKey !== currentKey),
    isDocumentEnd: hasMultipleDocuments && (!nextKey || nextKey !== currentKey),
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
 * @param {Function} t
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number, documentPageNumber:number, documentPageCount:number }} documentContext
 * @returns {Array<Object>}
 */
function getMetricBadges(t, pageNumber, totalPages, documentContext) {
  const totalTitle = t('thumbnails.metrics.totalPageTitle', {
    page: pageNumber,
    total: totalPages,
    defaultValue: `Page ${pageNumber} of ${totalPages}`,
  });
  const badges = [
    {
      key: 'total-page',
      prefix: t('thumbnails.metrics.totalPagePrefix', { defaultValue: 'T' }),
      value: formatMetricValue(pageNumber),
      title: `${t('thumbnails.metrics.totalPageBadgeTitle', {
        defaultValue: 'Total page number in the current selection',
      })} — ${totalTitle}`,
      position: 'top-left',
    },
  ];

  if (!documentContext.hasMultipleDocuments) return badges;

  const documentFraction = formatMetricFraction(documentContext.documentNumber, documentContext.totalDocuments);
  const documentPageFraction = documentContext.documentPageCount > 0
    ? formatMetricFraction(documentContext.documentPageNumber, documentContext.documentPageCount)
    : formatMetricValue(documentContext.documentPageNumber);

  badges.push(
    {
      key: 'document',
      prefix: t('thumbnails.metrics.documentPrefix', { defaultValue: 'D' }),
      value: formatMetricValue(documentContext.documentNumber),
      title: `${t('thumbnails.metrics.documentBadgeTitle', {
        defaultValue: 'Document number in current session',
      })} — ${documentFraction}`,
      position: 'bottom-left',
    },
    {
      key: 'document-page',
      prefix: t('thumbnails.metrics.documentPagePrefix', { defaultValue: 'S' }),
      value: formatMetricValue(documentContext.documentPageNumber),
      title: `${t('thumbnails.metrics.documentPageBadgeTitle', {
        defaultValue: 'Page number within the current document',
      })} — ${documentPageFraction}`,
      position: 'bottom-right',
    }
  );

  return badges;
}

/**
 * @param {Function} t
 * @param {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number }} documentContext
 * @returns {string}
 */
function getDocumentBoundaryLabel(t, documentContext) {
  if (!documentContext.hasMultipleDocuments) return '';
  return t('thumbnails.documentBoundaryStartShort', {
    document: documentContext.documentNumber,
    total: documentContext.totalDocuments,
    defaultValue: `Doc ${documentContext.documentNumber}`,
  });
}

/**
 * @param {Function} t
 * @param {{ hasMultipleDocuments:boolean, documentNumber:number, totalDocuments:number }} documentContext
 * @returns {string}
 */
function getDocumentBoundaryTitle(t, documentContext) {
  if (!documentContext.hasMultipleDocuments) return '';
  return t('thumbnails.documentBoundaryStartTitle', {
    document: documentContext.documentNumber,
    total: documentContext.totalDocuments,
    defaultValue: `Document ${documentContext.documentNumber}`,
  });
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
  isFocusedSelected,
  isPrimarySelected,
  isCompareSelected,
  isCompareMode,
  preferFullAssetPreview,
  totalPages,
  documentGroupingActive,
  prevPage,
  nextPage,
  onActivate,
  onKeyActivate,
  onOpenContextMenu,
  onImageLoad,
  fullyRenderOffscreenRows,
}) {
  const { t } = useTranslation('common');
  const visiblePageNumber = index + 1;
  const originalPageNumber = getSessionPageIndex(page, index) + 1;
  const rowId = `thumbnail-${visiblePageNumber}`;
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
  const documentContext = getPageDocumentContext(page, prevPage, nextPage);
  const metricTitles = getMetricTitles(t, visiblePageNumber, totalPages, documentContext);
  const metricBadges = getMetricBadges(t, visiblePageNumber, totalPages, documentContext);

  const rowShellClassName = [
    'thumbnail-row-shell',
    documentGroupingActive ? 'document-aware' : '',
    documentContext.isDocumentStart ? 'has-document-start' : '',
    documentContext.isDocumentEnd ? 'has-document-end' : '',
  ].filter(Boolean).join(' ');

  const wrapperClassName = [
    'thumbnail-wrapper',
    isFocusedSelected ? 'selected-focus' : '',
    isPrimarySelected ? 'selected-primary' : '',
    isCompareSelected ? 'selected-compare' : '',
    isDualSelected ? 'selected-dual' : '',
  ].filter(Boolean).join(' ');

  const navigationTitle = isDualSelected
    ? t('thumbnails.goToPageBothPanes', { page: visiblePageNumber, defaultValue: `Go to page ${visiblePageNumber} (shown in both panes)` })
    : isCompareSelected
      ? t('thumbnails.goToPageRightPane', { page: visiblePageNumber, defaultValue: `Go to page ${visiblePageNumber} (right pane)` })
      : isPrimarySelected
        ? t('thumbnails.goToPageLeftPane', { page: visiblePageNumber, defaultValue: `Go to page ${visiblePageNumber} (left pane)` })
        : t('thumbnails.goToPage', { page: visiblePageNumber });

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
          <span
            className="thumbnail-document-boundary-label"
            title={getDocumentBoundaryTitle(t, documentContext)}
          >
            {getDocumentBoundaryLabel(t, documentContext)}
          </span>
          <span className="thumbnail-document-boundary-line" />
        </div>
      ) : null}

      <div
        id={rowId}
        className={wrapperClassName}
        onClick={(event) => onActivate(originalPageNumber, event)}
        onKeyDown={(event) => onKeyActivate(event, originalPageNumber)}
        onContextMenu={(event) => onOpenContextMenu(event, originalPageNumber, page)}
        role="option"
        tabIndex={isFocusedSelected ? 0 : -1}
        aria-label={rowTitle}
        aria-selected={isFocusedSelected}
      >
        <div
          className={`thumbnail-image-stage ${thumbnailStatus === 0 ? 'is-loading' : ''}`}
          style={{ height: `${imageStageHeight}px` }}
        >
          {metricBadges.map((metric) => (
            <span
              key={metric.key}
              className={`thumbnail-overlay-badge metric-${metric.key} position-${metric.position}`}
              title={metric.title}
            >
              <span className="thumbnail-overlay-badge-prefix">{metric.prefix}</span>
              <span className="thumbnail-overlay-badge-value">{metric.value}</span>
            </span>
          ))}

          {isCompareMode && (isPrimarySelected || isCompareSelected) ? (
            <div className="thumbnail-selection-badges overlay-corner" aria-hidden="true">
              {isPrimarySelected ? (
                <span
                  className="thumbnail-selection-badge primary"
                  title={t('thumbnails.leftPaneBadgeTooltip', { defaultValue: 'Left pane in compare view' })}
                >
                  {t('thumbnails.leftPaneBadgeShort', { defaultValue: 'L' })}
                </span>
              ) : null}
              {isCompareSelected ? (
                <span
                  className="thumbnail-selection-badge compare"
                  title={t('thumbnails.rightPaneBadgeTooltip', { defaultValue: 'Right pane in compare view' })}
                >
                  {t('thumbnails.rightPaneBadgeShort', { defaultValue: 'R' })}
                </span>
              ) : null}
            </div>
          ) : null}

          {thumbnailStatus === 0 && <LoadingSpinner />}
          {thumbnailStatus === -1 && (
            <img
              src={getPublicAssetUrl('lost.png')}
              alt={t('thumbnails.pageFailedAlt', { page: visiblePageNumber })}
              className="thumbnail"
              decoding="async"
              draggable={false}
            />
          )}
          {thumbnailStatus === 1 && thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt={t('viewer.pageAlt', { page: visiblePageNumber })}
              className="thumbnail"
              decoding="async"
              draggable={false}
              onLoad={() => onImageLoad(getSessionPageIndex(page, index), usesFullAsset ? 'full' : 'thumbnail')}
            />
          )}
        </div>
      </div>

    </div>
  );
});

/**
 * @param {Object} props
 * @param {Array<any>} props.allPages
 * @param {number} props.pageNumber - Original 1-based selected page number in the session.
 * @param {function(number): void} props.setPageNumber - Accepts an original 1-based page number.
 * @param {{ current:(HTMLElement|null) }} props.thumbnailsContainerRef
 * @param {number} props.width
 * @param {function(number): void} [props.selectForCompare]
 * @param {boolean=} props.isComparing
 * @param {(number|null)=} props.comparePageNumber - Original 1-based compare page number.
 * @param {{ shift:boolean, ctrl:boolean }} props.navigationModifierState
 * @param {boolean=} props.selectionPanelEnabled
 * @param {function(number): boolean} [props.onHidePageFromSelection]
 * @param {function(number): boolean} [props.onHideDocumentFromSelection]
 * @param {function(number): boolean} [props.onOpenDocumentMetadata]
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
  navigationModifierState,
  selectionPanelEnabled = false,
  onHidePageFromSelection,
  onHideDocumentFromSelection,
  onOpenDocumentMetadata,
}) {
  const { t } = useTranslation('common');
  const isShiftPressed = !!navigationModifierState.shift;
  const {
    bundle,
    ensurePageAsset,
    touchPageAsset,
    documentLoadingConfig,
    memoryPressureStage,
    loadingRunActive,
  } = useContext(ViewerContext);
  const fallbackConfig = useMemo(() => getDocumentLoadingConfig(), []);
  const activeConfig = documentLoadingConfig || fallbackConfig;
  const renderConfig = activeConfig.render;
  const overscan = Math.max(0, Number(renderConfig.visibleThumbnailOverscan) || 0);

  const containerRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contextMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const scrollSyncRafRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollReleaseRafRef = useRef(0);
  const lastKnownScrollTopRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(Math.max(160, Number(width) || 0));
  const [contextMenuState, setContextMenuState] = useState(/** @type {(null|{ x:number, y:number, originalIndex:number, documentNumber:number, totalDocuments:number, documentId:(string|undefined) })} */ (null));

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
  const stickyDocumentContext = useMemo(() => {
    if (!documentGroupingActive || totalCount <= 0) return null;
    const topIndex = clamp(
      Math.floor(Math.max(0, Number(scrollTop) || 0) / Math.max(1, layout.rowHeight)),
      0,
      Math.max(0, totalCount - 1)
    );
    return getPageDocumentContext(allPages[topIndex] || null, allPages[topIndex - 1] || null, allPages[topIndex + 1] || null);
  }, [allPages, documentGroupingActive, layout.rowHeight, scrollTop, totalCount]);
  const showStickyDocumentHeader = !!stickyDocumentContext?.hasMultipleDocuments && scrollTop > 8;
  const warmAllThumbnails = useMemo(
    () => shouldWarmAllThumbnails(renderConfig, totalCount),
    [renderConfig, totalCount]
  );
  const fullyRenderOffscreenRows = warmAllThumbnails;
  const primarySelectedIndex = useMemo(() => {
    if (totalCount <= 0) return -1;
    return allPages.findIndex((page, visibleIndex) => (getSessionPageIndex(page, visibleIndex) + 1) === Number(pageNumber));
  }, [allPages, pageNumber, totalCount]);
  const compareSelectedIndex = useMemo(() => {
    if (!isComparing || !Number.isFinite(comparePageNumber) || totalCount <= 0) return -1;
    return allPages.findIndex((page, visibleIndex) => (getSessionPageIndex(page, visibleIndex) + 1) === Number(comparePageNumber));
  }, [allPages, comparePageNumber, isComparing, totalCount]);
  // Follow actual page/document changes only. Holding Shift by itself must not yank the strip to
  // the compare thumbnail; the right pane should only take over after an explicit compare page
  // change coming from keyboard navigation, toolbar navigation, or compare selection.
  const [autoScrollPageNumber, setAutoScrollPageNumber] = useState(Math.max(1, Number(pageNumber) || 1));
  const previousPrimaryPageNumberRef = useRef(Number(pageNumber) || 0);
  const previousComparePageNumberRef = useRef(Number.isFinite(comparePageNumber) ? Number(comparePageNumber) : 0);
  const selectedIndexForAutoScroll = useMemo(() => {
    if (totalCount <= 0) return -1;
    const targetPageNumber = Math.max(1, Number(autoScrollPageNumber) || Number(pageNumber) || 1);
    return allPages.findIndex((page, visibleIndex) => (getSessionPageIndex(page, visibleIndex) + 1) === targetPageNumber);
  }, [allPages, autoScrollPageNumber, pageNumber, totalCount]);
  const activeDescendantId = selectedIndexForAutoScroll >= 0 ? `thumbnail-${selectedIndexForAutoScroll + 1}` : undefined;
  const focusedOriginalPageNumber = Math.max(1, Number(autoScrollPageNumber) || Number(pageNumber) || 1);

  useEffect(() => {
    if (totalCount <= 0) {
      previousPrimaryPageNumberRef.current = Number(pageNumber) || 0;
      setAutoScrollPageNumber(Math.max(1, Number(pageNumber) || 1));
      return;
    }
    const nextPrimaryPageNumber = Number(pageNumber) || 0;
    const previousPrimaryPageNumber = Number(previousPrimaryPageNumberRef.current) || 0;
    previousPrimaryPageNumberRef.current = nextPrimaryPageNumber;
    if (nextPrimaryPageNumber !== previousPrimaryPageNumber && primarySelectedIndex >= 0) {
      setAutoScrollPageNumber(nextPrimaryPageNumber);
    }
  }, [pageNumber, primarySelectedIndex, totalCount]);

  useEffect(() => {
    if (totalCount <= 0) {
      previousComparePageNumberRef.current = Number.isFinite(comparePageNumber) ? Number(comparePageNumber) : 0;
      return;
    }
    const nextComparePageNumber = Number.isFinite(comparePageNumber) ? Number(comparePageNumber) : 0;
    const previousComparePageNumber = Number(previousComparePageNumberRef.current) || 0;
    previousComparePageNumberRef.current = nextComparePageNumber;
    if (isComparing && nextComparePageNumber > 0 && nextComparePageNumber !== previousComparePageNumber && compareSelectedIndex >= 0) {
      setAutoScrollPageNumber(nextComparePageNumber);
    }
  }, [comparePageNumber, compareSelectedIndex, isComparing, totalCount]);

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
    const currentIndex = selectedIndexForAutoScroll;
    const compareIndex = compareSelectedIndex;

    if (currentIndex >= 0) indexes.add(currentIndex);
    if (compareIndex >= 0) indexes.add(compareIndex);
    for (let index = visibleRange.start; index <= visibleRange.end; index += 1) indexes.add(index);

    return new Set(Array.from(indexes).filter((index) => {
      const page = allPages[index];
      return !!page && shouldUseFullImagesForThumbnails(activeConfig, page, totalCount);
    }));
  }, [
    activeConfig,
    allPages,
    allowWidePaneFullPreview,
    compareSelectedIndex,
    selectedIndexForAutoScroll,
    totalCount,
    visibleRange.end,
    visibleRange.start,
  ]);

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
    const pushIndex = (visibleIndex, priority) => {
      if (visibleIndex < 0 || visibleIndex >= totalCount) return;
      const page = allPages[visibleIndex];
      const sessionIndex = getSessionPageIndex(page, visibleIndex);
      if (!page || page.status === -1 || page.thumbnailStatus === -1 || !page.sourceKey || isThumbnailReady(page)) return;
      const previous = requested.get(sessionIndex);
      const previousRank = previous ? (ranks[previous] || 0) : 0;
      const nextRank = ranks[priority] || 0;
      if (nextRank > previousRank) requested.set(sessionIndex, priority);
    };

    const currentIndex = selectedIndexForAutoScroll;
    const compareIndex = compareSelectedIndex;
    const visibleHasPages = visibleRange.end >= visibleRange.start;
    const focusIndex = visibleHasPages && visibleCenterIndex >= 0 ? visibleCenterIndex : currentIndex;
    const currentIsVisible = currentIndex >= 0 && isIndexInRange(currentIndex, visibleRange);
    const compareIsVisible = compareIndex >= 0 && isIndexInRange(compareIndex, visibleRange);

    const touchVisibleIndex = (visibleIndex) => {
      if (visibleIndex < 0 || visibleIndex >= totalCount) return;
      const page = allPages[visibleIndex];
      const sessionIndex = getSessionPageIndex(page, visibleIndex);
      touchPageAsset(sessionIndex, page?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');
    };

    pushIndex(focusIndex, 'critical');
    touchVisibleIndex(focusIndex);

    if (currentIndex >= 0) {
      pushIndex(currentIndex, currentIsVisible ? 'critical' : 'normal');
      touchVisibleIndex(currentIndex);
    }

    if (compareIndex >= 0) {
      pushIndex(compareIndex, compareIsVisible ? 'high' : 'normal');
      touchVisibleIndex(compareIndex);
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
      touchVisibleIndex(index);
    }

    const ahead = Math.max(0, Number(renderConfig.lookAheadPageCount) || 0);
    const behind = Math.max(0, Number(renderConfig.lookBehindPageCount) || 0);
    for (let offset = 1; offset <= ahead; offset += 1) pushIndex(focusIndex + offset, 'normal');
    for (let offset = 1; offset <= behind; offset += 1) pushIndex(focusIndex - offset, 'normal');
    if (currentIndex >= 0 && currentIndex !== focusIndex) {
      for (let offset = 1; offset <= Math.min(2, ahead); offset += 1) pushIndex(currentIndex + offset, 'low');
      for (let offset = 1; offset <= Math.min(2, behind); offset += 1) pushIndex(currentIndex - offset, 'low');
    }
    if (compareIndex >= 0 && compareIndex !== focusIndex) {
      for (let offset = 1; offset <= Math.min(2, ahead); offset += 1) pushIndex(compareIndex + offset, 'low');
      for (let offset = 1; offset <= Math.min(2, behind); offset += 1) pushIndex(compareIndex - offset, 'low');
    }

    for (const [sessionIndex, priority] of requested.entries()) {
      void ensurePageAsset(sessionIndex, 'thumbnail', { priority }).catch(() => {});
    }
  }, [
    allPages,
    comparePageNumber,
    compareSelectedIndex,
    ensurePageAsset,
    isComparing,
    renderConfig.lookAheadPageCount,
    renderConfig.lookBehindPageCount,
    selectedIndexForAutoScroll,
    totalCount,
    touchPageAsset,
    visibleCenterIndex,
    visibleRange,
  ]);

  useEffect(() => {
    if (!allowWidePaneFullPreview || preferredFullPreviewIndexes.size <= 0) return;

    preferredFullPreviewIndexes.forEach((index) => {
      const page = allPages[index];
      const sessionIndex = getSessionPageIndex(page, index);
      if (!page || page.status === -1 || !page.sourceKey || page.fullSizeStatus === -1) return;
      if (page.fullSizeStatus === 1 && page.fullSizeUrl) {
        touchPageAsset(sessionIndex, 'full');
        return;
      }

      const priority = index === selectedIndexForAutoScroll
        ? 'critical'
        : (isComparing && comparePageNumber === sessionIndex + 1 ? 'high' : 'normal');
      void ensurePageAsset(sessionIndex, 'full', { priority }).catch(() => {});
    });
  }, [
    allPages,
    allowWidePaneFullPreview,
    comparePageNumber,
    ensurePageAsset,
    isComparing,
    preferredFullPreviewIndexes,
    selectedIndexForAutoScroll,
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

  const closeContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  useEffect(() => {
    if (!contextMenuState) return undefined;

    /**
     * @param {*} event
     * @returns {void}
     */
    const handlePointerDown = (event) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(event?.target)) return;
      closeContextMenu();
    };

    /**
     * @param {KeyboardEvent} event
     * @returns {void}
     */
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

  useEffect(() => {
    if (!warmAllThumbnails || totalCount <= 0) return undefined;

    let cancelled = false;
    let timeoutId = 0;
    const currentIndex = selectedIndexForAutoScroll;
    const compareIndex = compareSelectedIndex;
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
        const sessionIndex = getSessionPageIndex(page, index);
        const isThumbnailReady = !!page && (page.thumbnailUsesFullAsset
          ? (page.fullSizeStatus === 1 && !!page.fullSizeUrl)
          : page.thumbnailStatus === 1 && !!page.thumbnailUrl);
        if (!page || page.status === -1 || page.thumbnailStatus === -1 || !page.sourceKey || isThumbnailReady) continue;
        void ensurePageAsset(sessionIndex, 'thumbnail', { priority: 'low' }).catch(() => {});
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
    compareSelectedIndex,
    ensurePageAsset,
    isComparing,
    renderConfig.maxConcurrentAssetRenders,
    selectedIndexForAutoScroll,
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
    closeContextMenu();
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
  }, [closeContextMenu, layout.rowHeight, viewportHeight]);

  /**
   * @param {number} nextPageNumber
   * @param {*} event
   * @returns {void}
   */
  const handleActivate = useCallback((nextPageNumber, event) => {
    closeContextMenu();
    try {
      const wantsCompareTarget = !!(event?.shiftKey || isShiftPressed) && typeof selectForCompare === 'function';
      if (wantsCompareTarget) {
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
  }, [closeContextMenu, isShiftPressed, selectForCompare, setPageNumber]);

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
   * @param {*} event
   * @param {number} originalPageNumber
   * @param {*} page
   * @returns {void}
   */
  const handleOpenContextMenu = useCallback((event, originalPageNumber, page) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const hasSelectionActions = !!selectionPanelEnabled
      && (typeof onHidePageFromSelection === 'function' || typeof onHideDocumentFromSelection === 'function');
    const hasCompareAction = typeof selectForCompare === 'function';
    const hasMetadataAction = typeof onOpenDocumentMetadata === 'function'
      && bundleDocumentHasMetadata(bundle, page?.documentId);
    if (!hasSelectionActions && !hasCompareAction && !hasMetadataAction) {
      closeContextMenu();
      return;
    }

    const originalIndex = getSessionPageIndex(page, Math.max(0, Number(originalPageNumber) - 1));
    const documentContext = getPageDocumentContext(page);
    setContextMenuState({
      x: Math.max(8, Number(event?.clientX) || 0),
      y: Math.max(8, Number(event?.clientY) || 0),
      originalIndex,
      documentNumber: documentContext.documentNumber,
      totalDocuments: documentContext.totalDocuments,
      documentId: String(page?.documentId || '').trim() || undefined,
    });
  }, [bundle, closeContextMenu, onHideDocumentFromSelection, onHidePageFromSelection, onOpenDocumentMetadata, selectForCompare, selectionPanelEnabled]);

  const handleCompareFromContextMenu = useCallback(() => {
    if (!contextMenuState || typeof selectForCompare !== 'function') return;
    selectForCompare(contextMenuState.originalIndex + 1);
    closeContextMenu();
  }, [closeContextMenu, contextMenuState, selectForCompare]);

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

  /**
   * @param {number} sessionIndex
   * @param {('full'|'thumbnail')} variant
   * @returns {void}
   */
  const handleImageLoad = useCallback((sessionIndex, variant) => {
    touchPageAsset(sessionIndex, variant);
  }, [touchPageAsset]);

  const rows = [];
  for (let index = 0; index < totalCount; index += 1) {
    const originalPageNumber = getSessionPageIndex(allPages[index], index) + 1;
    rows.push(
      <ThumbnailRow
        key={String(allPages[index]?.sourceKey || index)}
        page={allPages[index] || null}
        index={index}
        rowHeight={layout.rowHeight}
        imageStageHeight={layout.imageStageHeight}
        isFocusedSelected={originalPageNumber === focusedOriginalPageNumber}
        isPrimarySelected={originalPageNumber === pageNumber}
        isCompareSelected={!!isComparing && originalPageNumber === comparePageNumber}
        isCompareMode={!!isComparing}
        preferFullAssetPreview={preferredFullPreviewIndexes.has(index)}
        totalPages={totalCount}
        documentGroupingActive={documentGroupingActive}
        prevPage={index > 0 ? (allPages[index - 1] || null) : null}
        nextPage={index + 1 < totalCount ? (allPages[index + 1] || null) : null}
        onActivate={handleActivate}
        onKeyActivate={handleKeyActivate}
        onOpenContextMenu={handleOpenContextMenu}
        onImageLoad={handleImageLoad}
        fullyRenderOffscreenRows={fullyRenderOffscreenRows}
      />
    );
  }

  const canHidePageFromSelection = !!selectionPanelEnabled
    && typeof onHidePageFromSelection === 'function';
  const canHideDocumentFromSelection = !!selectionPanelEnabled
    && typeof onHideDocumentFromSelection === 'function';
  const canCompareFromContextMenu = typeof selectForCompare === 'function';
  const canOpenMetadataFromContextMenu = !!contextMenuState
    && typeof onOpenDocumentMetadata === 'function'
    && bundleDocumentHasMetadata(bundle, contextMenuState.documentId);
  const contextMenuLeft = contextMenuState
    ? Math.max(8, Math.min(contextMenuState.x, Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : contextMenuState.x + 240) - 248)))
    : 0;
  const contextMenuTop = contextMenuState
    ? Math.max(8, Math.min(contextMenuState.y, Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : contextMenuState.y + 256) - 256)))
    : 0;

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
      {showStickyDocumentHeader ? (
        <div className="thumbnail-sticky-document-header" aria-hidden="true">
          <span className="thumbnail-document-boundary-label sticky-label">
            {getDocumentBoundaryLabel(t, stickyDocumentContext)}
          </span>
        </div>
      ) : null}

      <div
        className="thumbnails-static-list"
        style={{
          position: 'relative',
          width: '100%',
          minHeight: `${Math.max(totalHeight, viewportHeight)}px`,
        }}
      >
        {rows}
        {documentGroupingActive && totalCount > 0 && !loadingRunActive ? (
          <div className="thumbnail-document-boundary end end-of-strip" aria-hidden="true">
            <span className="thumbnail-document-boundary-line" />
            <span
              className="thumbnail-document-boundary-label end-label"
              title={t('thumbnails.documentBoundaryEndTitle', { defaultValue: 'End of document bundle' })}
            >
              {t('thumbnails.documentBoundaryEndShort', { defaultValue: 'End' })}
            </span>
            <span className="thumbnail-document-boundary-line" />
          </div>
        ) : null}
      </div>

      {contextMenuState ? (
        <div
          ref={contextMenuRef}
          className="odv-context-menu"
          role="menu"
          style={{ left: `${contextMenuLeft}px`, top: `${contextMenuTop}px` }}
        >
          {canCompareFromContextMenu ? (
            <button
              type="button"
              className="odv-context-menu-item"
              role="menuitem"
              onClick={handleCompareFromContextMenu}
              title={isComparing
                ? t('thumbnails.contextMenu.showToRight', {
                    defaultValue: 'Show this page in the right compare pane',
                  })
                : t('thumbnails.contextMenu.openCompareFromThumbnail', {
                    defaultValue: 'Open compare view and show this page on the right',
                  })}
            >
              <span className="material-icons" aria-hidden="true">compare_arrows</span>
              <span>
                {t('thumbnails.contextMenu.showToRightLabel', {
                  defaultValue: 'Show to right',
                })}
              </span>
            </button>
          ) : null}
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
        </div>
      ) : null}
    </div>
  );
});

ThumbnailRow.propTypes = {
  page: PropTypes.any,
  index: PropTypes.number.isRequired,
  rowHeight: PropTypes.number.isRequired,
  imageStageHeight: PropTypes.number.isRequired,
  isFocusedSelected: PropTypes.bool.isRequired,
  isPrimarySelected: PropTypes.bool.isRequired,
  isCompareSelected: PropTypes.bool.isRequired,
  isCompareMode: PropTypes.bool.isRequired,
  preferFullAssetPreview: PropTypes.bool.isRequired,
  totalPages: PropTypes.number.isRequired,
  documentGroupingActive: PropTypes.bool.isRequired,
  prevPage: PropTypes.any,
  nextPage: PropTypes.any,
  onActivate: PropTypes.func.isRequired,
  onKeyActivate: PropTypes.func.isRequired,
  onOpenContextMenu: PropTypes.func.isRequired,
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
  navigationModifierState: PropTypes.shape({
    shift: PropTypes.bool.isRequired,
    ctrl: PropTypes.bool.isRequired,
  }).isRequired,
  selectionPanelEnabled: PropTypes.bool,
  onHidePageFromSelection: PropTypes.func,
  onHideDocumentFromSelection: PropTypes.func,
  onOpenDocumentMetadata: PropTypes.func,
};

export default DocumentThumbnailList;
