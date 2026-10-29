// File: src/utils/__tests__/ocrConfig.test.js
/**
 * Proves the shipped OCR configuration contract on the real public config files:
 * `public/odv.config.js` ships `ocr.enabled: false` with the documented defaults, the sample site
 * file keeps it off, and a site file can only turn it on with the boolean literal `true`.
 *
 * The public scripts are evaluated in a JSDOM window exactly as the browser would run them, and
 * the accessors are read through the same default runtime-config path the viewer uses.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOcrAssetBaseUrl, getOcrLanguages, isOcrEnabled } from '../runtimeConfig.js';

const SHIPPED_OCR_DEFAULTS = Object.freeze({ enabled: false, languages: ['swe', 'eng'], assetBaseUrl: null });

afterEach(() => vi.unstubAllGlobals());

/**
 * Evaluate the public config script(s) in a fresh JSDOM window and read the OCR values back
 * through the runtime-config accessors.
 *
 * @param {{ siteConfig?: Object, useSampleSiteFile?: boolean }} [options]
 */
function readOcrConfig({ siteConfig, useSampleSiteFile = false } = {}) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    if (useSampleSiteFile) dom.window.eval(readFileSync('public/odv.site.config.sample.js', 'utf8'));
    if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    return {
      ocr: JSON.parse(JSON.stringify(dom.window.__ODV_CONFIG__.ocr)),
      siteKeys: [...dom.window.__ODV_SITE_CONFIG_KEYS__],
      enabled: isOcrEnabled(),
      languages: getOcrLanguages(),
      assetBaseUrl: getOcrAssetBaseUrl(),
    };
  } finally {
    dom.window.close();
  }
}

describe('shipped OCR configuration', () => {
  it('ships OCR off with the documented defaults', () => {
    const shipped = readOcrConfig();
    expect(shipped.ocr).toEqual(SHIPPED_OCR_DEFAULTS);
    expect(shipped.enabled).toBe(false);
    expect(shipped.languages).toEqual(['swe', 'eng']);
    expect(shipped.assetBaseUrl).toBeNull();
    expect(shipped.siteKeys).toEqual([]);
  });

  it('keeps OCR off with the sample site file applied as-is', () => {
    const sample = readOcrConfig({ useSampleSiteFile: true });
    expect(sample.siteKeys).toContain('ocr');
    expect(sample.ocr).toEqual(SHIPPED_OCR_DEFAULTS);
    expect(sample.enabled).toBe(false);
  });

  it('lets a site file turn OCR on with the literal true and deep-merges the sub keys', () => {
    const site = readOcrConfig({ siteConfig: { ocr: { enabled: true, languages: ['swe'] } } });
    expect(site.ocr).toEqual({ enabled: true, languages: ['swe'], assetBaseUrl: null });
    expect(site.enabled).toBe(true);
    expect(site.languages).toEqual(['swe']);
    expect(site.assetBaseUrl).toBeNull();
  });

  it.each([
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an object', { value: true }],
  ])('keeps OCR off when a site file sets enabled to %s', (_label, value) => {
    const site = readOcrConfig({ siteConfig: { ocr: { enabled: value } } });
    expect(site.ocr.enabled).toEqual(value);
    expect(site.enabled).toBe(false);
  });

  it('reads a site assetBaseUrl without touching the off default', () => {
    const site = readOcrConfig({ siteConfig: { ocr: { assetBaseUrl: 'https://host.example/odv-ocr' } } });
    expect(site.enabled).toBe(false);
    expect(site.languages).toEqual(['swe', 'eng']);
    expect(site.assetBaseUrl).toBe('https://host.example/odv-ocr/');
  });

  it('freezes the top level of the merged config, so the ocr section cannot be replaced', () => {
    // Object.freeze in odv.config.js is shallow: the top-level object is frozen, nested sections
    // are not. This pins exactly that, so nobody reads a stronger guarantee into the config.
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      const cfg = dom.window.__ODV_CONFIG__;
      expect(Object.isFrozen(cfg)).toBe(true);
      expect(() => { 'use strict'; cfg.ocr = { enabled: true }; }).toThrow();
      expect(cfg.ocr.enabled).toBe(false);
      expect(Object.isFrozen(cfg.ocr)).toBe(false);
    } finally {
      dom.window.close();
    }
  });
});
