// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getLanguagePreference,
  getViewerPreferences,
  setLanguagePreference,
  setViewerPreferences,
} from '../viewerPreferences.js';

const STORAGE_KEY = 'ODV_USER_PREFERENCES';

function clearStores() {
  window.localStorage.clear();
  document.cookie = `${STORAGE_KEY}=; Max-Age=0; Path=/`;
}

describe('setLanguagePreference', () => {
  beforeEach(clearStores);
  afterEach(clearStores);

  it.each(['', ' \t\n '])('clears language from both stores while preserving other preferences: %j', (language) => {
    const otherPreferences = { theme: 'dark', themeMode: 'dark', defaultZoomMode: 'FIT_PAGE', printDefaultMode: 'all' };
    setViewerPreferences({ ...otherPreferences, language: 'sv' });

    expect(setLanguagePreference(language)).toEqual(otherPreferences);
    expect(getLanguagePreference()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual(otherPreferences);

    // With storage unavailable after reload, the cookie must not resurrect the language.
    window.localStorage.clear();
    expect(getViewerPreferences()).toEqual(otherPreferences);
    expect(getLanguagePreference()).toBeNull();
  });

  it('normalizes and saves a non-empty language to both stores', () => {
    expect(setLanguagePreference(' EN ')).toEqual({ language: 'en' });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual({ language: 'en' });
    window.localStorage.clear();
    expect(getLanguagePreference()).toBe('en');
  });
});
