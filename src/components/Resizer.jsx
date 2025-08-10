// File: src/components/Resizer.js

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';

/**
 * Resizer component.
 * Allows users to resize elements by clicking and dragging or using the keyboard.
 *
 * @param {function} onMouseDown - Function to handle mouse down event.
 * @returns {JSX.Element} The resizer component.
 */
const Resizer = React.memo(({ onMouseDown }) => {
  /**
   * Handles key down events for accessibility.
   * Allows resizing using the Enter or Space keys.
   *
   * @param {object} e - The keyboard event.
   */
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onMouseDown(e);
    }
  }, [onMouseDown]);

  return (
    <div 
      className="resizer" 
      onMouseDown={onMouseDown} 
      role="separator" 
      aria-orientation="vertical" 
      tabIndex={0} 
      onKeyDown={handleKeyDown}
      onFocus={(e) => e.target.classList.add('resizer-focused')}
      onBlur={(e) => e.target.classList.remove('resizer-focused')}
    />
  );
});

Resizer.propTypes = {
  onMouseDown: PropTypes.func.isRequired,
};

Resizer.displayName = 'Resizer';

export default Resizer;
