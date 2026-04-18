// File: src/utils/performanceOverlayFlag.js
/**
 * Shared runtime toggle helpers for optional diagnostics UI.
 *
 * The performance overlay is intentionally opt-in. Consumers can use the same helper both during
 * bootstrap and after React mounts so support tooling does not retain extra host metadata unless the
 * overlay is actually enabled.
 */

/**
 * @param {string} value
 * @returns {string}
 */
function escapeMetaName(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Resolve a boolean flag from (precedence order):
 *   1) window.__ODV_CONFIG__[name]
 *   2) import.meta.env[envVar]
 *   3) <meta name="{metaName}" content="true|false">
 *   4) fallback
 *
 * @param {string} name
 * @param {string} envVar
 * @param {string} metaName
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
export function readRuntimeBooleanFlag(name, envVar, metaName, fallback = false) {
  try {
    const cfg = (typeof window !== 'undefined' && window.__ODV_CONFIG__) || undefined;
    if (cfg && typeof cfg[name] === 'boolean') return cfg[name];

    const envVal =
      typeof import.meta !== 'undefined'
      && import.meta
      && import.meta.env
      && typeof import.meta.env[envVar] === 'string'
        ? String(import.meta.env[envVar]).trim()
        : '';
    if (envVal) {
      const normalized = envVal.toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }

    if (typeof document !== 'undefined' && metaName) {
      const meta = document.querySelector(`meta[name="${escapeMetaName(metaName)}"]`);
      const content = meta && meta.getAttribute('content');
      if (typeof content === 'string') {
        const normalized = content.toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
      }
    }
  } catch {
    // ignore and fall through
  }
  return fallback;
}

/**
 * Determine whether the diagnostics/performance overlay is enabled.
 *
 * @returns {boolean}
 */
export function isPerformanceOverlayEnabled() {
  return (
    readRuntimeBooleanFlag('showPerfOverlay', 'VITE_SHOW_PERF_OVERLAY', 'odv-show-perf-overlay', false)
    || (
      typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('perf') === '1'
    )
  );
}

export default {
  readRuntimeBooleanFlag,
  isPerformanceOverlayEnabled,
};
