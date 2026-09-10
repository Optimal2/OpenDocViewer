import { beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ states: [], assets: new Map(), renderer: null }));
// Execute provider callbacks with deterministic state/ref updates. DOM layout and React scheduling
// remain operator checks; these tests exercise the actual cache/boost callback implementation.
vi.mock('react', async (original) => ({
  ...await original(),
  useState: (initial) => {
    const slot = harness.states.length;
    harness.states.push(typeof initial === 'function' ? initial() : initial);
    return [harness.states[slot], (next) => { harness.states[slot] = typeof next === 'function' ? next(harness.states[slot]) : next; }];
  },
  useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {},
}));
vi.mock('../utils/pageAssetRenderer.js', () => ({ createPageAssetRenderer: () => harness.renderer }));
vi.mock('../utils/sourceTempStore.js', () => ({ createSourceTempStore: () => ({ ready: async () => {}, dispose: async () => {}, getStats: () => ({}) }) }));
vi.mock('../utils/pageAssetStore.js', () => ({ createPageAssetStore: () => ({
  ready: async () => {}, dispose: async () => {}, getStats: () => ({}),
  getAsset: async (key) => harness.assets.get(key) || null,
  putAsset: async (entry) => { harness.assets.set(entry.assetKey, { blob: entry.blob, meta: entry }); },
}) }));
import { ViewerProvider } from './ViewerProvider.jsx';
import { getDocumentLoadingConfig } from '../utils/documentLoadingConfig.js';
import { resolvePdfViewportResolution } from '../utils/pdfResolution.js';
import { getPdfResolutionInputs } from '../utils/pdfResolutionRuntime.js';
import { revokeTrackedObjectUrl } from '../utils/objectUrlRegistry.js';

beforeEach(() => { harness.states = []; harness.assets.clear(); });
async function setup(scale = 2, pdfResolutionOverrides = {}) {
  const config = getDocumentLoadingConfig({ documentLoading: {
    render: { pdfResolution: { mode: 'fixed', fixedScale: scale, ...pdfResolutionOverrides }, thumbnailSourceStrategy: 'dedicated' },
    assetStore: { persistFullPagesInBackground: false },
  } });
  const viewport = { width: 595, height: 842 };
  harness.renderer = {
    updateConfig: vi.fn(), dispose: async () => {},
    resolvePdfPageResolution: async (_page, options) => resolvePdfViewportResolution(viewport, getPdfResolutionInputs(config.render, options)),
    renderPageAsset: vi.fn(async (_page, options) => {
      const pdfResolution = resolvePdfViewportResolution(viewport, getPdfResolutionInputs(config.render, options));
      return { blob: new Blob(['raster']), width: Math.ceil(595 * pdfResolution.scale), height: Math.ceil(842 * pdfResolution.scale), pdfResolution };
    }),
  };
  const api = ViewerProvider({ children: null }).props.value;
  await api.initializeDocumentSession({ config });
  api.registerSourceDescriptor({ sourceKey: 'pdf', fileExtension: 'pdf', fileIndex: 0 });
  api.insertPageAtIndex({ sourceKey: 'pdf', pageIndex: 0, fileExtension: 'pdf', status: 0 }, 0);
  return api;
}

