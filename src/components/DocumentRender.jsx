// File: src/components/DocumentRender.jsx
/**
 * OpenDocViewer — Active page renderer.
 *
 * The old implementation waited until every page in the load run had been rasterized before it
 * displayed anything. That amplified both memory and CPU usage for large batches.
 *
 * This renderer instead requests the active page on demand, keeps the last successfully displayed
 * page visible while the next target page is loading, and optionally prefetches a few neighboring
 * pages for smoother navigation. That avoids the distracting "loading page" blink during normal
 * page-to-page navigation.
 */

import React, {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import ViewerContext from '../contexts/viewerContext.js';
import logger from '../logging/systemLogger.js';
import ImageRenderer from './ImageRenderer.jsx';
import CanvasRenderer from './CanvasRenderer.jsx';
import LoadingMessage from './LoadingMessage.jsx';
import {
  calculateFitToScreenZoom,
  calculateFitToWidthZoom,
  handleZoomIn,
  handleZoomOut,
} from '../utils/zoomUtils.js';
import { getDocumentLoadingConfig } from '../utils/documentLoadingConfig.js';

/**
 * @param {Array<any>} allPages
 * @param {number} pageNumber
 * @returns {any}
 */
function getCurrentPage(allPages, pageNumber) {
  if (!Array.isArray(allPages) || allPages.length === 0) return null;
  return allPages[Math.max(0, Number(pageNumber) - 1)] || null;
}

/**
 * @param {{ width:number, height:number }} size
 * @returns {{ width:number, height:number }}
 */
function normalizeSize(size) {
  return {
    width: Math.max(0, Number(size?.width) || 0),
    height: Math.max(0, Number(size?.height) || 0),
  };
}

/**
 * @typedef {Object} DisplayedAsset
 * @property {string} url
 * @property {number} pageIndex
 * @property {number} pageNumber
 */

/**
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.zoom
 * @param {function(): void=} props.initialRenderDone
 * @param {function(): void=} props.onRender
 * @param {{ current: HTMLElement|null }} props.viewerContainerRef
 * @param {function(number): void} props.setZoom
 * @param {boolean} props.isCompareMode
 * @param {{ rotation:number, brightness:number, contrast:number }} props.imageProperties
 * @param {boolean} props.isCanvasEnabled
 * @param {boolean=} props.forceRender
 * @param {Array<any>} props.allPages
 * @param {{ current: HTMLElement|null }=} props.thumbnailsContainerRef
 * @returns {React.ReactElement}
 */
const DocumentRender = React.forwardRef(function DocumentRender(
  {
    pageNumber,
    zoom,
    initialRenderDone = () => {},
    onRender = () => {},
    viewerContainerRef,
    setZoom,
    isCompareMode,
    imageProperties,
    isCanvasEnabled,
    forceRender,
    allPages,
    thumbnailsContainerRef,
  },
  ref
) {
  const { t } = useTranslation('common');
  const {
    ensurePageAsset,
    touchPageAsset,
    pinPageAsset,
    unpinPageAsset,
    getPrintablePageUrls,
  } = useContext(ViewerContext);

  const loadingConfig = useMemo(() => getDocumentLoadingConfig(), []);
  const currentIndex = Math.max(0, Number(pageNumber) - 1);
  const currentPage = useMemo(() => getCurrentPage(allPages, pageNumber), [allPages, pageNumber]);
  const currentSourceKey = currentPage?.sourceKey || '';
  const currentPageStatus = Number(currentPage?.status || 0);
  const currentFullStatus = Number(currentPage?.fullSizeStatus || 0);

  const canvasRef = useRef(/** @type {(HTMLCanvasElement|null)} */ (null));
  const imgRef = useRef(/** @type {(HTMLImageElement|null)} */ (null));
  const requestSeqRef = useRef(0);
  const initialRenderRef = useRef(false);
  const initialFitPendingRef = useRef(true);
  const displayedAssetRef = useRef(/** @type {DisplayedAsset} */ ({ url: '', pageIndex: -1, pageNumber: 0 }));
  const pendingAssetRef = useRef(/** @type {(DisplayedAsset|null)} */ (null));

  const [displayedAsset, setDisplayedAsset] = useState(/** @type {DisplayedAsset} */ ({
    url: '',
    pageIndex: -1,
    pageNumber: 0,
  }));
  const [pendingAsset, setPendingAsset] = useState(/** @type {(DisplayedAsset|null)} */ (null));
  const [imageRevision, setImageRevision] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    displayedAssetRef.current = displayedAsset;
  }, [displayedAsset]);

  useEffect(() => {
    pendingAssetRef.current = pendingAsset;
  }, [pendingAsset]);


  useEffect(() => {
    const pageIndex = Number(displayedAsset?.pageIndex);
    const url = String(displayedAsset?.url || '');
    if (pageIndex < 0 || !url) return undefined;

    pinPageAsset(pageIndex, 'full');
    return () => {
      unpinPageAsset(pageIndex, 'full');
    };
  }, [displayedAsset?.pageIndex, displayedAsset?.url, pinPageAsset, unpinPageAsset]);

  useEffect(() => {
    const pageIndex = Number(pendingAsset?.pageIndex);
    const url = String(pendingAsset?.url || '');
    if (pageIndex < 0 || !url) return undefined;

    pinPageAsset(pageIndex, 'full');
    return () => {
      unpinPageAsset(pageIndex, 'full');
    };
  }, [pendingAsset?.pageIndex, pendingAsset?.url, pinPageAsset, unpinPageAsset]);

  /**
   * @returns {number}
   */
  const getSidebarWidth = useCallback(() => {
    const widthPx = Number(thumbnailsContainerRef?.current?.offsetWidth || 0);
    return Math.max(0, widthPx);
  }, [thumbnailsContainerRef]);

  /**
   * @param {HTMLImageElement} image
   * @returns {void}
   */
  const drawImageOnCanvas = useCallback((image) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image) return;

    const sourceWidth = Math.max(1, Number(image.naturalWidth || currentPage?.realWidth || 0) || 1);
    const sourceHeight = Math.max(1, Number(image.naturalHeight || currentPage?.realHeight || 0) || 1);
    const rotation = Number(imageProperties?.rotation || 0) || 0;
    const brightness = Number(imageProperties?.brightness || 100) || 100;
    const contrast = Number(imageProperties?.contrast || 100) || 100;

    if (rotation === 90 || rotation === 270) {
      canvas.width = sourceHeight;
      canvas.height = sourceWidth;
    } else {
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    ctx.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
    ctx.restore();
  }, [currentPage?.realHeight, currentPage?.realWidth, imageProperties]);

  /**
   * @returns {void}
   */
  const fitToScreen = useCallback(() => {
    const image = imgRef.current;
    if (!image || !image.complete) return;
    calculateFitToScreenZoom(
      image,
      viewerContainerRef,
      setZoom,
      isCompareMode,
      { sidebarWidthPx: getSidebarWidth() }
    );
  }, [getSidebarWidth, isCompareMode, setZoom, viewerContainerRef]);

  /**
   * @returns {void}
   */
  const fitToWidth = useCallback(() => {
    const image = imgRef.current;
    if (!image || !image.complete) return;
    calculateFitToWidthZoom(
      image,
      viewerContainerRef,
      setZoom,
      isCompareMode,
      { sidebarWidthPx: getSidebarWidth() }
    );
  }, [getSidebarWidth, isCompareMode, setZoom, viewerContainerRef]);

  useEffect(() => {
    let cancelled = false;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    pinPageAsset(currentIndex, 'full');
    setAssetFailed(false);

    if (!currentPage) {
      setPendingAsset(null);
      setDisplayedAsset({ url: '', pageIndex: -1, pageNumber: 0 });
      setImageLoaded(false);
      setNaturalSize({ width: 0, height: 0 });
      return () => {
        cancelled = true;
        unpinPageAsset(currentIndex, 'full');
      };
    }

    if (currentPageStatus === -1 || currentFullStatus === -1) {
      setPendingAsset(null);
      setDisplayedAsset({ url: '', pageIndex: currentIndex, pageNumber });
      setImageLoaded(false);
      setAssetFailed(true);
      return () => {
        cancelled = true;
        unpinPageAsset(currentIndex, 'full');
      };
    }

    void ensurePageAsset(currentIndex, 'full', { priority: 'critical' })
      .then((url) => {
        if (cancelled || requestSeqRef.current !== requestId) return;
        if (!url) {
          setPendingAsset(null);
          setDisplayedAsset({ url: '', pageIndex: currentIndex, pageNumber });
          setImageLoaded(false);
          setAssetFailed(true);
          return;
        }

        touchPageAsset(currentIndex, 'full');

        const alreadyDisplayed =
          displayedAssetRef.current.url === url &&
          displayedAssetRef.current.pageIndex === currentIndex;

        if (alreadyDisplayed) {
          setPendingAsset(null);
          setImageLoaded(true);
          setAssetFailed(false);
        } else {
          setPendingAsset({ url, pageIndex: currentIndex, pageNumber });
          if (!displayedAssetRef.current.url) setImageLoaded(false);
          setAssetFailed(false);
        }

        const lookBehind = Math.max(0, Number(loadingConfig.render.lookBehindPageCount) || 0);
        const lookAhead = Math.max(0, Number(loadingConfig.render.lookAheadPageCount) || 0);
        for (let i = 1; i <= lookBehind; i += 1) {
          const idx = currentIndex - i;
          if (idx >= 0) void ensurePageAsset(idx, 'full', { priority: 'low' }).catch(() => {});
        }
        for (let i = 1; i <= lookAhead; i += 1) {
          const idx = currentIndex + i;
          if (idx < allPages.length) void ensurePageAsset(idx, 'full', { priority: 'low' }).catch(() => {});
        }
      })
      .catch((error) => {
        if (cancelled || requestSeqRef.current !== requestId) return;
        logger.error('Failed to request current page asset', {
          pageNumber,
          error: String(error?.message || error),
        });
        setPendingAsset(null);
        setDisplayedAsset({ url: '', pageIndex: currentIndex, pageNumber });
        setImageLoaded(false);
        setAssetFailed(true);
      });

    return () => {
      cancelled = true;
      requestSeqRef.current += 1;
      unpinPageAsset(currentIndex, 'full');
    };
  }, [
    allPages.length,
    currentFullStatus,
    currentIndex,
    currentPage,
    currentPageStatus,
    currentSourceKey,
    ensurePageAsset,
    loadingConfig.render.lookAheadPageCount,
    loadingConfig.render.lookBehindPageCount,
    pageNumber,
    pinPageAsset,
    touchPageAsset,
    unpinPageAsset,
  ]);

  useEffect(() => {
    if (!forceRender) return;
    if (isCanvasEnabled && imgRef.current?.complete) {
      drawImageOnCanvas(imgRef.current);
      onRender();
      return;
    }
    setImageRevision((prev) => prev + 1);
  }, [drawImageOnCanvas, forceRender, isCanvasEnabled, onRender]);

  useEffect(() => {
    if (!isCanvasEnabled || !imageLoaded || !imgRef.current?.complete) return;
    drawImageOnCanvas(imgRef.current);
    onRender();
  }, [drawImageOnCanvas, imageLoaded, imageProperties, isCanvasEnabled, onRender, displayedAsset.url]);

  /**
   * @param {HTMLImageElement} image
   * @param {{ pageIndex:number, pageNumber:number }} target
   * @returns {void}
   */
  const finalizeDisplayedAsset = useCallback((image, target) => {
    const nextSize = normalizeSize({
      width: Number(image?.naturalWidth || currentPage?.realWidth || 0),
      height: Number(image?.naturalHeight || currentPage?.realHeight || 0),
    });

    setDisplayedAsset({
      url: String(image?.currentSrc || image?.src || ''),
      pageIndex: target.pageIndex,
      pageNumber: target.pageNumber,
    });
    setPendingAsset(null);
    setNaturalSize(nextSize);
    setImageLoaded(true);
    setAssetFailed(false);
    touchPageAsset(target.pageIndex, 'full');

    if (isCanvasEnabled && image) drawImageOnCanvas(image);

    if (!initialRenderRef.current) {
      initialRenderRef.current = true;
      initialRenderDone();
    }

    onRender();

    if (initialFitPendingRef.current) {
      initialFitPendingRef.current = false;
      fitToScreen();
    }
  }, [
    currentPage?.realHeight,
    currentPage?.realWidth,
    drawImageOnCanvas,
    fitToScreen,
    initialRenderDone,
    isCanvasEnabled,
    onRender,
    touchPageAsset,
  ]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handleVisibleImageLoad = useCallback((event) => {
    const image = event?.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;

    const nextSize = normalizeSize({
      width: Number(image.naturalWidth || currentPage?.realWidth || 0),
      height: Number(image.naturalHeight || currentPage?.realHeight || 0),
    });

    setNaturalSize(nextSize);
    touchPageAsset(displayedAssetRef.current.pageIndex, 'full');

    if (isCanvasEnabled) drawImageOnCanvas(image);

    if (!initialRenderRef.current) {
      initialRenderRef.current = true;
      initialRenderDone();
    }

    onRender();

    if (initialFitPendingRef.current) {
      initialFitPendingRef.current = false;
      fitToScreen();
    }
  }, [
    currentPage?.realHeight,
    currentPage?.realWidth,
    drawImageOnCanvas,
    fitToScreen,
    initialRenderDone,
    isCanvasEnabled,
    onRender,
    touchPageAsset,
  ]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handlePendingImageLoad = useCallback((event) => {
    const image = event?.currentTarget;
    const target = pendingAssetRef.current;
    if (!(image instanceof HTMLImageElement) || !target) return;

    const imageUrl = String(image.currentSrc || image.src || '');
    if (!imageUrl || imageUrl !== String(target.url || '')) return;

    finalizeDisplayedAsset(image, target);
  }, [finalizeDisplayedAsset]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const handlePendingImageError = useCallback((event) => {
    const image = event?.currentTarget;
    const target = pendingAssetRef.current;
    const imageUrl = String(image?.currentSrc || image?.src || '');
    const targetUrl = String(target?.url || '');

    if (!target || !imageUrl || imageUrl !== targetUrl) return;

    logger.error('Pending page image failed to load', {
      pageNumber: target.pageNumber || pageNumber,
      url: imageUrl,
    });
    setPendingAsset(null);
    setDisplayedAsset({ url: '', pageIndex: currentIndex, pageNumber });
    setImageLoaded(false);
    setAssetFailed(true);
  }, [currentIndex, pageNumber]);

  /**
   * @returns {void}
   */
  const handleVisibleImageError = useCallback((event) => {
    const imageUrl = String(event?.currentTarget?.currentSrc || event?.currentTarget?.src || '');
    const activeUrl = String(displayedAssetRef.current.url || '');
    if (!imageUrl || imageUrl !== activeUrl) return;

    logger.error('Active page image failed to load', {
      pageNumber: displayedAssetRef.current.pageNumber || pageNumber,
      url: activeUrl,
    });
    setDisplayedAsset({ url: '', pageIndex: currentIndex, pageNumber });
    setImageLoaded(false);
    setAssetFailed(true);
  }, [currentIndex, pageNumber]);

  const imperativeHandle = useMemo(() => ({
    updateImageSourceAndFit() {
      if (imgRef.current?.complete) {
        if (isCanvasEnabled) drawImageOnCanvas(imgRef.current);
        fitToScreen();
      } else {
        setImageRevision((prev) => prev + 1);
      }
    },
    getActiveCanvas() {
      return isCanvasEnabled ? canvasRef.current : imgRef.current;
    },
    fitToScreen() {
      fitToScreen();
    },
    fitToWidth() {
      fitToWidth();
    },
    zoomIn() {
      handleZoomIn(setZoom);
    },
    zoomOut() {
      handleZoomOut(setZoom);
    },
    forceRender() {
      if (isCanvasEnabled && imgRef.current?.complete) {
        drawImageOnCanvas(imgRef.current);
        onRender();
      } else {
        setImageRevision((prev) => prev + 1);
      }
    },
    async getAllPrintableDataUrls() {
      return getPrintablePageUrls();
    },
    async exportAllPagesAsDataUrls() {
      return getPrintablePageUrls();
    },
  }), [
    drawImageOnCanvas,
    fitToScreen,
    fitToWidth,
    getPrintablePageUrls,
    isCanvasEnabled,
    onRender,
    setZoom,
  ]);

  useImperativeHandle(ref, () => imperativeHandle, [imperativeHandle]);

  const displayedUrl = displayedAsset.url;
  const targetPageDisplayed =
    displayedAsset.pageIndex === currentIndex &&
    !!displayedUrl &&
    imageLoaded &&
    !assetFailed;
  const showErrorState = assetFailed || currentPageStatus === -1 || currentFullStatus === -1;
  const showLoadingOverlay = !showErrorState && !targetPageDisplayed && !displayedUrl;
  const hiddenImageStyle = isCanvasEnabled
    ? {
        opacity: 0,
        pointerEvents: 'none',
      }
    : {
        visibility: 'visible',
      };

  return (
    <div className="document-render-container">
      {displayedUrl && (
        <ImageRenderer
          key={`${displayedAsset.pageIndex}:${imageRevision}:${displayedUrl}`}
          ref={imgRef}
          src={displayedUrl}
          zoom={zoom}
          pageNumber={displayedAsset.pageNumber || pageNumber}
          style={hiddenImageStyle}
          onLoad={handleVisibleImageLoad}
          onError={handleVisibleImageError}
          draggable={false}
        />
      )}

      {pendingAsset?.url && pendingAsset.url !== displayedUrl && (
        <img
          src={pendingAsset.url}
          alt=""
          aria-hidden="true"
          decoding="async"
          style={{ display: 'none' }}
          onLoad={handlePendingImageLoad}
          onError={handlePendingImageError}
        />
      )}

      {isCanvasEnabled && !!displayedUrl && !showErrorState && (
        <CanvasRenderer
          ref={canvasRef}
          naturalWidth={naturalSize.width || currentPage?.realWidth || 0}
          naturalHeight={naturalSize.height || currentPage?.realHeight || 0}
          zoom={zoom}
          pageNumber={displayedAsset.pageNumber || pageNumber}
        />
      )}

      {showErrorState && (
        <div className="document-render-status-overlay error-state">
          <LoadingMessage pageStatus={-1} className="document-render-loading-message" />
        </div>
      )}

      {!showErrorState && showLoadingOverlay && (
        <div className="document-render-status-overlay">
          <LoadingMessage
            pageStatus={0}
            className="document-render-loading-message"
            loadingText={t('viewer.loadingPagesWait')}
          />
        </div>
      )}
    </div>
  );
});

DocumentRender.displayName = 'DocumentRender';

export default DocumentRender;
