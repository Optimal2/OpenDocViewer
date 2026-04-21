// File: src/contexts/themeContext.js
import { createContext } from 'react';

/**
 * Theme identifier.
 * @typedef {('normal'|'light'|'dark')} ThemeName
 * @typedef {('system'|'normal'|'light'|'dark')} ThemeMode
 */

/**
 * Context value shape for the theme.
 * @typedef {Object} ThemeContextValue
 * @property {ThemeName} theme
 * @property {ThemeMode} themeMode
 * @property {function(): void} toggleTheme
 * @property {function(ThemeName): void} setThemeExplicit
 * @property {function(ThemeMode): void} setThemeMode
 */

/**
 * Create the Theme context with a safe default to avoid undefined access
 * if a consumer is mounted outside the provider by mistake.
 * Consumers should still wrap with <ThemeProvider>.
 * @type {React.Context.<ThemeContextValue>}
 */
const ThemeContext = createContext(
  /** @type {ThemeContextValue} */ ({
    theme: 'light',
    themeMode: 'system',
    toggleTheme: function () {},
    setThemeExplicit: function (_next) {},
    setThemeMode: function (_next) {}
  })
);

export default ThemeContext;
