// File: src/OpenDocViewer.jsx
/**
 * src/OpenDocViewer.jsx
 *
 * OpenDocViewer — Top-level Viewer Component (React)
 *
 * PURPOSE
 *   - Initialize theme and viewer providers.
 *   - Track a simple mobile-view breakpoint and pass it to the viewer shell.
 *   - Decide whether to render the PerformanceMonitor (runtime-toggleable).
 *   - Support two input styles:
 *       1) Pattern mode: { folder, extension, endNumber }
 *       2) Explicit list: { sourceList, bundle }
 *   - NEW (demo passthrough): Forward optional demo-mode props so the loader can
 *       short-circuit simple images (JPG/PNG/etc.) without workers:
 *       { demoMode, demoStrategy, demoCount, demoFormats }
 *
 * RUNTIME TOGGLES (set via public/odv.config.js, <meta>, or Vite env)
 *   - showPerfOverlay: boolean — when true OR when ?perf=1 is present, the HUD is shown.
 *   - exposeStackTraces: boolean — used elsewhere (ErrorBoundary/UI) to hide/show error stacks.
 *
 * IMPORTANT PROJECT NOTE
 *   - Elsewhere in the app we import from 'file-type' (root), NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and breaks Vite builds.
 *     See README “Design notes & gotchas” before changing this.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import logger from './LogController';
import { ThemeProvider } from './ThemeContext';
import { ViewerProvider } from './ViewerContext';
import PerformanceMonitor from './PerformanceMonitor';
import DocumentConsumerWrapper from './components/DocumentConsumerWrapper';

/**
 * Resolve a boolean flag from (precedence order):
 *   1) window.__ODV_CONFIG__[name] (runtime config, best for ops)
 *   2) import.meta.env[envVar]      (Vite env at build time)
 *   3) <meta name="{metaName}" content="true|false"> (HTML-controlled)
 *   4) fallback (default)
 *
 * @param {string} name              Key inside window.__ODV_CONFIG__
 * @param {string} envVar            Vite env key (e.g., 'VITE_SHOW_PERF_OVERLAY')
 * @param {string} metaName          Meta tag name (e.g., 'odv-show-perf-overlay')
 * @param {boolean} [fallback=false] Default value if no sources specify a value
 * @returns {boolean}
 */
function readFlag(name, envVar, metaName, fallback = false) {
  try {
    // 1) Runtime config (preferred: portable builds)
    const cfg = (typeof window !== 'undefined' && window.__ODV_CONFIG__) || undefined;
    if (cfg && typeof cfg[name] === 'boolean') return cfg[name];

    // 2) Vite env (build-time only)
    // IMPORTANT: guard with `typeof import.meta !== 'undefined'` (NOT `typeof import`)
    const envVal =
      (typeof import.meta !== 'undefined' &&
        import.meta &&
        import.meta.env &&
        import.meta.env[envVar]) ||
      '';
    if (typeof envVal === 'string') {
      const v = envVal.toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
    }

    // 3) <meta> tag in index.html
    if (typeof document !== 'undefined' && metaName) {
      const meta = document.querySelector(`meta[name="${metaName}"]`);
      const content = meta && meta.getAttribute('content');
      if (typeof content === 'string') {
        const c = content.toLowerCase();
        if (c === 'true' || c === '1') return true;
        if (c === 'false' || c === '0') return false;
      }
    }
  } catch {
    // ignore and fall through
  }
  return fallback;
}

/**
 * Item in the explicit source list mode.
 * @typedef {Object} SourceItem
 * @property {string} url
 * @property {(string|undefined)} ext
 * @property {(number|undefined)} fileIndex
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
 * @param {Object} [props.bundle]    Optional metadata object (reserved for future)
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
  // NEW: demo passthrough props
  demoMode,
  demoStrategy,
  demoCount,
  demoFormats
}) => {
  const [initialized, setInitialized] = useState(false);

  // Initial mobile-view detection (SSR-safe default)
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
  const showPerf =
    readFlag('showPerfOverlay', 'VITE_SHOW_PERF_OVERLAY', 'odv-show-perf-overlay', false) ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('perf') === '1');

  return (
    <ThemeProvider>
      <ViewerProvider>
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
        {showPerf && <PerformanceMonitor />}
      </ViewerProvider>
    </ThemeProvider>
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

  // Demo-mode passthrough (optional)
  demoMode: PropTypes.bool,
  demoStrategy: PropTypes.oneOf(['repeat', 'mix']),
  demoCount: PropTypes.number,
  demoFormats: PropTypes.arrayOf(PropTypes.string),
};

export default OpenDocViewer;
