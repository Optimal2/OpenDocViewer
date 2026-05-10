// File: src/components/DocumentToolbar/HelpMenuButton.jsx
/**
 * Toolbar help menu with entries for the manual and About dialog.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import StatusLed from '../common/StatusLed.jsx';

const HelpMenuButton = ({ onOpenManual, onOpenAbout, className = '', statusLedState = 'off', statusLedTitle = '' }) => {
  const { t } = useTranslation('common');
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);

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

  const handleOpenManual = () => {
    setOpen(false);
    onOpenManual?.();
  };

  const handleOpenAbout = () => {
    setOpen(false);
    onOpenAbout?.();
  };

  return (
    <div className="toolbar-menu-shell">
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn help-button odv-btn--with-status-led${className ? ` ${className}` : ''}`}
        aria-label={t('help.open', { defaultValue: 'Open help menu' })}
        title={t('help.open', { defaultValue: 'Open help menu' })}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-icons" aria-hidden="true">help_outline</span>
        <StatusLed state={statusLedState} size="xs" title={statusLedTitle} className="odv-toolbar-runtime-led" />
      </button>

      {open ? (
        <div ref={menuRef} id={menuId} className="toolbar-popup-menu" role="menu">
          <button
            type="button"
            className="toolbar-popup-menu-item"
            role="menuitem"
            onClick={handleOpenManual}
            title={t('help.menu.manual', { defaultValue: 'Manual' })}
          >
            <span className="toolbar-popup-menu-check material-icons" aria-hidden="true">menu_book</span>
            <span>{t('help.menu.manual', { defaultValue: 'Manual' })}</span>
          </button>
          <button
            type="button"
            className="toolbar-popup-menu-item"
            role="menuitem"
            onClick={handleOpenAbout}
            title={t('help.menu.about', { defaultValue: 'About OpenDocViewer' })}
          >
            <span className="toolbar-popup-menu-check material-icons" aria-hidden="true">info</span>
            <span>{t('help.menu.about', { defaultValue: 'About OpenDocViewer' })}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

HelpMenuButton.propTypes = {
  onOpenManual: PropTypes.func,
  onOpenAbout: PropTypes.func,
  className: PropTypes.string,
  statusLedState: PropTypes.oneOf(['off', 'pending', 'ready', 'active', 'warning', 'error']),
  statusLedTitle: PropTypes.string,
};

export default React.memo(HelpMenuButton);
