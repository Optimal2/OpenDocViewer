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
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DocumentViewerToolbar from './DocumentViewerToolbar.jsx';
import DocumentViewerThumbnails from './DocumentViewerThumbnails.jsx';
import DocumentViewerRender from './DocumentViewerRender.jsx';
import Resizer from '../Resizer.jsx';
import logger from '../../logging/systemLogger.js';
import ViewerContext from '../../contexts/viewerContext.js';
import { useDocumentViewer } from './useDocumentViewer.js';
import useNavigationModifierState from '../../hooks/useNavigationModifierState.js';
import DocumentMetadataOverlayDialog from '../DocumentMetadataOverlayDialog.jsx';
import DocumentMetadataMatrixOverlayDialog from '../DocumentMetadataMatrixOverlayDialog.jsx';
import ViewerProblemNotice from '../ViewerProblemNotice.jsx';
import { buildDocumentMetadataMatrixView, buildDocumentMetadataView } from '../../utils/documentMetadata.js';
import { getRuntimeConfig, isDocumentMetadataUiEnabled } from '../../utils/runtimeConfig.js';

const DocumentViewer = () => {
  const {
    allPages,
    bundle,
    loadingRunActive,
    documentLoadingConfig,
    memoryPressureStage,
    error,
    pageLoadState,
  } = useContext(ViewerContext);
  const { t } = useTranslation('common');
  const navigationModifierState = useNavigationModifierState();

  const {
    pageNumber,
    pageNumberDisplay,
    renderPageNumber,
    setPageNumber,
    setVisiblePageNumber,
    thumbnailSelectionPageNumber,
    compareThumbnailPageNumber,
    zoom,
    setZoom,
    isComparing,
    comparePageNumber,
    renderComparePageNumber,
    setComparePageNumber,
    setVisibleComparePageNumber,
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
    printEnabled,
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
    clearSelectionFilter,
    hidePageFromSelection,
    hideDocumentFromSelection,
  } = useDocumentViewer();

  const isDocumentLoading = useMemo(() => {
    if (loadingRunActive) return true;
    if (!pageLoadState) return false;
    if ((Number(pageLoadState.expectedPages) || 0) <= 0) return false;
    return !pageLoadState.allPagesReady;
  }, [loadingRunActive, pageLoadState]);

  const [metadataOverlayState, setMetadataOverlayState] = useState(null);
  const [isMetadataMatrixOpen, setIsMetadataMatrixOpen] = useState(false);
  const metadataUiEnabled = useMemo(() => isDocumentMetadataUiEnabled(getRuntimeConfig()), []);

  const metadataMatrixView = useMemo(
    () => (metadataUiEnabled ? buildDocumentMetadataMatrixView(bundle) : null),
    [bundle, metadataUiEnabled]
  );
  const canOpenMetadataMatrix = metadataUiEnabled
    && !!metadataMatrixView
    && Array.isArray(metadataMatrixView.columns)
    && metadataMatrixView.columns.length > 0;

  const openDocumentMetadataForOriginalIndex = useCallback((originalIndex) => {
    if (!metadataUiEnabled) return false;
    const safeOriginalIndex = Math.max(0, Math.floor(Number(originalIndex) || 0));
    const sourcePage = Array.isArray(allPages) ? (allPages[safeOriginalIndex] || null) : null;
    const documentId = String(sourcePage?.documentId || '').trim();
    if (!documentId) return false;

    const metadataView = buildDocumentMetadataView(bundle, documentId);
    if (!metadataView) return false;

    setMetadataOverlayState({
      metadataView,
      documentNumber: Math.max(0, Number(sourcePage?.documentNumber) || 0),
      totalDocuments: Math.max(0, Number(sourcePage?.totalDocuments) || 0),
    });
    return true;
  }, [allPages, bundle, metadataUiEnabled]);

  const closeMetadataOverlay = useCallback(() => {
    setMetadataOverlayState(null);
  }, []);

  const openMetadataMatrix = useCallback(() => {
    if (!canOpenMetadataMatrix) return false;
    setMetadataOverlayState(null);
    setIsMetadataMatrixOpen(true);
    return true;
  }, [canOpenMetadataMatrix]);

  const closeMetadataMatrix = useCallback(() => {
    setIsMetadataMatrixOpen(false);
  }, []);

  useEffect(() => {
    if (!canOpenMetadataMatrix) {
      setIsMetadataMatrixOpen(false);
    }
  }, [canOpenMetadataMatrix]);

  useEffect(() => {
    /** @param {*} target */
    const isEditableTarget = (target) => {
      if (!(target instanceof Element)) return false;
      if (target.isContentEditable) return true;
      return !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-odv-shortcuts="off"]');
    };

    /** @returns {boolean} */
    const hasActiveModalDialog = () => (typeof document !== 'undefined')
      && !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]');

    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (!canOpenMetadataMatrix) return;
      if (event.defaultPrevented || event.isComposing) return;
      const key = String(event.key || '').toLowerCase();
      if (key !== 'm') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (hasActiveModalDialog()) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      openMetadataMatrix();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [canOpenMetadataMatrix, openMetadataMatrix]);

  const viewerRuntimeStatus = useMemo(() => {
    if (error) {
      return {
        ledState: 'error',
        title: t('viewer.modeIndicator.error', { defaultValue: 'Viewer loading error' }),
      };
    }

    const currentStage = String(memoryPressureStage || 'normal').toLowerCase();
    if (currentStage === 'hard') {
      return {
        ledState: 'error',
        title: t('viewer.modeIndicator.hardMemory', { defaultValue: 'Hard memory protection active' }),
      };
    }

    const renderStrategy = String(documentLoadingConfig?.render?.strategy || 'eager-nearby').toLowerCase();
    const mode = String(documentLoadingConfig?.mode || 'auto').toLowerCase();
    if (currentStage !== 'normal' || mode === 'memory' || renderStrategy === 'lazy-viewport') {
      return {
        ledState: 'warning',
        title: t('viewer.modeIndicator.memory', { defaultValue: 'Memory-efficient mode active' }),
      };
    }

    return {
      ledState: 'ready',
      title: t('viewer.modeIndicator.performance', { defaultValue: 'Performance mode active' }),
    };
  }, [documentLoadingConfig?.mode, documentLoadingConfig?.render?.strategy, error, memoryPressureStage, t]);


  const hasVisiblePages = totalPages > 0;
  const hasPrintableSelection = selectionActive && visibleOriginalPageNumbers.length > 0;
  const showEmptySelectionState = selectionActive && !hasVisiblePages;

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

  const handleViewerContextMenu = useMemo(() => {
    /**
     * @param {*} target
     * @returns {boolean}
     */
    const allowNativeContextMenu = (target) => {
      if (!(target instanceof Element)) return false;
      return !!target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [data-odv-allow-native-contextmenu="true"]'
      );
    };

    /**
     * @param {*} event
     * @returns {void}
     */
    return (event) => {
      if (allowNativeContextMenu(event?.target)) return;
      event?.preventDefault?.();
    };
  }, []);

  return (
    <div
      className="document-viewer-container"
      onClick={handleContainerClick}
      onContextMenu={handleViewerContextMenu}
      role="region"
      aria-label={t('viewer.aria.containerRegion')}
    >
      <DocumentViewerToolbar
        runtimeStatusLedState={viewerRuntimeStatus.ledState}
        runtimeStatusLedTitle={viewerRuntimeStatus.title}
        memoryPressureStage={memoryPressureStage}
        pageNumber={pageNumber}
        pageNumberDisplay={pageNumberDisplay}
        setPageNumber={setPageNumber}
        setVisiblePageNumber={setVisiblePageNumber}
        setComparePageNumber={setComparePageNumber}
        setVisibleComparePageNumber={setVisibleComparePageNumber}
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
        printEnabled={printEnabled}
        hasActiveSelection={hasPrintableSelection}
        visibleOriginalPageNumbers={visibleOriginalPageNumbers}
        selectionIncludedCount={visibleOriginalPageNumbers.length}
        sessionTotalPages={totalPagesDisplay}
        bundle={bundle || null}
        allPages={allPages || []}

        isComparing={isComparing}
        handleCompare={handleCompare}
        comparePageNumber={comparePageNumber}
        comparePageNumberDisplay={renderComparePageNumber}
        primaryImageProperties={primaryImageProperties}
        compareImageProperties={compareImageProperties}
        handleRotationChange={handleRotationChange}
        handleBrightnessChange={handleBrightnessChange}
        handleContrastChange={handleContrastChange}
        resetImageProperties={resetImageProperties}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}

        documentRenderRef={documentRenderRef}
        compareRef={compareRef}
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
        navigationModifierState={navigationModifierState}
      />

      <ViewerProblemNotice
        error={error}
        pageLoadState={pageLoadState}
        loadingRunActive={loadingRunActive}
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
          navigationModifierState={navigationModifierState}
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
                clearSelectionFilter={clearSelectionFilter}
                hidePageFromSelection={hidePageFromSelection}
                hideDocumentFromSelection={hideDocumentFromSelection}
                onOpenDocumentMetadata={metadataUiEnabled ? openDocumentMetadataForOriginalIndex : undefined}
          canOpenMetadataMatrix={canOpenMetadataMatrix}
          onOpenMetadataMatrix={openMetadataMatrix}
                minWidth={thumbnailWidthMin}
                maxWidth={thumbnailWidthMax}
                defaultWidth={thumbnailWidthDefault}
                onSetMinWidth={setThumbnailPaneToMinimumWidth}
                onResetWidth={resetThumbnailPaneWidth}
                onSetMaxWidth={setThumbnailPaneToMaximumWidth}
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

        {showEmptySelectionState ? (
          <div className="viewer-empty-state" role="status" aria-live="polite">
            <div className="viewer-empty-state-card">
              <span className="material-icons viewer-empty-state-icon" aria-hidden="true">filter_alt_off</span>
              <h2>{t('viewer.selectionEmpty.title', { defaultValue: 'No pages remain in the current selection' })}</h2>
              <p>{t('viewer.selectionEmpty.description', { defaultValue: 'The active selection currently hides every page. Reset the selection filter to show the full session again, or open the selection tab to choose a new subset.' })}</p>
              <div className="viewer-empty-state-actions">
                <button
                  type="button"
                  className="viewer-empty-state-button primary"
                  onClick={clearSelectionFilter}
                >
                  {t('viewer.selectionEmpty.showAll', { defaultValue: 'Show all pages' })}
                </button>
                <button
                  type="button"
                  className="viewer-empty-state-button secondary"
                  onClick={() => setThumbnailPaneMode('selection')}
                >
                  {t('viewer.selectionEmpty.openSelection', { defaultValue: 'Open selection' })}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <DocumentViewerRender
            pageNumber={renderPageNumber}
            zoom={zoom}
            setZoom={setZoom}
            isComparing={isComparing}
            primaryImageProperties={primaryImageProperties}
            compareImageProperties={compareImageProperties}
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
            selectionPanelEnabled={selectionPanelEnabled}
            onHidePageFromSelection={hidePageFromSelection}
            onHideDocumentFromSelection={hideDocumentFromSelection}
            onOpenDocumentMetadata={metadataUiEnabled ? openDocumentMetadataForOriginalIndex : undefined}
            closeCompare={closeCompare}
          />
        )}
      </div>

      <DocumentMetadataOverlayDialog
        isOpen={metadataUiEnabled && !!metadataOverlayState}
        onClose={closeMetadataOverlay}
        metadataView={metadataOverlayState?.metadataView || null}
        documentNumber={metadataOverlayState?.documentNumber ?? null}
        totalDocuments={metadataOverlayState?.totalDocuments ?? null}
        canOpenMatrix={canOpenMetadataMatrix}
        onOpenMatrix={openMetadataMatrix}
      />

      <DocumentMetadataMatrixOverlayDialog
        isOpen={metadataUiEnabled && isMetadataMatrixOpen}
        onClose={closeMetadataMatrix}
        matrixView={metadataMatrixView}
      />
    </div>
  );
};

export default React.memo(DocumentViewer);
