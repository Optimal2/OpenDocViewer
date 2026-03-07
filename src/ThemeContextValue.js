// File: src/ThemeContextValue.js
import { createContext } from 'react';

/**
 * Theme identifier.
 * @typedef {('light'|'dark')} ThemeName
 */

/**
 * Context value shape for the theme.
 * @typedef {Object} ThemeContextValue
 * @property {ThemeName} theme
 * @property {function(): void} toggleTheme
 * @property {function(ThemeName): void} setThemeExplicit
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
    toggleTheme: function () {},
    setThemeExplicit: function (_next) {}
  })
);

export default ThemeContext;
