// File: src/components/DocumentToolbar/LanguageMenuButton.jsx
/**
 * Compact language selector for the toolbar.
 *
 * Uses the already-initialized i18next instance and persists the chosen language via the shared
 * viewer-preferences utility (handled centrally in `src/i18n.js`).
 *
 * With the read-aloud state provided (contexts/readAloudContext.js: OCR on, read-aloud on) the
 * menu has two titled sections, "Interface language" and "Reading language", each its own
 * radio group, so the UI language and the language read aloud are chosen in the same place
 * without being confused: "Auto (svenska)" first (with the language guess on), one entry per
 * OCR language (greyed without a local voice), and "Follow the interface language" last. The
 * reading choice is kept in the viewer preferences. Without that state the menu is the plain
 * language list it always was.
 */

import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ReadAloudContext from '../../contexts/readAloudContext.js';

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
  const readAloud = useContext(ReadAloudContext);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const uiTitleId = useId();
  const readTitleId = useId();
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
      closeMenu();
    }
  };

  /** Close the menu and give the focus back to the button (a choice unmounts the focused item). */
  const closeMenu = () => {
    setOpen(false);
    buttonRef.current?.focus?.();
  };

  const currentLabel = resolveLanguageLabel(currentLanguage, t);
  const buttonTitle = t('toolbar.language.current', { language: currentLabel, defaultValue: `Language: ${currentLabel}` })
    + (readAloud ? ` · ${readAloud.languageTitle}: ${readAloud.currentLabel}` : '');

  const uiEntries = supportedLanguages.map((code) => {
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
  });

  return (
    <div className="toolbar-menu-shell">
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn${className ? ` ${className}` : ''}`}
        aria-label={t('toolbar.language.openMenu', { defaultValue: 'Choose language' })}
        title={buttonTitle}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-icons" aria-hidden="true">language</span>
      </button>

      {open ? (
        <div ref={menuRef} id={menuId} className={`toolbar-popup-menu${readAloud ? ' toolbar-split-menu' : ''}`} role="menu">
          {readAloud ? (
            <>
              <div className="toolbar-split-menu-section" role="group" aria-labelledby={uiTitleId}>
                <div id={uiTitleId} className="toolbar-split-menu-title" role="presentation">
                  {t('toolbar.language.uiTitle', { defaultValue: 'Interface language' })}
                </div>
                {uiEntries}
              </div>
              <div className="toolbar-split-menu-section" role="group" aria-labelledby={readTitleId} data-odv-ocr="read-menu">
                <div id={readTitleId} className="toolbar-split-menu-title" role="presentation">{readAloud.languageTitle}</div>
                {readAloud.entries.map((entry) => {
                  const selected = entry.value === readAloud.selectedValue;
                  return (
                    <button
                      key={entry.value || 'auto'}
                      type="button"
                      className={`toolbar-popup-menu-item${selected ? ' is-selected' : ''}`}
                      role="menuitemradio"
                      aria-checked={selected}
                      aria-disabled={entry.disabled || undefined}
                      disabled={entry.disabled}
                      data-speech-language={entry.value}
                      title={entry.label}
                      onClick={() => {
                        readAloud.chooseLanguage(entry.value);
                        closeMenu();
                      }}
                    >
                      <span className={`toolbar-popup-menu-check${selected ? ' material-icons is-selected' : ''}`} aria-hidden="true">
                        {selected ? 'check' : ''}
                      </span>
                      <span>{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : uiEntries}
        </div>
      ) : null}
    </div>
  );
};

LanguageMenuButton.propTypes = {
  className: PropTypes.string,
};

export default React.memo(LanguageMenuButton);
