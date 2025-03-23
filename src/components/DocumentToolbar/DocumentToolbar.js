// File: src/components/DocumentToolbar/DocumentToolbar.js

import React, { useContext, useRef, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import logger from '../../LogController';
import { ThemeContext } from '../../ThemeContext';
import usePageNavigation from '../../hooks/usePageNavigation';
import PageNavigationButtons from './PageNavigationButtons';
import ZoomButtons from './ZoomButtons';
import ThemeToggleButton from './ThemeToggleButton';
import { handlePrint } from '../../utils/printUtils';

const SLIDER_CENTER_RANGE = 20;

/**
 * DocumentToolbar component.
 * Provides controls for document navigation, zooming, image adjustments, and theme toggling.
 * 
 * @param {Object} props - Component props.
 * @param {Array} props.pages - Array of pages in the document.
 * @param {number} props.pageNumber - Current page number.
 * @param {number} props.totalPages - Total number of pages in the document.
 * @param {boolean} props.prevPageDisabled - Flag to disable the previous page button.
 * @param {boolean} props.nextPageDisabled - Flag to disable the next page button.
 * @param {boolean} props.firstPageDisabled - Flag to disable the first page button.
 * @param {boolean} props.lastPageDisabled - Flag to disable the last page button.
 * @param {function} props.setPageNumber - Function to set the page number.
 * @param {function} props.zoomIn - Function to zoom in.
 * @param {function} props.zoomOut - Function to zoom out.
 * @param {function} props.fitToScreen - Function to fit the document to screen.
 * @param {function} props.fitToWidth - Function to fit the document to width.
 * @param {function} props.setZoom - Function to set the zoom level.
 * @param {object} props.viewerContainerRef - Ref to the viewer container.
 * @param {function} props.handleCompare - Function to toggle compare mode.
 * @param {boolean} props.isComparing - Flag indicating if compare mode is enabled.
 * @param {Object} props.imageProperties - Object containing image properties (brightness, contrast).
 * @param {function} props.handleRotationChange - Function to handle rotation change.
 * @param {function} props.handleBrightnessChange - Function to handle brightness change.
 * @param {function} props.handleContrastChange - Function to handle contrast change.
 * @param {function} props.resetImageProperties - Function to reset image properties.
 * @param {object} props.documentRenderRef - Ref to the document render component.
 * @param {boolean} props.isExpanded - Flag indicating if the canvas tools are enabled.
 * @param {function} props.setIsExpanded - Function to set the expanded state.
 */
const DocumentToolbar = ({
  pages,
  pageNumber,
  totalPages,
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
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
}) => {
  const { toggleTheme } = useContext(ThemeContext);
  const lastPageNumberRef = useRef(null);

  useEffect(() => {
    lastPageNumberRef.current = pageNumber;
  }, [pageNumber]);

  const {
    handlePrevPageWrapper,
    handleNextPageWrapper,
    handleFirstPageWrapper,
    handleLastPageWrapper,
    startPrevPageTimer,
    stopPrevPageTimer,
    startNextPageTimer,
    stopNextPageTimer,
  } = usePageNavigation(setPageNumber, totalPages);

  const snapToZero = useMemo(() => (value) => (Math.abs(value - 100) <= SLIDER_CENTER_RANGE ? 100 : value), []);

  const handleBrightnessSliderChange = useCallback(
    (event) => {
      const value = snapToZero(parseInt(event.target.value, 10));
      handleBrightnessChange({ target: { value } });
    },
    [handleBrightnessChange, snapToZero]
  );

  const handleContrastSliderChange = useCallback(
    (event) => {
      const value = snapToZero(parseInt(event.target.value, 10));
      handleContrastChange({ target: { value } });
    },
    [handleContrastChange, snapToZero]
  );

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      resetImageProperties();
    }
    setIsExpanded((prev) => {
      if (!prev) {
        logger.info('Enabling canvas tools and forcing render');
        documentRenderRef.current?.forceRender();
      }
      return !prev;
    });
  }, [isExpanded, resetImageProperties, documentRenderRef, setIsExpanded]);

  return (
    <div className="toolbar">
      <button onClick={() => handlePrint(documentRenderRef)} aria-label="Print document" title="Print document">
        <span className="material-icons">print</span>
      </button>
      <div className="separator"></div>
      <PageNavigationButtons
        prevPageDisabled={prevPageDisabled}
        nextPageDisabled={nextPageDisabled}
        firstPageDisabled={firstPageDisabled}
        lastPageDisabled={lastPageDisabled}
        startPrevPageTimer={startPrevPageTimer}
        stopPrevPageTimer={stopPrevPageTimer}
        startNextPageTimer={startNextPageTimer}
        stopNextPageTimer={stopNextPageTimer}
        handleFirstPage={handleFirstPageWrapper}
        handleLastPage={handleLastPageWrapper}
        handlePrevPage={handlePrevPageWrapper}
        handleNextPage={handleNextPageWrapper}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
      <div className="separator"></div>
      <ZoomButtons 
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
      />
      <div className="separator"></div>
      <button 
        onClick={handleCompare} 
        aria-label="Compare document" 
        title={isComparing ? "Disable Compare Mode" : "Enable Compare Mode"} 
        className={`compare-button ${isComparing ? "compare-enabled" : "compare-disabled"}`}
      >
        <span className="material-icons">compare</span>
      </button>
      <div className="separator"></div>
      <button 
        onClick={toggleExpand} 
        aria-label={isExpanded ? "Disable canvas tools" : "Enable canvas tools"} 
        title={isExpanded ? "Disable canvas tools" : "Enable canvas tools"}
        className={`editing-button ${isExpanded ? "editing-enabled" : "editing-disabled"}`}
      >
        <span className="material-icons">edit</span>
      </button>
      {isExpanded && (
        <div className="editing-tools">
          <button onClick={() => handleRotationChange(-90)}>⟲</button>
          <button onClick={() => handleRotationChange(90)}>⟳</button>
          <label>
            Brightness:
            <input type="range" min="0" max="200" value={imageProperties.brightness} onChange={handleBrightnessSliderChange} className={imageProperties.brightness === 100 ? 'resting' : 'active'} />
          </label>
          <label>
            Contrast:
            <input type="range" min="0" max="200" value={imageProperties.contrast} onChange={handleContrastSliderChange} className={imageProperties.contrast === 100 ? 'resting' : 'active'} />
          </label>
        </div>
      )}
      <div className="separator"></div>
      <ThemeToggleButton toggleTheme={toggleTheme} />
    </div>
  );
};

DocumentToolbar.propTypes = {
  pages: PropTypes.array.isRequired,
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  zoomIn: PropTypes.func.isRequired,
  zoomOut: PropTypes.func.isRequired,
  fitToScreen: PropTypes.func.isRequired,
  fitToWidth: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  viewerContainerRef: PropTypes.object.isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  imageProperties: PropTypes.shape({
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.isRequired,
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  documentRenderRef: PropTypes.object.isRequired,
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
};

export default DocumentToolbar;
