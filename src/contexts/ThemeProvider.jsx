// File: src/contexts/ThemeProvider.jsx
/**
 * src/contexts/ThemeProvider.jsx
 *
 * OpenDocViewer — Theme state context (React)
 *
 * PURPOSE
 *   Centralize theme handling with:
 *     - explicit modes: auto / light / dark
 *     - robust initialization (persisted preference → system preference → light fallback)
 *     - resilient DOM updates (SSR-safe, try/catch)
 *     - live reaction to `prefers-color-scheme` changes while the mode is `auto`
 *     - memoized context value for predictable renders
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import logger from '../logging/systemLogger.js';
import ThemeContext from './themeContext.js';
import { getThemeModePreference, setThemeModePreference } from '../utils/viewerPreferences.js';

/**
 * Theme identifier.
 * @typedef {('light'|'dark')} ThemeName
 */

/**
 * Theme mode identifier.
 * @typedef {('auto'|'light'|'dark')} ThemeMode
 */

/**
 * Detect system preferred color scheme (SSR-safe; defaults to light).
 * @returns {ThemeName}
 */
function detectSystemTheme() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Resolve the concrete theme for a theme mode.
 * @param {ThemeMode} mode
 * @returns {ThemeName}
 */
function resolveThemeForMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return detectSystemTheme();
}

/**
 * Apply the resolved theme to the DOM (SSR-safe).
 * @param {ThemeName} resolvedTheme
 * @param {ThemeMode} mode
 * @returns {void}
 */
function applyThemeToDocument(resolvedTheme, mode) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    root.setAttribute('data-theme-mode', mode);
    root.style.colorScheme = resolvedTheme;
  } catch {
    // ignore; DOM not available or locked down
  }
}

/**
 * ThemeProvider component to manage and provide theme-related state and functions.
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState/** @type {function(): ThemeMode} */(() => {
    const saved = getThemeModePreference();
    if (saved === 'auto' || saved === 'light' || saved === 'dark') {
      logger.info('Theme mode loaded from persisted preferences', { themeMode: saved });
      return saved;
    }
    logger.info('Theme mode defaults to automatic system-following mode');
    return 'auto';
  });

  const [theme, setTheme] = useState/** @type {function(): ThemeName} */(() => resolveThemeForMode(
    (getThemeModePreference() === 'light' || getThemeModePreference() === 'dark' || getThemeModePreference() === 'auto')
      ? /** @type {ThemeMode} */ (getThemeModePreference())
      : 'auto'
  ));

  /**
   * Persist and apply a theme mode.
   * @param {ThemeMode} nextMode
   * @returns {void}
   */
  const setThemeMode = useCallback((nextMode) => {
    const normalized = nextMode === 'dark' ? 'dark' : (nextMode === 'light' ? 'light' : 'auto');
    const resolved = resolveThemeForMode(normalized);
    setThemeModePreference(normalized);
    setThemeModeState(normalized);
    setTheme(resolved);
    applyThemeToDocument(resolved, normalized);
    logger.info('Theme mode applied', { themeMode: normalized, resolvedTheme: resolved });
  }, []);

  /**
   * Apply an explicit concrete theme.
   * @param {ThemeName} nextTheme
   * @returns {void}
   */
  const setThemeExplicit = useCallback((nextTheme) => {
    setThemeMode(nextTheme === 'dark' ? 'dark' : 'light');
  }, [setThemeMode]);

  /**
   * Toggle between light and dark explicit modes.
   * Auto resolves first, then toggles to the opposite explicit mode.
   * @returns {void}
   */
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
  }, [theme, setThemeMode]);

  useEffect(() => {
    const resolved = resolveThemeForMode(themeMode);
    setTheme((current) => (current === resolved ? current : resolved));
    applyThemeToDocument(resolved, themeMode);

    /** @type {MediaQueryList|undefined} */
    let mq;
    /** @param {MediaQueryListEvent|MediaQueryList} event */
    const onChange = (event) => {
      if (themeMode !== 'auto') return;
      const next = event.matches ? 'dark' : 'light';
      setTheme((current) => (current === next ? current : next));
      applyThemeToDocument(next, 'auto');
      logger.info('Theme updated from system preference', { resolvedTheme: next });
    };

    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
        else if (typeof mq.addListener === 'function') mq.addListener(onChange);
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (mq) {
          if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
          else if (typeof mq.removeListener === 'function') mq.removeListener(onChange);
        }
      } catch {
        // ignore
      }
    };
  }, [themeMode]);

  const contextValue = useMemo(() => ({
    theme,
    themeMode,
    toggleTheme,
    setThemeExplicit,
    setThemeMode,
  }), [theme, themeMode, toggleTheme, setThemeExplicit, setThemeMode]);

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};
