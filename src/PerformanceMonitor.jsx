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
import PropTypes from 'prop-types';
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

function formatMilliseconds(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  if (safeMs < 1000) return `${Math.round(safeMs)} ms`;
  return `${(safeMs / 1000).toFixed(1)} s`;
}

function formatRate(value, unit = 'p/s') {
  const safeValue = Math.max(0, Number(value) || 0);
  if (safeValue <= 0) return `0 ${unit}`;
  if (safeValue < 10) return `${safeValue.toFixed(1)} ${unit}`;
  return `${Math.round(safeValue)} ${unit}`;
}

/**
 * @param {number} ttlMs
 * @returns {string}
 */
function formatTtl(ttlMs) {
  const safeMs = Math.max(0, Number(ttlMs) || 0);
  if (!safeMs) return 'off';
  const seconds = Math.round(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

/**
 * @param {*} value
 * @returns {string}
 */
function formatCacheScope(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (text.length <= 20) return text;
  return `...${text.slice(-14)}`;
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
 * @param {*} value
 * @returns {string}
 */
function describeValueType(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value == null) return 'null';
  return typeof value;
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SENSITIVE_KEY_RE = /(auth|token|secret|password|passwd|authorization|cookie|apikey|api_key)/i;

/**
 * Redact auth-like values before showing transport payloads in the diagnostics HUD.
 *
 * @param {*} value
 * @param {number} depth
 * @returns {*}
 */
function sanitizeForOverlay(value, depth = 0) {
  if (depth > 8) return '[MaxDepth]';
  if (Array.isArray(value)) return value.map((item) => sanitizeForOverlay(item, depth + 1));
  if (!isPlainObject(value)) return value;

  /** @type {Record<string, *>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(String(key || ''))) {
      out[key] = '[Masked]';
      continue;
    }
    out[key] = sanitizeForOverlay(entry, depth + 1);
  }
  return out;
}

/**
 * @param {*} value
 * @returns {string}
 */
function safePrettyStringify(value) {
  try {
    if (typeof value === 'string') return value;
    return JSON.stringify(sanitizeForOverlay(value), null, 2);
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

/**
 * @param {*} payload
 * @returns {number}
 */
function getPayloadTopLevelCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (isPlainObject(payload)) return Object.keys(payload).length;
  return 0;
}

/**
 * @param {*} payload
 * @returns {number}
 */
function getCaseIdCount(payload) {
  if (Array.isArray(payload?.caseIds)) return payload.caseIds.length;
  if (Array.isArray(payload?.CaseIds)) return payload.CaseIds.length;
  return 0;
}

/**
 * @param {*} bundle
 * @returns {number}
 */
function countBundleMetaFields(bundle) {
  const docs = Array.isArray(bundle?.documents) ? bundle.documents : [];
  let count = 0;
  for (const doc of docs) {
    if (Array.isArray(doc?.meta)) count += doc.meta.length;
  }
  return count;
}

/**
 * Copy best-effort text to clipboard without throwing.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore and fall back
  }

  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}


/**
 * Download best-effort text as a local file without throwing.
 *
 * @param {string} filename
 * @param {string} text
 * @returns {boolean}
 */
function downloadText(filename, text) {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
    }, 1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * PerformanceMonitor component.
 * Renders nothing unless showPerfOverlay=true in runtime config.
 *
 * @param {Object} props
 * @param {*} [props.bundle]
 * @param {(Object|null)} [props.bootstrapDebugInfo]
 * @returns {(React.ReactElement|null)}
 */
const PerformanceMonitor = ({ bundle = null, bootstrapDebugInfo = null }) => {
  const { t } = useTranslation('common');
  const {
    allPages,
    error,
    workerCount,
    messageQueue,
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
  const [showHostMetadata, setShowHostMetadata] = useState(false);
  const [copyState, setCopyState] = useState('idle');
  const [copyPerfState, setCopyPerfState] = useState('idle');
  const [downloadState, setDownloadState] = useState('idle');

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
  const copyResetTimerRef = useRef(undefined);
  const copyPerfResetTimerRef = useRef(undefined);
  const downloadResetTimerRef = useRef(undefined);
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
      try { if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current); } catch {}
      try { if (copyPerfResetTimerRef.current) clearTimeout(copyPerfResetTimerRef.current); } catch {}
      try { if (downloadResetTimerRef.current) clearTimeout(downloadResetTimerRef.current); } catch {}
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
  const loadRunStartedAtMs = Number(runtimeDiagnostics?.loadRunStartedAtMs || 0);
  const loadRunCompletedAtMs = Number(runtimeDiagnostics?.loadRunCompletedAtMs || 0);
  const loadRunTimingActive = loadRunStartedAtMs > 0 && loadRunCompletedAtMs <= 0;
  const loadRunElapsedMs = resolveElapsedMs(
    loadRunStartedAtMs,
    loadRunCompletedAtMs,
    clockNow
  );
  const fullReadyCount = Math.max(0, Number(runtimeDiagnostics?.fullReadyCount || 0));
  const thumbnailReadyCount = Math.max(0, Number(runtimeDiagnostics?.thumbnailReadyCount || 0));
  const messages = Array.isArray(messageQueue) ? messageQueue.slice(-20) : [];
  const pdfWorkerPagePolicy = documentLoadingConfig?.render?.pdfWorkerPagePolicy || {};
  const pdfAutoPolicyLabel = [
    Number(pdfWorkerPagePolicy.mainThreadBelowPageCount) || 0,
    `${Number(pdfWorkerPagePolicy.smallWorkerBelowPageCount) || 100}:${Number(pdfWorkerPagePolicy.smallWorkerCount) || 1}`,
    Number(pdfWorkerPagePolicy.fixedWorkerBelowPageCount) || 600,
    Number(pdfWorkerPagePolicy.pagesPerWorker) || 150,
  ].join('/');
  const assetRenderCount = Math.max(0, Number(runtimeDiagnostics?.assetRenderCompletedCount || 0));
  const assetRenderAvgMs = assetRenderCount > 0
    ? Number(runtimeDiagnostics?.assetRenderTotalMs || 0) / assetRenderCount
    : 0;
  const assetRenderMaxMs = Math.max(0, Number(runtimeDiagnostics?.assetRenderMaxMs || 0));
  const assetRestoreAttempts = Math.max(0, Number(runtimeDiagnostics?.assetRestoreAttemptCount || 0));
  const assetRestoreAvgMs = assetRestoreAttempts > 0
    ? Number(runtimeDiagnostics?.assetRestoreTotalMs || 0) / assetRestoreAttempts
    : 0;
  const assetPersistCompleted = Math.max(0, Number(runtimeDiagnostics?.assetPersistCompletedCount || 0));
  const assetPersistFailed = Math.max(0, Number(runtimeDiagnostics?.assetPersistFailedCount || 0));
  const assetPersistFinished = assetPersistCompleted + assetPersistFailed;
  const assetPersistAvgMs = assetPersistFinished > 0
    ? Number(runtimeDiagnostics?.assetPersistTotalMs || 0) / assetPersistFinished
    : 0;
  const assetPersistMaxMs = Math.max(0, Number(runtimeDiagnostics?.assetPersistMaxMs || 0));
  const activePdfWorkerCount = Math.max(0, Number(runtimeDiagnostics?.activePdfWorkerCount || 0));
  const activePageAssetWorkerCount = Math.max(0, Number(runtimeDiagnostics?.activePageAssetWorkerCount || 0));
  const pdfWorkerRenderedCount = Math.max(0, Number(runtimeDiagnostics?.pdfWorkerRenderedCount || 0));
  const pdfWorkerFallbackCount = Math.max(0, Number(runtimeDiagnostics?.pdfWorkerFallbackCount || 0));
  const mainPdfRenderedCount = Math.max(0, Number(runtimeDiagnostics?.mainPdfRenderedCount || 0));
  const loadRunElapsedSeconds = loadRunElapsedMs > 0 ? loadRunElapsedMs / 1000 : 0;
  const loadPageRate = loadRunElapsedSeconds > 0 ? fullReadyCount / loadRunElapsedSeconds : 0;
  const renderPageRate = loadRunElapsedSeconds > 0 ? assetRenderCount / loadRunElapsedSeconds : 0;
  const sourceRate = loadRunElapsedSeconds > 0
    ? Number(runtimeDiagnostics?.sourceCount || 0) / loadRunElapsedSeconds
    : 0;
  const overlaySnapshotText = [
    `OpenDocViewer performance ${new Date().toISOString()}`,
    `FPS: ${fps || 0} CPU: ${hardwareConcurrency} cores RAM~${deviceMemory || 'n/a'}GB`,
    `Mode: ${String(documentLoadingConfig?.mode || 'auto')} Stage: ${String(memoryPressureStage || 'normal')} Workers: ${workerCount} PDF ${activePdfWorkerCount} raster ${activePageAssetWorkerCount}`,
    `Fetch: ${String(documentLoadingConfig?.fetch?.strategy || 'sequential')} Render: ${String(documentLoadingConfig?.render?.strategy || 'eager-nearby')} Backend: ${String(documentLoadingConfig?.render?.backend || 'hybrid-by-format')}`,
    `PDF route: ${String(documentLoadingConfig?.render?.pdfToImageMode || 'main-thread')} policy ${pdfAutoPolicyLabel} done worker:${pdfWorkerRenderedCount} main:${mainPdfRenderedCount} fallback:${pdfWorkerFallbackCount}`,
    `Load run: ${formatDuration(loadRunElapsedMs)} ${loadRunTimingActive ? 'active' : 'done'}`,
    `Throughput: load ${formatRate(loadPageRate)} render ${formatRate(renderPageRate)} sources ${formatRate(sourceRate, 'src/s')}`,
    `Pages: ${discoveredPages} full ${fullReadyCount}/${totalPages} thumbs ${thumbnailReadyCount}/${totalPages} failed ${failedPages}`,
    `Asset pipeline: render ${assetRenderCount} avg ${formatMilliseconds(assetRenderAvgMs)} max ${formatMilliseconds(assetRenderMaxMs)} restore ${Number(runtimeDiagnostics?.assetRestoreHitCount || 0)}/${Number(runtimeDiagnostics?.assetRestoreMissCount || 0)} avg ${formatMilliseconds(assetRestoreAvgMs)} persist ${Number(runtimeDiagnostics?.assetPersistPendingCount || 0)}/${assetPersistCompleted}/${assetPersistFailed} avg ${formatMilliseconds(assetPersistAvgMs)} max ${formatMilliseconds(assetPersistMaxMs)}`,
    hasHeapMetrics
      ? `Heap: ${memory.usedJSHeapSize.toFixed(1)} MB / ${memory.totalJSHeapSize.toFixed(1)} MB limit ${memory.jsHeapSizeLimit.toFixed(0)} MB`
      : 'Heap: unavailable',
    `Source store: ${String(runtimeDiagnostics?.sourceStoreMode || 'memory')} ${formatBytes(Number(runtimeDiagnostics?.sourceBytes || 0))} items ${Number(runtimeDiagnostics?.sourceCount || 0)}`,
    `Asset store: ${String(runtimeDiagnostics?.assetStoreMode || 'disabled')} ${formatBytes(Number(runtimeDiagnostics?.assetBytes || 0))} items ${Number(runtimeDiagnostics?.assetCount || 0)}`,
    `Cache scope source ${formatCacheScope(runtimeDiagnostics?.sourceCacheSessionId)} key ${String(runtimeDiagnostics?.sourceCacheKeyStorage || '-')} assets ${formatCacheScope(runtimeDiagnostics?.assetCacheSessionId)} key ${String(runtimeDiagnostics?.assetCacheKeyStorage || '-')}`,
    `Source key doc-ver ${Number(runtimeDiagnostics?.sourceCacheKeyModeDocumentVersion || 0)} fallback ${Number(runtimeDiagnostics?.sourceCacheKeyModeUrlFallback || 0)} url ${Number(runtimeDiagnostics?.sourceCacheKeyModeUrl || 0)}`,
    `Object URLs: ${Number(runtimeDiagnostics?.trackedObjectUrlCount || 0)} pending ${Number(runtimeDiagnostics?.pendingAssetCount || 0)} warm-up ${Number(runtimeDiagnostics?.warmupQueueLength || 0)}`,
    `Full cache: ${Number(runtimeDiagnostics?.fullCacheCount || 0)} / ${Math.max(0, Number(runtimeDiagnostics?.fullCacheLimit || 0))} Thumb cache: ${Number(runtimeDiagnostics?.thumbnailCacheCount || 0)} / ${Math.max(0, Number(runtimeDiagnostics?.thumbnailCacheLimit || 0))}`,
  ].join('\n');

  const hostPayload = bootstrapDebugInfo?.hostPayload;
  const hostPayloadSource = String(bootstrapDebugInfo?.hostPayloadSource || '');
  const filterInfo = bootstrapDebugInfo?.filterInfo;
  const bundleDocumentCount = Array.isArray(bundle?.documents) ? bundle.documents.length : 0;
  const bundleMetaFieldCount = countBundleMetaFields(bundle);
  const caseIdCount = getCaseIdCount(hostPayload);
  const hostPayloadPretty = useMemo(() => safePrettyStringify(hostPayload), [hostPayload]);
  const hasHostMetadata = useMemo(() => {
    const hasPayload = hostPayload != null
      && ((typeof hostPayload === 'string' && hostPayload.length > 0) || getPayloadTopLevelCount(hostPayload) > 0);
    const fromSessionData = hostPayloadSource === 'sessiondata';
    const bundleBackedMode = [
      'session-token',
      'parent-page',
      'js-api',
    ].includes(String(bootstrapDebugInfo?.mode || ''));
    return fromSessionData || (bundleBackedMode && (hasPayload || bundleDocumentCount > 0 || bundleMetaFieldCount > 0));
  }, [bootstrapDebugInfo?.mode, hostPayload, hostPayloadSource, bundleDocumentCount, bundleMetaFieldCount]);

  const metadataDownloadName = useMemo(() => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `odv-host-metadata-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
  }, []);

  const onCopyMetadata = useCallback(async () => {
    const ok = await copyText(hostPayloadPretty);
    setCopyState(ok ? 'copied' : 'failed');
    try {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    } catch {
      // ignore
    }
    copyResetTimerRef.current = setTimeout(() => setCopyState('idle'), 1800);
  }, [hostPayloadPretty]);

  const onDownloadMetadata = useCallback(() => {
    const ok = downloadText(metadataDownloadName, hostPayloadPretty);
    setDownloadState(ok ? 'downloaded' : 'failed');
    try {
      if (downloadResetTimerRef.current) clearTimeout(downloadResetTimerRef.current);
    } catch {
      // ignore
    }
    downloadResetTimerRef.current = setTimeout(() => setDownloadState('idle'), 1800);
  }, [hostPayloadPretty, metadataDownloadName]);

  const onCopyPerfSnapshot = useCallback(async () => {
    const ok = await copyText(overlaySnapshotText);
    setCopyPerfState(ok ? 'copied' : 'failed');
    try {
      if (copyPerfResetTimerRef.current) clearTimeout(copyPerfResetTimerRef.current);
    } catch {
      // ignore
    }
    copyPerfResetTimerRef.current = setTimeout(() => setCopyPerfState('idle'), 1800);
  }, [overlaySnapshotText]);

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
  const h3Style = { margin: 0, fontSize: '12px', letterSpacing: '0.02em', opacity: 0.9 };
  const sectionStyle = { margin: '6px 0' };
  const labelStyle = { opacity: 0.8 };
  const valueStyle = { fontWeight: 700 };
  const smallButtonStyle = {
    font: 'inherit',
    color: '#fff',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '4px',
    padding: '2px 6px',
    cursor: 'pointer',
  };

  return (
    <div style={wrapStyle} role="status" aria-live="polite" aria-atomic="true">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <h3 style={h3Style}>{t('perf.title')}</h3>
        <button
          type="button"
          onClick={onCopyPerfSnapshot}
          style={smallButtonStyle}
          title={t('perf.copySnapshotTitle', { defaultValue: 'Copy the diagnostics overlay as text' })}
        >
          {copyPerfState === 'copied'
            ? t('perf.copiedLabel', { defaultValue: 'Copied' })
            : copyPerfState === 'failed'
              ? t('perf.copyFailedLabel', { defaultValue: 'Copy failed' })
              : t('perf.copySnapshot', { defaultValue: 'Copy' })}
        </button>
      </div>

      {hasHostMetadata ? (
        <div style={{ ...sectionStyle, marginTop: 2, marginBottom: 10, padding: '8px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', background: 'rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={labelStyle}>{t('perf.hostMetadataLabel', { defaultValue: 'Host metadata:' })}</span>
            <strong>{hostPayloadSource || String(bootstrapDebugInfo?.mode || 'host')}</strong>
            <button
              type="button"
              onClick={() => setShowHostMetadata((prev) => !prev)}
              style={smallButtonStyle}
              aria-expanded={showHostMetadata}
            >
              {showHostMetadata
                ? t('perf.hideHostMetadata', { defaultValue: 'Hide' })
                : t('perf.showHostMetadata', { defaultValue: 'Show metadata' })}
            </button>
            <button
              type="button"
              onClick={onDownloadMetadata}
              style={smallButtonStyle}
              title={t('perf.downloadHostMetadataTitle', { defaultValue: 'Download sanitized host metadata JSON' })}
            >
              {downloadState === 'downloaded'
                ? t('perf.downloadedLabel', { defaultValue: 'Downloaded' })
                : downloadState === 'failed'
                  ? t('perf.downloadFailedLabel', { defaultValue: 'Download failed' })
                  : t('perf.downloadHostMetadata', { defaultValue: 'Download JSON' })}
            </button>
            <button
              type="button"
              onClick={onCopyMetadata}
              style={smallButtonStyle}
              title={t('perf.copyHostMetadataTitle', { defaultValue: 'Copy sanitized host metadata JSON' })}
            >
              {copyState === 'copied'
                ? t('perf.copiedLabel', { defaultValue: 'Copied' })
                : copyState === 'failed'
                  ? t('perf.copyFailedLabel', { defaultValue: 'Copy failed' })
                  : t('perf.copyHostMetadata', { defaultValue: 'Copy' })}
            </button>
          </div>
          <div style={{ marginTop: 4, opacity: 0.82 }}>
            <span>{t('perf.payloadTypeLabel', { defaultValue: 'Payload:' })} <strong>{describeValueType(hostPayload)}</strong></span>
            <span style={{ marginLeft: 10 }}>{t('perf.topLevelFieldsLabel', { defaultValue: 'Top-level:' })} <strong>{getPayloadTopLevelCount(hostPayload)}</strong></span>
            {caseIdCount > 0 ? <span style={{ marginLeft: 10 }}>{t('perf.caseIdsLabel', { defaultValue: 'caseIds:' })} <strong>{caseIdCount}</strong></span> : null}
            {bundleDocumentCount > 0 ? <span style={{ marginLeft: 10 }}>{t('perf.bundleDocumentsLabel', { defaultValue: 'Documents:' })} <strong>{bundleDocumentCount}</strong></span> : null}
            {bundleMetaFieldCount > 0 ? <span style={{ marginLeft: 10 }}>{t('perf.bundleMetaFieldsLabel', { defaultValue: 'Meta fields:' })} <strong>{bundleMetaFieldCount}</strong></span> : null}
            {filterInfo ? (
              <span style={{ marginLeft: 10 }}>
                {t('perf.caseIdFilterLabel', { defaultValue: 'Filter:' })}{' '}
                <strong>{Number(filterInfo.retainedDocumentCount || 0)}</strong>
                /{Number(filterInfo.originalDocumentCount || 0)}
              </span>
            ) : null}
          </div>
          {showHostMetadata ? (
            <pre
              style={{
                marginTop: 8,
                marginBottom: 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '20vh',
                overflowY: 'auto',
                padding: '8px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {hostPayloadPretty}
            </pre>
          ) : null}
        </div>
      ) : null}

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
          <span style={{ opacity: 0.75 }}>
            {' '}PDF <strong>{activePdfWorkerCount}</strong> raster <strong>{activePageAssetWorkerCount}</strong>
          </span>
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
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          PDF <strong>{String(documentLoadingConfig?.render?.pdfToImageMode || 'main-thread')}</strong>
          <span style={{ opacity: 0.75 }}>
            {String(documentLoadingConfig?.render?.pdfToImageMode || '').toLowerCase() === 'auto'
              ? ` policy ${pdfAutoPolicyLabel}`
              : ` max ${Number(documentLoadingConfig?.render?.pdfWorkerMaxCount) || 0}`}
          </span>
          {(pdfWorkerRenderedCount > 0 || mainPdfRenderedCount > 0 || pdfWorkerFallbackCount > 0) ? (
            <span style={{ opacity: 0.75 }}>
              {' '}done w:<strong>{pdfWorkerRenderedCount}</strong> main:<strong>{mainPdfRenderedCount}</strong>
              {pdfWorkerFallbackCount > 0 ? <> fb:<strong>{pdfWorkerFallbackCount}</strong></> : null}
            </span>
          ) : null}
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>{t('perf.loadRunLabel')}</span>{' '}
        <strong>{formatDuration(loadRunElapsedMs)}</strong>
        <span style={{ marginLeft: 8, opacity: 0.75 }}>
          {loadRunTimingActive ? t('perf.loadRunActive') : t('perf.loadRunDone')}
        </span>
        <span style={{ marginLeft: 10, opacity: 0.9 }}>
          {t('perf.throughputLabel', { defaultValue: 'Rate:' })}{' '}
          <strong>{formatRate(loadPageRate)}</strong>
          <span style={{ opacity: 0.75 }}>
            {' '}render <strong>{formatRate(renderPageRate)}</strong>
          </span>
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
        <span style={labelStyle}>{t('perf.assetPipelineLabel', { defaultValue: 'Asset pipeline:' })}</span>{' '}
        <span style={{ opacity: 0.9 }}>
          render <strong>{assetRenderCount}</strong> avg <strong>{formatMilliseconds(assetRenderAvgMs)}</strong>
          {' '}max <strong>{formatMilliseconds(assetRenderMaxMs)}</strong>
        </span>
        <span style={{ marginLeft: 8, opacity: 0.9 }}>
          restore <strong>{Number(runtimeDiagnostics?.assetRestoreHitCount || 0)}</strong>
          /<strong>{Number(runtimeDiagnostics?.assetRestoreMissCount || 0)}</strong>
          {' '}avg <strong>{formatMilliseconds(assetRestoreAvgMs)}</strong>
        </span>
        <span style={{ marginLeft: 8, opacity: 0.9 }}>
          persist <strong>{Number(runtimeDiagnostics?.assetPersistPendingCount || 0)}</strong>
          /<strong>{assetPersistCompleted}</strong>
          /<strong>{assetPersistFailed}</strong>
          {' '}avg <strong>{formatMilliseconds(assetPersistAvgMs)}</strong>
          {' '}max <strong>{formatMilliseconds(assetPersistMaxMs)}</strong>
        </span>
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
        {(Number(runtimeDiagnostics?.sourceReloadCacheTtlMs || 0) > 0 || Number(runtimeDiagnostics?.assetReloadCacheTtlMs || 0) > 0) ? (
          <div>
            <span style={labelStyle}>{t('perf.reloadCacheLabel', { defaultValue: 'Reload-cache' })}</span>{' '}
            <span style={{ opacity: 0.85 }}>
              {t('perf.sourceStoreShortLabel', { defaultValue: 'source' })}{' '}
              <strong>{Number(runtimeDiagnostics?.sourceCacheHits || 0)}</strong>
              /{Number(runtimeDiagnostics?.sourceCacheMisses || 0)}{' '}
              {t('perf.cacheHitsMissesLabel', { defaultValue: 'hits/misses' })}
              {' '}({formatTtl(Number(runtimeDiagnostics?.sourceReloadCacheTtlMs || 0))})
            </span>
            <span style={{ marginLeft: 10, opacity: 0.85 }}>
              {t('perf.assetStoreShortLabel', { defaultValue: 'assets' })}{' '}
              <strong>{Number(runtimeDiagnostics?.assetCacheHits || 0)}</strong>
              /{Number(runtimeDiagnostics?.assetCacheMisses || 0)}{' '}
              {t('perf.cacheHitsMissesLabel', { defaultValue: 'hits/misses' })}
              {' '}({formatTtl(Number(runtimeDiagnostics?.assetReloadCacheTtlMs || 0))})
            </span>
          </div>
        ) : null}
        {(runtimeDiagnostics?.sourceCacheSessionId || runtimeDiagnostics?.assetCacheSessionId) ? (
          <div
            style={{ opacity: 0.78 }}
            title={[
              String(runtimeDiagnostics?.sourceCacheLastReadFailure || ''),
              String(runtimeDiagnostics?.assetCacheLastReadFailure || ''),
            ].filter(Boolean).join(' | ')}
          >
            <span style={labelStyle}>{t('perf.reloadCacheScopeLabel', { defaultValue: 'Cache scope' })}</span>{' '}
            {t('perf.sourceStoreShortLabel', { defaultValue: 'source' })}{' '}
            <strong title={String(runtimeDiagnostics?.sourceCacheSessionId || '')}>
              {formatCacheScope(runtimeDiagnostics?.sourceCacheSessionId)}
            </strong>
            <span style={{ marginLeft: 8 }}>
              {t('perf.keyStorageLabel', { defaultValue: 'key' })}{' '}
              <strong>{String(runtimeDiagnostics?.sourceCacheKeyStorage || '-')}</strong>
            </span>
            <span style={{ marginLeft: 10 }}>
              {t('perf.assetStoreShortLabel', { defaultValue: 'assets' })}{' '}
              <strong title={String(runtimeDiagnostics?.assetCacheSessionId || '')}>
                {formatCacheScope(runtimeDiagnostics?.assetCacheSessionId)}
              </strong>
              <span style={{ marginLeft: 8 }}>
                {t('perf.keyStorageLabel', { defaultValue: 'key' })}{' '}
                <strong>{String(runtimeDiagnostics?.assetCacheKeyStorage || '-')}</strong>
              </span>
            </span>
          </div>
        ) : null}
        {(Number(runtimeDiagnostics?.sourceCacheKeyModeDocumentVersion || 0) > 0
          || Number(runtimeDiagnostics?.sourceCacheKeyModeUrlFallback || 0) > 0
          || Number(runtimeDiagnostics?.sourceCacheKeyModeUrl || 0) > 0) ? (
          <div style={{ opacity: 0.78 }}>
            <span style={labelStyle}>{t('perf.sourceKeyModeLabel', { defaultValue: 'Source key' })}</span>{' '}
            doc-ver <strong>{Number(runtimeDiagnostics?.sourceCacheKeyModeDocumentVersion || 0)}</strong>
            <span style={{ marginLeft: 8 }}>
              fallback <strong>{Number(runtimeDiagnostics?.sourceCacheKeyModeUrlFallback || 0)}</strong>
            </span>
            <span style={{ marginLeft: 8 }}>
              url <strong>{Number(runtimeDiagnostics?.sourceCacheKeyModeUrl || 0)}</strong>
            </span>
          </div>
        ) : null}
        {(Number(runtimeDiagnostics?.sourceCacheReadFailures || 0) > 0
          || Number(runtimeDiagnostics?.assetCacheReadFailures || 0) > 0
          || runtimeDiagnostics?.sourceCacheLastMissReason
          || runtimeDiagnostics?.assetCacheLastMissReason) ? (
          <div style={{ opacity: 0.78 }}>
            <span style={labelStyle}>{t('perf.reloadCacheMissReasonLabel', { defaultValue: 'Cache miss' })}</span>{' '}
            {t('perf.sourceStoreShortLabel', { defaultValue: 'source' })}{' '}
            <strong>{String(runtimeDiagnostics?.sourceCacheLastMissReason || '-')}</strong>
            <span style={{ marginLeft: 6 }}>
              {t('perf.errorsShortLabel', { defaultValue: 'errors' })}{' '}
              <strong>{Number(runtimeDiagnostics?.sourceCacheReadFailures || 0)}</strong>
            </span>
            <span style={{ marginLeft: 10 }}>
              {t('perf.assetStoreShortLabel', { defaultValue: 'assets' })}{' '}
              <strong>{String(runtimeDiagnostics?.assetCacheLastMissReason || '-')}</strong>
              <span style={{ marginLeft: 6 }}>
                {t('perf.errorsShortLabel', { defaultValue: 'errors' })}{' '}
                <strong>{Number(runtimeDiagnostics?.assetCacheReadFailures || 0)}</strong>
              </span>
            </span>
          </div>
        ) : null}
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

PerformanceMonitor.propTypes = {
  bundle: PropTypes.any,
  bootstrapDebugInfo: PropTypes.shape({
    mode: PropTypes.string,
    hostPayloadSource: PropTypes.string,
    hostPayload: PropTypes.any,
    filterInfo: PropTypes.shape({
      source: PropTypes.string,
      caseIdCount: PropTypes.number,
      originalDocumentCount: PropTypes.number,
      retainedDocumentCount: PropTypes.number,
    }),
  }),
};

export default PerformanceMonitor;
