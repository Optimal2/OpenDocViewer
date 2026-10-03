// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getEffectiveToolbarLargeButtons,
  getToolbarLargeButtonsPreference,
  getViewerPreferences,
  setToolbarLargeButtonsPreference,
  setViewerPreferences,
} from '../viewerPreferences.js';
import { getToolbarLargeButtonsDefault } from '../runtimeConfig.js';

const STORAGE_KEY = 'ODV_USER_PREFERENCES';

function clearStores() {
  window.localStorage.clear();
  document.cookie = `${STORAGE_KEY}=; Max-Age=0; Path=/`;
}

describe('getToolbarLargeButtonsDefault (runtime config toolbar.largeButtons)', () => {
  it('defaults to large buttons when the key is missing or not a boolean', () => {
    expect(getToolbarLargeButtonsDefault({})).toBe(true);
    expect(getToolbarLargeButtonsDefault({ toolbar: {} })).toBe(true);
    expect(getToolbarLargeButtonsDefault({ toolbar: { largeButtons: 'false' } })).toBe(true);
    expect(getToolbarLargeButtonsDefault({ toolbar: { largeButtons: true } })).toBe(true);
  });

  it('only an explicit false makes compact the default', () => {
    expect(getToolbarLargeButtonsDefault({ toolbar: { largeButtons: false } })).toBe(false);
  });
});

describe('toolbar large-buttons preference', () => {
  beforeEach(clearStores);
  afterEach(clearStores);

  it('is unset until the user chooses', () => {
    expect(getToolbarLargeButtonsPreference()).toBeNull();
  });

  it('persists the choice to localStorage and the cookie, keeping other preferences', () => {
    setViewerPreferences({ themeMode: 'dark', theme: 'dark', language: 'sv' });

    expect(setToolbarLargeButtonsPreference(false)).toEqual({
      theme: 'dark', themeMode: 'dark', language: 'sv', toolbarLargeButtons: false,
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).toolbarLargeButtons).toBe(false);

    // Cookie alone (storage cleared, as after a reload with storage unavailable) keeps it.
    window.localStorage.clear();
    expect(getToolbarLargeButtonsPreference()).toBe(false);

    setToolbarLargeButtonsPreference(true);
    expect(getToolbarLargeButtonsPreference()).toBe(true);
  });

  it('ignores non-boolean stored values', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ toolbarLargeButtons: 'no', language: 'en' }));
    expect(getViewerPreferences()).toEqual({ language: 'en' });
    expect(getToolbarLargeButtonsPreference()).toBeNull();
  });

  it('uses the config default when nothing is stored', () => {
    expect(getEffectiveToolbarLargeButtons({})).toBe(true);
    expect(getEffectiveToolbarLargeButtons({ toolbar: { largeButtons: false } })).toBe(false);
  });

  it('a stored choice outranks the config default in both directions', () => {
    setToolbarLargeButtonsPreference(false);
    expect(getEffectiveToolbarLargeButtons({ toolbar: { largeButtons: true } })).toBe(false);
    expect(getEffectiveToolbarLargeButtons({})).toBe(false);

    setToolbarLargeButtonsPreference(true);
    expect(getEffectiveToolbarLargeButtons({ toolbar: { largeButtons: false } })).toBe(true);
  });
});
