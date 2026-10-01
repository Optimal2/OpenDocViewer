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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../ThemeProvider.jsx';
import ThemeContext from '../themeContext.js';
import { OMP_THEME_BRIDGE_KIND } from '../../integrations/ompThemeBridge.js';
import {
  OMP_THEME_STORAGE_KEY,
  getEffectiveOdvThemeMode,
  applyOdvThemeToDocument,
  resolveConcreteTheme,
  createSharedThemeRevision,
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

it('keeps a mounted provider synchronized without echoing remote changes', async () => {
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
  const host = { postMessage: vi.fn() };
  const mediaListeners = new Set();
  const media = {
    matches: false,
    addEventListener: (_type, listener) => mediaListeners.add(listener),
    removeEventListener: (_type, listener) => mediaListeners.delete(listener),
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => media);
  window.__ODV_CONFIG__ = { theme: { bridge: { allowedOrigins: ['https://host.example'] } } };
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let theme;
  function Probe() {
    theme = useContext(ThemeContext);
    return createElement('span', null, theme.themeMode);
  }
  try {
    localStorage.clear();
    clearCookies();
    await act(() => root.render(createElement(ThemeProvider, null, createElement(Probe))));
    expect(document.documentElement.dataset.theme).toBe('light');
    await act(() => {
      media.matches = true;
      for (const listener of mediaListeners) listener(media);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(() => theme.setThemeMode('normal'));
    expect(document.documentElement.dataset.theme).toBe('normal');
    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage.mock.calls[0][1]).toBe('https://host.example');
    const revision = createSharedThemeRevision();
    const remote = { kind: OMP_THEME_BRIDGE_KIND, version: 1, mode: 'dark', revision };
    await act(() => window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://host.example', source: host, data: remote,
    })));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(() => window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://host.example', source: host, data: remote,
    })));
    expect(host.postMessage).toHaveBeenCalledTimes(1);
    await act(() => {
      media.matches = false;
      for (const listener of mediaListeners) listener(media);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    for (const eventType of ['storage', 'focus', 'pageshow', 'omp:theme-changed']) {
      const mode = theme.themeMode === 'light' ? 'dark' : 'light';
      setSharedCookie(mode, createSharedThemeRevision());
      await act(() => window.dispatchEvent(eventType === 'storage'
        ? new StorageEvent('storage', { key: OMP_THEME_STORAGE_KEY }) : new Event(eventType)));
      expect(document.documentElement.dataset.theme).toBe(mode);
    }
    expect(host.postMessage).toHaveBeenCalledTimes(1);
    const payload = localStorage.getItem(OMP_THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = 'normal';
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(document.documentElement.dataset.theme).toBe(theme.theme);
    expect(localStorage.getItem(OMP_THEME_STORAGE_KEY)).toBe(payload);
  } finally {
    await act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, 'parent', originalParent);
    delete window.__ODV_CONFIG__;
    vi.unstubAllGlobals();
  }
  expect(mediaListeners.size).toBe(0);
});
