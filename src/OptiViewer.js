/**
 * src/OptiViewer.js
 *
 * OpenDocViewer — Optimized top-level viewer component (React)
 *
 * PURPOSE
 *   - Initialize viewer context providers (Theme, Viewer) and mount the document consumer.
 *   - Handle responsive/mobile layout toggling based on a configurable breakpoint.
 *   - Expose a clean surface for both "pattern" input (folder/extension/endNumber)
 *     and "explicit list" input (sourceList/bundle).
 *   - Mount the PerformanceMonitor HUD (it renders null unless enabled in runtime config).
 *
 * IMPORTANT DESIGN NOTES (for future humans and AIs)
 *   - Performance HUD: We always mount <PerformanceMonitor/>, but it only paints when
 *     window.__ODV_CONFIG__.showPerfOverlay === true (see public/odv.config.js).
 *   - Error stacks: Whether end users see stack traces is controlled elsewhere
 *     (ErrorBoundary + runtime config: exposeStackTraces), not here.
 *   - file-type import trap: Elsewhere we import from 'file-type' (root), NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break the Vite build.
 *     See README “Design notes & gotchas” before changing this.
 *
 * Provenance for earlier baseline (traceability):
 *   :contentReference[oaicite:0]{index=0}
 */

import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import logger from './LogController';
import { ThemeProvider } from './ThemeContext';
import { ViewerProvider } from './ViewerContext';
import PerformanceMonitor from './PerformanceMonitor';
import DocumentConsumerWrapper from './components/DocumentConsumerWrapper';

/**
 * Read a stable snapshot of runtime config without exposing a mutable reference.
 * @returns {{ showPerfOverlay?: boolean, exposeStackTraces?: boolean }} config
 */
function readRuntimeConfig() {
  try {
    if (typeof window !== 'undefined' && typeof window.__ODV_GET_CONFIG__ === 'function') {
      return window.__ODV_GET_CONFIG__() || {};
    }
    if (typeof window !== 'undefined' && window.__ODV_CONFIG__) {
      return window.__ODV_CONFIG__ || {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * OptiViewer
 *
 * Top-level viewer component. Keeps responsibilities small and predictable:
 *  - Bootstraps providers
 *  - Tracks a mobile-view boolean (breakpoint-driven)
 *  - Forwards props to the document consumer wrapper
 *
 * @param {Object} props                                 Component props
 * @param {string} [props.folder]                         Pattern mode: base folder for images
 * @param {string} [props.extension]                      Pattern mode: file extension (e.g., "jpg")
 * @param {number} [props.endNumber]                      Pattern mode: number of files to load
 * @param {Array<{url:string, ext?:string, fileIndex?:number}>} [props.sourceList]
 *        Explicit list mode: ordered list of document sources
 * @param {Object} [props.bundle]                         Optional metadata object (reserved for future)
 * @param {boolean} [props.sameBlob=false]                Use the same blob URL for thumbnail & full image
 * @param {number} [props.mobileBreakpoint=600]           Width threshold for mobile layout
 * @returns {JSX.Element}
 */
const OptiViewer = ({
  folder,
  extension,
  endNumber,
  sourceList,
  bundle,
  sameBlob = false,
  mobileBreakpoint = 600,
}) => {
  const [initialized, setInitialized] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() => {
    try { return (typeof window !== 'undefined' ? window.innerWidth : 1024) < mobileBreakpoint; }
    catch { return false; }
  });

  /** Handle window resize (cheap, no debounce needed for simple threshold checks). */
  const handleResize = useCallback(() => {
    try {
      const mobile = window.innerWidth < mobileBreakpoint;
      setIsMobileView(mobile);
      logger.debug('Window resized', { width: window.innerWidth, isMobileView: mobile });
    } catch {
      /* ignore */
    }
  }, [mobileBreakpoint]);

  useEffect(() => {
    const cfg = readRuntimeConfig();
    logger.debug('OptiViewer mount', {
      mobileBreakpoint,
      initialMobile: isMobileView,
      showPerfOverlay: !!cfg.showPerfOverlay,
      exposeStackTraces: !!cfg.exposeStackTraces,
    });

    setInitialized(true);
    logger.info('OptiViewer initialized');

    // Attach listener and seed once
    try {
      window.addEventListener('resize', handleResize);
      handleResize();
    } catch {
      /* ignore */
    }

    return () => {
      try { window.removeEventListener('resize', handleResize); } catch {}
      logger.debug('OptiViewer unmount');
    };
  }, [handleResize, isMobileView, mobileBreakpoint]);

  return (
    <ThemeProvider>
      <ViewerProvider>
        <DocumentConsumerWrapper
          folder={folder}
          extension={extension}
          endNumber={endNumber}
          sourceList={Array.isArray(sourceList) ? sourceList : null}
          bundle={bundle || null}
          sameBlob={!!sameBlob}
          isMobileView={isMobileView}
          initialized={initialized}
        />
        {/* Mounted in all builds; actual visibility toggled via runtime config */}
        <PerformanceMonitor />
      </ViewerProvider>
    </ThemeProvider>
  );
};

OptiViewer.propTypes = {
  // Pattern mode (legacy/demo)
  folder: PropTypes.string,
  extension: PropTypes.string,
  endNumber: PropTypes.number,

  // Explicit-list mode (recommended)
  sourceList: PropTypes.arrayOf(
    PropTypes.shape({
      url: PropTypes.string.isRequired,
      ext: PropTypes.string,
      fileIndex: PropTypes.number,
    })
  ),
  bundle: PropTypes.object,

  // Rendering tweaks
  sameBlob: PropTypes.bool,
  mobileBreakpoint: PropTypes.number,
};

export default OptiViewer;
