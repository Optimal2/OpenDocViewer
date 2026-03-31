// File: src/PerformanceMonitor.jsx
/**
 * src/PerformanceMonitor.jsx
 *
 * OpenDocViewer — Lightweight Performance HUD
 *
 * PURPOSE
 *   - Provide optional, low-impact visibility into runtime performance and viewer state.
 *   - Intended for diagnostics in development and support scenarios.
 *   - Mounts conditionally based on runtime config: window.__ODV_CONFIG__.showPerfOverlay
 *
 * SAFETY & COMPATIBILITY
 *   - Uses non-standard `performance.memory` only when available (Chromium). Falls back gracefully.
 *   - In browsers that do not expose heap metrics (for example Firefox), the overlay shows N/A.
 *   - Avoids noisy logs and heavy work; memory is sampled ~1 Hz while the timer display updates at a
 *     modest cadence.
 *   - Cleans up all timers and rAF handlers on unmount.
 */

import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ViewerContext from './contexts/viewerContext.js';
import { formatBytes } from './utils/documentLoadingConfig.js';

/**
 * @typedef {Object} MemorySnapshot
 * @property {number} totalJSHeapSize
 * @property {number} usedJSHeapSize
 * @property {number} jsHeapSizeLimit
 */

/**
 * @param {number} bytes
 * @returns {number}
 */
function toMB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes / (1024 * 1024);
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalTenths = Math.round(safeMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const hh = hours > 0 ? `${hours}:` : '';
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return `${hh}${mm}:${ss}.${tenths}`;
}

/**
 * @param {number} startedAtMs
 * @param {number} completedAtMs
 * @param {number} nowMs
 * @returns {number}
 */
function resolveElapsedMs(startedAtMs, completedAtMs, nowMs) {
  const start = Math.max(0, Number(startedAtMs) || 0);
  if (!start) return 0;
  const end = Math.max(start, Number(completedAtMs) || Number(nowMs) || start);
  return Math.max(0, end - start);
}

/**
 * PerformanceMonitor component.
 * Renders nothing unless showPerfOverlay=true in runtime config.
 *
 * @returns {(React.ReactElement|null)}
 */
