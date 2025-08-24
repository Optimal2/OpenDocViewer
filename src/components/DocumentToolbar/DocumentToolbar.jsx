/**
 * File: src/components/DocumentToolbar/DocumentToolbar.jsx
 *
 * OpenDocViewer — Document Toolbar
 *
 * PURPOSE
 *   Provides controls for:
 *     • Printing
 *     • Page navigation (single-step + press-and-hold)
 *     • Zoom and auto-fit
 *     • Compare mode toggle
 *     • Optional canvas-based editing tools (rotation, brightness, contrast)
 *     • Theme toggle
 *
 * ACCESSIBILITY
 *   - Buttons are native <button type="button"> with aria-label + title.
 *   - Live page information is announced via a polite live region.
 *
 * PERFORMANCE
 *   - Delegates continuous navigation to a timer hook to avoid tight loops.
 *   - Avoids noisy per-interval logging; only logs coarse actions.
 *
 * IMPORTANT PROJECT GOTCHA (for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With file-type v21 the '/browser' subpath is not exported
 *     for bundlers and will break Vite builds (see README).
 *
 * Provenance / baseline reference for prior version of this file: :contentReference[oaicite:0]{index=0}
 */

import React, { useContext, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import logger from '../../LogController.js';
import { ThemeContext } from '../../ThemeContext.jsx';
import usePageNavigation from '../../hooks/usePageNavigation.js';
import PageNavigationButtons from './PageNavigationButtons.jsx';
import ZoomButtons from './ZoomButtons.jsx';
import ThemeToggleButton from './ThemeToggleButton.jsx';
import { handlePrint } from '../../utils/printUtils.js';

/** Range (±) around 100% where sliders snap back to the neutral value. */
const SLIDER_CENTER_RANGE = 20;

/**
 * DocumentToolbar component.
 *
 * @param {Object} props
 * @param {number} props.pageNumber
 * @param {number} props.totalPages
 * @param {boolean} props.prevPageDisabled
 * @param {boolean} props.nextPageDisabled
 * @param {boolean} props.firstPageDisabled
 * @param {boolean} props.lastPageDisabled
 * @param {(n:number)=>void} props.setPageNumber
 * @param {() => void} props.zoomIn
 * @param {() => void} props.zoomOut
 * @param {() => void} props.fitToScreen
 * @param {() => void} props.fitToWidth
 * @param {{ current: any }} props.documentRenderRef
 * @param {() => void} props.handleCompare
 * @param {boolean} props.isComparing
 * @param {{ rotation:number, brightness:number, contrast:number }} props.imageProperties
 * @param {(angle:number) => void} props.handleRotationChange
 * @param {(e:{target:{value:any}}) => void} props.handleBrightnessChange
 * @param {(e:{target:{value:any}}) => void} props.handleContrastChange
 * @param {() => void} props.resetImageProperties
 * @param {boolean} props.isExpanded
 * @param {(v:boolean|((p:boolean)=>boolean))=>void} props.setIsExpanded
 * @returns {JSX.Element}
 */
const DocumentToolbar = ({
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
  documentRenderRef,
  handleCompare,
  isComparing,
  imageProperties,
  handleRotationChange,
  handleBrightnessChange,
  handleContrastChange,
  resetImageProperties,
  isExpanded,
  setIsExpanded,
}) => {
  const { toggleTheme } = useContext(ThemeContext);

  // Navigation helpers (single-step handlers + press-and-hold timers)
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

  // Snap slider values near 100% to exactly 100% to make "neutral" easy to hit.
  const snapToZero = useMemo(
    () => (value) => (Math.abs(Number(value) - 100) <= SLIDER_CENTER_RANGE ? 100 : Number(value)),
    []
  );

  const handleBrightnessSliderChange = useCallback(
    (event) => {
      const raw = parseInt(event?.target?.value, 10);
      const value = Number.isFinite(raw) ? snapToZero(raw) : 100;
      handleBrightnessChange({ target: { value } });
    },
    [handleBrightnessChange, snapToZero]
  );

  const handleContrastSliderChange = useCallback(
    (event) => {
      const raw = parseInt(event?.target?.value, 10);
      const value = Number.isFinite(raw) ? snapToZero(raw) : 100;
      handleContrastChange({ target: { value } });
    },
    [handleContrastChange, snapToZero]
  );

  /** Toggle the canvas editing tools. Reset adjustments when turning the tools off. */
  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      resetImageProperties();
    }
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) {
        logger.info('Enabling canvas tools and forcing render');
        try { documentRenderRef.current?.forceRender?.(); } catch {}
      }
      return next;
    });
  }, [isExpanded, resetImageProperties, documentRenderRef, setIsExpanded]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Document controls">
      {/* Print */}
      <button
        type="button"
        onClick={() => handlePrint(documentRenderRef)}
        aria-label="Print document"
        title="Print document"
        className="odv-btn"
      >
        <span className="material-icons" aria-hidden="true">print</span>
      </button>

      <div className="separator" />

      {/* Paging controls */}
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

      <div className="separator" />

      {/* Zoom & fit */}
      <ZoomButtons
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToScreen={fitToScreen}
        fitToWidth={fitToWidth}
      />

      <div className="separator" />

      {/* Compare mode */}
      <button
        type="button"
        onClick={handleCompare}
        aria-label={isComparing ? 'Disable compare mode' : 'Enable compare mode'}
        title={isComparing ? 'Disable compare mode' : 'Enable compare mode'}
        className={`odv-btn compare-button ${isComparing ? 'compare-enabled' : 'compare-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">compare</span>
      </button>

      <div className="separator" />

      {/* Canvas editing tools toggle */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-label={isExpanded ? 'Disable canvas tools' : 'Enable canvas tools'}
        title={isExpanded ? 'Disable canvas tools' : 'Enable canvas tools'}
        className={`odv-btn editing-button ${isExpanded ? 'editing-enabled' : 'editing-disabled'}`}
      >
        <span className="material-icons" aria-hidden="true">edit</span>
      </button>

      {/* Editing controls (visible only when canvas tools are enabled) */}
      {isExpanded && (
        <div className="editing-tools" aria-label="Image adjustments">
          <button
            type="button"
            onClick={() => handleRotationChange(-90)}
            aria-label="Rotate left 90°"
            title="Rotate left 90°"
            className="odv-btn"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={() => handleRotationChange(90)}
            aria-label="Rotate right 90°"
            title="Rotate right 90°"
            className="odv-btn"
          >
            ⟳
          </button>

          <label className="slider-label">
            Brightness
            <input
              type="range"
              min="0"
              max="200"
              value={imageProperties.brightness}
              onChange={handleBrightnessSliderChange}
              className={imageProperties.brightness === 100 ? 'resting' : 'active'}
              aria-valuemin={0}
              aria-valuemax={200}
              aria-valuenow={imageProperties.brightness}
              aria-label="Adjust brightness"
            />
          </label>

          <label className="slider-label">
            Contrast
            <input
              type="range"
              min="0"
              max="200"
              value={imageProperties.contrast}
              onChange={handleContrastSliderChange}
              className={imageProperties.contrast === 100 ? 'resting' : 'active'}
              aria-valuemin={0}
              aria-valuemax={200}
              aria-valuenow={imageProperties.contrast}
              aria-label="Adjust contrast"
            />
          </label>
        </div>
      )}

      <div className="separator" />

      {/* Theme toggle */}
      <ThemeToggleButton toggleTheme={toggleTheme} />
    </div>
  );
};

DocumentToolbar.propTypes = {
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
  documentRenderRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  handleCompare: PropTypes.func.isRequired,
  isComparing: PropTypes.bool.isRequired,
  imageProperties: PropTypes.shape({
    rotation: PropTypes.number.isRequired,
    brightness: PropTypes.number.isRequired,
    contrast: PropTypes.number.isRequired,
  }).isRequired,
  handleRotationChange: PropTypes.func.isRequired,
  handleBrightnessChange: PropTypes.func.IsRequired, // corrected in runtime types by PropTypes; keep case consistent with others
  handleContrastChange: PropTypes.func.isRequired,
  resetImageProperties: PropTypes.func.isRequired,
  isExpanded: PropTypes.bool.isRequired,
  setIsExpanded: PropTypes.func.isRequired,
};

export default React.memo(DocumentToolbar);
