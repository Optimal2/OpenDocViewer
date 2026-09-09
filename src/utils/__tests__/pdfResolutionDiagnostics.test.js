import { afterEach, expect, it, vi } from 'vitest';
import { collectSupportDiagnostics } from '../supportDiagnostics.js';
import { recordPdfResolution } from '../pdfResolutionRuntime.js';

afterEach(() => vi.unstubAllGlobals());
it('exports site outcome and normalized policy with actual rendering measurements', () => {
  const status = { attempted: true, url: '/odv.site.config.js', loaded: false, reason: 'wrong-content-type' };
  vi.stubGlobal('window', {
    innerWidth: 1920, devicePixelRatio: 2,
    __ODV_SITE_CONFIG_STATUS__: status, __ODV_SITE_CONFIG_KEYS__: ['documentLoading'],
    __ODV_CONFIG__: { documentLoading: { render: { fullPageScale: 4 } } },
  });
  recordPdfResolution({ scale: 4, viewerWidthCss: 1500, devicePixelRatio: 1, pixels: 8015840, reason: 'floor' });
  const loading = collectSupportDiagnostics().config.documentLoading;
  expect(loading.siteConfigStatus).toEqual(status);
  expect(loading.siteConfigKeys).toEqual(['documentLoading']);
  expect(loading.pdfResolution).toMatchObject({ mode: 'auto', fixedScale: 4, latestScale: 4, viewerWidthCss: 1500, devicePixelRatio: 1 });
});
