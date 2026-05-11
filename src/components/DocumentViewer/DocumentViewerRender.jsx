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
 *   - Base zoom remains global/shared. In compare mode we now apply a *post-zoom*
 *     multiplicative factor per pane to fine-tune each side independently:
 *       effectiveLeft  = zoom * postZoomLeft
 *       effectiveRight = zoom * postZoomRight
 *   - Sticky fit modes are still honored after each pane renders.
 *   - Per-pane floating zoom controls are rendered above the pane viewport so the
 *     scrollable document surface never overlaps the controls.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import DocumentRender from '../DocumentRender.jsx';
import CompareZoomOverlay from './CompareZoomOverlay.jsx';
import ViewerContext from '../../contexts/viewerContext.js';
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

/**
 * DocumentViewerRender
 * Renders the main document pane and, if enabled, a comparison pane.
 *
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.zoom
 * @param {SetNumberState} props.setZoom
 * @param {boolean} props.isComparing
 * @param {{ rotation:number, brightness:number, contrast:number }} props.primaryImageProperties
 * @param {{ rotation:number, brightness:number, contrast:number }} props.compareImageProperties
 * @param {RefLike} props.documentRenderRef
 * @param {(number|null)} props.comparePageNumber
 * @param {RefLike} props.compareRef
 * @param {Array} props.allPages
 * @param {'FIT_PAGE'|'FIT_WIDTH'|'ACTUAL_SIZE'|'CUSTOM'} [props.zoomMode='CUSTOM']
 * @param {number} props.postZoomLeft
 * @param {number} props.postZoomRight
 * @param {function(number): void} props.bumpPostZoomLeft
 * @param {function(number): void} props.bumpPostZoomRight
 * @param {function(Object): void=} props.onPrimaryDisplayStateChange
 * @param {boolean=} props.selectionPanelEnabled
 * @param {function(number): boolean=} props.onHidePageFromSelection
 * @param {function(number): boolean=} props.onHideDocumentFromSelection
 * @param {function(number): boolean=} [props.onOpenDocumentMetadata]
 * @param {function(): void=} props.closeCompare
 * @returns {React.ReactElement}
 */
const DocumentViewerRender = ({
  pageNumber,
  zoom,
  setZoom,
  isComparing,
  primaryImageProperties,
  compareImageProperties,
  documentRenderRef,
  comparePageNumber,
  compareRef,
  allPages,
  zoomMode = 'CUSTOM',
  postZoomLeft = 1.0,
  postZoomRight = 1.0,
  bumpPostZoomLeft,
  bumpPostZoomRight,
  onPrimaryDisplayStateChange,
  selectionPanelEnabled = false,
  onHidePageFromSelection,
  onHideDocumentFromSelection,
  onOpenDocumentMetadata,
  closeCompare,
}) => {
  const { t } = useTranslation('common');
  const { bundle } = useContext(ViewerContext);
  const contextMenuRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const [contextMenuState, setContextMenuState] = useState(
    /** @type {(ViewerContextMenuState|null)} */ (null)
  );

  const primaryCanvasEnabled = Number(primaryImageProperties?.rotation || 0) !== 0
    || Number(primaryImageProperties?.brightness ?? 100) !== 100
    || Number(primaryImageProperties?.contrast ?? 100) !== 100;
  const compareCanvasEnabled = Number(compareImageProperties?.rotation || 0) !== 0
    || Number(compareImageProperties?.brightness ?? 100) !== 100
    || Number(compareImageProperties?.contrast ?? 100) !== 100;

  const handlePrimaryRendered = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') {
      documentRenderRef?.current?.fitToScreen?.();
    } else if (zoomMode === 'FIT_WIDTH') {
      documentRenderRef?.current?.fitToWidth?.();
    }
  }, [documentRenderRef, zoomMode]);

  const handleCompareRendered = useCallback(() => {
    if (zoomMode === 'FIT_PAGE') {
      compareRef?.current?.fitToScreen?.();
    } else if (zoomMode === 'FIT_WIDTH') {
      compareRef?.current?.fitToWidth?.();
    }
  }, [compareRef, zoomMode]);

  const closeContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

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

  // Apply per-pane post-zoom only while comparing; single-pane stays at base zoom
  const effectiveLeftZoom = isComparing ? zoom * postZoomLeft : zoom;
  const effectiveRightZoom = isComparing ? zoom * postZoomRight : zoom;
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

  return (
    <>
      <div className="viewer-section" style={{ display: 'flex', padding: '15px' }}>
        {/* LEFT / PRIMARY PANE */}
        <div
          className={isComparing ? 'document-render-container-comparison' : 'document-render-container-single'}
          style={{ position: 'relative' }}
        >
          <div
            className={`document-pane-frame ${isComparing ? 'is-primary-pane' : 'is-single-pane'}`}
            onContextMenu={(event) => handlePaneContextMenu(event, pageNumber, 'primary')}
          >
            {isComparing && (
              <div className="compare-zoom-sticky">
                <CompareZoomOverlay
                  value={postZoomLeft}
                  onInc={() => bumpPostZoomLeft?.(1)}
                  onDec={() => bumpPostZoomLeft?.(-1)}
                />
              </div>
            )}

            <DocumentRender
              ref={documentRenderRef}
              pageNumber={pageNumber}
              zoom={effectiveLeftZoom}
              initialRenderDone={() => {}}
              onRender={handlePrimaryRendered}
              setZoom={setZoom}
              imageProperties={primaryImageProperties}
              isCanvasEnabled={primaryCanvasEnabled}
              allPages={allPages}
              onDisplayStateChange={onPrimaryDisplayStateChange}
            />
          </div>
        </div>

        {/* RIGHT / COMPARE PANE */}
        {isComparing && comparePageNumber !== null && (
          <div className="document-render-container-comparison" style={{ position: 'relative' }}>
            <div
              className="document-pane-frame is-compare-pane"
              onContextMenu={(event) => handlePaneContextMenu(event, comparePageNumber, 'compare')}
            >
              <div className="compare-zoom-sticky">
                <CompareZoomOverlay
                  value={postZoomRight}
                  onInc={() => bumpPostZoomRight?.(1)}
                  onDec={() => bumpPostZoomRight?.(-1)}
                />
              </div>

              <DocumentRender
                ref={compareRef}
                pageNumber={comparePageNumber}
                zoom={effectiveRightZoom}
                initialRenderDone={() => {}}
                onRender={handleCompareRendered}
                setZoom={setZoom}
                imageProperties={compareImageProperties}
                isCanvasEnabled={compareCanvasEnabled}
                allPages={allPages}
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
  primaryImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  compareImageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  comparePageNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  compareRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  allPages: PropTypes.array.isRequired,
  zoomMode: PropTypes.oneOf(['FIT_PAGE', 'FIT_WIDTH', 'ACTUAL_SIZE', 'CUSTOM']),
  postZoomLeft: PropTypes.number.isRequired,
  postZoomRight: PropTypes.number.isRequired,
  bumpPostZoomLeft: PropTypes.func.isRequired,
  bumpPostZoomRight: PropTypes.func.isRequired,
  onPrimaryDisplayStateChange: PropTypes.func,
  selectionPanelEnabled: PropTypes.bool,
  onHidePageFromSelection: PropTypes.func,
  onHideDocumentFromSelection: PropTypes.func,
  onOpenDocumentMetadata: PropTypes.func,
  closeCompare: PropTypes.func,
};

export default React.memo(DocumentViewerRender);