describe('provider PDF resolution and asset replacement', () => {
  it('doubles the actual factor, replaces the visible URL and keeps the boosted URL cached', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    expect(original).toMatch(/^blob:/);
    expect(await api.enhancePdfPageResolution(0)).toBe(true);
    const boosted = await api.ensurePageAsset(0, 'full');
    expect(boosted).not.toBe(original);
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(2);
    expect(harness.renderer.renderPageAsset.mock.calls[1][1].pdfResolutionInput.config.pdfResolution.fixedScale).toBe(4);
    expect(await api.enhancePdfPageResolution(0)).toBe(false);
    expect(harness.states.find((state) => state?.boostedKeys)?.boostedKeys).toEqual(['pdf:0']);
    expect([...harness.assets.keys()]).toHaveLength(1);
    expect([...harness.assets.keys()][0]).toMatch(/:2$/);
    revokeTrackedObjectUrl(boosted);
    const recovered = await api.ensurePageAsset(0, 'full');
    expect(recovered).not.toBe(boosted);
    expect(harness.renderer.renderPageAsset.mock.calls[2][1].pdfResolutionInput.config.pdfResolution.fixedScale).toBe(4);
    expect([...harness.assets.keys()]).toHaveLength(1);
    await api.disposeDocumentSession();
  });
  it('keeps the visible asset during a boost and lets a concurrent ordinary request join it', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    let resolveRender;
    const gate = new Promise((resolve) => { resolveRender = resolve; });
    const realRender = harness.renderer.renderPageAsset.getMockImplementation();
    harness.renderer.renderPageAsset.mockImplementationOnce(async (page, options) => { await gate; return realRender(page, options); });

    const boost = api.enhancePdfPageResolution(0);
    await Promise.resolve();
    // The page is still showing the original asset while the boost renders: no blanking, no reload.
    const during = harness.states.find((state) => Array.isArray(state) && state[0]?.fullSizeUrl !== undefined);
    expect(during?.[0]?.fullSizeUrl).toBe(original);
    expect(during?.[0]?.fullSizeStatus).toBe(1);
    // An ordinary request from the viewer during the boost gets the still-visible asset back and
    // starts no second render (that second render used to land last and undo the boost).
    expect(await api.ensurePageAsset(0, 'full', { priority: 'critical' })).toBe(original);
    resolveRender();
    expect(await boost).toBe(true);
    const boostedUrl = await api.ensurePageAsset(0, 'full');
    expect(boostedUrl).not.toBe(original);
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(2);
    expect(harness.renderer.renderPageAsset.mock.calls[1][1].pdfResolutionInput.config.pdfResolution.fixedScale).toBe(4);
    await api.disposeDocumentSession();
  });
  it('boosts a page that already sits at the policy ceiling (maxScale)', async () => {
    const api = await setup(6);
    const original = await api.ensurePageAsset(0, 'full');
    expect(await api.enhancePdfPageResolution(0)).toBe(true);
    expect(await api.ensurePageAsset(0, 'full')).not.toBe(original);
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(2);
    const boostedInput = harness.renderer.renderPageAsset.mock.calls[1][1].pdfResolutionInput.config.pdfResolution;
    expect(boostedInput.fixedScale).toBeGreaterThan(6);
    expect(boostedInput.maxScale).toBeGreaterThanOrEqual(boostedInput.fixedScale);
    const state = harness.states.find((s) => s?.boostedKeys);
    expect(state.boostedKeys).toEqual(['pdf:0']);
    expect(state.maxedKeys).toEqual([]);
    await api.disposeDocumentSession();
  });
  it('marks a page maxed, not boosted, when the hard caps already bind', async () => {
    // maxPixels just above the raster at factor 6: no higher factor fits, so the boost is unavailable.
    const api = await setup(6, { maxPixels: Math.ceil(595 * 6) * Math.ceil(842 * 6) + 1 });
    const original = await api.ensurePageAsset(0, 'full');
    expect(await api.enhancePdfPageResolution(0)).toBe(false);
    expect(await api.ensurePageAsset(0, 'full')).toBe(original);
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(1);
    const state = harness.states.find((s) => s?.boostedKeys);
    expect(state.boostedKeys).toEqual([]);
    expect(state.maxedKeys).toEqual(['pdf:0']);
    // A maxed page is not retried.
    expect(await api.enhancePdfPageResolution(0)).toBe(false);
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(1);
    await api.disposeDocumentSession();
  });
  it('restores the matching factor and cannot restore another resolution on a fresh page', async () => {
    const api = await setup(2);
    await api.ensurePageAsset(0, 'full');
    api.insertPageAtIndex({ sourceKey: 'pdf', pageIndex: 0, fileExtension: 'pdf', status: 0 }, 1);
    await api.ensurePageAsset(1, 'full');
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(1);
    // A stale bitmap under another effective factor must be a cache miss.
    const [key, asset] = [...harness.assets.entries()][0];
    harness.assets.clear();
    harness.assets.set(key.replace(/:2$/, ':4'), asset);
    api.insertPageAtIndex({ sourceKey: 'pdf', pageIndex: 0, fileExtension: 'pdf', status: 0 }, 2);
    await api.ensurePageAsset(2, 'full');
    expect(harness.renderer.renderPageAsset).toHaveBeenCalledTimes(2);
    await api.disposeDocumentSession();
  });
  it('does not serve the previous factor when an explicit scale is requested without forceRefresh', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const replacement = await api.ensurePageAsset(0, 'full', { fullPageScale: 4 });
    expect(replacement).not.toBe(original);
    expect([...harness.assets.keys()].map((key) => key.slice(-2)).sort()).toEqual([':2', ':4']);
    await api.disposeDocumentSession();
  });
});
