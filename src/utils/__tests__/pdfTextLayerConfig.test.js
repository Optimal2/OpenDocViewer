// File: src/utils/__tests__/pdfTextLayerConfig.test.js
/**
 * The `pdfTextLayer.enabled` switch (a PDF page's own text as a text layer while OCR is off):
 * only the boolean literal `true` turns it on; `isPageTextEnabled` is the gate of everything
 * that works on a page's text and is on when either switch is; the shipped configuration and
 * the sample site file keep it off, and a site file turns it on with the literal alone. The
 * public scripts are evaluated in a JSDOM window as the browser would run them.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOcrEnabled, isPageTextEnabled, isPdfTextLayerEnabled } from '../runtimeConfig.js';

/**
 * Evaluate the public config script(s) in a fresh JSDOM window, as src/utils/__tests__/ocrConfig.test.js
 * does, and read the switch back through the accessors.
 *
 * @param {{ siteConfig?: Object, useSampleSiteFile?: boolean }} [options]
 */
function readConfig({ siteConfig, useSampleSiteFile = false } = {}) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    if (useSampleSiteFile) dom.window.eval(readFileSync('public/odv.site.config.sample.js', 'utf8'));
    if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    const cfg = JSON.parse(JSON.stringify(dom.window.__ODV_CONFIG__));
    return {
      section: cfg.pdfTextLayer,
      pdfText: isPdfTextLayerEnabled(cfg),
      pageText: isPageTextEnabled(cfg),
      ocr: isOcrEnabled(cfg),
    };
  } finally {
    dom.window.close();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPdfTextLayerEnabled', () => {
  it.each([
    ['no config', undefined, false],
    ['an empty config', {}, false],
    ['a missing key', { pdfTextLayer: {} }, false],
    ['false', { pdfTextLayer: { enabled: false } }, false],
    ['the string "true"', { pdfTextLayer: { enabled: 'true' } }, false],
    ['the number 1', { pdfTextLayer: { enabled: 1 } }, false],
    ['an object', { pdfTextLayer: { enabled: {} } }, false],
    ['a bare true for the section', { pdfTextLayer: true }, false],
    ['null for the section', { pdfTextLayer: null }, false],
    ['the literal true', { pdfTextLayer: { enabled: true } }, true],
  ])('%s', (_label, cfg, expected) => {
    expect(isPdfTextLayerEnabled(cfg)).toBe(expected);
  });

  it('is independent of ocr.enabled', () => {
    expect(isPdfTextLayerEnabled({ ocr: { enabled: true } })).toBe(false);
    expect(isOcrEnabled({ pdfTextLayer: { enabled: true } })).toBe(false);
  });

  it('reads the viewer config when called without an argument', () => {
    vi.stubGlobal('window', { __ODV_CONFIG__: { pdfTextLayer: { enabled: true } } });
    expect(isPdfTextLayerEnabled()).toBe(true);
    expect(isPageTextEnabled()).toBe(true);
    expect(isOcrEnabled()).toBe(false);
  });
});

describe('isPageTextEnabled', () => {
  it.each([
    ['both off', { ocr: { enabled: false }, pdfTextLayer: { enabled: false } }, false],
    ['nothing configured', {}, false],
    ['only OCR on', { ocr: { enabled: true } }, true],
    ['only the PDF text on', { pdfTextLayer: { enabled: true } }, true],
    ['both on', { ocr: { enabled: true }, pdfTextLayer: { enabled: true } }, true],
    ['both as strings', { ocr: { enabled: 'true' }, pdfTextLayer: { enabled: 'true' } }, false],
  ])('%s', (_label, cfg, expected) => {
    expect(isPageTextEnabled(cfg)).toBe(expected);
  });
});

describe('shipped configuration', () => {
  it('ships pdfTextLayer.enabled false, and nothing else in the section', () => {
    expect(readConfig()).toEqual({ section: { enabled: false }, pdfText: false, pageText: false, ocr: false });
  });

  it('keeps it off with the sample site file, where the line that turns it on is commented out', () => {
    expect(readFileSync('public/odv.site.config.sample.js', 'utf8')).toMatch(/pdfTextLayer: \{[^}]*\/\/ enabled: true\s*\}/);
    expect(readConfig({ useSampleSiteFile: true })).toMatchObject({ pdfText: false, pageText: false });
  });

  it('is turned on by a site file with the literal true alone, without turning OCR on', () => {
    expect(readConfig({ siteConfig: { pdfTextLayer: { enabled: true } } })).toEqual({
      section: { enabled: true }, pdfText: true, pageText: true, ocr: false,
    });
    expect(readConfig({ siteConfig: { pdfTextLayer: { enabled: 'true' } } })).toMatchObject({ pdfText: false, pageText: false });
    expect(readConfig({ siteConfig: { ocr: { enabled: true } } })).toMatchObject({ pdfText: false, pageText: true, ocr: true });
  });
});
