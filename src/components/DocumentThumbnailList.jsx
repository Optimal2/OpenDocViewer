// File: src/components/DocumentThumbnailList.jsx
/**
 * OpenDocViewer — Deterministic thumbnail strip.
 *
 * The thumbnail pane always exposes a stable scrollbar whose total height depends only on the number
 * of pages. Asset generation may still be on demand, but the DOM height never changes while the user
 * scrolls.
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
import { getDocumentLoadingConfig } from '../utils/documentLoadingConfig.js';

/**
 * @typedef {Object} ThumbnailRowProps
 * @property {*} page
 * @property {number} index
 * @property {number} rowHeight
 * @property {number} imageStageHeight
 * @property {boolean} isPrimarySelected
 * @property {boolean} isCompareSelected
 * @property {boolean} isCompareMode
 * @property {function(number, *): void} onActivate
 * @property {function(*, number): void} onKeyActivate
 * @property {function(number, ('full'|'thumbnail')): void} onImageLoad
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
 * @returns {{ rowHeight:number, imageStageHeight:number }}
 */
function getThumbnailLayout(renderConfig, paneWidth) {
  const configuredMaxWidth = Math.max(80, Number(renderConfig?.thumbnailMaxWidth) || 220);
  const configuredMaxHeight = Math.max(96, Number(renderConfig?.thumbnailMaxHeight) || 310);
  const safePaneWidth = Math.max(160, Number(paneWidth) || 0);
  const stageWidth = Math.max(88, safePaneWidth - 28);
  const usableWidth = Math.min(stageWidth, Math.max(configuredMaxWidth, Math.round(stageWidth * 0.96)));
  const imageAspectRatio = configuredMaxHeight / Math.max(1, configuredMaxWidth);
  const imageStageHeight = Math.max(120, Math.round(usableWidth * imageAspectRatio));
  const rowHeight = imageStageHeight + 56;

  return {
    rowHeight,
    imageStageHeight,
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
  onActivate,
  onKeyActivate,
  onImageLoad,
}) {
  const { t } = useTranslation('common');
  const pageNumber = index + 1;
  const usesFullAsset = !!page?.thumbnailUsesFullAsset;
  const thumbnailStatus = page?.status === -1
    ? -1
    : usesFullAsset
      ? (page?.fullSizeStatus === -1 ? -1 : (page?.fullSizeStatus === 1 && page?.fullSizeUrl ? 1 : 0))
      : (typeof page?.thumbnailStatus === 'number' ? page.thumbnailStatus : 0);
  const thumbnailUrl = usesFullAsset
    ? (typeof page?.fullSizeUrl === 'string' ? page.fullSizeUrl : '')
    : (typeof page?.thumbnailUrl === 'string' ? page.thumbnailUrl : '');
  const isDualSelected = isPrimarySelected && isCompareSelected;

  const wrapperClassName = [
    'thumbnail-wrapper',
    isPrimarySelected ? 'selected-primary' : '',
    isCompareSelected ? 'selected-compare' : '',
    isDualSelected ? 'selected-dual' : '',
  ].filter(Boolean).join(' ');

  const title = isDualSelected
    ? t('thumbnails.goToPageBothPanes', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (shown in both panes)` })
    : isCompareSelected
      ? t('thumbnails.goToPageRightPane', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (right pane)` })
      : isPrimarySelected
        ? t('thumbnails.goToPageLeftPane', { page: pageNumber, defaultValue: `Go to page ${pageNumber} (left pane)` })
        : t('thumbnails.goToPage', { page: pageNumber });

  return (
    <div
      className="thumbnail-row-shell"
      style={{
        height: `${rowHeight}px`,
        contentVisibility: 'auto',
        containIntrinsicSize: `${rowHeight}px`,
      }}
    >
      <div
        id={`thumbnail-${pageNumber}`}
        className={wrapperClassName}
        onClick={(event) => onActivate(pageNumber, event)}
        onKeyDown={(event) => onKeyActivate(event, pageNumber)}
        role="option"
        tabIndex={isPrimarySelected ? 0 : -1}
        aria-label={title}
        aria-selected={isPrimarySelected}
        title={title}
      >
        <div className="thumbnail-number-bar">
          <div className="thumbnail-number">{pageNumber}</div>
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
  const { ensurePageAsset, touchPageAsset } = useContext(ViewerContext);
  const config = useMemo(() => getDocumentLoadingConfig(), []);
  const renderConfig = config.render;
  const overscan = Math.max(0, Number(renderConfig.visibleThumbnailOverscan) || 0);

  const containerRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(Math.max(160, Number(width) || 0));

  const totalCount = Array.isArray(allPages) ? allPages.length : 0;
  const layout = useMemo(
    () => getThumbnailLayout(renderConfig, containerWidth || width),
    [containerWidth, renderConfig, width]
  );
  const totalHeight = totalCount * layout.rowHeight;
  const warmAllThumbnails = useMemo(
    () => shouldWarmAllThumbnails(renderConfig, totalCount),
    [renderConfig, totalCount]
  );
  const activeDescendantId = totalCount > 0 && pageNumber >= 1 && pageNumber <= totalCount
    ? `thumbnail-${pageNumber}`
    : undefined;

  const visibleRange = useMemo(() => {
    if (totalCount <= 0) return { start: 0, end: -1 };
    const rawStart = Math.floor(scrollTop / layout.rowHeight) - overscan;
    const rawEnd = Math.ceil((scrollTop + Math.max(viewportHeight, layout.rowHeight)) / layout.rowHeight) + overscan;
    return {
      start: clamp(rawStart, 0, Math.max(0, totalCount - 1)),
      end: clamp(rawEnd, 0, Math.max(0, totalCount - 1)),
    };
  }, [layout.rowHeight, overscan, scrollTop, totalCount, viewportHeight]);

  /**
   * @param {(HTMLDivElement|null)} node
   * @returns {void}
   */
  const setContainerRef = useCallback((node) => {
    containerRef.current = node;
    thumbnailsContainerRef.current = node;
    if (node) {
      setViewportHeight(node.clientHeight || 0);
      setScrollTop(node.scrollTop || 0);
      setContainerWidth(node.clientWidth || Math.max(160, Number(width) || 0));
    }
  }, [thumbnailsContainerRef, width]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateMeasurements = () => {
      setViewportHeight(node.clientHeight || 0);
      setScrollTop(node.scrollTop || 0);
      setContainerWidth(node.clientWidth || Math.max(160, Number(width) || 0));
    };

    updateMeasurements();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateMeasurements)
      : null;
    resizeObserver?.observe(node);

    return () => {
      resizeObserver?.disconnect();
    };
  }, [width]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !totalCount) return;

    const selectedIndex = clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1));
    const rowTop = selectedIndex * layout.rowHeight;
    const rowBottom = rowTop + layout.rowHeight;
    const viewportTop = node.scrollTop || 0;
    const viewportBottom = viewportTop + (node.clientHeight || 0);

    if (rowTop < viewportTop) {
      node.scrollTop = rowTop;
    } else if (rowBottom > viewportBottom) {
      node.scrollTop = Math.max(0, rowBottom - (node.clientHeight || 0));
    }

    setScrollTop(node.scrollTop || 0);
  }, [layout.rowHeight, pageNumber, totalCount]);

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
    pushIndex(currentIndex, 'critical');
    touchPageAsset(currentIndex, allPages[currentIndex]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');

    const compareIndex = isComparing && Number.isFinite(comparePageNumber)
      ? clamp(Number(comparePageNumber) - 1, 0, Math.max(0, totalCount - 1))
      : -1;
    if (compareIndex >= 0) {
      pushIndex(compareIndex, compareIndex === currentIndex ? 'critical' : 'high');
      touchPageAsset(compareIndex, allPages[compareIndex]?.thumbnailUsesFullAsset ? 'full' : 'thumbnail');
    }

    for (let index = visibleRange.start; index <= visibleRange.end; index += 1) {
      const priority = index === currentIndex
        ? 'critical'
        : index === compareIndex
          ? 'high'
          : 'normal';
      pushIndex(index, priority);
    }

    const ahead = Math.max(0, Number(renderConfig.lookAheadPageCount) || 0);
    const behind = Math.max(0, Number(renderConfig.lookBehindPageCount) || 0);
    for (let offset = 1; offset <= ahead; offset += 1) pushIndex(currentIndex + offset, 'low');
    for (let offset = 1; offset <= behind; offset += 1) pushIndex(currentIndex - offset, 'low');
    if (compareIndex >= 0) {
      for (let offset = 1; offset <= ahead; offset += 1) pushIndex(compareIndex + offset, 'low');
      for (let offset = 1; offset <= behind; offset += 1) pushIndex(compareIndex - offset, 'low');
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
    visibleRange.end,
    visibleRange.start,
  ]);

  useEffect(() => {
    if (!warmAllThumbnails || totalCount <= 0) return undefined;

    let cancelled = false;
    let timeoutId = 0;
    const currentIndex = clamp(pageNumber - 1, 0, Math.max(0, totalCount - 1));
    const compareIndex = isComparing && Number.isFinite(comparePageNumber)
      ? clamp(Number(comparePageNumber) - 1, 0, Math.max(0, totalCount - 1))
      : -1;

    /** @type {Array<number>} */
    const queue = [];
    for (let index = 0; index < totalCount; index += 1) {
      if (index === currentIndex || index === compareIndex) continue;
      queue.push(index);
    }

    const pump = () => {
      if (cancelled) return;
      const batch = queue.splice(0, 12);
      for (const index of batch) {
        const page = allPages[index];
        const isThumbnailReady = !!page && (page.thumbnailUsesFullAsset
          ? (page.fullSizeStatus === 1 && !!page.fullSizeUrl)
          : page.thumbnailStatus === 1 && !!page.thumbnailUrl);
        if (!page || page.status === -1 || page.thumbnailStatus === -1 || !page.sourceKey || isThumbnailReady) continue;
        void ensurePageAsset(index, 'thumbnail', { priority: 'low' }).catch(() => {});
      }
      if (queue.length > 0) timeoutId = window.setTimeout(pump, 0);
    };

    timeoutId = window.setTimeout(pump, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [allPages, comparePageNumber, ensurePageAsset, isComparing, pageNumber, totalCount, warmAllThumbnails]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handleScroll = useCallback((event) => {
    const next = Number(event?.currentTarget?.scrollTop || 0);
    setScrollTop(next);
  }, []);

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
        onActivate={handleActivate}
        onKeyActivate={handleKeyActivate}
        onImageLoad={handleImageLoad}
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
  onActivate: PropTypes.func.isRequired,
  onKeyActivate: PropTypes.func.isRequired,
  onImageLoad: PropTypes.func.isRequired,
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
