// File: src/components/DocumentToolbar/ThemeToggleButton.js

import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { ThemeContext } from '../../ThemeContext';

/**
 * ThemeToggleButton component.
 * Provides a button to toggle between light and dark themes.
 * 
 * @param {Object} props - Component props.
 * @param {function} props.toggleTheme - Function to toggle the theme.
 */
const ThemeToggleButton = ({ toggleTheme }) => {
  const { theme } = useContext(ThemeContext);

  return (
    <button onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
      <span className="material-icons">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
    </button>
  );
};

ThemeToggleButton.propTypes = {
  toggleTheme: PropTypes.func.isRequired,
};

export default ThemeToggleButton;
