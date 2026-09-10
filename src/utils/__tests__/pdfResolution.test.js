import { describe, expect, it } from 'vitest';
import { resolvePdfRenderScale, resolvePdfResolutionBoost, normalizePdfResolution } from '../pdfResolution.js';
import { createPersistedPageAssetKey } from '../reloadCacheIdentity.js';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';

const sizes = { A5: [420, 595], A4: [595, 842], A3: [842, 1191] };
const PRINT_SCALE = 300 / 72; // 4.1666…: auto targets 300 dpi regardless of the screen.
// Format, CSS width, DPR: the screen must not change the factor (rasters are also printed).
const cases = [
  ['A5', 1280, 1], ['A5', 1920, 2],
  ['A4', 1280, 1], ['A4', 1920, 2],
  ['A3', 1280, 1], ['A3', 1920, 2],
];
const input = { pageWidthPt: 595, pageHeightPt: 842, viewerWidthCss: 1500, devicePixelRatio: 1 };

describe('PDF resolution policy', () => {
  it.each(cases)('%s at width %s and DPR %s resolves to 300 dpi', (format, viewerWidthCss, devicePixelRatio) => {
    const [pageWidthPt, pageHeightPt] = sizes[format];
    const result = resolvePdfRenderScale({ pageWidthPt, pageHeightPt, viewerWidthCss, devicePixelRatio });
    expect(result.scale).toBeCloseTo(PRINT_SCALE, 5);
    expect(result.reason).toBe('auto');
    expect(result.pixels).toBe(Math.ceil(pageWidthPt * result.scale) * Math.ceil(pageHeightPt * result.scale));
  });
  it('gives A4 a print-quality raster of 2480 x 3509 pixels', () => {
    const result = resolvePdfRenderScale(input);
    expect(result.scale).toBeCloseTo(PRINT_SCALE);
    expect(Math.ceil(595 * result.scale)).toBe(2480);
    expect(Math.ceil(842 * result.scale)).toBe(3509);
  });
  it('honors targetDpi within its bounds and the policy ceiling', () => {
    expect(resolvePdfRenderScale({ ...input, config: { pdfResolution: { targetDpi: 200 } } }).scale).toBeCloseTo(200 / 72);
    expect(resolvePdfRenderScale({ ...input, config: { pdfResolution: { targetDpi: 600 } } })).toMatchObject({ scale: 6, reason: 'max-scale' });
    expect(normalizePdfResolution({ pdfResolution: { targetDpi: 10 } }).targetDpi).toBe(72);
    expect(normalizePdfResolution({ pdfResolution: { targetDpi: 'junk' } }).targetDpi).toBe(300);
  });
  it('ignores rotation, viewer width, DPR and headroom for the factor', () => {
    const base = resolvePdfRenderScale(input);
    expect(resolvePdfRenderScale({ ...input, rotation: 90 }).scale).toBeCloseTo(base.scale);
    expect(resolvePdfRenderScale({ ...input, viewerWidthCss: 400, devicePixelRatio: 1 }).scale).toBeCloseTo(base.scale);
    expect(resolvePdfRenderScale({ ...input, viewerWidthCss: 4000, devicePixelRatio: 3 }).scale).toBeCloseTo(base.scale);
    expect(resolvePdfRenderScale({ ...input, config: { pdfResolution: { headroom: 3, dprCap: 4 } } }).scale).toBeCloseTo(base.scale);
  });
  it('honors the legacy floor when it is above the print target', () => {
    expect(resolvePdfRenderScale({ ...input, config: { fullPageScale: 5 } })).toMatchObject({ scale: 5, reason: 'floor' });
    expect(resolvePdfRenderScale({ ...input, config: { fullPageScale: 3 } }).scale).toBeCloseTo(PRINT_SCALE);
  });
  it.each([0.5, 1.5, 2, 4])('preserves safe fixed raster dimensions at %s', (fixedScale) => {
    const result = resolvePdfRenderScale({ ...input, config: { pdfResolution: { mode: 'fixed', fixedScale } } });
    expect(result.scale).toBe(fixedScale);
    expect(result.pixels).toBe(Math.ceil(595 * fixedScale) * Math.ceil(842 * fixedScale));
  });
  it('bounds scale and applies the pixel budget after rounding, including low memory', () => {
    const large = { ...input, pageWidthPt: 4000, pageHeightPt: 6000, viewerWidthCss: 20000 };
    const normal = resolvePdfRenderScale(large);
    const low = resolvePdfRenderScale({ ...large, memoryTier: 'low' });
    expect(normal.pixels).toBeLessThanOrEqual(40e6);
    expect(low.pixels).toBeLessThanOrEqual(20e6);
    expect(low.scale).toBeLessThan(normal.scale);
    expect(low.clamped).toBe(true);
    expect(resolvePdfRenderScale({ ...input, config: { pdfResolution: { targetDpi: 1200 } } }).scale).toBe(6);
    const narrow = resolvePdfRenderScale({ ...large, pageWidthPt: 1e6, pageHeightPt: 1 });
    expect(Math.ceil(narrow.scale * 1e6)).toBeLessThanOrEqual(32767);
  });
  it('normalizes garbage, aliases, and inverted bounds', () => {
    expect(normalizePdfResolution({ pdfResolution: { mode: 'junk', fixedScale: 'junk', maxPixels: Infinity } })).toEqual(normalizePdfResolution());
    const render = getDocumentLoadingConfig({ documentLoading: { render: { fullPageScale: 4 } } }).render;
    expect(render.pdfResolution.fixedScale).toBe(4);
    expect(render.fullPageScale).toBe(4);
    expect(normalizePdfResolution({ fullPageScale: 4, pdfResolution: { fixedScale: 3 } }).fixedScale).toBe(4);
    const bounded = normalizePdfResolution({ pdfResolution: { minScale: 9, maxScale: -2, dprCap: 99 } });
    expect(bounded.maxScale).toBeGreaterThanOrEqual(bounded.minScale);
    expect(bounded.maxScale).toBeLessThanOrEqual(6);
    expect(bounded.dprCap).toBeLessThanOrEqual(4);
  });
  it('doubles the effective factor past the policy ceiling and stops only at the hard caps', () => {
    expect(resolvePdfResolutionBoost(input, 2)).toMatchObject({ scale: 4, available: true });
    // The auto policy already sits at maxScale (6) on a wide or high-DPI viewer. The boost must
    // still raise the factor: it is bounded by maxPixels/surface/scale limit, not by maxScale.
    const atCeiling = resolvePdfResolutionBoost(input, 6);
    expect(atCeiling.available).toBe(true);
    expect(atCeiling.scale).toBeGreaterThan(6);
    expect(atCeiling.scale).toBeLessThanOrEqual(12);
    expect(atCeiling.pixels).toBeLessThanOrEqual(40e6);
    // Twice the scale limit is never requested.
    expect(resolvePdfResolutionBoost(input, 12).available).toBe(false);
    // A page that already hits the pixel/surface caps cannot be boosted.
    const large = { ...input, pageWidthPt: 4000, pageHeightPt: 6000 };
    const capped = resolvePdfRenderScale(large);
    expect(resolvePdfResolutionBoost(large, capped.scale).available).toBe(false);
  });
  it('never shares persisted keys between effective factors', () => {
    const base = { sourceKey: 'document', pageIndex: 0, variant: 'full', renderSignature: 'policy' };
    expect(createPersistedPageAssetKey({ ...base, effectiveScale: 2 })).not.toBe(createPersistedPageAssetKey({ ...base, effectiveScale: 4 }));
  });
});
