// File: src/components/DocumentToolbar/ThemeMenuButton.jsx
/**
 * Compact theme selector for the toolbar.
 *
 * Modes:
 * - normal -> balanced mid-light theme
 * - light  -> brightest theme
 * - dark   -> darkest theme
 *
 * When no explicit choice has been saved yet, the viewer follows the browser/OS preference.
 */

import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ThemeContext from '../../contexts/themeContext.js';

/**
 * @param {'system'|'normal'|'light'|'dark'} mode
 * @param {function(string, Object=): string} t
 * @returns {string}
 */
function resolveThemeModeLabel(mode, t) {
  if (mode === 'dark') return t('toolbar.theme.options.dark', { defaultValue: 'Dark' });
  if (mode === 'light') return t('toolbar.theme.options.light', { defaultValue: 'Light' });
  if (mode === 'normal') return t('toolbar.theme.options.normal', { defaultValue: 'Normal' });
  return t('toolbar.theme.system', { defaultValue: 'System' });
}

/**
 * @param {'system'|'normal'|'light'|'dark'} mode
 * @returns {string}
 */
function resolveThemeModeIcon(mode) {
  if (mode === 'dark') return 'dark_mode';
  if (mode === 'light') return 'light_mode';
  if (mode === 'normal') return 'contrast';
  return 'settings_suggest';
}

const ThemeMenuButton = ({ className = '' }) => {
  const { t } = useTranslation('common');
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const ctx = useContext(ThemeContext);
  const currentMode = (ctx?.themeMode === 'system' || ctx?.themeMode === 'normal' || ctx?.themeMode === 'dark' || ctx?.themeMode === 'light')
    ? ctx.themeMode
    : 'system';
  const resolvedTheme = (ctx?.theme === 'normal' || ctx?.theme === 'dark' || ctx?.theme === 'light')
    ? ctx.theme
    : 'light';
  const selectedMode = currentMode === 'system' ? (resolvedTheme === 'dark' ? 'dark' : 'light') : currentMode;
  const setThemeMode = typeof ctx?.setThemeMode === 'function' ? ctx.setThemeMode : null;

  const options = useMemo(() => ([
    { mode: 'normal', icon: resolveThemeModeIcon('normal') },
    { mode: 'light', icon: resolveThemeModeIcon('light') },
    { mode: 'dark', icon: resolveThemeModeIcon('dark') },
  ]), []);

  useEffect(() => {
    if (!open) return undefined;

    /** @param {MouseEvent} event */
    const handlePointerDown = (event) => {
      const target = event.target;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      setOpen(false);
    };

    /** @param {KeyboardEvent} event */
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus?.();
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  /** @param {'normal'|'light'|'dark'} mode */
  const handleSelect = (mode) => {
    try {
      setThemeMode?.(mode);
    } finally {
      setOpen(false);
    }
  };

  const buttonIcon = resolveThemeModeIcon(currentMode === 'system' ? selectedMode : currentMode);
  const currentLabel = currentMode === 'system'
    ? t('toolbar.theme.currentSystem', {
      theme: resolveThemeModeLabel(selectedMode, t),
      defaultValue: `System (${resolveThemeModeLabel(selectedMode, t)})`,
    })
    : resolveThemeModeLabel(currentMode, t);

  return (
    <div className="toolbar-menu-shell">
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn${className ? ` ${className}` : ''}`}
        aria-label={t('toolbar.theme.openMenu', { defaultValue: 'Choose theme' })}
        title={t('toolbar.theme.current', {
          theme: currentLabel,
          defaultValue: `Theme: ${currentLabel}`,
        })}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-icons" aria-hidden="true">{buttonIcon}</span>
      </button>

      {open ? (
        <div ref={menuRef} id={menuId} className="toolbar-popup-menu" role="menu">
          {options.map(({ mode, icon }) => {
            const selected = mode === selectedMode;
            const label = resolveThemeModeLabel(/** @type {'system'|'normal'|'light'|'dark'} */ (mode), t);
            return (
              <button
                key={mode}
                type="button"
                className={`toolbar-popup-menu-item${selected ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => handleSelect(/** @type {'normal'|'light'|'dark'} */ (mode))}
                title={t('toolbar.theme.switchToMode', {
                  theme: label,
                  defaultValue: `Switch theme to ${label}`,
                })}
              >
                <span
                  className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`}
                  aria-hidden="true"
                >
                  {selected ? 'check' : ''}
                </span>
                <span className="material-icons" aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

ThemeMenuButton.propTypes = {
  className: PropTypes.string,
};

export default React.memo(ThemeMenuButton);
