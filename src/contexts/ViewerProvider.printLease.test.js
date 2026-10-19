import { beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ states: [], assets: new Map(), renderer: null }));
// Same deterministic harness as ViewerProvider.test.js: execute provider callbacks with
// direct state/ref updates. These tests exercise the print-URL lease implementation.
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
import { isTrackedObjectUrl } from '../utils/objectUrlRegistry.js';

beforeEach(() => { harness.states = []; harness.assets.clear(); });
async function setup(scale = 2) {
  const config = getDocumentLoadingConfig({ documentLoading: {
    render: { pdfResolution: { mode: 'fixed', fixedScale: scale }, thumbnailSourceStrategy: 'dedicated' },
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

describe('print URL lease across a resolution boost', () => {
  it('keeps a captured print URL valid when a boost commits before the print fetches it', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const urls = await api.getPrintablePageUrls([0]);
      expect(urls).toEqual([original]);

      expect(await api.enhancePdfPageResolution(0)).toBe(true);
      const boosted = await api.ensurePageAsset(0, 'full');
      expect(boosted).not.toBe(original);

      // The print consumer captured `original` before the boost; it must still be fetchable.
      expect(isTrackedObjectUrl(original)).toBe(true);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(0);
      expect(isTrackedObjectUrl(boosted)).toBe(true);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('revokes the superseded print URL after the print flow releases it', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const urls = await api.getPrintablePageUrls([0]);
      expect(await api.enhancePdfPageResolution(0)).toBe(true);
      const boosted = await api.ensurePageAsset(0, 'full');

      api.releasePrintablePageUrls(urls);

      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(1);
      expect(isTrackedObjectUrl(original)).toBe(false);
      // The live boosted asset is untouched by the release.
      expect(isTrackedObjectUrl(boosted)).toBe(true);
      expect((await api.ensurePageAsset(0, 'full'))).toBe(boosted);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('revokes a leased live URL on release when the print flow is cancelled before fetching', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      // Capture for print, then supersede without the print ever fetching.
      const urls = await api.getPrintablePageUrls([0]);
      expect(await api.enhancePdfPageResolution(0)).toBe(true);

      // Cancel: release without fetching. No leak: the superseded URL is revoked exactly once.
      api.releasePrintablePageUrls(urls);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(1);
      expect(isTrackedObjectUrl(original)).toBe(false);

      // Releasing the same list again is a no-op, never a double revoke.
      api.releasePrintablePageUrls(urls);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(1);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('revokes a freshly rendered ephemeral print URL when the print flow is cancelled', async () => {
    const api = await setup(2);
    await api.ensurePageAsset(0, 'full');
    api.insertPageAtIndex({ sourceKey: 'pdf', pageIndex: 1, fileExtension: 'pdf', status: 0 }, 1);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      // Page 1 has no live asset, so the print handoff renders a short-lived URL for it.
      const urls = await api.getPrintablePageUrls([1]);
      expect(urls).toHaveLength(1);
      expect(isTrackedObjectUrl(urls[0])).toBe(true);

      // Cancel before fetching: the ephemeral URL must not leak.
      api.releasePrintablePageUrls(urls);
      expect(isTrackedObjectUrl(urls[0])).toBe(false);
      expect(revokeSpy.mock.calls.filter(([url]) => url === urls[0])).toHaveLength(1);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('keeps a doubly leased URL alive until the last concurrent print releases it', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const first = await api.getPrintablePageUrls([0]);
      const second = await api.getPrintablePageUrls([0]);
      expect(first).toEqual([original]);
      expect(second).toEqual([original]);

      expect(await api.enhancePdfPageResolution(0)).toBe(true);
      const boosted = await api.ensurePageAsset(0, 'full');
      expect(boosted).not.toBe(original);

      // One lease is still outstanding: the first release must not revoke.
      api.releasePrintablePageUrls(first);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(0);
      expect(isTrackedObjectUrl(original)).toBe(true);

      api.releasePrintablePageUrls(second);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(1);
      expect(isTrackedObjectUrl(original)).toBe(false);
      expect(isTrackedObjectUrl(boosted)).toBe(true);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('does not revoke a still-referenced live URL when its print lease is released', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const urls = await api.getPrintablePageUrls([0]);
      // No boost happened: the URL is still the live page asset.
      api.releasePrintablePageUrls(urls);
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(0);
      expect(isTrackedObjectUrl(original)).toBe(true);
      expect(await api.ensurePageAsset(0, 'full')).toBe(original);
    } finally {
      revokeSpy.mockRestore();
      await api.disposeDocumentSession();
    }
  });

  it('revokes a superseded leased URL on dispose even when the print never releases it', async () => {
    const api = await setup(2);
    const original = await api.ensurePageAsset(0, 'full');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      await api.getPrintablePageUrls([0]);
      expect(await api.enhancePdfPageResolution(0)).toBe(true);
      const boosted = await api.ensurePageAsset(0, 'full');
      expect(boosted).not.toBe(original);

      // The print flow never releases its lease; session teardown must still revoke it.
      await api.disposeDocumentSession();
      expect(revokeSpy.mock.calls.filter(([url]) => url === original)).toHaveLength(1);
      expect(isTrackedObjectUrl(original)).toBe(false);
      expect(isTrackedObjectUrl(boosted)).toBe(false);
    } finally {
      revokeSpy.mockRestore();
    }
  });
});
