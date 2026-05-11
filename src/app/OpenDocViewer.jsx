// File: src/app/OpenDocViewer.jsx
/**
 * src/app/OpenDocViewer.jsx
 *
 * Main application shell for the viewer.
 *
 * Responsibilities:
 * - mount the viewer provider and top-level shell utilities
 * - keep a lightweight responsive/mobile flag for the shell
 * - decide whether optional diagnostics such as the performance overlay should render
 * - pass the selected startup payload into `DocumentConsumerWrapper`
 *
 * This component intentionally does not contain document-loading logic or toolbar/viewer logic.
 * Those concerns live deeper in the component tree.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import logger from '../logging/systemLogger.js';
import { ViewerProvider } from '../contexts/ViewerProvider.jsx';
import PerformanceMonitor from '../PerformanceMonitor.jsx';
import DocumentConsumerWrapper from '../components/DocumentConsumerWrapper.jsx';
import { isPerformanceOverlayEnabled } from '../utils/performanceOverlayFlag.js';

/**
 * Item in the explicit source list mode.
 * @typedef {Object} SourceItem
 * @property {string} url
 * @property {(string|undefined)} ext
 * @property {(number|undefined)} fileIndex
 */

/**
 * Diagnostics-only startup details surfaced through the performance overlay.
 *
 * @typedef {Object} BootstrapDebugInfo
 * @property {string} mode
 * @property {(string|undefined)} [hostPayloadSource]
 * @property {*=} [hostPayload]
 * @property {Object=} [filterInfo]
 */

/**
 * OpenDocViewer — Top-level component.
 *
 * @param {Object} props
 * @param {string} [props.folder]    Pattern mode: base folder path for images
 * @param {string} [props.extension] Pattern mode: file extension (e.g., "jpg")
 * @param {number} [props.endNumber] Pattern mode: number of files to load
 * @param {Array.<SourceItem>} [props.sourceList]
 *        Explicit list mode: ordered list of document sources
 * @param {Object} [props.bundle]    Optional normalized bundle with document metadata and integration hints
 * @param {BootstrapDebugInfo} [props.bootstrapDebugInfo]
 *        Diagnostics-only transport details from startup detection
 * @param {(boolean|undefined)} [props.demoMode]
 *        Demo passthrough: when true, the loader may directly insert simple images.
 * @param {"repeat"|"mix"} [props.demoStrategy]
 *        Demo passthrough (optional; defaults handled in loader)
 * @param {(number|undefined)} [props.demoCount]
 *        Demo passthrough (optional)
 * @param {Array.<string>} [props.demoFormats]
 *        Demo passthrough (optional)
 * @returns {React.ReactElement}
 */
const OpenDocViewer = ({
  folder,
  extension,
  endNumber,
  sourceList,
  bundle,
  bootstrapDebugInfo,
  // NEW: demo passthrough props
  demoMode,
  demoStrategy,
  demoCount,
  demoFormats
}) => {
  const [initialized, setInitialized] = useState(false);

  // Keep a simple shell-level breakpoint flag; renderer/layout details are handled lower down.
  const [isMobileView, setIsMobileView] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 600 : false
  );

  /**
   * rAF-throttled resize handler:
   * - Avoids re-render spam during window drags.
   * - Uses passive listener where supported.
   */
  const resizeRaf = useRef(0);
  const handleResize = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Fallback path when rAF is unavailable (very old engines)
    if (typeof window.requestAnimationFrame !== 'function') {
      const mobileView = window.innerWidth < 600;
      setIsMobileView(mobileView);
      logger.debug('Window resized', { isMobileView: mobileView });
      return;
    }

    if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
    resizeRaf.current = window.requestAnimationFrame(() => {
      const mobileView = window.innerWidth < 600;
      setIsMobileView(mobileView);
      logger.debug('Window resized', { isMobileView: mobileView });
    });
  }, []);

  useEffect(() => {
    logger.debug('Initializing OpenDocViewer');
    setInitialized(true);
    logger.info('OpenDocViewer initialization complete');

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize, { passive: true });
      // seed on mount
      handleResize();
      return () => {
        try { window.removeEventListener('resize', handleResize); } catch {}
        try { if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current); } catch {}
      };
    }
  }, [handleResize]);

  /**
   * Decide if the Performance HUD should render:
   * - Runtime flag (config/env/meta)
   * - OR explicit URL opt-in: ?perf=1 (handy during support sessions)
   */
  const showPerf = useMemo(() => isPerformanceOverlayEnabled(), []);

  return (
    <ViewerProvider bundle={bundle || null} diagnosticsEnabled={showPerf}>
      <DocumentConsumerWrapper
        folder={folder}
        extension={extension}
        endNumber={endNumber}
        sourceList={sourceList || null}  // explicit list passthrough
        bundle={bundle || null}          // optional metadata
        isMobileView={isMobileView}
        initialized={initialized}
        /* NEW: forward demo-mode props so the loader can engage demo fast-paths */
        demoMode={demoMode}
        demoStrategy={demoStrategy}
        demoCount={demoCount}
        demoFormats={demoFormats}
      />
      {/* Render HUD only when enabled (runtime-toggleable; see public/odv.config.js) */}
      {showPerf && <PerformanceMonitor bundle={bundle || null} bootstrapDebugInfo={bootstrapDebugInfo || null} />}
    </ViewerProvider>
  );
};

OpenDocViewer.propTypes = {
  // Pattern mode (legacy/demo)
  folder: PropTypes.string,
  extension: PropTypes.string,
  endNumber: PropTypes.number,

  // Explicit-list mode
  sourceList: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.string.isRequired,
      ext: PropTypes.string,
      fileIndex: PropTypes.number
    })
  ),
  bundle: PropTypes.object,
  bootstrapDebugInfo: PropTypes.shape({
    mode: PropTypes.string,
    hostPayloadSource: PropTypes.string,
    hostPayload: PropTypes.any,
    filterInfo: PropTypes.object,
  }),

  // Demo-mode passthrough (optional)
  demoMode: PropTypes.bool,
  demoStrategy: PropTypes.oneOf(['repeat', 'mix']),
  demoCount: PropTypes.number,
  demoFormats: PropTypes.arrayOf(PropTypes.string),
};

export default OpenDocViewer;
