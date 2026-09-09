import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';

afterEach(() => vi.unstubAllGlobals());

it('preserves the site fullPageScale through the public script and render normalization', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = { documentLoading: { render: { fullPageScale: 4 } } };
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    // Use the same default runtime-config read as ViewerProvider and PageAssetRenderer.
    const render = getDocumentLoadingConfig().render;
    expect(render.fullPageScale).toBe(4);
    expect(render.pdfResolution.fixedScale).toBe(4);
    expect(dom.window.__ODV_SITE_CONFIG_KEYS__).toEqual(['documentLoading']);
  } finally {
    dom.window.close();
  }
});

it('lets an explicit nested fixedScale take precedence and normalizes invalid site values', () => {
  for (const [fixedScale, expected] of [[3, 3], ['garbage', 2]]) {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      dom.window.__ODV_SITE_CONFIG__ = {
        documentLoading: { render: { fullPageScale: 4, pdfResolution: { mode: 'fixed', fixedScale } } },
      };
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      const render = getDocumentLoadingConfig().render;
      expect(render.pdfResolution.fixedScale).toBe(expected);
      expect(render.fullPageScale).toBe(expected);
    } finally {
      dom.window.close();
    }
  }
});
