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
});
