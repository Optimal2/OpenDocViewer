// File: src/components/Resizer.jsx
/**
 * File: src/components/Resizer.jsx
 *
 * OpenDocViewer — Resizer
 *
 * PURPOSE
 *   Small, focusable separator used to let users resize adjacent panels (e.g., sidebar/content)
 *   via mouse drag or keyboard interaction. This component is deliberately “dumb”: it simply
 *   exposes interaction hooks and ARIA semantics; the actual resizing logic lives in the parent.
 *
 * ACCESSIBILITY
 *   - role="separator" with aria-orientation="vertical" (default) or "horizontal".
 *   - Keyboard: Enter/Space triggers the same handler as a mouse down, allowing the parent to
 *     start a keyboard-based resize routine if desired.
 *   - Focus styles are toggled with a helper class ('resizer-focused') for clear visibility.
 *
 * API
 *   Props:
 *     - onMouseDown (required): ResizeStartHandler
 *     - orientation (optional): 'vertical' | 'horizontal' (default: 'vertical')
 *     - ariaLabel  (optional): string — accessible name for assistive tech
 *     - className  (optional): string — additional class names
 *
 * NOTES / FUTURE:
 *   - Consider upgrading to Pointer Events (onPointerDown) if you implement touch/pen resize
 *     in the parent logic. Avoid attaching both pointer and mouse handlers simultaneously,
 *     as many browsers will fire both, causing duplicate starts.
 *
 * PROJECT GOTCHA (reminder for future reviewers)
 *   - In other modules we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *     See README “Design notes & gotchas” before changing this.
 */

/**
 * Handler invoked when a resize interaction is initiated.
 * @callback ResizeStartHandler
 * @param {*} e
 * @returns {void}
 */

/**
 * Props for <Resizer/>.
 * @typedef {Object} ResizerProps
 * @property {ResizeStartHandler} onMouseDown
 * @property {('vertical'|'horizontal'|undefined)} orientation
 * @property {(string|undefined)} ariaLabel
 * @property {(string|undefined)} className
 */

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * Resizer component.
 * @param {ResizerProps} props
 * @returns {React.ReactElement}
 */
const Resizer = React.memo(({ onMouseDown, orientation = 'vertical', ariaLabel, className = '' }) => {
  const { t } = useTranslation('common');

  /**
   * Keyboard handler (Enter/Space) to initiate the same flow as mouse down.
   * Parent components may listen for this to start a keyboard resize routine.
   * @param {*} e
   * @returns {void}
   */
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (typeof onMouseDown === 'function') onMouseDown(e);
      }
    },
    [onMouseDown]
  );

  const label = ariaLabel || t('viewer.resizer.ariaLabel');

  return (
    <div
      className={`resizer${className ? ` ${className}` : ''}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={(e) => e.currentTarget.classList.add('resizer-focused')}
      onBlur={(e) => e.currentTarget.classList.remove('resizer-focused')}
    />
  );
});

Resizer.propTypes = {
  /** Initiates resize in the parent (mouse or keyboard-initiated). */
  onMouseDown: PropTypes.func.isRequired,
  /** Visual/semantic orientation of the separator. */
  orientation: PropTypes.oneOf(['vertical', 'horizontal']),
  /** Accessible name for assistive technologies. */
  ariaLabel: PropTypes.string,
  /** Extra class names to append to the root element. */
  className: PropTypes.string,
};

Resizer.displayName = 'Resizer';

export default Resizer;
