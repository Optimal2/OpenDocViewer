// File: src/components/DocumentToolbar/LanguageMenuButton.jsx
/**
 * Compact language selector for the toolbar.
 *
 * Uses the already-initialized i18next instance and persists the chosen language via the shared
 * viewer-preferences utility (handled centrally in `src/i18n.js`).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {string} code
 * @param {function(string, Object=): string} t
 * @returns {string}
 */
function resolveLanguageLabel(code, t) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'sv') return t('toolbar.language.options.sv', { defaultValue: 'Svenska' });
  if (normalized === 'en') return t('toolbar.language.options.en', { defaultValue: 'English' });
  return normalized.toUpperCase();
}

const LanguageMenuButton = ({ className = '' }) => {
  const { t, i18n } = useTranslation('common');
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);

  const supportedLanguages = useMemo(() => {
    const raw = Array.isArray(i18n?.options?.supportedLngs) ? i18n.options.supportedLngs : [];
    const unique = [];
    raw.forEach((entry) => {
      const normalized = String(entry || '').trim().toLowerCase();
      if (!normalized || normalized === 'cimode' || unique.includes(normalized)) return;
      unique.push(normalized);
    });
    return unique.length ? unique : ['en'];
  }, [i18n?.options?.supportedLngs]);

  const currentLanguage = useMemo(() => {
    const raw = String(i18n?.resolvedLanguage || i18n?.language || supportedLanguages[0] || 'en');
    return raw.toLowerCase().split('-')[0] || 'en';
  }, [i18n?.language, i18n?.resolvedLanguage, supportedLanguages]);

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

  /**
   * @param {string} code
   * @returns {Promise<void>}
   */
  const handleSelectLanguage = async (code) => {
    const normalized = String(code || '').trim().toLowerCase();
    if (!normalized) {
      setOpen(false);
      return;
    }

    try {
      if (normalized !== currentLanguage) {
        await i18n.changeLanguage(normalized);
      }
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="toolbar-menu-shell">
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn${className ? ` ${className}` : ''}`}
        aria-label={t('toolbar.language.openMenu', { defaultValue: 'Choose language' })}
        title={t('toolbar.language.current', {
          language: resolveLanguageLabel(currentLanguage, t),
          defaultValue: `Language: ${resolveLanguageLabel(currentLanguage, t)}`,
        })}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-icons" aria-hidden="true">language</span>
      </button>

      {open ? (
        <div ref={menuRef} id={menuId} className="toolbar-popup-menu" role="menu">
          {supportedLanguages.map((code) => {
            const label = resolveLanguageLabel(code, t);
            const selected = code === currentLanguage;
            return (
              <button
                key={code}
                type="button"
                className={`toolbar-popup-menu-item${selected ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => { void handleSelectLanguage(code); }}
                title={t('toolbar.language.switchTo', {
                  language: label,
                  defaultValue: `Switch language to ${label}`,
                })}
              >
                <span
                  className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`}
                  aria-hidden="true"
                >
                  {selected ? 'check' : ''}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

LanguageMenuButton.propTypes = {
  className: PropTypes.string,
};

export default React.memo(LanguageMenuButton);
