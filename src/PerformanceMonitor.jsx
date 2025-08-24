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
 *   - Avoids noisy logs and heavy work; updates are throttled to ~1 Hz for memory and ~60 Hz for FPS.
 *   - Cleans up all timers and rAF handlers on unmount.
 *
 * CONFIG (set via public/odv.config.js; no rebuild required)
 *   - showPerfOverlay: boolean (default false) — when false, this component renders null.
 *
 * GOTCHA (project-wide reminder):
 *   - Elsewhere we import from 'file-type' (root), **not** 'file-type/browser', because v21 does
 *     not export that subpath for bundlers and it will break a Vite build. See README design notes.
 *
 * Source of original baseline for reference: :contentReference[oaicite:0]{index=0}
 */

import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { ViewerContext } from './ViewerContext';

/**
 * @typedef {Object} MemorySnapshot
 * @property {number} totalJSHeapSize  // MB
 * @property {number} usedJSHeapSize   // MB
 * @property {number} jsHeapSizeLimit  // MB
 */

/**
 * Read a stable snapshot of runtime config without exposing a mutable reference.
 * @returns {{ showPerfOverlay?: boolean }} config
 */
function readRuntimeConfig() {
  try {
    // Preferred: helper installed by odv.config.js
    if (typeof window !== 'undefined' && typeof window.__ODV_GET_CONFIG__ === 'function') {
      return window.__ODV_GET_CONFIG__() || {};
    }
    // Fallback: direct global
    if (typeof window !== 'undefined' && window.__ODV_CONFIG__) {
      return window.__ODV_CONFIG__ || {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Format a number of bytes into MB with two decimals.
 * Returns 0 when input is falsy or not finite.
 * @param {number} bytes
 * @returns {number}
 */
function toMB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes / (1024 * 1024);
}

/**
 * PerformanceMonitor component.
 * Renders nothing unless showPerfOverlay=true in runtime config.
 *
 * @returns {JSX.Element|null}
 */
const PerformanceMonitor = () => {
  const { allPages, error, workerCount, messageQueue } = useContext(ViewerContext);

  // Runtime toggle (read once at mount; if you need live toggling, change to state + event)
  const showPerfOverlay = useMemo(() => !!readRuntimeConfig().showPerfOverlay, []);

  // Early exit to keep costs at absolute minimum when disabled
  if (!showPerfOverlay) return null;

  /** @type {[MemorySnapshot, React.Dispatch<React.SetStateAction<MemorySnapshot>>]} */
  const [memory, setMemory] = useState({
    totalJSHeapSize: 0,
    usedJSHeapSize: 0,
    jsHeapSizeLimit: 0,
  });

  /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
  const [hardwareConcurrency, setHardwareConcurrency] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 1) : 1;
    } catch {
      return 1;
    }
  });

  /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
  const [deviceMemory, setDeviceMemory] = useState(() => {
    try {
      // Non-standard; Chromium only; returns GB
      return typeof navigator !== 'undefined' ? (Number(navigator.deviceMemory) || 0) : 0;
    } catch {
      return 0;
    }
  });

  // FPS sampling (simple moving average)
  const [fps, setFps] = useState(0);
  /** @type {React.MutableRefObject<number | undefined>} */
  const rafRef = useRef(undefined);
  /** @type {React.MutableRefObject<number | undefined>} */
  const lastFrameTime = useRef(undefined);
  /** @type {React.MutableRefObject<number[]>} */
  const smaWindow = useRef([]); // last N instantaneous FPS values
  const SMA_SIZE = 30;

  /**
   * rAF loop to estimate instantaneous FPS and expose a short moving average.
   */
  const tick = useCallback((t) => {
    if (typeof t === 'number') {
      const prev = lastFrameTime.current;
      lastFrameTime.current = t;
      if (typeof prev === 'number' && t > prev) {
        const dt = (t - prev) / 1000; // seconds
        const inst = dt > 0 ? 1 / dt : 0;
        smaWindow.current.push(inst);
        if (smaWindow.current.length > SMA_SIZE) smaWindow.current.shift();
        const avg = smaWindow.current.reduce((a, b) => a + b, 0) / smaWindow.current.length;
        // Avoid re-render thrash: only update when the value moves noticeably
        setFps((prevFps) => (Math.abs(prevFps - avg) > 0.25 ? Math.round(avg) : prevFps));
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Memory stats (1 Hz, Chromium-only).
   * Falls back gracefully on engines that omit performance.memory.
   */
  const updateMemory = useCallback(() => {
    try {
      const perf = typeof window !== 'undefined' ? window.performance : undefined;
      // @ts-ignore - non-standard
      const mem = perf && perf.memory ? perf.memory : null;
      if (mem) {
        setMemory({
          totalJSHeapSize: toMB(mem.totalJSHeapSize),
          usedJSHeapSize: toMB(mem.usedJSHeapSize),
          jsHeapSizeLimit: toMB(mem.jsHeapSizeLimit),
        });
      }
    } catch {
      // ignore; unavailable or blocked
    }
  }, []);

  // Start FPS and memory loops
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    const id = setInterval(updateMemory, 1000);
    // seed once so UI doesn't start with zeros
    updateMemory();
    return () => {
      try { if (rafRef.current) cancelAnimationFrame(rafRef.current); } catch {}
      clearInterval(id);
    };
  }, [tick, updateMemory]);

  // Derivations
  const totalPages = allPages.length;
  const loadedPages = useMemo(() => allPages.filter(Boolean).length, [allPages]);
  const failedPages = useMemo(
    () => allPages.filter((p) => p && p.status === -1).length,
    [allPages]
  );

  // UI styles (inline to keep HUD self-contained)
  const wrapStyle = {
    position: 'fixed',
    bottom: 0,
    right: 0,
    padding: '10px 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: '#fff',
    zIndex: 2147483646,
    maxWidth: '340px',
    overflowY: 'auto',
    maxHeight: '50vh',
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

  const messages = messageQueue.slice(-20); // last 20

  return (
    <div style={wrapStyle} role="status" aria-live="polite" aria-atomic="true">
      <h3 style={h3Style}>OpenDocViewer · Perf</h3>

      <div style={sectionStyle}>
        <span style={labelStyle}>FPS:</span> <strong>{fps || 0}</strong>
        <span style={{ marginLeft: 8, opacity: 0.7 }}>
          · CPU: {hardwareConcurrency}c{deviceMemory ? ` · RAM≈${deviceMemory}GB` : ''}
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>Heap:</span>{' '}
        <strong>{memory.usedJSHeapSize.toFixed(1)} MB</strong>
        <span style={{ opacity: 0.7 }}>
          {' '} / {memory.totalJSHeapSize.toFixed(1)} MB (limit {memory.jsHeapSizeLimit.toFixed(0)} MB)
        </span>
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>Pages:</span>{' '}
        <strong>{loadedPages}</strong> loaded / {totalPages} total
        {failedPages > 0 ? <span style={{ color: '#ff9c9c' }}> · failed {failedPages}</span> : null}
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>Workers:</span> <strong>{workerCount}</strong>
        {error ? <div style={{ color: '#ff9c9c', marginTop: 4 }}>Error: {String(error)}</div> : null}
      </div>

      {messages.length > 0 && (
        <div style={{ ...sectionStyle, maxHeight: '24vh', overflowY: 'auto' }}>
          <div style={{ ...labelStyle, marginBottom: 2 }}>Messages:</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {messages.map((msg, i) => (
              <li key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {String(msg)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PerformanceMonitor;
