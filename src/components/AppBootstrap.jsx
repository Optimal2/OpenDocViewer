// File: src/components/AppBootstrap.jsx

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import logger from '../LogController';
import ErrorBoundary from '../ErrorBoundary';
import OpenDocViewer from '../OpenDocViewer';
import { bootstrapDetect, ODV_BOOTSTRAP_MODES } from '../integration/Bootstrap';
import { makeExplicitSource } from './DocumentLoader/sources/ExplicitListSource';

const DEMO_DEFAULT = { endNumber: 300 };

export default function AppBootstrap() {
  const [mode, setMode] = useState(ODV_BOOTSTRAP_MODES.DEMO);
  const [bundle, setBundle] = useState(null);
  const [urlConfig, setUrlConfig] = useState(null);
  const [demo, setDemo] = useState({ folder: '', extension: '', endNumber: DEMO_DEFAULT.endNumber });
  const [startApp, setStartApp] = useState(false);

  // Detect once on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await bootstrapDetect();
      if (!mounted) return;
      setMode(res.mode);
      if (res.bundle) setBundle(res.bundle);
      if (res.urlConfig) {
        setUrlConfig(res.urlConfig);
        setStartApp(true);
      } else if (res.bundle) {
        setStartApp(true);
      } else {
        // demo mode stays idle until user clicks
      }
      logger.info('Bootstrap detection', res);
    })();
    return () => { mounted = false; };
  }, []);

  // Reuse the existing demo launcher UI when mode === DEMO
  const handleDemoEndChange = useCallback((e) => {
    const val = Number(e.target.value);
    setDemo((p) => ({ ...p, endNumber: Number.isFinite(val) ? val : DEMO_DEFAULT.endNumber }));
    logger.info('End number changed', { value: val });
  }, []);

  const handleDemoClick = useCallback((type) => {
    setDemo((p) => ({ ...p, folder: type, extension: type }));
    setStartApp(true);
    logger.info('Button clicked', { type });
  }, []);

  // Compute sourceList for explicit bundle mode
  const sourceList = useMemo(() => {
    if (!bundle) return null;
    const src = makeExplicitSource(bundle);
    return src.items; // array of { url, ext?, fileIndex }
  }, [bundle]);

  // Decide final props for OpenDocViewer
  const props = useMemo(() => {
    if (mode === ODV_BOOTSTRAP_MODES.URL_PARAMS && urlConfig) {
      return { folder: urlConfig.folder, extension: urlConfig.extension, endNumber: urlConfig.endNumber };
    }
    if ((mode === ODV_BOOTSTRAP_MODES.PARENT_PAGE || mode === ODV_BOOTSTRAP_MODES.SESSION_TOKEN || mode === ODV_BOOTSTRAP_MODES.JS_API) && sourceList?.length) {
      return { sourceList, bundle }; // <- requires tiny seam to pass through to DocumentLoader
    }
    if (mode === ODV_BOOTSTRAP_MODES.DEMO && startApp) {
      return { folder: demo.folder, extension: demo.extension, endNumber: demo.endNumber };
    }
    return null;
  }, [mode, urlConfig, sourceList, bundle, demo, startApp]);

  // Render
  if (!props) {
    // Demo chooser UI (existing behavior)
    return (
      <div className="button-container">
        <input
          type="number"
          id="endNumber"
          value={demo.endNumber}
          onChange={handleDemoEndChange}
          placeholder="Enter end number"
          min="1"
          max="300"
        />
        {['jpg', 'png', 'tif', 'pdf'].map((type) => (
          <button key={type} onClick={() => handleDemoClick(type)}>
            {type.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <OpenDocViewer {...props} />
    </ErrorBoundary>
  );
}
