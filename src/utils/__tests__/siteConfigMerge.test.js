import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';
import {
  isCompareCurtainEnabled,
  isCompareCurtainPrintEnabled,
  isCompareOverlayEnabled,
  isCompareOverlayPrintEnabled,
  getCompareAdjustToolbarMode,
} from '../runtimeConfig.js';

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

it('keeps the compare view switches on by default and deep-merges a single site override', () => {
  const read = (siteConfig) => {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      return {
        compare: dom.window.__ODV_CONFIG__.compare,
        overlay: isCompareOverlayEnabled(),
        overlayPrint: isCompareOverlayPrintEnabled(),
        curtain: isCompareCurtainEnabled(),
        curtainPrint: isCompareCurtainPrintEnabled(),
      };
    } finally {
      dom.window.close();
    }
  };

  const base = read(null);
  expect(base.compare).toEqual({
    overlay: { enabled: true, print: { enabled: true } },
    curtain: { enabled: true, print: { enabled: true } },
    adjust: { toolbarMode: 'mirror' },
  });
  expect(base).toMatchObject({ overlay: true, overlayPrint: true, curtain: true, curtainPrint: true });

  const site = read({ compare: { overlay: { print: { enabled: false } } } });
  expect(site).toMatchObject({ overlay: true, overlayPrint: false, curtain: true, curtainPrint: true });
});

it('ships toolbarMode mirror and deep-merges a site file that sets only compare.adjust.toolbarMode', () => {
  const read = (siteConfig) => {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      return {
        compare: JSON.parse(JSON.stringify(dom.window.__ODV_CONFIG__.compare)),
        toolbarMode: getCompareAdjustToolbarMode(),
        overlay: isCompareOverlayEnabled(),
        curtain: isCompareCurtainEnabled(),
      };
    } finally {
      dom.window.close();
    }
  };

  expect(read(null).toolbarMode).toBe('mirror');

  const site = read({ compare: { adjust: { toolbarMode: 'hide' } } });
  // The site override wins over the shipped default ...
  expect(site.toolbarMode).toBe('hide');
  // ... and the sibling compare keys survive untouched.
  expect(site.compare).toEqual({
    overlay: { enabled: true, print: { enabled: true } },
    curtain: { enabled: true, print: { enabled: true } },
    adjust: { toolbarMode: 'hide' },
  });
  expect(site).toMatchObject({ overlay: true, curtain: true });

  // A site file that switches a view off keeps the shipped toolbarMode.
  const viewOff = read({ compare: { curtain: { enabled: false } } });
  expect(viewOff.toolbarMode).toBe('mirror');
  expect(viewOff.compare.adjust).toEqual({ toolbarMode: 'mirror' });

  // An invalid site value is kept in the merged config but read back fail-safe.
  expect(read({ compare: { adjust: { toolbarMode: 'Hidden' } } }).toolbarMode).toBe('mirror');
});
