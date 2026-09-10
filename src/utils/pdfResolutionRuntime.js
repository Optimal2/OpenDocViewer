/** Browser measurements and diagnostic state kept outside the pure PDF resolution policy. */
import { normalizePdfResolution } from './pdfResolution.js';
import { getRuntimeMemoryProfile } from './memoryProfile.js';

let readViewerWidth = null;
let latestResolution = null;

/** Register a live content-width measurement without triggering renders on resize. */
export function registerPdfViewerWidth(readWidth) {
  readViewerWidth = readWidth;
  return () => { if (readViewerWidth === readWidth) readViewerWidth = null; };
}

/** Capture serializable browser inputs before sending a render request to a window-less worker. */
export function getPdfResolutionInputs(config, options = {}) {
  if (options.pdfResolutionInput) return options.pdfResolutionInput;
  const policy = normalizePdfResolution(config);
  const override = Number(options.fullPageScale);
  // An explicit per-render override (the resolution boost) may exceed the policy ceiling; the
  // safety caps inside resolvePdfRenderScale still apply.
  const effectivePolicy = Number.isFinite(override) && override > 0
    ? { ...policy, mode: 'fixed', fixedScale: override, maxScale: Math.max(policy.maxScale, override) }
    : policy;
  const win = typeof window === 'undefined' ? null : window;
  return {
    config: { pdfResolution: effectivePolicy },
    viewerWidthCss: Number(options.viewerWidthCss) || Number(readViewerWidth?.()) || Number(win?.innerWidth) || 0,
    devicePixelRatio: Number(options.devicePixelRatio) || Number(win?.devicePixelRatio) || 1,
    memoryTier: options.memoryTier || getRuntimeMemoryProfile().tier,
  };
}

/** Record successful rendering/restoration only; never collect document identifiers. */
export function recordPdfResolution(resolution) {
  if (resolution?.scale > 0) latestResolution = resolution;
}

/** Effective PDF display diagnostics, with null scale until a page has been rendered. */
export function getPdfResolutionDiagnostics(config) {
  const current = getPdfResolutionInputs(config);
  return {
    ...normalizePdfResolution(config),
    latestScale: latestResolution?.scale ?? null,
    reason: latestResolution?.reason ?? null,
    pixels: latestResolution?.pixels ?? null,
    devicePixelRatio: latestResolution?.devicePixelRatio ?? current.devicePixelRatio,
    viewerWidthCss: latestResolution?.viewerWidthCss ?? current.viewerWidthCss,
    memoryTier: latestResolution?.memoryTier ?? current.memoryTier,
  };
}
