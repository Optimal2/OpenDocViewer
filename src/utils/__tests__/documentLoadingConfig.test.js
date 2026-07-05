// File: src/utils/__tests__/documentLoadingConfig.test.js
/**
 * Focused unit tests for documentLoadingConfig normalization helpers.
 *
 * These tests run in Node/Vitest and do not require a browser environment.
 */

import { describe, it, expect } from 'vitest';
import { normalizeProtection } from '../documentLoadingConfig.js';

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
});
