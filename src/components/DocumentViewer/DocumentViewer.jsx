// File: src/components/DocumentViewer/DocumentViewer.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewer.jsx
 *
 * OpenDocViewer — Document Viewer (Container)
 *
 * PURPOSE
 *   Tie together:
 *     • Toolbar (actions, zoom, adjustments)
 *     • Thumbnails / selection pane (navigation + filtering)
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
    documentLoadingConfig,
    memoryPressureStage,
    error,
    pageLoadState,
  } = useContext(ViewerContext);
  const { t } = useTranslation('common');

  const {
    pageNumber,
    pageNumberDisplay,
    renderPageNumber,
    setPageNumber,
    thumbnailSelectionPageNumber,
    compareThumbnailPageNumber,
    zoom,
    setZoom,
    isComparing,
    comparePageNumber,
    renderComparePageNumber,
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
    handleRotationChange,
    handleBrightnessChange,
    handleContrastChange,
    resetImageProperties,
    handleMouseDown,
    selectForCompare,
    setIsExpanded,
    zoomState,
    setZoomMode,
    postZoomLeft,
    postZoomRight,
    bumpPostZoomLeft,
    bumpPostZoomRight,
    viewerPages,
    totalPages,
    totalPagesDisplay,
    visibleOriginalPageNumbers,
    documentNavigationEnabled,
    primaryDocumentNavigation,
    compareDocumentNavigation,
    selectionPanelEnabled,
    selectionDocuments,
    selectionActive,
    draftSelectionMask,
    draftSelectionDirty,
    draftIncludedCount,
    thumbnailPaneMode,
    setThumbnailPaneMode,
    toggleDraftSelectAll,
    toggleDraftDocument,
    toggleDraftPage,
    saveDraftSelection,
    cancelDraftSelection,
  } = useDocumentViewer();

  const isDocumentLoading = useMemo(() => {
    if (loadingRunActive) return true;
    if (!pageLoadState) return false;
    if ((Number(pageLoadState.expectedPages) || 0) <= 0) return false;
    return !pageLoadState.allPagesReady;
  }, [loadingRunActive, pageLoadState]);

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

  logger.debug('Rendering DocumentViewer', {
    totalSessionPages: Array.isArray(allPages) ? allPages.length : 0,
    totalVisiblePages: totalPages,
    readyPages: pageLoadState?.readyPages,
    expectedPages: pageLoadState?.expectedPages,
    isDocumentLoading,
    selectionActive,
  });

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
        pageNumber={pageNumber}
        pageNumberDisplay={pageNumberDisplay}
        setPageNumber={setPageNumber}
        setComparePageNumber={setComparePageNumber}
        totalPages={totalPages}
        totalPagesDisplay={totalPagesDisplay}
        isDocumentLoading={isDocumentLoading}

        zoom={zoom}
        setZoom={setZoom}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        actualSize={actualSize}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
        zoomState={zoomState}
        setZoomMode={setZoomMode}

        isPrintDialogOpen={isPrintDialogOpen}
        openPrintDialog={openPrintDialog}
        closePrintDialog={closePrintDialog}
        hasActiveSelection={selectionActive}
        visibleOriginalPageNumbers={visibleOriginalPageNumbers}
        selectionIncludedCount={visibleOriginalPageNumbers.length}
        sessionTotalPages={totalPagesDisplay}

        isComparing={isComparing}
        handleCompare={handleCompare}
        comparePageNumber={comparePageNumber}
        imageProperties={imageProperties}
        handleRotationChange={handleRotationChange}
        handleBrightnessChange={handleBrightnessChange}
        handleContrastChange={handleContrastChange}
        resetImageProperties={resetImageProperties}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}

        documentRenderRef={documentRenderRef}
        viewerContainerRef={viewerContainerRef}

        prevPageDisabled={prevPageDisabled}
        nextPageDisabled={nextPageDisabled}
        firstPageDisabled={firstPageDisabled}
        lastPageDisabled={lastPageDisabled}
        goToPreviousPage={goToPreviousPage}
        goToNextPage={goToNextPage}
        goToFirstPage={goToFirstPage}
        goToLastPage={goToLastPage}
        goToPreviousDocument={goToPreviousDocument}
        goToNextDocument={goToNextDocument}
        goToFirstDocument={goToFirstDocument}
        goToLastDocument={goToLastDocument}
        documentNavigationEnabled={documentNavigationEnabled}
        primaryDocumentNavigation={primaryDocumentNavigation}
        compareDocumentNavigation={compareDocumentNavigation}
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
                allPages={viewerPages}
                pageNumber={thumbnailSelectionPageNumber}
                setPageNumber={setPageNumber}
                thumbnailsContainerRef={thumbnailsContainerRef}
                width={thumbnailWidth}
                sessionTotalPages={totalPagesDisplay}
                selectForCompare={selectForCompare}
                isComparing={isComparing}
                comparePageNumber={compareThumbnailPageNumber}
                paneMode={thumbnailPaneMode}
                setPaneMode={setThumbnailPaneMode}
                selectionPanelEnabled={selectionPanelEnabled}
                pageLoadState={pageLoadState}
                selectionDocuments={selectionDocuments}
                draftSelectionMask={draftSelectionMask}
                draftSelectionDirty={draftSelectionDirty}
                selectionActive={selectionActive}
                draftIncludedCount={draftIncludedCount}
                toggleDraftSelectAll={toggleDraftSelectAll}
                toggleDraftDocument={toggleDraftDocument}
                toggleDraftPage={toggleDraftPage}
                saveDraftSelection={saveDraftSelection}
                cancelDraftSelection={cancelDraftSelection}
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
          pageNumber={renderPageNumber}
          zoom={zoom}
          setZoom={setZoom}
          isComparing={isComparing}
          imageProperties={imageProperties}
          isExpanded={isExpanded}
          documentRenderRef={documentRenderRef}
          comparePageNumber={renderComparePageNumber}
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
