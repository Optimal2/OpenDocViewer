/**
 * File: src/components/DocumentToolbar/ThemeToggleButton.jsx
 *
 * OpenDocViewer — Theme Toggle Button
 *
 * PURPOSE
 *   Small, stateless control that toggles the viewer theme between "light" and "dark".
 *   By default it consumes ThemeContext for the current theme value, and will use a
 *   provided `toggleTheme` prop if supplied (useful for testing or custom hosts).
 *
 * ACCESSIBILITY
 *   - Uses `aria-pressed` to expose the toggle state.
 *   - Button includes a descriptive `aria-label` and `title`.
 *
 * ICONS
 *   - Uses Material Icons glyphs: `dark_mode` (when current theme is light) and
 *     `light_mode` (when current theme is dark).
 *
 * IMPORTANT PROJECT NOTE (future reviewers)
 *   - Elsewhere in this project we import from the **root** 'file-type' package, NOT
 *     'file-type/browser'. With file-type v21 the '/browser' subpath is not exported
 *     for bundlers and will break Vite builds. See README “Design notes & gotchas”.
 *
 * Baseline source reference: :contentReference[oaicite:0]{index=0}
 */

import React, { useContext, useMemo } from 'react';
import PropTypes from 'prop-types';
import { ThemeContext } from '../../ThemeContext.jsx';

/**
 * ThemeToggleButton
 *
 * @param {Object}   props
 * @param {() => void} [props.toggleTheme]  Optional override; if omitted, uses ThemeContext.toggleTheme.
 * @param {string}   [props.className]      Optional extra class names for the button.
 * @returns {JSX.Element}
 */
const ThemeToggleButton = ({ toggleTheme, className = '' }) => {
  const ctx = useContext(ThemeContext);
  const theme = (ctx?.theme === 'dark' || ctx?.theme === 'light') ? ctx.theme : 'light';
  const doToggle = toggleTheme || ctx?.toggleTheme;

  const isDark = theme === 'dark';

  const labels = useMemo(() => {
    return {
      aria: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      title: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      icon: isDark ? 'light_mode' : 'dark_mode',
    };
  }, [isDark]);

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
