// File: src/components/DocumentToolbar/ThemeToggleButton.jsx
/**
 * File: src/components/DocumentToolbar/ThemeToggleButton.jsx
 *
 * Small button that toggles between light/dark themes using the ThemeContext.
 *
 * @component
 * @param {Object} props
 * @param {function():void} [props.toggleTheme] - Optional external toggle handler; falls back to context.
 * @param {string} [props.className] - Optional extra class names.
 * @returns {JSX.Element}
 */

import React, { useContext, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { ThemeContext } from '../../ThemeContext.jsx';

const ThemeToggleButton = ({ toggleTheme, className = '' }) => {
  const { t } = useTranslation();
  const ctx = useContext(ThemeContext);
  const theme = (ctx?.theme === 'dark' || ctx?.theme === 'light') ? ctx.theme : 'light';
  const doToggle = toggleTheme || ctx?.toggleTheme;

  const isDark = theme === 'dark';

  const labels = useMemo(() => {
    return {
      aria: isDark ? t('toolbar.theme.switchToLight') : t('toolbar.theme.switchToDark'),
      title: isDark ? t('toolbar.theme.switchToLight') : t('toolbar.theme.switchToDark'),
      icon: isDark ? 'light_mode' : 'dark_mode',
    };
  }, [isDark, t]);

  return (
    <button
      type="button"
      onClick={doToggle}
      aria-label={labels.aria}
      title={labels.title}
      aria-pressed={isDark}
      className={`odv-btn${className ? ` ${className}` : ''}`}
    >
      <span className="material-icons" aria-hidden="true">{labels.icon}</span>
    </button>
  );
};

ThemeToggleButton.propTypes = {
  toggleTheme: PropTypes.func,
  className: PropTypes.string,
};

export default React.memo(ThemeToggleButton);
