// @vitest-environment jsdom
// File: src/contexts/__tests__/ompThemeApplied.browser.test.jsx
/**
 * Browser-level check: with a shared OMP_THEME_PREFERENCE cookie present for each
 * mode (system/light/dark), the viewer resolves and applies the matching palette
 * through data-theme on <html>.
 *
 * Runs in jsdom: the cookie is set exactly like the contract stores it
 * (URI-encoded JSON), then the adapter resolves the effective mode and applies it
 * to the document.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OMP_THEME_STORAGE_KEY,
  getEffectiveOdvThemeMode,
  applyOdvThemeToDocument,
  resolveConcreteTheme,
} from '../../utils/ompThemePreference.js';

const MODES = ['system', 'light', 'dark'];

function setSharedCookie(mode, revision) {
  const payload = encodeURIComponent(JSON.stringify({ version: 1, mode, revision }));
  document.cookie = `${OMP_THEME_STORAGE_KEY}=${payload}; Path=/`;
}

function clearCookies() {
  for (const cookie of String(document.cookie).split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

describe('shared preference cookie drives data-theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearCookies();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
  });

  for (const mode of MODES) {
    it(`applies data-theme for shared mode ${mode}`, () => {
      setSharedCookie(mode, `rev-${mode}`);
      const effective = getEffectiveOdvThemeMode();
      expect(effective).toBe(mode);
      const concrete = resolveConcreteTheme(effective);
      applyOdvThemeToDocument(concrete, effective);
      expect(document.documentElement.getAttribute('data-theme-mode')).toBe(mode);
      expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'));
      if (mode !== 'system') {
        expect(document.documentElement.getAttribute('data-theme')).toBe(mode);
      }
    });
  }
});
