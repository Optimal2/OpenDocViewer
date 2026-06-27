// File: src/components/DocumentToolbar/SplitToolbarButton.jsx
/**
 * Reusable toolbar split-button.
 *
 * The main button performs the primary action. The narrow arrow button opens a compact menu for
 * related settings without changing the primary-action click target.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]       Extra class names for the shell.
 * @param {string} [props.mainClassName]   Extra class names for the primary button.
 * @param {string} [props.menuClassName]   Extra class names for the popup menu.
 * @param {function():void} props.onClick  Primary action handler.
 * @param {boolean} [props.disabled=false] Disable the primary button.
 * @param {boolean} [props.menuDisabled=false] Disable the menu arrow button.
 * @param {string} props.ariaLabel         Accessible label for the primary button.
 * @param {string} [props.title]           Tooltip/title for the primary button.
 * @param {string} props.menuLabel         Accessible label for the menu arrow button.
 * @param {React.ReactNode} props.children Content rendered inside the primary button.
 * @param {(React.ReactNode|function({closeMenu:function():void}):React.ReactNode)} props.menuChildren
 *   Content rendered inside the popup menu. May be a render function that receives a closeMenu helper.
 * @returns {JSX.Element}
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const SplitToolbarButton = ({
  className = '',
  mainClassName = '',
  menuClassName = '',
  onClick,
  disabled = false,
  menuDisabled = false,
  ariaLabel,
  title,
  menuLabel,
  children,
  menuChildren,
}) => {
  const [open, setOpen] = useState(false);
  const shellRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (shellRef.current && shellRef.current.contains(event?.target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      setOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('touchstart', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('touchstart', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const closeMenu = () => setOpen(false);
  const shellClassName = ['toolbar-menu-shell', 'toolbar-split-button', className, open ? 'is-open' : '']
    .filter(Boolean)
    .join(' ');
  const primaryClassName = ['odv-btn', 'toolbar-split-main', mainClassName].filter(Boolean).join(' ');
  const popupClassName = ['toolbar-popup-menu', 'toolbar-split-menu', menuClassName].filter(Boolean).join(' ');

  return (
    <div ref={shellRef} className={shellClassName}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        title={title || ariaLabel}
        className={primaryClassName}
        disabled={disabled}
      >
        {children}
      </button>
      <button
        type="button"
        className="odv-btn toolbar-split-arrow"
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={menuDisabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-icons" aria-hidden="true">arrow_drop_down</span>
      </button>
      {open ? (
        <div id={menuId} className={popupClassName} role="menu">
          {typeof menuChildren === 'function' ? menuChildren({ closeMenu }) : menuChildren}
        </div>
      ) : null}
    </div>
  );
};

SplitToolbarButton.propTypes = {
  className: PropTypes.string,
  mainClassName: PropTypes.string,
  menuClassName: PropTypes.string,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  menuDisabled: PropTypes.bool,
  ariaLabel: PropTypes.string.isRequired,
  title: PropTypes.string,
  menuLabel: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  menuChildren: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
};

/**
 * Exported SplitToolbarButton component.
 * @returns {JSX.Element}
 */
export default React.memo(SplitToolbarButton);
