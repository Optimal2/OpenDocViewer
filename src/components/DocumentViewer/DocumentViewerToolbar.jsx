// File: src/components/DocumentViewer/DocumentViewerToolbar.jsx
/**
 * File: src/components/DocumentViewer/DocumentViewerToolbar.jsx
 *
 * OpenDocViewer — Document Viewer Toolbar (Wrapper)
 *
 * PURPOSE
 *   Thin wrapper that wires the viewer-specific state/handlers to the generic
 *   <DocumentToolbar /> component. Keeping this layer separate lets us evolve
 *   the toolbar UI without touching the parent viewer container.
 *
 * ACCESSIBILITY
 *   - All ARIA semantics are implemented inside <DocumentToolbar />.
 *
 * IMPORTANT PROJECT NOTE (gotcha for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *
 * Provenance / baseline reference for this file: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';
import DocumentToolbar from '../DocumentToolbar/DocumentToolbar.jsx';

/**
 * Image adjustments passed to the toolbar.
 * @typedef {Object} ImageAdjustments
 * @property {number} rotation
 * @property {number} brightness
 * @property {number} contrast
 */

/**
 * Props for DocumentViewerToolbar.
 * (Function types use Closure-style `function(...)` notation or project-wide callbacks.)
 * @typedef {Object} DocumentViewerToolbarProps
 * @property {Array} pages
 * @property {number} pageNumber
 * @property {number} totalPages
 * @property {SetPageNumber} setPageNumber
 * @property {function(): void} zoomIn
 * @property {function(): void} zoomOut
 * @property {function(): void} fitToScreen
 * @property {function(): void} fitToWidth
 * @property {SetNumberState} setZoom
 * @property {RefLike} viewerContainerRef
 * @property {function(): void} handleCompare
 * @property {boolean} isComparing
 * @property {ImageAdjustments} imageProperties
 * @property {function(number): void} handleRotationChange
 * @property {function(*): void} handleBrightnessChange
 * @property {function(*): void} handleContrastChange
 * @property {function(): void} resetImageProperties
 * @property {RefLike} documentRenderRef
 * @property {boolean} isExpanded
 * @property {SetBooleanState} setIsExpanded
 * @property {boolean} prevPageDisabled
 * @property {boolean} nextPageDisabled
 * @property {boolean} firstPageDisabled
 * @property {boolean} lastPageDisabled
 */

/**
 * Renders the toolbar for the document viewer by delegating to <DocumentToolbar />.
 * @param {DocumentViewerToolbarProps} props
 * @returns {JSX.Element}
 */
const DocumentViewerToolbar = ({
  pages,
  pageNumber,
  totalPages,
  setPageNumber,
  zoomIn,
  zoomOut,
  fitToScreen,
  fitToWidth,
  setZoom,
  viewerContainerRef,
  handleCompare,
  isComparing,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  documentRenderRef,
  isExpanded,
  setIsExpanded,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
}) => {
  return (
    <DocumentToolbar
      pages={pages}
      pageNumber={pageNumber}
      totalPages={totalPages}
      setPageNumber={setPageNumber}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToScreen={fitToScreen}
      fitToWidth={fitToWidth}
      setZoom={setZoom}
      viewerContainerRef={viewerContainerRef}
      handleCompare={handleCompare}
      isComparing={isComparing}
      imageProperties={imageProperties}
      handleRotationChange={handleRotationChange}
      handleBrightnessChange={handleBrightnessChange}
      handleContrastChange={handleContrastChange}
      resetImageProperties={resetImageProperties}
      documentRenderRef={documentRenderRef}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      prevPageDisabled={prevPageDisabled}
      nextPageDisabled={nextPageDisabled}
      firstPageDisabled={firstPageDisabled}
      lastPageDisabled={lastPageDisabled}
    />
  );
};

DocumentViewerToolbar.propTypes = {
  pages: PropTypes.array.isRequired,
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  viewerContainerRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  imageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.isRequired,
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
};

export default React.memo(DocumentViewerToolbar);
