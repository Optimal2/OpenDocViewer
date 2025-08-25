// File: src/components/AppBootstrap.jsx
/**
 * File: src/components/AppBootstrap.jsx
 *
 * OpenDocViewer — Application Bootstrapper
 *
 * PURPOSE
 *   Detect how the viewer should start (demo, URL params, parent page, session token, or JS API)
 *   and render <OpenDocViewer /> with the appropriate props:
 *     • Pattern mode:     { folder, extension, endNumber }
 *     • Explicit-list:    { sourceList, bundle }
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import logger from '../LogController.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import OpenDocViewer from '../OpenDocViewer.jsx';
import { bootstrapDetect, ODV_BOOTSTRAP_MODES } from '../integrations/Bootstrap.js';
import { makeExplicitSource } from './DocumentLoader/sources/ExplicitListSource.js';

/**
 * @typedef {Object} SessionShape
 * @property {string} id
 * @property {(string|undefined)} userId
 * @property {(string|undefined)} issuedAt
 */
/**
 * @typedef {Object} ExplicitItem
 * @property {string} url
 * @property {(string|undefined)} ext
 * @property {(number|undefined)} fileIndex
 */
/**
 * @typedef {Object} PortableDocumentBundle
 * @property {SessionShape} session
 * @property {Array.<*>} documents
 */
/**
 * @typedef {Object} UrlConfig
 * @property {string} folder
 * @property {string} extension
 * @property {number} endNumber
 */

const DEMO_DEFAULT = Object.freeze({ endNumber: 300 });

/**
 * Top-level bootstrapper component.
 * Detects environment, prepares props, and mounts the main viewer.
 * @returns {React.ReactElement}
 */
export default function AppBootstrap() {
  const [mode, setMode] = useState(ODV_BOOTSTRAP_MODES.DEMO);
  const [bundle, setBundle] = useState(
    /** @type {(PortableDocumentBundle|null)} */ (null)
  );
  const [urlConfig, setUrlConfig] = useState(
    /** @type {(UrlConfig|null)} */ (null)
  );
  const [demo, setDemo] = useState({ folder: '', extension: '', endNumber: DEMO_DEFAULT.endNumber });
  const [startApp, setStartApp] = useState(false);

  // Detect once on mount
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await bootstrapDetect();
        if (!mounted) return;

        setMode(res.mode);
        if (res.bundle) setBundle(res.bundle);
        if (res.urlConfig) setUrlConfig(res.urlConfig);

        // Auto-start for everything except demo (demo waits for user click)
        if (res.bundle || res.urlConfig) setStartApp(true);

        logger.info('Bootstrap detection', {
          mode: res.mode,
          hasBundle: !!res.bundle,
          hasUrlConfig: !!res.urlConfig,
        });
      } catch (error) {
        logger.error('Bootstrap detection failed', { error: String(error?.message || error) });
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Demo inputs
  const handleDemoEndChange = useCallback((e) => {
    const val = Number(e?.target?.value);
    setDemo((p) => ({ ...p, endNumber: Number.isFinite(val) ? val : DEMO_DEFAULT.endNumber }));
    logger.info('Demo endNumber changed', { value: val });
  }, []);

  const handleDemoClick = useCallback((type) => {
    setDemo((p) => ({ ...p, folder: type, extension: type }));
    setStartApp(true);
    logger.info('Demo type selected', { type });
  }, []);

  // Build explicit source list from bundle (if present)
  const sourceList = useMemo(() => {
    if (!bundle) return null;
    try {
      const src = makeExplicitSource(bundle);
      return src.items; // array of { url, ext?, fileIndex }
    } catch (error) {
      logger.error('Failed to create explicit source from bundle', { error: String(error?.message || error) });
      return null;
    }
  }, [bundle]);

  // Decide final props for <OpenDocViewer />
  const viewerProps = useMemo(() => {
    // 1) URL params → pattern mode
    if (mode === ODV_BOOTSTRAP_MODES.URL_PARAMS && urlConfig) {
      return {
        folder: urlConfig.folder,
        extension: urlConfig.extension,
        endNumber: urlConfig.endNumber,
      };
    }

    // 2) Bundle-backed modes → explicit-list mode
    if (
      (mode === ODV_BOOTSTRAP_MODES.PARENT_PAGE ||
        mode === ODV_BOOTSTRAP_MODES.SESSION_TOKEN ||
        mode === ODV_BOOTSTRAP_MODES.JS_API) &&
      Array.isArray(sourceList) &&
      sourceList.length > 0
    ) {
      return { sourceList, bundle };
    }

    // 3) Demo (after user picks a type)
    if (mode === ODV_BOOTSTRAP_MODES.DEMO && startApp) {
      return {
        folder: demo.folder,
        extension: demo.extension,
        endNumber: demo.endNumber,
      };
    }

    // No props yet → show demo launcher
    return null;
  }, [mode, urlConfig, sourceList, bundle, demo, startApp]);

  // Render the demo launcher if we don't have props to start the viewer yet
  if (!viewerProps) {
    return (
      <div className="button-container" role="region" aria-label="OpenDocViewer demo launcher">
        <label htmlFor="endNumber" style={{ marginRight: 8 }}>
          Total pages/files:
        </label>
        <input
          type="number"
          id="endNumber"
          value={demo.endNumber}
          onChange={handleDemoEndChange}
          placeholder="Enter end number"
          min="1"
          max={DEMO_DEFAULT.endNumber}
          aria-label="Total pages/files to load"
        />
        {['jpg', 'png', 'tif', 'pdf'].map((type) => (
          <button
            key={type}
            onClick={() => handleDemoClick(type)}
            type="button"
            aria-label={`Start ${type.toUpperCase()} demo`}
          >
            {type.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  // Normal path: render the viewer within an error boundary
  return (
    <ErrorBoundary>
      <OpenDocViewer {...viewerProps} />
    </ErrorBoundary>
  );
}
