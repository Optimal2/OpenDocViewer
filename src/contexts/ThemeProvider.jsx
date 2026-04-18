// File: src/contexts/ThemeProvider.jsx
/**
 * src/contexts/ThemeProvider.jsx
 *
 * OpenDocViewer — Theme state context (React)
 *
 * PURPOSE
 *   Centralize light/dark theme handling with:
 *     - robust initialization (localStorage → system preference → fallback)
 *     - resilient DOM updates (SSR-safe, try/catch)
 *     - live reaction to `prefers-color-scheme` changes (with Safari fallback)
 *     - memoized context value for predictable renders
 *
 * NOTES & GOTCHAS
 *   - We set `data-theme="light|dark"` on <html>. Keep CSS keyed to this attribute.
 *   - Do **not** throw on storage failures (Safari private mode, quota, etc.).
 *   - Avoid noisy logs in hot paths; theme changes are infrequent so info-level logs are OK.
 *   - Historical trap (elsewhere in the app): we import `file-type` from the **root** package,
 *     not "file-type/browser", because v21 does not export that subpath for bundlers.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import logger from '../logging/systemLogger.js';
import ThemeContext from './themeContext.js';
import { getThemePreference, setThemePreference } from '../utils/viewerPreferences.js';

/**
 * Theme identifier.
 * @typedef {('light'|'dark')} ThemeName
 */

/**
 * Context value shape for the theme.
 * @typedef {Object} ThemeContextValue
 * @property {ThemeName} theme                       Current theme name ("light" | "dark")
 * @property {function(): void} toggleTheme          Toggle between light/dark
 * @property {function(ThemeName): void} setThemeExplicit  Explicitly set a theme
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
 * Apply the theme to the DOM (SSR-safe).
 * - Sets <html data-theme="..."> for CSS selectors: [data-theme="dark"] { ... }
 * - Sets `color-scheme` to hint UA form controls, scrollbars, etc.
 * @param {ThemeName} newTheme
 * @returns {void}
 */
function applyThemeToDocument(newTheme) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', newTheme);
    root.style.colorScheme = newTheme; // helps native widgets match theme
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
  /**
   * Initialize theme state:
   *  1) localStorage "theme" if valid
   *  2) system preference via matchMedia
   *  3) 'light' fallback
   */
  const [theme, setTheme] = useState/** @type {function(): ThemeName} */(() => {
    const saved = getThemePreference();
    if (saved === 'light' || saved === 'dark') {
      logger.info('Theme loaded from persisted preferences', { theme: saved });
      return /** @type {ThemeName} */ (saved);
    }
    const sys = detectSystemTheme();
    logger.info('Theme set from system preference', { theme: sys });
    return sys;
  });

  /**
   * Apply a given theme and persist it.
   * @param {ThemeName} next
   * @returns {void}
   */
  const setThemeExplicit = useCallback((next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    applyThemeToDocument(value);
    setThemePreference(value);
    setTheme(value);
    logger.info('Theme applied', { theme: value });
  }, []);

  /**
   * Toggle between light and dark themes.
   * @returns {void}
   */
  const toggleTheme = useCallback(() => {
    setThemeExplicit(theme === 'light' ? 'dark' : 'light');
  }, [theme, setThemeExplicit]);

  /**
   * On mount and when theme changes, apply to document (idempotent).
   * Also subscribe to system theme changes (media query).
   */
  useEffect(() => {
    // Apply current theme
    applyThemeToDocument(theme);

    // Listen for system dark-mode changes (Chromium/Firefox)
    /** @type {*|undefined} */
    let mq;
    /**
     * @param {*} e
     * @returns {void}
     */
    const onChange = (e) => {
      const next = e.matches ? 'dark' : 'light';
      // Only auto-switch if the user has not explicitly chosen a theme.
      if (getThemePreference()) return;
      applyThemeToDocument(next);
      setTheme(next);
    };

    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        mq = window.matchMedia('(prefers-color-scheme: dark)');
        // Modern browsers
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
        // Safari fallback
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
  }, [theme, setThemeExplicit]);

  /** Memoized context value. */
  const contextValue = useMemo(
    () =>
      /** @type {ThemeContextValue} */ ({
        theme: theme,
        toggleTheme: toggleTheme,
        setThemeExplicit: setThemeExplicit
      }),
    [theme, toggleTheme, setThemeExplicit]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};
