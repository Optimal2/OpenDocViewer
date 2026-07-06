// File: src/logging/__tests__/systemLogger.test.js
/**
 * Focused unit tests for systemLogger placeholder detection.
 *
 * These tests run in Node/Vitest and do not require a browser environment
 * because they exercise the pure helper directly.
 */

import { describe, it, expect } from 'vitest';
import { isPlaceholderToken, shouldEnableBackendLogging } from '../systemLogger.js';

describe('systemLogger', () => {
  describe('isPlaceholderToken', () => {
    it('detects the default placeholder token', () => {
      expect(isPlaceholderToken('REPLACE_WITH_SYSTEM_LOG_TOKEN')).toBe(true);
    });

    it('detects placeholder tokens case-insensitively', () => {
      expect(isPlaceholderToken('replace_with_system_log_token')).toBe(true);
      expect(isPlaceholderToken('Replace_With_System_Log_Token')).toBe(true);
    });

    it('detects empty, null and undefined tokens as placeholders', () => {
      expect(isPlaceholderToken('')).toBe(true);
      expect(isPlaceholderToken(null)).toBe(true);
      expect(isPlaceholderToken(undefined)).toBe(true);
      expect(isPlaceholderToken('   ')).toBe(true);
    });

    it('detects common placeholder patterns', () => {
      expect(isPlaceholderToken('YOUR_TOKEN_HERE')).toBe(true);
      expect(isPlaceholderToken('PLACEHOLDER_TOKEN')).toBe(true);
      expect(isPlaceholderToken('TODO_set_real_token')).toBe(true);
    });

    it('returns false for real-looking tokens', () => {
      expect(isPlaceholderToken('real-token-abc123')).toBe(false);
      expect(isPlaceholderToken('devtoken')).toBe(false);
      expect(isPlaceholderToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(false);
    });
  });

  describe('shouldEnableBackendLogging', () => {
    it('fails closed for placeholder tokens even when explicitly enabled', () => {
      expect(shouldEnableBackendLogging('https://logs.example.test/log', true, 'REPLACE_WITH_SYSTEM_LOG_TOKEN')).toBe(false);
    });

    it('enables backend logging for real tokens when explicitly enabled', () => {
      expect(shouldEnableBackendLogging('https://logs.example.test/log', true, 'real-token-abc123')).toBe(true);
    });

    it('stays disabled when there is no backend endpoint', () => {
      expect(shouldEnableBackendLogging('', true, 'real-token-abc123')).toBe(false);
    });
  });
});
