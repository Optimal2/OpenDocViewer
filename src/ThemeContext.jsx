// File: src/ThemeContext.js

import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import logger from './LogController';

// Create the Theme context
export const ThemeContext = createContext();

/**
 * ThemeProvider component to manage and provide theme-related state and functions.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - The child components that will consume the theme context.
 * @returns {JSX.Element} The ThemeProvider component.
 */
export const ThemeProvider = ({ children }) => {
  // Initialize theme state, loading from localStorage or using system preference
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        logger.info('Theme loaded from localStorage', { theme: savedTheme });
        return savedTheme;
      }
      const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initialTheme = prefersDarkScheme ? 'dark' : 'light';
      logger.info('Theme set based on system preference', { theme: initialTheme });
      return initialTheme;
    } catch (error) {
      logger.error('Error initializing theme from localStorage', { error: error.toString() });
      return 'light';
    }
  });

  /**
   * Apply the given theme to the document and save it in localStorage.
   * @param {string} newTheme - The new theme to apply ('light' or 'dark').
   */
  const applyTheme = useCallback((newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    logger.info('Theme applied', { theme: newTheme });
  }, []);

  useEffect(() => {
    try {
      // Apply the current theme when the component mounts
      applyTheme(theme);

      // Handle system theme changes
      const handleSystemThemeChange = (e) => {
        const newTheme = e.matches ? 'dark' : 'light';
        setTheme(newTheme);
        applyTheme(newTheme);
      };

      const darkSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      darkSchemeMediaQuery.addEventListener('change', handleSystemThemeChange);

      // Clean up the event listener on component unmount
      return () => {
        darkSchemeMediaQuery.removeEventListener('change', handleSystemThemeChange);
      };
    } catch (error) {
      logger.error('Error applying theme', { error: error.toString() });
    }
  }, [theme, applyTheme]);

  /**
   * Toggle between light and dark themes.
   */
  const toggleTheme = useCallback(() => {
    try {
      const newTheme = theme === 'light' ? 'dark' : 'light';
      setTheme(newTheme);
      applyTheme(newTheme);
      logger.info('Theme toggled', { theme: newTheme });
    } catch (error) {
      logger.error('Error toggling theme', { error: error.toString() });
    }
  }, [theme, applyTheme]);

  const contextValue = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};
