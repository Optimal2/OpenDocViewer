// File: src/components/DocumentViewer/DocumentViewer.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewer.jsx
 *
 * OpenDocViewer — Document Viewer (Container)
 *
 * PURPOSE
 *   Tie together:
 *     • Toolbar (actions, zoom, adjustments)
 *     • Thumbnails (navigation)
 *     • Main renderer (canvas/img)
 *   This component wires ViewerContext state into the viewer UI and delegates
 *   heavy logic to the dedicated hook `useDocumentViewer`.
 *
 * ACCESSIBILITY
 *   - The scrollable viewer container remains focusable for scroll/assistive-tech workflows.
 *   - Viewer shortcuts are handled globally and are suspended only inside editable/form contexts
 *     or active modal dialogs.
 *
 * @returns {React.ReactElement}
 */
import React, { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DocumentViewerToolbar from './DocumentViewerToolbar.jsx';
import DocumentViewerThumbnails from './DocumentViewerThumbnails.jsx';
import DocumentViewerRender from './DocumentViewerRender.jsx';
import Resizer from '../Resizer.jsx';
import logger from '../../logging/systemLogger.js';
import ViewerContext from '../../contexts/viewerContext.js';
import { useDocumentViewer } from './useDocumentViewer.js';

const DocumentViewer = () => {
  const {
    allPages,
    loadingRunActive,
    plannedPageCount,
    documentLoadingConfig,
    memoryPressureStage,
    error,
  } = useContext(ViewerContext);
  const { t } = useTranslation('common');

  const {
    pageNumber,
    setPageNumber,
    thumbnailSelectionPageNumber,
    zoom,
    setZoom,
    isComparing,
    comparePageNumber,
    setComparePageNumber,
    isPrintDialogOpen,
    openPrintDialog,
    closePrintDialog,
    imageProperties,
    isExpanded,
    thumbnailWidth,
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
    setIsExpanded,
    // sticky fit semantics
    zoomState,
    setZoomMode,
    // per-pane post-zoom (compare mode only)
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
  } = useDocumentViewer();

  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const resolvedPageCount = useMemo(
    () => (Array.isArray(allPages)
      ? allPages.reduce((count, page) => count + (page && typeof page.status === 'number' ? 1 : 0), 0)
      : 0),
    [allPages]
  );
  const isDocumentLoading = !!loadingRunActive || (plannedPageCount > 0 && resolvedPageCount < plannedPageCount);

  const viewerModeIndicator = useMemo(() => {
    if (error) {
      return {
        className: 'is-error',
        title: t('viewer.modeIndicator.error', { defaultValue: 'Viewer loading error' }),
      };
    }

    const currentStage = String(memoryPressureStage || 'normal').toLowerCase();
    const renderStrategy = String(documentLoadingConfig?.render?.strategy || 'eager-nearby').toLowerCase();
    const mode = String(documentLoadingConfig?.mode || 'auto').toLowerCase();
    if (currentStage !== 'normal' || mode === 'memory' || renderStrategy === 'lazy-viewport') {
      return {
        className: 'is-memory',
        title: t('viewer.modeIndicator.memory', { defaultValue: 'Memory-efficient mode active' }),
      };
    }

    return {
      className: 'is-performance',
      title: t('viewer.modeIndicator.performance', { defaultValue: 'Performance mode active' }),
    };
  }, [documentLoadingConfig?.mode, documentLoadingConfig?.render?.strategy, error, memoryPressureStage, t]);

  const prevPageDisabled = pageNumber <= 1;
  const nextPageDisabled = pageNumber >= totalPages;
  const firstPageDisabled = pageNumber <= 1;
  const lastPageDisabled = pageNumber >= totalPages;

  logger.debug('Rendering DocumentViewer', { totalPages, plannedPageCount, resolvedPageCount, isDocumentLoading });

  return (
    <div
      className="document-viewer-container"
      onClick={handleContainerClick}
      role="region"
      aria-label={t('viewer.aria.containerRegion')}
    >
      <div
        className={`document-viewer-mode-indicator ${viewerModeIndicator.className}`}
        title={viewerModeIndicator.title}
        aria-hidden="true"
      />

      <DocumentViewerToolbar
        /* page + totals */
        pageNumber={pageNumber}
        setPageNumber={setPageNumber}
        setComparePageNumber={setComparePageNumber}
        totalPages={totalPages}
        isDocumentLoading={isDocumentLoading}

        /* zoom controls */
        zoom={zoom}
        setZoom={setZoom}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        actualSize={actualSize}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
        zoomState={zoomState}
        setZoomMode={setZoomMode}

        /* print */
        isPrintDialogOpen={isPrintDialogOpen}
        openPrintDialog={openPrintDialog}
        closePrintDialog={closePrintDialog}

        /* compare + editing */
        isComparing={isComparing}
        handleCompare={handleCompare}
        closeCompare={closeCompare}
        comparePageNumber={comparePageNumber}
        handleRotationChange={handleRotationChange}
        handleBrightnessChange={handleBrightnessChange}
        handleContrastChange={handleContrastChange}
        resetImageProperties={resetImageProperties}
        imageProperties={imageProperties}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}

        /* imperative + layout refs used by toolbar/print */
        documentRenderRef={documentRenderRef}
        viewerContainerRef={viewerContainerRef}

        /* nav button disabled states */
        prevPageDisabled={prevPageDisabled}
        nextPageDisabled={nextPageDisabled}
        firstPageDisabled={firstPageDisabled}
        lastPageDisabled={lastPageDisabled}
        goToPreviousPage={goToPreviousPage}
        goToNextPage={goToNextPage}
        goToFirstPage={goToFirstPage}
        goToLastPage={goToLastPage}

      />

      <div
        className="document-viewer-wrapper"
        ref={viewerContainerRef}
        id="viewerContainer"
        tabIndex={0}
        aria-label={t('viewer.aria.main')}
      >
        {thumbnailWidth > 0 ? (
          <>
            <div className="thumbnail-pane-column" style={{ width: `${thumbnailWidth}px`, minWidth: `${thumbnailWidth}px`, flexShrink: 0 }}>
              <DocumentViewerThumbnails
                allPages={allPages}
                pageNumber={thumbnailSelectionPageNumber}
                setPageNumber={handlePageNumberChange}
                thumbnailsContainerRef={thumbnailsContainerRef}
                width={thumbnailWidth}
                selectForCompare={selectForCompare}
                isComparing={isComparing}
                comparePageNumber={comparePageNumber}
                onIncreaseWidth={increaseThumbnailWidth}
                onDecreaseWidth={decreaseThumbnailWidth}
                onHide={hideThumbnailPane}
              />
            </div>
            <Resizer onMouseDown={handleMouseDown} />
          </>
        ) : (
          <div className="thumbnail-pane-collapsed-rail" aria-hidden="false">
            <button
              type="button"
              className="thumbnail-pane-collapsed-toggle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={showThumbnailPane}
              aria-label={t('thumbnails.controls.showPane', { defaultValue: 'Show thumbnails' })}
              title={t('thumbnails.controls.showPane', { defaultValue: 'Show thumbnails' })}
            >
              <span className="material-icons" aria-hidden="true">photo_library</span>
            </button>
          </div>
        )}

        <DocumentViewerRender
          pageNumber={pageNumber}
          zoom={zoom}
          setZoom={setZoom}
          isComparing={isComparing}
          imageProperties={imageProperties}
          isExpanded={isExpanded}
          documentRenderRef={documentRenderRef}
          comparePageNumber={comparePageNumber}
          compareRef={compareRef}
          allPages={allPages}
          zoomMode={zoomState?.mode}
          postZoomLeft={postZoomLeft}
          postZoomRight={postZoomRight}
          bumpPostZoomLeft={bumpPostZoomLeft}
          bumpPostZoomRight={bumpPostZoomRight}
          onPrimaryDisplayStateChange={handlePrimaryDisplayStateChange}
        />
      </div>
    </div>
  );
};

export default React.memo(DocumentViewer);
