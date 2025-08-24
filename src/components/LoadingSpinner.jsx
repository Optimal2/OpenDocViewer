/**
 * File: src/components/LoadingSpinner.jsx
 *
 * OpenDocViewer — Loading Spinner
 *
 * PURPOSE
 *   Minimal, accessible loading indicator. Keeps behavior simple and styling
 *   entirely in CSS (class: `.spinner`) so the component is easy to swap or theme.
 *
 * ACCESSIBILITY
 *   - Uses role="status" and aria-live="polite" to announce progress to AT.
 *   - Includes visually-hidden text for screen readers (configurable via `label`).
 *
 * API
 *   <LoadingSpinner size={24} label="Loading" className="my-extra-class" />
 *
 *   - size?: number | string   → Optional width/height (e.g., 24 or "2rem"). If omitted,
 *                                dimensions are controlled purely by CSS.
 *   - label?: string           → Accessible label for screen readers (default: "Loading").
 *   - className?: string       → Extra classes to append to the root element.
 *
 * PROJECT GOTCHA (for future reviewers):
 *   - Elsewhere in the app we import from the **root** 'file-type' package, NOT 'file-type/browser'.
 *     With file-type v21 the '/browser' subpath is not exported and will break Vite builds.
 *
 * Provenance / previous baseline reference for this component: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';

/** Inline “visually hidden” style for screen-reader-only text (no CSS dependency). */
const srOnlyStyle = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * LoadingSpinner component.
 * Displays a CSS-driven spinner with accessible labeling.
 *
 * @param {{ size?: number|string, label?: string, className?: string }} props
 * @returns {JSX.Element}
 */
const LoadingSpinner = ({ size, label = 'Loading', className = '' }) => {
  const style =
    size == null
      ? undefined
      : {
          width: typeof size === 'number' ? `${size}px` : String(size),
          height: typeof size === 'number' ? `${size}px` : String(size),
        };

  return (
    <div
      className={`spinner${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      style={style}
    >
      <span style={srOnlyStyle}>{label}…</span>
    </div>
  );
};

LoadingSpinner.propTypes = {
  /** Optional width/height; if omitted, CSS controls dimensions. */
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** Accessible label announced by assistive technologies. */
  label: PropTypes.string,
  /** Extra classes to append to the root element. */
  className: PropTypes.string,
};

export default React.memo(LoadingSpinner);
