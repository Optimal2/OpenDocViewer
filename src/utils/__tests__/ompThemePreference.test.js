// File: src/utils/__tests__/ompThemePreference.test.js
/**
 * Unit tests for the shared OMP theme preference adapter (OMP_THEME_PREFERENCE).
 *
 * Covers the contract: cookie + localStorage mirror, newest revision wins, cookie on
 * a tie, unknown version/mode ignored, denied storage tolerated, migration of an
 * existing ODV theme setting only when no shared preference exists, Normal
 * persistence bound to a shared revision (overridden by a newer shared choice),
 * and that other ODV_USER_PREFERENCES fields are never overwritten.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OMP_THEME_STORAGE_KEY,
  getSharedThemePreference,
  setSharedThemePreference,
  parseSharedThemeValue,
  getEffectiveOdvThemeMode,
  setOdvThemeMode,
} from '../ompThemePreference.js';
import {
  getViewerPreferences,
  setViewerPreferences,
} from '../viewerPreferences.js';

/**
 * Install minimal browser stubs: in-memory localStorage, document.cookie and
 * window.matchMedia. Each store can be switched to throw to simulate denied storage.
 */
function installBrowserStubs() {
  const stores = {
    storageData: {},
    storageDenied: false,
    cookieData: {},
    cookieDenied: false,
    systemDark: false,
  };

  const storage = {
    getItem: (key) => {
      if (stores.storageDenied) throw new Error('denied');
      return Object.hasOwn(stores.storageData, key) ? stores.storageData[key] : null;
    },
    setItem: (key, value) => {
      if (stores.storageDenied) throw new Error('denied');
      stores.storageData[key] = String(value);
    },
    removeItem: (key) => {
      if (stores.storageDenied) throw new Error('denied');
      delete stores.storageData[key];
    },
  };

  const cookieStore = stores.cookieData;
  Object.defineProperty(globalThis, 'document', {
    value: {
      get cookie() {
        if (stores.cookieDenied) throw new Error('denied');
        return Object.entries(cookieStore)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ');
      },
      set cookie(entry) {
        if (stores.cookieDenied) throw new Error('denied');
        const pair = String(entry || '').split(';')[0] || '';
        const index = pair.indexOf('=');
        if (index < 0) return;
        cookieStore[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
      },
      documentElement: {
        setAttribute: () => {},
        style: {},
      },
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: storage,
      matchMedia: () => ({ matches: stores.systemDark, addEventListener: () => {}, removeEventListener: () => {} }),
    },
    configurable: true,
    writable: true,
  });

  return stores;
}

/** Encode a shared preference value the way the cookie stores it. */
function encodeShared(value) {
  return encodeURIComponent(JSON.stringify(value));
}

describe('ompThemePreference', () => {
  let stores;
  let originalWindow;
  let originalDocument;
  let originalLocation;

  beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    stores = installBrowserStubs();
    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
  });

  describe('parseSharedThemeValue', () => {
    it('accepts a version 1 value with a known mode', () => {
      expect(parseSharedThemeValue(JSON.stringify({ version: 1, mode: 'dark', revision: 'abc' })))
        .toEqual({ mode: 'dark', revision: 'abc' });
    });

    it('ignores an unknown version', () => {
      expect(parseSharedThemeValue(JSON.stringify({ version: 2, mode: 'dark', revision: 'abc' }))).toBeNull();
    });

    it('ignores an unknown mode', () => {
      expect(parseSharedThemeValue(JSON.stringify({ version: 1, mode: 'sepia', revision: 'abc' }))).toBeNull();
    });

    it('ignores malformed JSON and treats missing revisions as oldest like OMP', () => {
      expect(parseSharedThemeValue('not json')).toBeNull();
      expect(parseSharedThemeValue(JSON.stringify({ version: 1, mode: 'dark' })))
        .toEqual({ mode: 'dark', revision: '' });
    });
  });

  describe('getSharedThemePreference', () => {
    it('reads the cookie value when storage is empty', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'dark', revision: 'r1' });
      expect(getSharedThemePreference()).toEqual({ mode: 'dark', revision: 'r1' });
    });

    it('lets the newest revision win across stores', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'dark', revision: 'b' });
      stores.storageData[OMP_THEME_STORAGE_KEY] = JSON.stringify({ version: 1, mode: 'light', revision: 'c' });
      expect(getSharedThemePreference()).toEqual({ mode: 'light', revision: 'c' });
    });

    it('prefers the cookie on a revision tie', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'dark', revision: 'same' });
      stores.storageData[OMP_THEME_STORAGE_KEY] = JSON.stringify({ version: 1, mode: 'light', revision: 'same' });
      expect(getSharedThemePreference()).toEqual({ mode: 'dark', revision: 'same' });
    });

    it('uses the cookie when timestamps tie, regardless of the random suffix', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'dark', revision: '100-aaa' });
      stores.storageData[OMP_THEME_STORAGE_KEY] = JSON.stringify({ version: 1, mode: 'light', revision: '100-zzz' });
      expect(getSharedThemePreference()?.mode).toBe('dark');
    });

    it('preserves a shared choice without a revision instead of migrating over it', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'light' });
      setViewerPreferences({ themeMode: 'dark' });
      expect(getEffectiveOdvThemeMode()).toBe('light');
    });

    it('orders base-36 timestamps numerically across a digit boundary', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'dark', revision: 'z-old' });
      stores.storageData[OMP_THEME_STORAGE_KEY] = JSON.stringify({ version: 1, mode: 'light', revision: '10-new' });
      expect(getSharedThemePreference()?.mode).toBe('light');
    });

    it('ignores invalid values instead of crashing', () => {
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 9, mode: 'dark', revision: 'x' });
      stores.storageData[OMP_THEME_STORAGE_KEY] = 'broken json';
      expect(getSharedThemePreference()).toBeNull();
    });

    it('tolerates denied storage and still reads the cookie', () => {
      stores.storageDenied = true;
      stores.cookieData[OMP_THEME_STORAGE_KEY] = encodeShared({ version: 1, mode: 'light', revision: 'r1' });
      expect(getSharedThemePreference()).toEqual({ mode: 'light', revision: 'r1' });
    });

    it('returns null when both stores are denied', () => {
      stores.storageDenied = true;
      stores.cookieDenied = true;
      expect(getSharedThemePreference()).toBeNull();
    });
  });

  describe('setSharedThemePreference', () => {
    it('writes a new revision to both stores', () => {
      const first = setSharedThemePreference('dark');
      const second = setSharedThemePreference('light');
      expect(first.revision).toBeTruthy();
      expect(second.revision).not.toBe(first.revision);
      expect(getSharedThemePreference()).toEqual(second);
    });

    it('tolerates denied storage without throwing', () => {
      stores.storageDenied = true;
      stores.cookieDenied = true;
      expect(() => setSharedThemePreference('dark')).not.toThrow();
    });
  });

  describe('ODV mapping and Normal semantics', () => {
    it.each(['normal', 'dark', 'light', 'system'])('keeps %s for the session when both stores are denied', (mode) => {
      stores.storageDenied = true;
      stores.cookieDenied = true;
      setOdvThemeMode(mode);
      expect(getEffectiveOdvThemeMode()).toBe(mode);
    });

    it('keeps legacy Normal after migration and repeated preference reads', () => {
      stores.storageData.theme = 'normal';
      expect(getEffectiveOdvThemeMode()).toBe('normal');
      expect(getEffectiveOdvThemeMode()).toBe('normal');
    });

    it('lets a later explicit Light choice replace Normal', () => {
      setOdvThemeMode('normal');
      setSharedThemePreference('light');
      expect(getEffectiveOdvThemeMode()).toBe('light');
    });

    it('maps shared system/light/dark to the matching ODV mode', () => {
      setSharedThemePreference('system');
      expect(getEffectiveOdvThemeMode()).toBe('system');
      setSharedThemePreference('dark');
      expect(getEffectiveOdvThemeMode()).toBe('dark');
    });

    it('migrates an existing ODV theme setting only when no shared preference exists', () => {
      setViewerPreferences({ themeMode: 'dark', theme: 'dark', language: 'sv' });
      expect(getEffectiveOdvThemeMode()).toBe('dark');
      // Migration wrote the shared preference; the other ODV fields survived.
      expect(getSharedThemePreference()?.mode).toBe('dark');
      expect(getViewerPreferences().language).toBe('sv');
    });

    it('does not migrate a local setting over an existing shared preference', () => {
      const shared = setSharedThemePreference('light');
      setViewerPreferences({ themeMode: 'dark', theme: 'dark' });
      expect(getEffectiveOdvThemeMode()).toBe('light');
      expect(getSharedThemePreference()).toEqual(shared);
    });

    it('keeps a stored Normal across reload while the shared revision is unchanged', () => {
      expect(setOdvThemeMode('normal')).toBe('normal');
      const shared = getSharedThemePreference();
      expect(shared?.mode).toBe('light');
      // Simulate a reload: the effective mode still resolves to Normal.
      expect(getEffectiveOdvThemeMode()).toBe('normal');
    });

    it('lets a later explicit shared choice win over an old local Normal', () => {
      setOdvThemeMode('normal');
      expect(getEffectiveOdvThemeMode()).toBe('normal');
      setSharedThemePreference('dark');
      expect(getEffectiveOdvThemeMode()).toBe('dark');
    });

    it('writes System/Light/Dark choices to the shared preference', () => {
      setOdvThemeMode('dark');
      expect(getSharedThemePreference()?.mode).toBe('dark');
      expect(getEffectiveOdvThemeMode()).toBe('dark');
      setOdvThemeMode('system');
      expect(getSharedThemePreference()?.mode).toBe('system');
    });

    it('never overwrites the other ODV preference fields', () => {
      setViewerPreferences({
        language: 'sv',
        defaultZoomMode: 'FIT_WIDTH',
        printDefaultMode: 'all',
        customFitWidthFactorPercent: 70,
      });
      setOdvThemeMode('dark');
      const prefs = getViewerPreferences();
      expect(prefs.language).toBe('sv');
      expect(prefs.defaultZoomMode).toBe('FIT_WIDTH');
      expect(prefs.printDefaultMode).toBe('all');
      expect(prefs.customFitWidthFactorPercent).toBe(70);
    });
  });
});
