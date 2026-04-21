// File: src/contexts/ThemeProvider.jsx
/**
 * src/contexts/ThemeProvider.jsx
 *
 * OpenDocViewer — Theme state context (React)
 *
 * PURPOSE
 *   Centralize theme handling with:
 *     - explicit themes: normal / light / dark
 *     - an implicit system-following startup mode when the user has not chosen a theme yet
 *     - robust initialization (persisted preference → system preference → light fallback)
 *     - resilient DOM updates (SSR-safe, try/catch)
 *     - live reaction to `prefers-color-scheme` changes while the mode is `system`
 *     - memoized context value for predictable renders
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import logger from '../logging/systemLogger.js';
import ThemeContext from './themeContext.js';
import { getThemeModePreference, setThemeModePreference } from '../utils/viewerPreferences.js';

/**
 * Theme identifier.
 * @typedef {('normal'|'light'|'dark')} ThemeName
 */

/**
 * Theme mode identifier.
 * - `system` means no explicit saved theme is active; follow the browser/OS preference.
 * - `normal`, `light`, and `dark` are explicit user-selected themes.
 * @typedef {('system'|'normal'|'light'|'dark')} ThemeMode
 */

/**
 * Detect system preferred color scheme (SSR-safe; defaults to light).
 * @returns {('light'|'dark')}
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
 * `system` follows the browser/OS preference; the explicit `normal` theme is a separate, slightly
 * softer light theme intended to stay visually distinct from the plain light palette.
 *
 * @param {ThemeMode} mode
 * @returns {ThemeName}
 */
function resolveThemeForMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (mode === 'normal') return 'normal';
  return detectSystemTheme() === 'dark' ? 'dark' : 'light';
}

/**
 * Apply the resolved theme to the DOM (SSR-safe).
 *
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
    root.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  } catch {
    // ignore; DOM not available or locked down
  }
}


/**
 * Resolve the initial theme mode once during provider initialization.
 *
 * @returns {ThemeMode}
 */
function resolveInitialThemeMode() {
  const saved = getThemeModePreference();
  if (saved === 'system' || saved === 'normal' || saved === 'light' || saved === 'dark') {
    logger.info('Theme mode loaded from persisted preferences', { themeMode: saved });
    return saved;
  }
  logger.info('Theme mode defaults to browser/OS-following mode until the user chooses an explicit theme');
  return 'system';
}

/**
 * ThemeProvider component to manage and provide theme-related state and functions.
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export const ThemeProvider = ({ children }) => {
  const initialStateRef = useRef(null);
  if (!initialStateRef.current) {
    const mode = resolveInitialThemeMode();
    initialStateRef.current = { mode, theme: resolveThemeForMode(mode) };
  }

  const [themeMode, setThemeModeState] = useState/** @type {function(): ThemeMode} */(() => initialStateRef.current.mode);
  const [theme, setTheme] = useState/** @type {function(): ThemeName} */(() => initialStateRef.current.theme);

  /**
   * Persist and apply a theme mode.
   *
   * @param {ThemeMode} nextMode
   * @returns {void}
   */
  const setThemeMode = useCallback((nextMode) => {
    const normalized = nextMode === 'dark'
      ? 'dark'
      : (nextMode === 'light'
        ? 'light'
        : (nextMode === 'normal' ? 'normal' : 'system'));
    const resolved = resolveThemeForMode(normalized);
    setThemeModePreference(normalized);
    setThemeModeState(normalized);
    setTheme(resolved);
    applyThemeToDocument(resolved, normalized);
    logger.info('Theme mode applied', { themeMode: normalized, resolvedTheme: resolved });
  }, []);

  /**
   * Apply an explicit concrete theme.
   *
   * @param {ThemeName} nextTheme
   * @returns {void}
   */
  const setThemeExplicit = useCallback((nextTheme) => {
    setThemeMode(nextTheme === 'dark' ? 'dark' : (nextTheme === 'normal' ? 'normal' : 'light'));
  }, [setThemeMode]);

  /**
   * Toggle between the two highest-contrast explicit themes.
   * This helper is retained for compatibility with older consumers.
   *
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
      if (themeMode !== 'system') return;
      const next = event.matches ? 'dark' : 'light';
      setTheme((current) => (current === next ? current : next));
      applyThemeToDocument(next, 'system');
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