const PerformanceMonitor = () => {
  const { t } = useTranslation('common');
  const {
    allPages,
    error,
    workerCount,
    messageQueue,
    loadingRunActive,
    plannedPageCount,
    documentLoadingConfig,
    memoryPressureStage,
    runtimeDiagnostics,
  } = useContext(ViewerContext);

  const [memory, setMemory] = useState(
    /** @type {MemorySnapshot} */ ({
      totalJSHeapSize: 0,
      usedJSHeapSize: 0,
      jsHeapSizeLimit: 0,
    })
  );
  const [hasHeapMetrics, setHasHeapMetrics] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const hardwareConcurrency = useMemo(() => {
    try {
      return typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 1) : 1;
    } catch {
      return 1;
    }
  }, []);

  const deviceMemory = useMemo(() => {
    try {
      return typeof navigator !== 'undefined' ? (Number(navigator.deviceMemory) || 0) : 0;
    } catch {
      return 0;
    }
  }, []);

  const [fps, setFps] = useState(0);
  const rafRef = useRef(undefined);
  const lastFrameTime = useRef(undefined);
  const smaWindow = useRef([]);
  const SMA_SIZE = 30;

  /**
   * @param {number} frameTime
   * @returns {void}
   */
  const tick = useCallback((frameTime) => {
    if (typeof frameTime === 'number') {
      const prev = lastFrameTime.current;
      lastFrameTime.current = frameTime;
      if (typeof prev === 'number' && frameTime > prev) {
        const dt = (frameTime - prev) / 1000;
        const inst = dt > 0 ? 1 / dt : 0;
        smaWindow.current.push(inst);
        if (smaWindow.current.length > SMA_SIZE) smaWindow.current.shift();
        const avg = smaWindow.current.reduce((sum, value) => sum + value, 0) / smaWindow.current.length;
        setFps((prevFps) => (Math.abs(prevFps - avg) > 0.25 ? Math.round(avg) : prevFps));
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * @returns {void}
   */
  const updateMemory = useCallback(() => {
    try {
      const perf = typeof window !== 'undefined' ? window.performance : undefined;
      // @ts-ignore Chromium-only API
      const mem = perf && perf.memory ? perf.memory : null;
      if (mem) {
        setHasHeapMetrics(true);
        setMemory({
          totalJSHeapSize: toMB(mem.totalJSHeapSize),
          usedJSHeapSize: toMB(mem.usedJSHeapSize),
          jsHeapSizeLimit: toMB(mem.jsHeapSizeLimit),
        });
        return;
      }
      setHasHeapMetrics(false);
    } catch {
      setHasHeapMetrics(false);
    }
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    const memoryTimerId = setInterval(updateMemory, 1000);
    const clockTimerId = setInterval(() => setClockNow(Date.now()), 250);
    updateMemory();
    setClockNow(Date.now());

    return () => {
      try { if (rafRef.current) cancelAnimationFrame(rafRef.current); } catch {}
      clearInterval(memoryTimerId);
      clearInterval(clockTimerId);
    };
  }, [tick, updateMemory]);

  const totalPages = Array.isArray(allPages) ? allPages.length : 0;
  const failedPages = useMemo(
    () => allPages.filter((page) => page && (page.status === -1 || page.fullSizeStatus === -1 || page.thumbnailStatus === -1)).length,
    [allPages]
  );
  const discoveredPages = Math.max(totalPages, Number(plannedPageCount) || 0);
  const loadRunElapsedMs = resolveElapsedMs(
    runtimeDiagnostics?.loadRunStartedAtMs,
    runtimeDiagnostics?.loadRunCompletedAtMs,
    clockNow
  );
  const fullReadyCount = Math.max(0, Number(runtimeDiagnostics?.fullReadyCount || 0));
  const thumbnailReadyCount = Math.max(0, Number(runtimeDiagnostics?.thumbnailReadyCount || 0));
  const messages = Array.isArray(messageQueue) ? messageQueue.slice(-20) : [];

  const wrapStyle = {
    position: 'fixed',
    bottom: 0,
    right: 0,
    padding: '10px 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    color: '#fff',
    zIndex: 2147483646,
    maxWidth: '420px',
    overflowY: 'auto',
    maxHeight: '60vh',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: 1.5,
    borderTopLeftRadius: '6px',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 6px 24px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(2px)',
  };
  const h3Style = { margin: '0 0 6px 0', fontSize: '12px', letterSpacing: '0.02em', opacity: 0.9 };
  const sectionStyle = { margin: '6px 0' };
  const labelStyle = { opacity: 0.8 };
  const valueStyle = { fontWeight: 700 };

  return (
    <div style={wrapStyle} role="status" aria-live="polite" aria-atomic="true">
      <h3 style={h3Style}>{t('perf.title')}</h3>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.fpsLabel')}</span> <strong>{fps || 0}</strong>
        <span style={{ marginLeft: 8, opacity: 0.7 }}>
          {t('perf.cpuCores', { count: hardwareConcurrency })}
          {deviceMemory ? ` ${t('perf.ramApprox', { gb: deviceMemory })}` : ''}
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.modeLabel')}</span>{' '}
        <span style={valueStyle}>{String(documentLoadingConfig?.mode || 'auto')}</span>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {t('perf.stageLabel')} <strong>{String(memoryPressureStage || 'normal')}</strong>
        </span>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {t('perf.workersLabel')} <strong>{workerCount}</strong>
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.fetchLabel', { defaultValue: 'Fetch:' })}</span>{' '}
        <strong>{String(documentLoadingConfig?.fetch?.strategy || 'sequential')}</strong>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {t('perf.renderLabel', { defaultValue: 'Render:' })} <strong>{String(documentLoadingConfig?.render?.strategy || 'eager-nearby')}</strong>
        </span>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {t('perf.backendLabel', { defaultValue: 'Backend:' })} <strong>{String(documentLoadingConfig?.render?.backend || 'hybrid-by-format')}</strong>
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.workerRoutingLabel', { defaultValue: 'Worker routing:' })}</span>{' '}
        <strong>Raster {documentLoadingConfig?.render?.useWorkersForRasterImages === false ? 'off' : 'on'}</strong>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          TIFF <strong>{documentLoadingConfig?.render?.useWorkersForTiff === false ? 'off' : 'on'}</strong>
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.loadRunLabel')}</span>{' '}
        <strong>{formatDuration(loadRunElapsedMs)}</strong>
        <span style={{ marginLeft: 8, opacity: 0.75 }}>
          {loadingRunActive ? t('perf.loadRunActive') : t('perf.loadRunDone')}
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.pagesLabel')}</span>{' '}
        <strong>{discoveredPages}</strong>
        <span style={{ marginLeft: 8, opacity: 0.9 }}>
          {t('perf.fullAssetsLabel')} <strong>{fullReadyCount}</strong>/{totalPages}
        </span>
        <span style={{ marginLeft: 8, opacity: 0.9 }}>
          {t('perf.thumbnailAssetsLabel')} <strong>{thumbnailReadyCount}</strong>/{totalPages}
        </span>
        {failedPages > 0 ? <span style={{ color: '#ff9c9c' }}> {t('perf.failedSuffix', { count: failedPages })}</span> : null}
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.heapLabel')}</span>{' '}
        {hasHeapMetrics ? (
          <>
            <strong>{memory.usedJSHeapSize.toFixed(1)} MB</strong>
            <span style={{ opacity: 0.7 }}>
              {' '} / {memory.totalJSHeapSize.toFixed(1)} MB {t('perf.heapLimit', { mb: memory.jsHeapSizeLimit.toFixed(0) })}
            </span>
          </>
        ) : (
          <span style={{ opacity: 0.7 }}>
            <strong>{t('perf.heapNotAvailable')}</strong> {t('perf.heapUnsupported')}
          </span>
        )}
      </div>

      <div style={sectionStyle}>
        <div>
          <span style={labelStyle}>{t('perf.sourceStoreLabel')}</span>{' '}
          <strong>{String(runtimeDiagnostics?.sourceStoreMode || 'memory')}</strong>
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            {formatBytes(Number(runtimeDiagnostics?.sourceBytes || 0))}
          </span>
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            {t('perf.itemsShortLabel')} {Number(runtimeDiagnostics?.sourceCount || 0)}
          </span>
          {runtimeDiagnostics?.sourceStoreEncrypted ? (
            <span style={{ marginLeft: 8, opacity: 0.75 }}>{t('perf.encryptedLabel')}</span>
          ) : null}
        </div>
        <div>
          <span style={labelStyle}>{t('perf.assetStoreLabel')}</span>{' '}
          <strong>{String(runtimeDiagnostics?.assetStoreMode || 'disabled')}</strong>
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            {formatBytes(Number(runtimeDiagnostics?.assetBytes || 0))}
          </span>
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            {t('perf.itemsShortLabel')} {Number(runtimeDiagnostics?.assetCount || 0)}
          </span>
          {runtimeDiagnostics?.assetStoreEncrypted ? (
            <span style={{ marginLeft: 8, opacity: 0.75 }}>{t('perf.encryptedLabel')}</span>
          ) : null}
        </div>
      </div>

      <div style={sectionStyle}>
        <div>
          <span style={labelStyle}>{t('perf.objectUrlsLabel')}</span>{' '}
          <strong>{Number(runtimeDiagnostics?.trackedObjectUrlCount || 0)}</strong>
          <span style={{ marginLeft: 10, opacity: 0.9 }}>
            {t('perf.pendingAssetsLabel')} <strong>{Number(runtimeDiagnostics?.pendingAssetCount || 0)}</strong>
          </span>
          <span style={{ marginLeft: 10, opacity: 0.9 }}>
            {t('perf.warmupQueueLabel')} <strong>{Number(runtimeDiagnostics?.warmupQueueLength || 0)}</strong>
          </span>
        </div>
        <div>
          <span style={labelStyle}>{t('perf.fullCacheLabel')}</span>{' '}
          <strong>{Number(runtimeDiagnostics?.fullCacheCount || 0)}</strong>
          <span style={{ opacity: 0.7 }}>
            {' '} / {Math.max(0, Number(runtimeDiagnostics?.fullCacheLimit || 0))}
          </span>
          <span style={{ marginLeft: 10, opacity: 0.9 }}>
            {t('perf.thumbnailCacheLabel')} <strong>{Number(runtimeDiagnostics?.thumbnailCacheCount || 0)}</strong>
            <span style={{ opacity: 0.7 }}>
              {' '} / {Math.max(0, Number(runtimeDiagnostics?.thumbnailCacheLimit || 0))}
            </span>
          </span>
        </div>
      </div>

      {error ? (
        <div style={{ ...sectionStyle, color: '#ff9c9c' }}>
          {t('perf.errorPrefix')} {String(error)}
        </div>
      ) : null}

      {messages.length > 0 && (
        <div style={{ ...sectionStyle, maxHeight: '24vh', overflowY: 'auto' }}>
          <div style={{ ...labelStyle, marginBottom: 2 }}>{t('perf.messagesLabel')}</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {messages.map((message, index) => (
              <li key={index} style={{ whiteSpace: 'pre-wrap' }}>
                {String(message)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PerformanceMonitor;
