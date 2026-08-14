// File: src/utils/__tests__/documentLoadingConfig.test.js
/**
 * Focused unit tests for documentLoadingConfig normalization helpers.
 *
 * These tests run in Node/Vitest and do not require a browser environment.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeProtection,
  resolveRecommendedWorkerCount,
  resolvePdfWorkerPlanForPageCount,
  resolvePdfRenderConfigForPageCount,
  applyDocumentLoadingMode,
  applyMemoryPressureStage,
  shouldUseFullImagesForThumbnails,
  shouldRecommendStopping,
  formatBytes,
  countPdfPages,
  DOCUMENT_LOADING_DEFAULTS,
} from '../documentLoadingConfig.js';

describe('documentLoadingConfig', () => {
  describe('normalizeProtection', () => {
    it('returns aes-gcm-session for the canonical value', () => {
      expect(normalizeProtection('aes-gcm-session')).toBe('aes-gcm-session');
    });

    it('returns none only for an explicit none value', () => {
      expect(normalizeProtection('none')).toBe('none');
    });

    it('is case-insensitive', () => {
      expect(normalizeProtection('AES-GCM-SESSION')).toBe('aes-gcm-session');
      expect(normalizeProtection('NONE')).toBe('none');
    });

    it('fails closed to aes-gcm-session for typos and invalid values', () => {
      expect(normalizeProtection('aes-gcm')).toBe('aes-gcm-session');
      expect(normalizeProtection('encrypted')).toBe('aes-gcm-session');
      expect(normalizeProtection('AES-GCM-SESION')).toBe('aes-gcm-session');
    });

    it('fails closed to aes-gcm-session for empty or missing values', () => {
      expect(normalizeProtection('')).toBe('aes-gcm-session');
      expect(normalizeProtection(undefined)).toBe('aes-gcm-session');
      expect(normalizeProtection(null)).toBe('aes-gcm-session');
    });

    it('honors an explicit none fallback', () => {
      expect(normalizeProtection(undefined, 'none')).toBe('none');
    });

    it('ignores an invalid fallback and fails closed', () => {
      expect(normalizeProtection(undefined, 'bad-value')).toBe('aes-gcm-session');
    });
  });
// Reported by GitHub code quality: normalizeProtection was the only exported helper in
  // this module with coverage, while several with real branching had none. These cover the
  // branch-heavy ones -- the worker planner and the mode/pressure transforms -- plus the
  // small pure helpers where a regression would be silent.

  describe('resolveRecommendedWorkerCount', () => {
    it('returns an explicit preference unchanged', () => {
      expect(resolveRecommendedWorkerCount(3)).toBe(3);
    });

    it('falls back to a hardware-derived count of at least four', () => {
      expect(resolveRecommendedWorkerCount(0)).toBeGreaterThanOrEqual(4);
    });

    it('never exceeds the hard cap of 32', () => {
      expect(resolveRecommendedWorkerCount(0)).toBeLessThanOrEqual(32);
    });
  });

  describe('resolvePdfWorkerPlanForPageCount', () => {
    it('renders on the main thread when the page count is unknown', () => {
      expect(resolvePdfWorkerPlanForPageCount(0).mode).toBe('main-thread');
    });

    it('treats a negative page count the same as unknown', () => {
      expect(resolvePdfWorkerPlanForPageCount(-5).mode).toBe('main-thread');
    });

    it('allocates at least one worker for a large document', () => {
      const plan = resolvePdfWorkerPlanForPageCount(5000);
      if (plan.mode !== 'main-thread') {
        expect(plan.workerCount).toBeGreaterThanOrEqual(1);
        expect(plan.workerCount).toBeLessThanOrEqual(plan.hardwareCap);
      }
    });

    it('floors a fractional page count instead of propagating it', () => {
      expect(resolvePdfWorkerPlanForPageCount(12.9)).toEqual(resolvePdfWorkerPlanForPageCount(12));
    });
  });

  describe('resolvePdfRenderConfigForPageCount', () => {
    it('returns a render config for a zero page count', () => {
      expect(resolvePdfRenderConfigForPageCount(DOCUMENT_LOADING_DEFAULTS.render, 0)).toBeTruthy();
    });

    it('does not mutate the config it was given', () => {
      const snapshot = JSON.stringify(DOCUMENT_LOADING_DEFAULTS.render);
      resolvePdfRenderConfigForPageCount(DOCUMENT_LOADING_DEFAULTS.render, 4000);
      expect(JSON.stringify(DOCUMENT_LOADING_DEFAULTS.render)).toBe(snapshot);
    });
  });

  describe('applyDocumentLoadingMode', () => {
    it('switches render strategy to eager-all in performance mode', () => {
      const next = applyDocumentLoadingMode(DOCUMENT_LOADING_DEFAULTS, 'performance');
      expect(next.mode).toBe('performance');
      expect(next.render.strategy).toBe('eager-all');
    });

    it('leaves the source config untouched', () => {
      const snapshot = JSON.stringify(DOCUMENT_LOADING_DEFAULTS);
      applyDocumentLoadingMode(DOCUMENT_LOADING_DEFAULTS, 'performance');
      expect(JSON.stringify(DOCUMENT_LOADING_DEFAULTS)).toBe(snapshot);
    });

    it('falls back to the base mode for an unknown mode', () => {
      expect(applyDocumentLoadingMode(DOCUMENT_LOADING_DEFAULTS, 'nonsense').mode)
        .toBe(DOCUMENT_LOADING_DEFAULTS.mode || 'auto');
    });
  });

  describe('applyMemoryPressureStage', () => {
    it('returns a usable config for every stage it accepts', () => {
      for (const stage of [0, 1, 2, 3]) {
        expect(applyMemoryPressureStage(DOCUMENT_LOADING_DEFAULTS, stage)).toBeTruthy();
      }
    });

    it('leaves the source config untouched', () => {
      const snapshot = JSON.stringify(DOCUMENT_LOADING_DEFAULTS);
      applyMemoryPressureStage(DOCUMENT_LOADING_DEFAULTS, 3);
      expect(JSON.stringify(DOCUMENT_LOADING_DEFAULTS)).toBe(snapshot);
    });
  });

  describe('shouldUseFullImagesForThumbnails', () => {
    it('always declines for the dedicated strategy', () => {
      const config = { render: { thumbnailSourceStrategy: 'dedicated' } };
      expect(shouldUseFullImagesForThumbnails(config, { fileExtension: 'png' }, 1)).toBe(false);
    });

    it('always accepts for the prefer-full-images strategy', () => {
      const config = { render: { thumbnailSourceStrategy: 'prefer-full-images' } };
      expect(shouldUseFullImagesForThumbnails(config, { fileExtension: 'pdf' }, 9999)).toBe(true);
    });

    it('declines a non-raster page under the auto strategy', () => {
      const config = { render: { thumbnailSourceStrategy: 'auto' }, mode: 'performance' };
      expect(shouldUseFullImagesForThumbnails(config, { fileExtension: 'pdf' }, 1)).toBe(false);
    });
  });

  describe('shouldRecommendStopping', () => {
    const config = { warning: { minStopRecommendationSources: 10, minStopRecommendationPages: 100 } };

    it('recommends stopping once the source threshold is reached', () => {
      expect(shouldRecommendStopping({ sourceCount: 10, pageCount: 0, config })).toBe(true);
    });

    it('recommends stopping once the page threshold is reached', () => {
      expect(shouldRecommendStopping({ sourceCount: 0, pageCount: 100, config })).toBe(true);
    });

    it('stays quiet below both thresholds', () => {
      expect(shouldRecommendStopping({ sourceCount: 9, pageCount: 99, config })).toBe(false);
    });

    it('ignores a threshold that is switched off with zero', () => {
      const off = { warning: { minStopRecommendationSources: 0, minStopRecommendationPages: 0 } };
      expect(shouldRecommendStopping({ sourceCount: 1e6, pageCount: 1e6, config: off })).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('reports plain bytes below one kibibyte', () => {
      expect(formatBytes(512)).toBe('512 B');
    });

    it('clamps a negative value to zero', () => {
      expect(formatBytes(-1)).toBe('0 B');
    });

    it('steps up through the units', () => {
      expect(formatBytes(1024)).toMatch(/KiB$/);
      expect(formatBytes(1024 ** 2)).toMatch(/MiB$/);
      expect(formatBytes(1024 ** 3)).toMatch(/GiB$/);
    });

    it('drops decimals once the value reaches three digits', () => {
      expect(formatBytes(512 * 1024)).toBe('512 KiB');
    });
  });

  describe('countPdfPages', () => {
    it('returns zero for a non-array', () => {
      expect(countPdfPages(null)).toBe(0);
    });
  });
});
