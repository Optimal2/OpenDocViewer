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
 * Renders the toolbar for the document viewer by delegating to <DocumentToolbar />.
 *
 * @param {Object} props
 * @param {Array} props.pages                          List of all page entries (for totals, etc.)
 * @param {number} props.pageNumber                    Current 1-based page number
 * @param {number} props.totalPages                    Total number of pages
 * @param {(n: number) => void} props.setPageNumber    Setter for current page number
 * @param {() => void} props.zoomIn                    Increase zoom (clamped in callee)
 * @param {() => void} props.zoomOut                   Decrease zoom (clamped in callee)
 * @param {() => void} props.fitToScreen               Fit page to available screen
 * @param {() => void} props.fitToWidth                Fit page width to container width
 * @param {(z: number|((prev:number)=>number)) => void} props.setZoom  Raw zoom setter (rarely used directly)
 * @param {{ current: HTMLElement|null }} props.viewerContainerRef   Ref to the main viewer container
 * @param {() => void} props.handleCompare             Toggle compare mode
 * @param {boolean} props.isComparing                  Whether compare mode is active
 * @param {{ rotation:number, brightness:number, contrast:number }} props.imageProperties  Current image adjustments
 * @param {(angle:number) => void} props.handleRotationChange        Adjust rotation (degrees)
 * @param {(e:any) => void} props.handleBrightnessChange             Adjust brightness (%)
 * @param {(e:any) => void} props.handleContrastChange               Adjust contrast (%)
 * @param {() => void} props.resetImageProperties       Reset all image adjustments
 * @param {{ current: any }} props.documentRenderRef    Imperative handle to the page renderer
 * @param {boolean} props.isExpanded                    Whether viewer is expanded (sidebar collapsed)
 * @param {(v:boolean|((p:boolean)=>boolean))=>void} props.setIsExpanded  Toggle expanded state
 * @param {boolean} props.prevPageDisabled              Disable "previous page" action
 * @param {boolean} props.nextPageDisabled              Disable "next page" action
 * @param {boolean} props.firstPageDisabled             Disable "first page" action
 * @param {boolean} props.lastPageDisabled              Disable "last page" action
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
