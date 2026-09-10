/** Pure, per-page PDF display resolution policy shared by browser and worker renderers. */
import { clampRenderSurfaceSize } from './renderSurfaceBounds.js';

export const PDF_RESOLUTION_DEFAULTS = Object.freeze({
  mode: 'auto', fixedScale: 2, minScale: 1.5, maxScale: 6,
  headroom: 1.25, dprCap: 2, maxPixels: 40e6,
});

/**
 * Upper bound for configured scale factors. The policy ceiling (maxScale) defaults to 6; the
 * one-shot resolution boost may go to twice that. Memory is protected by maxPixels and the
 * browser render-surface limits, not by this number.
 */
export const PDF_RESOLUTION_SCALE_LIMIT = 12;

function bounded(value, fallback, min, max) {
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/** Normalize a render config, including the legacy fullPageScale alias. */
export function normalizePdfResolution(render = {}) {
  const raw = render?.pdfResolution || {};
  const defaults = PDF_RESOLUTION_DEFAULTS;
  const limit = PDF_RESOLUTION_SCALE_LIMIT;
  const minScale = bounded(raw.minScale, defaults.minScale, 0.5, 6);
  const mode = raw.mode === 'fixed' ? 'fixed' : 'auto';
  const fixedScale = bounded(raw.fixedScale ?? render?.fullPageScale, defaults.fixedScale, 0.5, limit);
  return {
    mode,
    fixedScale: mode === 'auto' ? Math.max(fixedScale, bounded(render?.fullPageScale, 0.5, 0.5, limit)) : fixedScale,
    minScale,
    maxScale: Math.max(minScale, bounded(raw.maxScale, defaults.maxScale, 0.5, limit)),
    headroom: bounded(raw.headroom, defaults.headroom, 1, 3),
    dprCap: bounded(raw.dprCap, defaults.dprCap, 1, 4),
    maxPixels: bounded(raw.maxPixels, defaults.maxPixels, 1, 268435456),
  };
}

/**
 * Resolve an effective scale without reading browser globals. Dimensions are unrotated PDF points;
 * when passing an already rotated scale-one PDF.js viewport, leave rotation at zero.
 * Safety limits take precedence over the configured floor, including in fixed mode.
 * @param {Object} input
 * @returns {{scale:number, reason:string, clamped:boolean, pixels:number}}
 */
export function resolvePdfRenderScale({ pageWidthPt, pageHeightPt, rotation = 0, viewerWidthCss, devicePixelRatio, config, memoryTier } = {}) {
  const policy = normalizePdfResolution(config);
  let width = bounded(pageWidthPt, 1, 1, Number.MAX_SAFE_INTEGER);
  let height = bounded(pageHeightPt, 1, 1, Number.MAX_SAFE_INTEGER);
  if (Math.abs(Number(rotation) % 180) === 90) [width, height] = [height, width];
  const cssWidth = bounded(viewerWidthCss, width, 1, Number.MAX_SAFE_INTEGER);
  const dpr = bounded(devicePixelRatio, 1, 0.1, policy.dprCap);
  const requested = policy.mode === 'fixed'
    ? policy.fixedScale
    : cssWidth * dpr * policy.headroom / width;
  const floor = policy.mode === 'fixed' ? 0 : Math.max(policy.minScale, policy.fixedScale);
  let scale = Math.min(policy.maxScale, Math.max(floor, requested));
  let reason = policy.mode === 'fixed' ? 'fixed' : 'auto';
  if (scale > requested) reason = 'floor';
  if (scale < requested) reason = 'max-scale';
  const maxPixels = Math.max(1, Math.floor(policy.maxPixels / (memoryTier === 'low' ? 2 : 1)));
  const pixelsAt = (value) => Math.max(1, Math.ceil(width * value)) * Math.max(1, Math.ceil(height * value));
  const surface = clampRenderSurfaceSize(width * scale, height * scale);
  if (surface.clamped || pixelsAt(scale) > maxPixels) {
    reason = surface.clamped ? 'surface-limit' : 'max-pixels';
    // Search against integer canvas dimensions so rounding cannot exceed the area/dimension caps.
    let lower = 0;
    let upper = scale;
    for (let step = 0; step < 64; step += 1) {
      const candidate = (lower + upper) / 2;
      if (pixelsAt(candidate) <= maxPixels && !clampRenderSurfaceSize(width * candidate, height * candidate).clamped) lower = candidate;
      else upper = candidate;
    }
    scale = lower;
  }
  return { scale, reason, clamped: scale !== requested, pixels: pixelsAt(scale) };
}

/**
 * Double the current effective scale for a one-shot boost. The policy ceiling (maxScale) does not
 * apply: on high-DPI or wide viewers the auto policy already sits at that ceiling, and a boost
 * "within the same ceiling" could never do anything. Only the hard safety caps (maxPixels, the
 * browser render surface and the scale limit) bound the boost; when they already bind, the page
 * is reported as not boostable (`available: false`).
 */
export function resolvePdfResolutionBoost(input, currentScale) {
  const policy = normalizePdfResolution(input?.config);
  const target = Math.min(PDF_RESOLUTION_SCALE_LIMIT, currentScale * 2);
  const result = resolvePdfRenderScale({
    ...input,
    config: { pdfResolution: { ...policy, mode: 'fixed', fixedScale: target, maxScale: Math.max(policy.maxScale, target) } },
  });
  return { ...result, available: result.scale > currentScale * (1 + 1e-9) };
}

/** Resolve a scale-one, already rotated PDF.js viewport and retain inputs for cache/boost checks. */
export function resolvePdfViewportResolution(viewport, input) {
  const dimensions = { pageWidthPt: viewport.width, pageHeightPt: viewport.height, rotation: 0 };
  return { ...input, ...dimensions, ...resolvePdfRenderScale({ ...input, ...dimensions }) };
}
