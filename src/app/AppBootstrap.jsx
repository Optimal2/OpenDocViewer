// File: src/app/AppBootstrap.jsx
/**
 * File: src/app/AppBootstrap.jsx
 *
 * Application bootstrap React component.
 *
 * Responsibilities:
 * - run bootstrap detection exactly once after mount
 * - convert the detected startup mode into a stable prop shape for `OpenDocViewer`
 * - present the demo launcher when no host-provided startup payload exists
 *
 * Supported startup inputs:
 * - URL pattern mode (`folder` + `extension` + `endNumber`)
 * - explicit source lists derived from normalized bundles
 * - local demo source lists built from files in `public/`
 *
 * This file should stay focused on *startup selection*. It should not own document rendering,
 * bundle normalization rules, or viewer interaction state.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n.js'; // initialize i18n before any components render
import logger from '../logging/systemLogger.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import OpenDocViewer from './OpenDocViewer.jsx';
import { bootstrapDetect, ODV_BOOTSTRAP_MODES } from '../integrations/bootstrapRuntime.js';
import { makeExplicitSource } from '../components/DocumentLoader/sources/explicitListSource.js';
import { isPerformanceOverlayEnabled } from '../utils/performanceOverlayFlag.js';

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
 * Diagnostics-only bootstrap metadata.
 * @typedef {Object} BootstrapDebugInfo
 * @property {string} mode
 * @property {(string|undefined)} [hostPayloadSource]
 * @property {*=} [hostPayload]
 * @property {Object=} [filterInfo]
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
 * Build a stable reload-cache scope from host/user identity without including short-lived
 * source URLs/tickets, session ids, or the current document selection. Individual source entries
 * carry their own document-version identity, so the same document can be reused whether it is
 * opened alone or as part of a larger comparison bundle.
 *
 * @param {(PortableDocumentBundle|null|undefined)} bundle
 * @returns {string}
 */
function makeReloadCacheSeedFromBundle(bundle) {
  if (!bundle) return '';
  const session = bundle.session || {};

  return [
    'odv-cache-scope-v2',
    String(session.userId || session.UserId || ''),
    String(bundle.integration?.kind || ''),
  ].join('||');
}

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
  const [bootstrapDebugInfo, setBootstrapDebugInfo] = useState(/** @type {(BootstrapDebugInfo|null)} */ (null));

  const perfOverlayEnabled = useMemo(() => isPerformanceOverlayEnabled(), []);

  // Demo UI state (shown only when mode === DEMO and we haven't started)
  const [count, setCount] = useState(10);
  const [format, setFormat] = useState('png'); // 'jpg'|'png'|'tif'|'pdf'
  const [mix, setMix] = useState(false);
  const [start, setStart] = useState(false);

  // Detect startup mode once on mount and cache the resulting input shape.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await bootstrapDetect({ diagnosticsEnabled: perfOverlayEnabled });
        if (!mounted) return;
        setMode(res.mode);
        setBootstrapDebugInfo(perfOverlayEnabled ? (res.debugInfo || null) : null);
        if (res.bundle) setBundle(res.bundle);
        if (res.urlConfig) setUrlConfig(res.urlConfig);

        // Auto-start in non-demo modes
        if (res.bundle || res.urlConfig) setStart(true);

        logger.info('Bootstrap detection', {
          mode: res.mode,
          hasBundle: !!res.bundle,
          hasUrlConfig: !!res.urlConfig,
          debugSource: res.debugInfo?.hostPayloadSource || null,
        });
      } catch (error) {
        logger.error('Bootstrap detection failed', { error: String(error?.message || error) });
      }
    })();
    return () => { mounted = false; };
  }, [perfOverlayEnabled]);

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

  // Convert a normalized bundle into the explicit source-list format consumed by the loader.
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

  // Build the canonical prop object expected by the application shell.
  const viewerProps = useMemo(() => {
    // 1) URL params → pattern mode
    if (mode === ODV_BOOTSTRAP_MODES.URL_PARAMS && urlConfig) {
      return {
        folder: urlConfig.folder,
        extension: urlConfig.extension,
        endNumber: urlConfig.endNumber,
        bootstrapDebugInfo,
      };
    }

    // 2) Bundle-backed modes → explicit-list mode
    if (
      (mode === ODV_BOOTSTRAP_MODES.PARENT_PAGE ||
        mode === ODV_BOOTSTRAP_MODES.SESSION_URL ||
        mode === ODV_BOOTSTRAP_MODES.SESSION_TOKEN ||
        mode === ODV_BOOTSTRAP_MODES.JS_API) &&
      Array.isArray(sourceListFromBundle) &&
      sourceListFromBundle.length > 0
    ) {
      return {
        sourceList: sourceListFromBundle,
        bundle,
        bootstrapDebugInfo,
        reloadCacheSeed: makeReloadCacheSeedFromBundle(bundle),
      };
    }

    // 3) Demo launcher pressed → explicit-list mode from /public samples
    if (mode === ODV_BOOTSTRAP_MODES.DEMO && start) {
      const formats = mix ? ['jpg', 'png', 'tif', 'pdf'] : [format];
      const sourceList = buildDemoSourceList({ count, strategy: mix ? 'mix' : 'repeat', formats });
      // Pass demoMode so the loader knows it can insert simple image pages directly (no workers).
      return { sourceList, demoMode: true, bootstrapDebugInfo };
    }

    // No props yet → show demo launcher
    return null;
  }, [mode, urlConfig, sourceListFromBundle, bundle, start, mix, format, count, bootstrapDebugInfo]);

  // Until a startup payload exists, show the demo launcher instead of the viewer shell.
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

  return (
    <ErrorBoundary>
      <OpenDocViewer {...viewerProps} />
    </ErrorBoundary>
  );
}
