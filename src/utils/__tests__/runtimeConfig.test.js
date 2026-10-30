// File: src/utils/__tests__/runtimeConfig.test.js
/**
 * Focused unit tests for runtimeConfig normalization helpers.
 *
 * These tests cover fallback behavior, clamping, and alias resolution for the
 * exported runtimeConfig helpers. They run in Node/Vitest and do not require a
 * browser environment because every helper accepts an explicit cfg object.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getRuntimeConfig,
  getKeyboardPrintShortcutBehavior,
  isDocumentMetadataUiEnabled,
  isCompareOverlayEnabled,
  isCompareOverlayPrintEnabled,
  isCompareCurtainEnabled,
  isCompareCurtainPrintEnabled,
  COMPARE_ADJUST_TOOLBAR_MODES,
  getCompareAdjustToolbarMode,
  isPdfSignatureInspectionEnabled,
  getPdfSignatureInspectionStart,
  PDF_SIGNATURE_UNCHECKED_SEVERITIES,
  getPdfSignatureUncheckedSeverity,
  DEFAULT_OCR_LANGUAGES,
  OCR_ASSET_BASE_URL_REJECTIONS,
  isOcrEnabled,
  isOcrLineRemovalEnabled,
  describeOcrLanguages,
  getOcrLanguages,
  describeOcrAssetBaseUrl,
  getOcrAssetBaseUrl,
  normalizePrintDefaultMode,
  normalizeCustomFitWidthFactorPercent,
  normalizeOptionalCustomFitFactorPercent,
  normalizeCustomFitSizeLimitPreference,
  getViewerDefaultZoomMode,
  getViewerCustomFitWidthFactorPercent,
  getViewerCustomFitSizeLimits,
  getPrintDefaultMode,
  getPrintSelectionWorkspaceConfig,
  getViewerEdgeScrollPageTurnConfig,
  getViewerProblemNoticeConfig,
  getOmpThemeBridgeAllowedOrigins,
  getThemeDefaultMode,
} from '../runtimeConfig.js';

describe('runtimeConfig', () => {
  describe('getRuntimeConfig', () => {
    const originalWindow = globalThis.window;

    beforeEach(() => {
      delete globalThis.window;
    });

    afterEach(() => {
      globalThis.window = originalWindow;
    });

    it('returns an empty object when no runtime globals exist', () => {
      expect(getRuntimeConfig()).toEqual({});
    });

    it('prefers __ODV_GET_CONFIG__ over __ODV_CONFIG__', () => {
      globalThis.window = {
        __ODV_GET_CONFIG__: () => ({ from: 'getter' }),
        __ODV_CONFIG__: { from: 'global' },
      };
      expect(getRuntimeConfig()).toEqual({ from: 'getter' });
    });

    it('falls back to __ODV_CONFIG__ when getter is missing', () => {
      globalThis.window = { __ODV_CONFIG__: { from: 'global' } };
      expect(getRuntimeConfig()).toEqual({ from: 'global' });
    });

    it('swallows runtime errors and returns an empty object', () => {
      globalThis.window = {
        get __ODV_GET_CONFIG__() {
          throw new Error('boom');
        },
      };
      expect(getRuntimeConfig()).toEqual({});
    });
  });

  describe('getThemeDefaultMode', () => {
    it('defaults to system', () => {
      expect(getThemeDefaultMode({})).toBe('system');
      expect(getThemeDefaultMode({ theme: {} })).toBe('system');
      expect(getThemeDefaultMode({ theme: { defaultMode: 42 } })).toBe('system');
    });

    it('accepts light, dark, normal and system case-insensitively', () => {
      expect(getThemeDefaultMode({ theme: { defaultMode: 'Light' } })).toBe('light');
      expect(getThemeDefaultMode({ theme: { defaultMode: ' DARK ' } })).toBe('dark');
      expect(getThemeDefaultMode({ theme: { defaultMode: 'normal' } })).toBe('normal');
      expect(getThemeDefaultMode({ theme: { defaultMode: 'system' } })).toBe('system');
    });

    it('falls back to system for unknown values', () => {
      expect(getThemeDefaultMode({ theme: { defaultMode: 'sepia' } })).toBe('system');
    });
  });

  describe('getKeyboardPrintShortcutBehavior', () => {
    it('defaults to browser', () => {
      expect(getKeyboardPrintShortcutBehavior({})).toBe('browser');
    });

    it('accepts valid values case-insensitively', () => {
      expect(getKeyboardPrintShortcutBehavior({ shortcuts: { print: { ctrlOrCmdP: 'Dialog' } } })).toBe('dialog');
      expect(getKeyboardPrintShortcutBehavior({ shortcuts: { print: { ctrlOrCmdP: 'DISABLE' } } })).toBe('disable');
    });

    it('falls back to browser for unknown values', () => {
      expect(getKeyboardPrintShortcutBehavior({ shortcuts: { print: { ctrlOrCmdP: 'magic' } } })).toBe('browser');
    });
  });

  describe('isDocumentMetadataUiEnabled', () => {
    it('defaults to true', () => {
      expect(isDocumentMetadataUiEnabled({})).toBe(true);
    });

    it('respects explicit false', () => {
      expect(isDocumentMetadataUiEnabled({ metadata: { enabled: false } })).toBe(false);
    });
  });

  describe('compare view switches', () => {
    /** Accessor and the path of the key it reads, e.g. ['overlay', 'print']. */
    const SWITCHES = [
      ['isCompareOverlayEnabled', isCompareOverlayEnabled, ['overlay']],
      ['isCompareOverlayPrintEnabled', isCompareOverlayPrintEnabled, ['overlay', 'print']],
      ['isCompareCurtainEnabled', isCompareCurtainEnabled, ['curtain']],
      ['isCompareCurtainPrintEnabled', isCompareCurtainPrintEnabled, ['curtain', 'print']],
    ];

    /** Build `{ compare: { ...path: { enabled: value } } }`. */
    const withValue = (path, value) => ({
      compare: path.reduceRight((inner, key) => ({ [key]: inner }), { enabled: value }),
    });

    describe.each(SWITCHES)('%s', (_name, accessor, path) => {
      it('returns true for an explicit true', () => {
        expect(accessor(withValue(path, true))).toBe(true);
      });

      it('returns false only for an explicit false', () => {
        expect(accessor(withValue(path, false))).toBe(false);
      });

      it('falls back to the base default (true) when the key or section is missing', () => {
        expect(accessor({})).toBe(true);
        expect(accessor({ compare: {} })).toBe(true);
        expect(accessor({ compare: { overlay: {}, curtain: {} } })).toBe(true);
        expect(accessor(null)).toBe(true);
      });

      it.each([
        ['a string', 'false'],
        ['another string', 'no'],
        ['the number 0', 0],
        ['the number 1', 1],
        ['null', null],
        ['an object', { value: false }],
      ])('falls back to the base default (true) for %s', (_label, value) => {
        expect(accessor(withValue(path, value))).toBe(true);
      });
    });

    it('reads each key independently of the others', () => {
      const cfg = { compare: { overlay: { enabled: true, print: { enabled: false } }, curtain: { enabled: false } } };
      expect(isCompareOverlayEnabled(cfg)).toBe(true);
      expect(isCompareOverlayPrintEnabled(cfg)).toBe(false);
      expect(isCompareCurtainEnabled(cfg)).toBe(false);
      expect(isCompareCurtainPrintEnabled(cfg)).toBe(true);
    });
  });

  describe('getCompareAdjustToolbarMode', () => {
    const withMode = (toolbarMode) => ({ compare: { adjust: { toolbarMode } } });

    it('lists exactly the two valid values', () => {
      expect(COMPARE_ADJUST_TOOLBAR_MODES).toEqual(['mirror', 'hide']);
      expect(Object.isFrozen(COMPARE_ADJUST_TOOLBAR_MODES)).toBe(true);
    });

    it('returns the valid values, lower-cased and trimmed', () => {
      expect(getCompareAdjustToolbarMode(withMode('mirror'))).toBe('mirror');
      expect(getCompareAdjustToolbarMode(withMode('hide'))).toBe('hide');
      expect(getCompareAdjustToolbarMode(withMode('HIDE'))).toBe('hide');
      expect(getCompareAdjustToolbarMode(withMode(' Hide '))).toBe('hide');
      expect(getCompareAdjustToolbarMode(withMode(' MIRROR'))).toBe('mirror');
    });

    it('falls back to mirror when the key or section is missing', () => {
      expect(getCompareAdjustToolbarMode({})).toBe('mirror');
      expect(getCompareAdjustToolbarMode({ compare: {} })).toBe('mirror');
      expect(getCompareAdjustToolbarMode({ compare: { adjust: {} } })).toBe('mirror');
      expect(getCompareAdjustToolbarMode(null)).toBe('mirror');
      expect(getCompareAdjustToolbarMode(undefined)).toBe('mirror');
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 1],
      ['zero', 0],
      ['a boolean', true],
      ['an object', { value: 'hide' }],
      ['an array', ['hide']],
      ['an empty string', ''],
      ['the string Hidden', 'Hidden'],
      ['the string mirrored', 'mirrored'],
      ['an unknown string', 'off'],
    ])('falls back to mirror for %s', (_label, value) => {
      expect(getCompareAdjustToolbarMode(withMode(value))).toBe('mirror');
    });
  });

  describe('isPdfSignatureInspectionEnabled', () => {
    it('defaults to true when the section is missing or non-boolean', () => {
      expect(isPdfSignatureInspectionEnabled({})).toBe(true);
      expect(isPdfSignatureInspectionEnabled({ pdfSignatures: {} })).toBe(true);
      expect(isPdfSignatureInspectionEnabled({ pdfSignatures: { enabled: 'no' } })).toBe(true);
    });

    it('turns inspection off only on explicit false', () => {
      expect(isPdfSignatureInspectionEnabled({ pdfSignatures: { enabled: false } })).toBe(false);
    });
  });

  describe('getPdfSignatureInspectionStart', () => {
    it('defaults to firstPage', () => {
      expect(getPdfSignatureInspectionStart({})).toBe('firstPage');
      expect(getPdfSignatureInspectionStart({ pdfSignatures: { inspectAfter: 'later' } })).toBe('firstPage');
    });

    it('accepts allPages case-insensitively', () => {
      expect(getPdfSignatureInspectionStart({ pdfSignatures: { inspectAfter: 'allPages' } })).toBe('allPages');
      expect(getPdfSignatureInspectionStart({ pdfSignatures: { inspectAfter: ' ALLPAGES ' } })).toBe('allPages');
    });
  });

  describe('getPdfSignatureUncheckedSeverity', () => {
    const withSeverity = (uncheckedSeverity) => ({ pdfSignatures: { uncheckedSeverity } });

    it('lists exactly the two valid values', () => {
      expect(PDF_SIGNATURE_UNCHECKED_SEVERITIES).toEqual(['ok', 'warning']);
      expect(Object.isFrozen(PDF_SIGNATURE_UNCHECKED_SEVERITIES)).toBe(true);
    });

    it('returns the valid values, lower-cased and trimmed', () => {
      expect(getPdfSignatureUncheckedSeverity(withSeverity('ok'))).toBe('ok');
      expect(getPdfSignatureUncheckedSeverity(withSeverity('warning'))).toBe('warning');
      expect(getPdfSignatureUncheckedSeverity(withSeverity('WARNING'))).toBe('warning');
      expect(getPdfSignatureUncheckedSeverity(withSeverity(' Warning '))).toBe('warning');
      expect(getPdfSignatureUncheckedSeverity(withSeverity(' OK'))).toBe('ok');
    });

    it('falls back to ok when the key or section is missing', () => {
      expect(getPdfSignatureUncheckedSeverity({})).toBe('ok');
      expect(getPdfSignatureUncheckedSeverity({ pdfSignatures: {} })).toBe('ok');
      expect(getPdfSignatureUncheckedSeverity(null)).toBe('ok');
      expect(getPdfSignatureUncheckedSeverity(undefined)).toBe('ok');
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 1],
      ['zero', 0],
      ['a boolean', true],
      ['an object', { value: 'warning' }],
      ['an array', ['warning']],
      ['an empty string', ''],
      ['the string warn', 'warn'],
      ['the string error', 'error'],
      ['an unknown string', 'off'],
    ])('falls back to ok for %s', (_label, value) => {
      expect(getPdfSignatureUncheckedSeverity(withSeverity(value))).toBe('ok');
    });
  });

  describe('isOcrEnabled', () => {
    it('is off when the section or key is missing', () => {
      expect(isOcrEnabled({})).toBe(false);
      expect(isOcrEnabled({ ocr: {} })).toBe(false);
      expect(isOcrEnabled(null)).toBe(false);
      expect(isOcrEnabled(undefined)).toBe(false);
    });

    it('turns on only for the boolean literal true', () => {
      expect(isOcrEnabled({ ocr: { enabled: true } })).toBe(true);
      expect(isOcrEnabled({ ocr: { enabled: false } })).toBe(false);
    });

    it.each([
      ['the string "true"', 'true'],
      ['the string "on"', 'on'],
      ['the number 1', 1],
      ['the number 0', 0],
      ['null', null],
      ['undefined', undefined],
      ['an object', { enabled: true }],
      ['an array', [true]],
    ])('stays off for %s', (_label, value) => {
      expect(isOcrEnabled({ ocr: { enabled: value } })).toBe(false);
    });
  });

  describe('isOcrLineRemovalEnabled', () => {
    it('is on when the section or key is missing', () => {
      expect(isOcrLineRemovalEnabled({})).toBe(true);
      expect(isOcrLineRemovalEnabled({ ocr: {} })).toBe(true);
      expect(isOcrLineRemovalEnabled(null)).toBe(true);
      expect(isOcrLineRemovalEnabled(undefined)).toBe(true);
    });

    it('turns off only for the boolean literal false', () => {
      expect(isOcrLineRemovalEnabled({ ocr: { removeRulingLines: false } })).toBe(false);
      expect(isOcrLineRemovalEnabled({ ocr: { removeRulingLines: true } })).toBe(true);
      expect(isOcrLineRemovalEnabled({ ocr: { removeRulingLines: 'false' } })).toBe(true);
      expect(isOcrLineRemovalEnabled({ ocr: { removeRulingLines: 0 } })).toBe(true);
      expect(isOcrLineRemovalEnabled({ ocr: { removeRulingLines: null } })).toBe(true);
    });
  });

  describe('getOcrLanguages', () => {
    it('defaults to swe and eng in that order', () => {
      expect(DEFAULT_OCR_LANGUAGES).toEqual(['swe', 'eng']);
      expect(Object.isFrozen(DEFAULT_OCR_LANGUAGES)).toBe(true);
      expect(getOcrLanguages({})).toEqual(['swe', 'eng']);
      expect(getOcrLanguages({ ocr: {} })).toEqual(['swe', 'eng']);
      expect(getOcrLanguages(null)).toEqual(['swe', 'eng']);
    });

    it('returns a fresh array, never the frozen default itself', () => {
      const languages = getOcrLanguages({});
      expect(languages).not.toBe(DEFAULT_OCR_LANGUAGES);
      expect(Object.isFrozen(languages)).toBe(false);
    });

    it.each([
      ['a string', 'swe+eng'],
      ['null', null],
      ['a number', 1],
      ['an object', { swe: true }],
      ['an empty array', []],
      ['an array without valid codes', ['sv', 7, '', 'script/Latin', 'swedish-x']],
    ])('falls back to the default for %s', (_label, value) => {
      expect(getOcrLanguages({ ocr: { languages: value } })).toEqual(['swe', 'eng']);
    });

    it('keeps order, trims, lower-cases, drops malformed entries and duplicates', () => {
      expect(getOcrLanguages({ ocr: { languages: [' ENG ', 'swe', 'eng', 'chi_sim', 'sv', 7, 'Swe', 'aze_cyrl'] } }))
        .toEqual(['eng', 'swe', 'chi_sim', 'aze_cyrl']);
    });

    it('accepts a single language', () => {
      expect(getOcrLanguages({ ocr: { languages: ['swe'] } })).toEqual(['swe']);
    });
  });

  describe('getOcrAssetBaseUrl', () => {
    it('defaults to null', () => {
      expect(getOcrAssetBaseUrl({})).toBeNull();
      expect(getOcrAssetBaseUrl({ ocr: {} })).toBeNull();
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: null } })).toBeNull();
      expect(getOcrAssetBaseUrl(null)).toBeNull();
    });

    it.each([
      ['a number', 1],
      ['a boolean', true],
      ['an object', { url: 'x' }],
      ['an empty string', ''],
      ['a blank string', '   '],
    ])('returns null for %s', (_label, value) => {
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: value } })).toBeNull();
    });

    it('trims and guarantees a trailing slash', () => {
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'https://host.example/odv-ocr' } })).toBe('https://host.example/odv-ocr/');
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: ' /shared/ocr/ ' } })).toBe('/shared/ocr/');
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'ocr' } })).toBe('ocr/');
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: '//cdn.example/odv-ocr' } })).toBe('//cdn.example/odv-ocr/');
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'HTTP://Host.Example/x' } })).toBe('HTTP://Host.Example/x/');
    });

    it.each([
      ['a query string', 'https://host.example/odv-ocr?token=x'],
      ['a fragment', 'https://host.example/odv-ocr#v1'],
      ['a query string on a relative base', '/shared/ocr/?v=2'],
      ['a javascript: scheme', 'javascript:alert(1)'],
      ['a data: scheme', 'data:text/javascript,1'],
      ['a blob: scheme', 'blob:https://host.example/abc'],
      ['a file: scheme', 'file:///C:/odv/ocr/'],
      ['a Windows drive letter', 'C:/odv/ocr/'],
      ['a scheme hidden behind a line feed', 'java\nscript:alert(1)'],
      ['a scheme hidden behind a NUL', 'java\u0000script:alert(1)'],
      ['a tab inside the value', 'https://host.example/odv\t-ocr/'],
      ['a space inside the value', 'https://host.example/odv ocr/'],
    ])('returns null for %s', (_label, value) => {
      expect(getOcrAssetBaseUrl({ ocr: { assetBaseUrl: value } })).toBeNull();
    });
  });

  describe('describeOcrLanguages', () => {
    const silentDefault = { languages: ['swe', 'eng'], configured: false, notArray: false, fallback: true, dropped: [], duplicates: [] };

    it('reports a missing key as the silent default', () => {
      expect(describeOcrLanguages({})).toEqual(silentDefault);
      expect(describeOcrLanguages({ ocr: {} })).toEqual(silentDefault);
      expect(describeOcrLanguages(null)).toEqual(silentDefault);
    });

    it.each([
      ['a string', 'swe'],
      ['null', null],
      ['a number', 1],
      ['an object', { swe: true }],
    ])('reports %s as configured but not an array', (_label, value) => {
      expect(describeOcrLanguages({ ocr: { languages: value } })).toEqual({ ...silentDefault, configured: true, notArray: true });
    });

    it('reports an explicit empty array as a configured fallback', () => {
      expect(describeOcrLanguages({ ocr: { languages: [] } })).toEqual({ ...silentDefault, configured: true });
    });

    it('lists the entries it dropped, as given, the repeated codes, and the fallback when nothing is left', () => {
      expect(describeOcrLanguages({ ocr: { languages: ['sv', 7, '', 'script/Latin', 'swedish-x'] } })).toEqual({
        languages: ['swe', 'eng'],
        configured: true,
        notArray: false,
        fallback: true,
        dropped: ['sv', 7, '', 'script/Latin', 'swedish-x'],
        duplicates: [],
      });
      expect(describeOcrLanguages({ ocr: { languages: [' ENG ', 'swe', 'eng', 'sv', 'Swe', 'swe'] } })).toEqual({
        languages: ['eng', 'swe'],
        configured: true,
        notArray: false,
        fallback: false,
        dropped: ['sv'],
        duplicates: ['eng', 'swe'],
      });
    });

    it('returns fresh arrays', () => {
      const first = describeOcrLanguages({ ocr: { languages: ['swe'] } });
      const second = describeOcrLanguages({ ocr: { languages: ['swe'] } });
      expect(first.languages).not.toBe(second.languages);
      expect(describeOcrLanguages({}).languages).not.toBe(DEFAULT_OCR_LANGUAGES);
    });
  });

  describe('describeOcrAssetBaseUrl', () => {
    it('reports unset and blank values without a rejection', () => {
      expect(describeOcrAssetBaseUrl({})).toEqual({ url: null, rejected: null, value: null });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: '   ' } })).toEqual({ url: null, rejected: null, value: null });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: 7 } })).toEqual({ url: null, rejected: null, value: null });
    });

    it('returns the normalized url for accepted values', () => {
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: ' https://host.example/odv-ocr ' } }))
        .toEqual({ url: 'https://host.example/odv-ocr/', rejected: null, value: 'https://host.example/odv-ocr' });
    });

    it('names the reason for a rejected value and keeps the trimmed value for the log', () => {
      expect(OCR_ASSET_BASE_URL_REJECTIONS).toEqual({ QUERY_OR_FRAGMENT: 'query-or-fragment', SCHEME: 'scheme', INVALID_CHARACTERS: 'invalid-characters' });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: ' https://h/ocr?token=x ' } }))
        .toEqual({ url: null, rejected: 'query-or-fragment', value: 'https://h/ocr?token=x' });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'java\nscript:alert(1)' } }))
        .toEqual({ url: null, rejected: 'invalid-characters', value: 'java\nscript:alert(1)' });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'https://h/ocr/#frag' } }))
        .toEqual({ url: null, rejected: 'query-or-fragment', value: 'https://h/ocr/#frag' });
      expect(describeOcrAssetBaseUrl({ ocr: { assetBaseUrl: 'javascript:alert(1)' } }))
        .toEqual({ url: null, rejected: 'scheme', value: 'javascript:alert(1)' });
    });
  });

  describe('normalizePrintDefaultMode', () => {
    it('defaults to active', () => {
      expect(normalizePrintDefaultMode(undefined)).toBe('active');
    });

    it('normalizes all-page aliases to all', () => {
      expect(normalizePrintDefaultMode('all')).toBe('all');
      expect(normalizePrintDefaultMode('ALL-PAGES')).toBe('all');
      expect(normalizePrintDefaultMode('everything')).toBe('all');
    });

    it('normalizes active-page aliases to active', () => {
      expect(normalizePrintDefaultMode('current_page')).toBe('active');
      expect(normalizePrintDefaultMode('CURRENT PAGE')).toBe('active');
    });

    it('falls back to the provided defaultMode', () => {
      expect(normalizePrintDefaultMode('unknown', 'all')).toBe('all');
      expect(normalizePrintDefaultMode('unknown', 'active')).toBe('active');
    });
  });

  describe('normalizeCustomFitWidthFactorPercent', () => {
    it('defaults to 70', () => {
      expect(normalizeCustomFitWidthFactorPercent(undefined)).toBe(70);
    });

    it('clamps to the 1..100 range', () => {
      expect(normalizeCustomFitWidthFactorPercent(0)).toBe(1);
      expect(normalizeCustomFitWidthFactorPercent(150)).toBe(100);
    });

    it('floors decimals', () => {
      expect(normalizeCustomFitWidthFactorPercent(42.9)).toBe(42);
    });
  });

  describe('normalizeOptionalCustomFitFactorPercent', () => {
    it('returns null for blank values', () => {
      expect(normalizeOptionalCustomFitFactorPercent(null)).toBeNull();
      expect(normalizeOptionalCustomFitFactorPercent('')).toBeNull();
      expect(normalizeOptionalCustomFitFactorPercent(undefined)).toBeNull();
    });

    it('returns null for non-positive values', () => {
      expect(normalizeOptionalCustomFitFactorPercent(0)).toBeNull();
      expect(normalizeOptionalCustomFitFactorPercent(-5)).toBeNull();
    });

    it('clamps to the supplied max', () => {
      expect(normalizeOptionalCustomFitFactorPercent(80, 50)).toBe(50);
    });

    it('rounds to the nearest integer', () => {
      expect(normalizeOptionalCustomFitFactorPercent(33.6)).toBe(34);
    });
  });

  describe('normalizeCustomFitSizeLimitPreference', () => {
    it('returns nulls for non-object values', () => {
      expect(normalizeCustomFitSizeLimitPreference(null)).toEqual({
        widthFactorPercent: null,
        heightFactorPercent: null,
        actualSizeFactorPercent: null,
      });
    });

    it('supports legacy *Percent aliases', () => {
      expect(normalizeCustomFitSizeLimitPreference({ widthPercent: 80, heightPercent: 120 })).toEqual({
        widthFactorPercent: 80,
        heightFactorPercent: 120,
        actualSizeFactorPercent: null,
      });
    });

    it('prefers the new *FactorPercent aliases', () => {
      expect(
        normalizeCustomFitSizeLimitPreference({ widthFactorPercent: 90, widthPercent: 80 }),
      ).toEqual({
        widthFactorPercent: 90,
        heightFactorPercent: null,
        actualSizeFactorPercent: null,
      });
    });
  });

  describe('getViewerDefaultZoomMode', () => {
    it('defaults to FIT_WIDTH', () => {
      expect(getViewerDefaultZoomMode({})).toBe('FIT_WIDTH');
    });

    it('resolves aliases to internal modes', () => {
      expect(getViewerDefaultZoomMode({ viewer: { defaultZoomMode: 'fit page' } })).toBe('FIT_PAGE');
      expect(getViewerDefaultZoomMode({ viewer: { defaultZoomMode: 'actual_size' } })).toBe('ACTUAL_SIZE');
      expect(getViewerDefaultZoomMode({ viewer: { defaultZoomMode: 'custom-fit-width' } })).toBe('FIT_CUSTOM');
    });

    it('falls back to FIT_WIDTH for unknown values', () => {
      expect(getViewerDefaultZoomMode({ viewer: { defaultZoomMode: 'unknown' } })).toBe('FIT_WIDTH');
    });
  });

  describe('getViewerCustomFitWidthFactorPercent', () => {
    it('defaults to 70', () => {
      expect(getViewerCustomFitWidthFactorPercent({})).toBe(70);
    });

    it('reads the legacy customFitWidthPercent alias', () => {
      expect(getViewerCustomFitWidthFactorPercent({ viewer: { customFitWidthPercent: 55 } })).toBe(55);
    });
  });

  describe('getViewerCustomFitSizeLimits', () => {
    it('uses default width and null opt-in limits', () => {
      expect(getViewerCustomFitSizeLimits({})).toEqual({
        widthFactorPercent: 70,
        heightFactorPercent: null,
        actualSizeFactorPercent: null,
      });
    });

    it('reads height and actual-size limits', () => {
      expect(
        getViewerCustomFitSizeLimits({
          viewer: {
            customFitHeightFactorPercent: 200,
            customFitActualSizeFactorPercent: 150,
          },
        }),
      ).toEqual({
        widthFactorPercent: 70,
        heightFactorPercent: 200,
        actualSizeFactorPercent: 150,
      });
    });
  });

  describe('getPrintDefaultMode', () => {
    it('checks multiple legacy config paths', () => {
      expect(getPrintDefaultMode({ print: { defaultPrintMode: 'all' } })).toBe('all');
      expect(getPrintDefaultMode({ viewer: { print: { defaultPageMode: 'all' } } })).toBe('all');
    });
  });

  describe('getPrintSelectionWorkspaceConfig', () => {
    it('defaults enabled to true and fills templates', () => {
      const cfg = getPrintSelectionWorkspaceConfig({});
      expect(cfg.enabled).toBe(true);
      expect(cfg.documentHeaderTemplate).toContain('{documentNumber}');
      expect(cfg.previewInfoTemplate).toContain('{sourcePage}');
    });

    it('reads legacy template aliases', () => {
      const cfg = getPrintSelectionWorkspaceConfig({
        print: {
          selectionWorkspace: {
            headerTemplate: 'H',
            lightboxInfoTemplate: 'L',
          },
        },
      });
      expect(cfg.documentHeaderTemplate).toBe('H');
      expect(cfg.previewInfoTemplate).toBe('L');
    });

    it('only accepts real booleans for enabled, otherwise falls back to true', () => {
      expect(getPrintSelectionWorkspaceConfig({ print: { selectionWorkspace: { enabled: false } } }).enabled).toBe(false);
      expect(getPrintSelectionWorkspaceConfig({ print: { selectionWorkspace: { enabled: 'no' } } }).enabled).toBe(true);
    });
  });

  describe('getViewerEdgeScrollPageTurnConfig', () => {
    it('normalizes boolean shorthand to an object', () => {
      expect(getViewerEdgeScrollPageTurnConfig({ viewer: { edgeScrollPageTurn: false } })).toEqual(
        expect.objectContaining({ enabled: false }),
      );
    });

    it('clamps threshold, quiet and decay values', () => {
      const cfg = getViewerEdgeScrollPageTurnConfig({
        viewer: { edgeScrollPageTurn: { thresholdPx: 50, quietMs: 5000, decayMs: 0 } },
      });
      expect(cfg.thresholdPx).toBe(120);
      expect(cfg.quietMs).toBe(2000);
      expect(cfg.decayMs).toBe(100);
    });
  });

  describe('getViewerProblemNoticeConfig', () => {
    it('applies defaults', () => {
      const cfg = getViewerProblemNoticeConfig({});
      expect(cfg.enabled).toBe(true);
      expect(cfg.failedPageRatio).toBe(0.5);
      expect(cfg.resetSessionTarget).toBe('parent-or-current');
    });

    it('normalizes resetSessionTarget', () => {
      expect(getViewerProblemNoticeConfig({ viewer: { problemNotice: { resetSessionTarget: 'NONE' } } }).resetSessionTarget).toBe('none');
      expect(getViewerProblemNoticeConfig({ viewer: { problemNotice: { resetSessionTarget: 'invalid' } } }).resetSessionTarget).toBe('parent-or-current');
    });

    it('clamps failedPageRatio to 0..1', () => {
      expect(getViewerProblemNoticeConfig({ viewer: { problemNotice: { failedPageRatio: 2 } } }).failedPageRatio).toBe(1);
      expect(getViewerProblemNoticeConfig({ viewer: { problemNotice: { failedPageRatio: -1 } } }).failedPageRatio).toBe(0);
    });
  });

  describe('getOmpThemeBridgeAllowedOrigins', () => {
    it('stays off by default', () => {
      expect(getOmpThemeBridgeAllowedOrigins({})).toEqual([]);
      expect(getOmpThemeBridgeAllowedOrigins({ theme: {} })).toEqual([]);
    });

    it('accepts exact origins and drops blanks and duplicates', () => {
      expect(getOmpThemeBridgeAllowedOrigins({
        theme: { bridge: { allowedOrigins: ['https://portal.example', '  ', 'https://portal.example', 7] } },
      })).toEqual(['https://portal.example']);
    });
  });
});
