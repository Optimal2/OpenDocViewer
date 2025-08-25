// File: src/ThemeContext.jsx
/**
 * src/ThemeContext.jsx
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

import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import logger from './LogController';

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

/** Storage key for persisting theme choice. */
const LS_KEY = 'theme';

/**
 * Try to read a string value from localStorage.
 * @param {string} key
 * @returns {(string|null)}
 */
function lsGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Try to write a string value to localStorage.
 * @param {string} key
 * @param {string} value
 * @returns {boolean} success
 */
function lsSet(key, value) {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

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
 * Create the Theme context with a safe default to avoid undefined access
 * if a consumer is mounted outside the provider by mistake.
 * Consumers should still wrap with <ThemeProvider>.
 * @type {React.Context.<ThemeContextValue>}
 */
export const ThemeContext = createContext(
  /** @type {ThemeContextValue} */ ({
    theme: 'light',
    toggleTheme: function () {},
    setThemeExplicit: function (_next) {}
  })
);

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
    const saved = lsGet(LS_KEY);
    if (saved === 'light' || saved === 'dark') {
      logger.info('Theme loaded from localStorage', { theme: saved });
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
    const ok = lsSet(LS_KEY, value);
    if (!ok) {
      // Storage might be unavailable; not fatal.
      logger.debug('Theme persist skipped or failed (storage unavailable)', { theme: value });
    }
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
      // Only auto-switch if the user hasn't explicitly chosen a theme before.
      // If you want user settings to always override, uncomment the guard below:
      // if (lsGet(LS_KEY)) return;
      setThemeExplicit(next);
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
