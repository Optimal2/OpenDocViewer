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

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import DocumentRender from '../DocumentRender.jsx';
import CompareZoomOverlay from './CompareZoomOverlay.jsx';

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
}) => {
  const primaryCanvasEnabled = Number(primaryImageProperties?.rotation || 0) !== 0
    || Number(primaryImageProperties?.brightness || 100) !== 100
    || Number(primaryImageProperties?.contrast || 100) !== 100;
  const compareCanvasEnabled = Number(compareImageProperties?.rotation || 0) !== 0
    || Number(compareImageProperties?.brightness || 100) !== 100
    || Number(compareImageProperties?.contrast || 100) !== 100;

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

  // Apply per-pane post-zoom only while comparing; single-pane stays at base zoom
  const effectiveLeftZoom = isComparing ? zoom * postZoomLeft : zoom;
  const effectiveRightZoom = isComparing ? zoom * postZoomRight : zoom;

  return (
    <div className="viewer-section" style={{ display: 'flex', padding: '15px' }}>
      {/* LEFT / PRIMARY PANE */}
      <div
        className={isComparing ? 'document-render-container-comparison' : 'document-render-container-single'}
        style={{ position: 'relative' }}
      >
        <div className={`document-pane-frame ${isComparing ? 'is-primary-pane' : 'is-single-pane'}`}>
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
          <div className="document-pane-frame is-compare-pane">
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
};

export default React.memo(DocumentViewerRender);
