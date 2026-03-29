// File: src/utils/memoryProfile.js
/**
 * OpenDocViewer — Runtime memory profile helpers.
 *
 * Browser runtimes expose only partial memory signals, but even coarse values are useful when the
 * viewer must decide whether to favor aggressive caching / eager rendering or conservative memory
 * behavior. This module reads those signals once and maps them to a small tier model.
 */

/** @typedef {'unknown'|'low'|'medium'|'high'|'very-high'} RuntimeMemoryTier */

/**
 * @typedef {Object} RuntimeMemoryProfile
 * @property {number} deviceMemoryGb
 * @property {number} jsHeapLimitMiB
 * @property {RuntimeMemoryTier} tier
 * @property {boolean} hasDeviceMemorySignal
 * @property {boolean} hasHeapLimitSignal
 */

/**
 * @returns {number}
 */
function readDeviceMemoryGb() {
  try {
    if (typeof navigator === 'undefined') return 0;
    const value = Number(navigator.deviceMemory);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * @returns {number}
 */
function readJsHeapLimitMiB() {
  try {
    if (typeof performance === 'undefined' || !performance?.memory) return 0;
    const value = Number(performance.memory.jsHeapSizeLimit);
    return Number.isFinite(value) && value > 0 ? (value / (1024 * 1024)) : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {number} deviceMemoryGb
 * @param {number} jsHeapLimitMiB
 * @returns {RuntimeMemoryTier}
 */
function resolveTier(deviceMemoryGb, jsHeapLimitMiB) {
  if (deviceMemoryGb >= 24 || jsHeapLimitMiB >= 4096) return 'very-high';
  if (deviceMemoryGb >= 16 || jsHeapLimitMiB >= 3072) return 'high';
  if (deviceMemoryGb >= 8 || jsHeapLimitMiB >= 1536) return 'medium';
  if (deviceMemoryGb > 0 || jsHeapLimitMiB > 0) return 'low';
  return 'unknown';
}

/**
 * @returns {RuntimeMemoryProfile}
 */
export function getRuntimeMemoryProfile() {
  const deviceMemoryGb = readDeviceMemoryGb();
  const jsHeapLimitMiB = readJsHeapLimitMiB();

  return {
    deviceMemoryGb,
    jsHeapLimitMiB,
    tier: resolveTier(deviceMemoryGb, jsHeapLimitMiB),
    hasDeviceMemorySignal: deviceMemoryGb > 0,
    hasHeapLimitSignal: jsHeapLimitMiB > 0,
  };
}
