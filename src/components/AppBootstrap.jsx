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
 *     • Demo (new logic): build an explicit sourceList from /public sample files.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n.js'; // initialize i18n before any components render
import logger from '../LogController.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import OpenDocViewer from '../OpenDocViewer.jsx';
import { bootstrapDetect, ODV_BOOTSTRAP_MODES } from '../integrations/Bootstrap.js';
import { makeExplicitSource } from './DocumentLoader/sources/ExplicitListSource.js';

/**
 * Session metadata for a bundle.
 * @typedef {Object} SessionShape
 * @property {string} id
 * @property {string} [userId]
 * @property {string} [issuedAt]
 */

/**
 * Explicit item (URL list).
 * @typedef {Object} ExplicitItem
 * @property {string} url
 * @property {string} [ext]
 * @property {number} [fileIndex]
 */

/**
 * Portable document bundle shape.
 * @typedef {Object} PortableDocumentBundle
 * @property {SessionShape} session
 * @property {Array.<*>} documents
 */

/**
 * URL parameter config (pattern mode).
 * @typedef {Object} UrlConfig
 * @property {string} folder
 * @property {string} extension
 * @property {number} endNumber
 */

/**
 * Options for building a demo source list.
 * @typedef {Object} DemoBuildOptions
 * @property {number} count
 * @property {'repeat'|'mix'} strategy
 * @property {Array.<string>} formats
 */

/**
 * One entry in the demo source list.
 * @typedef {Object} DemoSourceItem
 * @property {string} url
 * @property {string} ext
 * @property {number} fileIndex
 */

const DEMO_MAX = 300;

/**
 * Build a demo source list from the /public sample files.
 * Use Vite's BASE_URL so paths work under any mount point.
 *
 * @param {DemoBuildOptions} opts
 * @returns {Array.<DemoSourceItem>}
 */
function buildDemoSourceList({ count, strategy, formats }) {
  if (!Array.isArray(formats) || formats.length === 0) formats = ['jpg'];
  const base = (import.meta?.env?.BASE_URL || '/').replace(/\/+$/, '/'); // ensure trailing slash
  /** @type {Array.<DemoSourceItem>} */
  const out = [];
  const n = Math.max(0, Number(count) | 0);
  for (let i = 0; i < n; i++) {
    const fmt = (strategy === 'mix') ? formats[i % formats.length] : formats[0];
    out.push({ url: `${base}sample.${fmt}`, ext: fmt, fileIndex: i });
  }
  logger.info('Demo sourceList built', {
    count: out.length,
    first3: out.slice(0, 3).map(x => x.url),
  });
  return out;
}

/**
 * Top-level bootstrapper component.
 * Detects environment, prepares props, and mounts the main viewer.
 * @returns {*} React element
 */
export default function AppBootstrap() {
  // NOTE: Gate demo UI on `ready` to avoid calling t(...) before i18n has initialized.
  const { t, ready } = useTranslation('common');

  const [mode, setMode] = useState(ODV_BOOTSTRAP_MODES.DEMO);
  const [bundle, setBundle] = useState(/** @type {(PortableDocumentBundle|null)} */ (null));
  const [urlConfig, setUrlConfig] = useState(/** @type {(UrlConfig|null)} */ (null));

  // Demo UI state (shown only when mode === DEMO and we haven't started)
  const [count, setCount] = useState(10);
  const [format, setFormat] = useState('png'); // 'jpg'|'png'|'tif'|'pdf'
  const [mix, setMix] = useState(false);
  const [start, setStart] = useState(false);

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

        // Auto-start in non-demo modes
        if (res.bundle || res.urlConfig) setStart(true);

        logger.info('Bootstrap detection', {
          mode: res.mode,
          hasBundle: !!res.bundle,
          hasUrlConfig: !!res.urlConfig,
        });
      } catch (error) {
        logger.error('Bootstrap detection failed', { error: String(error?.message || error) });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const onEndChange = useCallback((e) => {
    const v = Math.max(1, Math.min(DEMO_MAX, Number(e?.target?.value) || 1));
    setCount(v);
    logger.info('Demo endNumber changed', { value: v });
  }, []);

  const onSelectFormat = useCallback((fmt) => {
    setFormat(fmt);
    setMix(false);
    setStart(true);
    logger.info('Demo type selected', { type: fmt });
  }, []);

  const onMix = useCallback(() => {
    setMix(true);
    setStart(true);
    logger.info('Demo mix selected');
  }, []);

  // Build explicit source list from bundle (if present)
  const sourceListFromBundle = useMemo(() => {
    if (!bundle) return null;
    try {
      const src = makeExplicitSource(bundle);
      return src.items; // array of { url, ext?, fileIndex }
    } catch (error) {
      logger.error('Failed to create explicit source from bundle', { error: String(error?.message || error) });
      return null;
    }
  }, [bundle]);

  // Props for <OpenDocViewer />
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
      Array.isArray(sourceListFromBundle) &&
      sourceListFromBundle.length > 0
    ) {
      return { sourceList: sourceListFromBundle, bundle };
    }

    // 3) Demo launcher pressed → explicit-list mode from /public samples
    if (mode === ODV_BOOTSTRAP_MODES.DEMO && start) {
      const formats = mix ? ['jpg', 'png', 'tif', 'pdf'] : [format];
      const sourceList = buildDemoSourceList({ count, strategy: mix ? 'mix' : 'repeat', formats });
      // Pass demoMode so the loader knows it can insert simple image pages directly (no workers).
      return { sourceList, demoMode: true };
    }

    // No props yet → show demo launcher
    return null;
  }, [mode, urlConfig, sourceListFromBundle, bundle, start, mix, format, count]);

  // Render the demo launcher if we don't have props to start the viewer yet
  if (!viewerProps) {
    // Avoid calling t(...) before i18n is initialized (prevents noisy dev warnings).
    if (!ready) {
      return (
        <div className="button-container" role="region" aria-busy="true" aria-live="polite">
          Loading…
        </div>
      );
    }

    return (
      <div className="button-container" role="region" aria-label={t('demoLauncher.aria.region')}>
        <label htmlFor="endNumber" style={{ marginRight: 8 }}>
          {t('demoControls.totalLabel')}
        </label>
        <input
          type="number"
          id="endNumber"
          value={count}
          onChange={onEndChange}
          placeholder={t('demoControls.endNumberPlaceholder')}
          min={1}
          max={DEMO_MAX}
          aria-label={t('demoControls.totalAria')}
        />
        {['jpg', 'png', 'tif', 'pdf'].map((fmt) => {
          const label = (fmt || '').toUpperCase();
          return (
            <button
              key={fmt}
              onClick={() => onSelectFormat(fmt)}
              type="button"
              aria-label={t('demoControls.startFormatDemo', { fmt: label })}
              title={t('demoControls.startFormatDemo', { fmt: label })}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={onMix}
          type="button"
          aria-label={t('demoControls.startMixedDemo')}
          title={t('demoControls.startMixedDemo')}
          style={{ marginLeft: 8 }}
        >
          {t('demoControls.mix')}
        </button>
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
