import { describe, expect, it } from 'vitest';
import { resolvePdfRenderScale, resolvePdfResolutionBoost, normalizePdfResolution } from '../pdfResolution.js';
import { createPersistedPageAssetKey } from '../reloadCacheIdentity.js';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';

const sizes = { A5: [420, 595], A4: [595, 842], A3: [842, 1191] };
// Format, CSS width, DPR, expected scale (rounded only in this table).
const cases = [
  ['A5', 1280, 1, 3.809524], ['A5', 1280, 2, 6],
  ['A5', 1920, 1, 5.714286], ['A5', 1920, 2, 6],
  ['A4', 1280, 1, 2.689076], ['A4', 1280, 2, 5.378151],
  ['A4', 1920, 1, 4.033613], ['A4', 1920, 2, 6],
  ['A3', 1280, 1, 2], ['A3', 1280, 2, 3.800475],
  ['A3', 1920, 1, 2.850356], ['A3', 1920, 2, 5.700713],
];
const input = { pageWidthPt: 595, pageHeightPt: 842, viewerWidthCss: 1500, devicePixelRatio: 1 };

describe('PDF resolution policy', () => {
  it.each(cases)('%s at width %s and DPR %s resolves to %s', (format, viewerWidthCss, devicePixelRatio, expected) => {
    const [pageWidthPt, pageHeightPt] = sizes[format];
    const result = resolvePdfRenderScale({ pageWidthPt, pageHeightPt, viewerWidthCss, devicePixelRatio });
    expect(result.scale).toBeCloseTo(expected, 5);
    expect(result.pixels).toBe(Math.ceil(pageWidthPt * result.scale) * Math.ceil(pageHeightPt * result.scale));
  });
  it('renders A4 above 3 at a measured 1500 CSS pixels', () => {
    expect(resolvePdfRenderScale(input).scale).toBeCloseTo(3.1512605);
  });
  it('uses the rotated width once', () => {
    expect(resolvePdfRenderScale({ ...input, rotation: 90 }).scale).toBeCloseTo(1500 * 1.25 / 842);
    expect(resolvePdfRenderScale({ ...input, rotation: 270 }).scale).toBeCloseTo(1500 * 1.25 / 842);
  });
  it('honors the legacy floor and caps DPR', () => {
    expect(resolvePdfRenderScale({ ...input, config: { fullPageScale: 4 } }).scale).toBe(4);
    expect(resolvePdfRenderScale({ ...input, devicePixelRatio: 8 })).toEqual(resolvePdfRenderScale({ ...input, devicePixelRatio: 2 }));
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
    expect(resolvePdfRenderScale({ ...input, viewerWidthCss: 20000 }).scale).toBe(6);
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
  it('doubles the effective factor and reports when the maximum is already reached', () => {
    expect(resolvePdfResolutionBoost(input, 2)).toMatchObject({ scale: 4, available: true });
    expect(resolvePdfResolutionBoost(input, 4)).toMatchObject({ scale: 6, available: true });
    expect(resolvePdfResolutionBoost(input, 6)).toMatchObject({ scale: 6, available: false });
    const large = { ...input, pageWidthPt: 4000, pageHeightPt: 6000 };
    const capped = resolvePdfRenderScale(large);
    expect(resolvePdfResolutionBoost(large, capped.scale).available).toBe(false);
  });
  it('never shares persisted keys between effective factors', () => {
    const base = { sourceKey: 'document', pageIndex: 0, variant: 'full', renderSignature: 'policy' };
    expect(createPersistedPageAssetKey({ ...base, effectiveScale: 2 })).not.toBe(createPersistedPageAssetKey({ ...base, effectiveScale: 4 }));
  });
});
