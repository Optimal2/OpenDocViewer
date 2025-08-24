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
 *   - When compare mode is enabled, both panes receive the same zoom value for a
 *     side-by-side, synchronized experience. If you later want independent zoom,
 *     split the zoom state in the viewer and pass separate values down.
 *   - Project-wide reminder: when type-sniffing elsewhere we import from the **root**
 *     'file-type' package, NOT 'file-type/browser' (file-type v21 does not export that
 *     subpath for bundlers and builds will fail if changed). See README for details.
 *
 * Provenance / baseline reference for prior content: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';
import DocumentRender from '../DocumentRender.jsx';

/**
 * DocumentViewerRender
 * Renders the main document pane and, if enabled, a comparison pane.
 *
 * @param {Object} props
 * @param {number} props.pageNumber                            Current (1-based) page for the primary pane
 * @param {number} props.zoom                                  Current zoom factor (shared across panes)
 * @param {{ current: HTMLElement|null }} props.viewerContainerRef  Ref to the scrollable viewer container
 * @param {(z:number|((prev:number)=>number))=>void} props.setZoom  Zoom setter
 * @param {(n:number|((prev:number)=>number))=>void} props.setPageNumber Page setter
 * @param {boolean} props.isComparing                          Whether compare mode is active
 * @param {{ rotation:number, brightness:number, contrast:number }} props.imageProperties Image adjustments
 * @param {boolean} props.isExpanded                           Whether to render via <canvas> (true) or <img> (false)
 * @param {{ current: any }} props.documentRenderRef           Imperative ref for the primary <DocumentRender />
 * @param {number|null} props.comparePageNumber                Page number for the comparison pane, when enabled
 * @param {{ current: any }} props.compareRef                  Imperative ref for the comparison <DocumentRender />
 * @param {Array} props.allPages                               Full page list (shared by panes)
 * @param {{ current: HTMLElement|null }} props.thumbnailsContainerRef Ref to thumbnails container (for scroll sync)
 * @returns {JSX.Element}
 */
const DocumentViewerRender = ({
  pageNumber,
  zoom,
  viewerContainerRef,
  setZoom,
  setPageNumber,
  isComparing,
  imageProperties,
  isExpanded,
  documentRenderRef,
  comparePageNumber,
  compareRef,
  allPages,
  thumbnailsContainerRef,
}) => {
  return (
    <div className="viewer-section" style={{ display: 'flex', padding: '15px' }}>
      <div className={isComparing ? 'document-render-container-comparison' : 'document-render-container-single'}>
        <DocumentRender
          ref={documentRenderRef}
          pageNumber={pageNumber}
          zoom={zoom}
          initialRenderDone={() => {}}
          onRender={() => {}}
          viewerContainerRef={viewerContainerRef}
          setZoom={setZoom}
          setPageNumber={setPageNumber}
          isCompareMode={isComparing}
          imageProperties={imageProperties}
          isCanvasEnabled={isExpanded}
          allPages={allPages}
          thumbnailsContainerRef={thumbnailsContainerRef}
        />
      </div>

      {isComparing && comparePageNumber !== null && (
        <div className="document-render-container-comparison">
          <DocumentRender
            ref={compareRef}
            pageNumber={comparePageNumber}
            zoom={zoom}
            initialRenderDone={() => {}}
            onRender={() => {}}
            viewerContainerRef={viewerContainerRef}
            setZoom={setZoom}
            setPageNumber={setPageNumber}
            isCompareMode={true}
            imageProperties={imageProperties}
            isCanvasEnabled={isExpanded}
            allPages={allPages}
            thumbnailsContainerRef={thumbnailsContainerRef}
          />
        </div>
      )}
    </div>
  );
};

DocumentViewerRender.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  viewerContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  setZoom: PropTypes.func.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  imageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  isExpanded: PropTypes.bool.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  comparePageNumber: PropTypes.number,
  compareRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  allPages: PropTypes.array.isRequired,
  thumbnailsContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};

export default React.memo(DocumentViewerRender);
