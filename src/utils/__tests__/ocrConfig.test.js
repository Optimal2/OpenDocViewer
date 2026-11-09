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
import {
  getOcrAssetBaseUrl,
  getOcrLanguages,
  isOcrEnabled,
  isOcrLineRemovalEnabled,
  isOcrWholeDocumentEnabled,
  isOcrSearchEnabled,
  isOcrSearchCtrlFOverrideEnabled,
  isReadAloudEnabled,
  isSpeechLanguageAutoDetectEnabled,
  resolveOcrWorkerCount,
} from '../runtimeConfig.js';

const SHIPPED_OCR_DEFAULTS = Object.freeze({
  enabled: false,
  removeRulingLines: true,
  recognizeWholeDocument: false,
  workerCount: 1,
  languages: ['swe', 'eng'],
  search: { enabled: true, overridesCtrlF: false },
  speech: { enabled: true, autoDetectLanguage: true },
  benchmark: {
    enabled: false,
    pageLimit: 40,
    sampleMode: 'evenly-spaced',
    workerCounts: [0],
    languageVariants: ['configured', 'single'],
    imageScales: [1, 0.75],
    iterations: 1,
    pageTimeoutMs: 180000,
    delayBetweenRunsMs: 500,
  },
  assetBaseUrl: null,
});

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
      removeRulingLines: isOcrLineRemovalEnabled(),
      wholeDocument: isOcrWholeDocumentEnabled(),
      search: isOcrSearchEnabled(),
      ctrlF: isOcrSearchCtrlFOverrideEnabled(),
      readAloud: isReadAloudEnabled(),
      autoDetect: isSpeechLanguageAutoDetectEnabled(),
      languages: getOcrLanguages(),
      assetBaseUrl: getOcrAssetBaseUrl(),
      workerCount: resolveOcrWorkerCount(undefined, { cores: 8 }),
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
    expect(shipped.removeRulingLines).toBe(true);
    expect(shipped.wholeDocument).toBe(false);
    expect(shipped.search).toBe(true);
    expect(shipped.ctrlF).toBe(false);
    expect(shipped.readAloud).toBe(true);
    expect(shipped.autoDetect).toBe(true);
    expect(shipped.languages).toEqual(['swe', 'eng']);
    expect(shipped.assetBaseUrl).toBeNull();
    expect(shipped.workerCount).toBe(1);
    expect(shipped.siteKeys).toEqual([]);
  });

  it('runs more workers only for a site file with an integer literal, and picks from the cores for 0', () => {
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true } } }).workerCount).toBe(1);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, workerCount: 3 } } }).workerCount).toBe(3);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, workerCount: 0 } } }).workerCount).toBe(4);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, workerCount: '3' } } }).workerCount).toBe(1);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, workerCount: 2.5 } } }).workerCount).toBe(1);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, workerCount: 99 } } }).workerCount).toBe(8);
  });

  it('offers the search and read-aloud unless a site file sets the literal false, each on its own', () => {
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true } } })).toMatchObject({ search: true, readAloud: true, autoDetect: true });
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, search: { enabled: 'false' }, speech: { enabled: 0 } } } }))
      .toMatchObject({ search: true, readAloud: true });
    const searchOff = readOcrConfig({ siteConfig: { ocr: { enabled: true, search: { enabled: false } } } });
    expect(searchOff).toMatchObject({ enabled: true, search: false, readAloud: true, autoDetect: true });
    const readAloudOff = readOcrConfig({ siteConfig: { ocr: { enabled: true, speech: { enabled: false } } } });
    expect(readAloudOff).toMatchObject({ enabled: true, search: true, readAloud: false, autoDetect: true });
    // The deep merge keeps the sibling key a site file does not mention.
    expect(readAloudOff.ocr.speech).toEqual({ enabled: false, autoDetectLanguage: true });
    const guessOff = readOcrConfig({ siteConfig: { ocr: { enabled: true, speech: { autoDetectLanguage: false } } } });
    expect(guessOff).toMatchObject({ readAloud: true, autoDetect: false });
  });

  it('recognises the whole document only for a site file with the literal true', () => {
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true } } }).wholeDocument).toBe(false);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, recognizeWholeDocument: 'true' } } }).wholeDocument).toBe(false);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, recognizeWholeDocument: true } } }).wholeDocument).toBe(true);
  });

  it('hands Ctrl+F to the search only for a site file with the literal true, keeping the search switch', () => {
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true } } }).ctrlF).toBe(false);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, search: { overridesCtrlF: 'true' } } } }).ctrlF).toBe(false);
    const on = readOcrConfig({ siteConfig: { ocr: { enabled: true, search: { overridesCtrlF: true } } } });
    expect(on).toMatchObject({ search: true, ctrlF: true });
    expect(on.ocr.search).toEqual({ enabled: true, overridesCtrlF: true });
  });

  it('keeps the ruling-line removal unless a site file sets the literal false', () => {
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true } } }).removeRulingLines).toBe(true);
    expect(readOcrConfig({ siteConfig: { ocr: { enabled: true, removeRulingLines: 'false' } } }).removeRulingLines).toBe(true);
    const off = readOcrConfig({ siteConfig: { ocr: { enabled: true, removeRulingLines: false } } });
    expect(off.removeRulingLines).toBe(false);
    expect(off.enabled).toBe(true);
  });

  it('keeps OCR off with the sample site file applied as-is', () => {
    const sample = readOcrConfig({ useSampleSiteFile: true });
    expect(sample.siteKeys).toContain('ocr');
    expect(sample.ocr).toEqual(SHIPPED_OCR_DEFAULTS);
    expect(sample.enabled).toBe(false);
  });

  it('lets a site file turn OCR on with the literal true and deep-merges the sub keys', () => {
    const site = readOcrConfig({ siteConfig: { ocr: { enabled: true, languages: ['swe'] } } });
    expect(site.ocr).toEqual({ ...SHIPPED_OCR_DEFAULTS, enabled: true, languages: ['swe'] });
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
