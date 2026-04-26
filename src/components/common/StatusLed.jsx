// File: src/components/common/StatusLed.jsx
/**
 * Small reusable LED-style status indicator.
 */

import React from 'react';
import PropTypes from 'prop-types';

/**
 * @param {Object} props
 * @param {'off'|'pending'|'ready'|'active'|'warning'|'error'} props.state
 * @param {'xs'|'sm'|'md'} [props.size]
 * @param {string=} props.title
 * @param {string=} props.className
 * @returns {JSX.Element}
 */
export default function StatusLed({ state = 'off', size = 'sm', title = '', className = '' }) {
  const safeState = ['off', 'pending', 'ready', 'active', 'warning', 'error'].includes(state) ? state : 'off';
  const safeSize = ['xs', 'sm', 'md'].includes(size) ? size : 'sm';
  return (
    <span
      className={`odv-status-led odv-status-led--${safeState} odv-status-led--${safeSize}${className ? ` ${className}` : ''}`}
      aria-label={title || safeState}
      title={title || undefined}
      role="status"
    />
  );
}

StatusLed.propTypes = {
  state: PropTypes.oneOf(['off', 'pending', 'ready', 'active', 'warning', 'error']),
  size: PropTypes.oneOf(['xs', 'sm', 'md']),
  title: PropTypes.string,
  className: PropTypes.string,
};
