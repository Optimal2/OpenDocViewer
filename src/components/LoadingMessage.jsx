/**
 * File: src/components/LoadingMessage.jsx
 *
 * OpenDocViewer — Loading / Error Message
 *
 * PURPOSE
 *   Simple, accessible message block that reflects the current page load status.
 *   Shows a placeholder while pages are loading and a distinct message/illustration
 *   when the loader signals a failure (pageStatus === -1).
 *
 * ACCESSIBILITY
 *   - Uses role="status" with aria-live="polite" so assistive tech announces updates.
 *   - Provides meaningful alt text for the illustrative image.
 *
 * CUSTOMIZATION
 *   - You can override default texts and images via props (see PropTypes below).
 *   - Styling is controlled via CSS classes: `.loading-message` and `.loading-image`.
 *
 * IMPORTANT PROJECT NOTE (gotcha for future reviewers)
 *   - Elsewhere in the app we import from the **root** 'file-type' package — NOT
 *     'file-type/browser'. With file-type v21 the '/browser' subpath is not exported
 *     for bundlers and will break Vite builds. See README for details.
 *
 * Source baseline for this component: :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import PropTypes from 'prop-types';

/** Default copy and assets (overridable via props). */
const DEFAULTS = Object.freeze({
  loadingText: 'Please wait, pages are still loading.',
  errorText: 'Error: The document is corrupted, missing, or in an unsupported format.',
  loadingImg: 'placeholder.png',
  errorImg: 'lost.png',
});

/**
 * LoadingMessage component.
 *
 * @param {Object} props
 * @param {number} props.pageStatus               Status of the page loading. (-1 => error; otherwise "loading")
 * @param {string} [props.loadingText]            Override: text shown while loading.
 * @param {string} [props.errorText]              Override: text shown on error.
 * @param {string} [props.loadingImageSrc]        Override: image shown while loading.
 * @param {string} [props.errorImageSrc]          Override: image shown on error.
 * @param {string} [props.className]              Optional extra class names for the root container.
 * @param {string} [props['data-testid']]         Optional test id.
 * @returns {JSX.Element}
 */
const LoadingMessage = ({
  pageStatus,
  loadingText = DEFAULTS.loadingText,
  errorText = DEFAULTS.errorText,
  loadingImageSrc = DEFAULTS.loadingImg,
  errorImageSrc = DEFAULTS.errorImg,
  className = '',
  'data-testid': testId,
}) => {
  const isError = pageStatus === -1;

  const displayMessage = isError ? errorText : loadingText;
  const imageUrl = isError ? errorImageSrc : loadingImageSrc;
  const alt = isError ? 'Document load error' : 'Loading document';

  return (
    <div
      className={`loading-message${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      {/* Illustration is optional; if the asset is missing, the alt still conveys state. */}
      <img src={imageUrl} alt={alt} className="loading-image" />
      <h2>{displayMessage}</h2>
    </div>
  );
};

LoadingMessage.propTypes = {
  pageStatus: PropTypes.number.isRequired,
  loadingText: PropTypes.string,
  errorText: PropTypes.string,
  loadingImageSrc: PropTypes.string,
  errorImageSrc: PropTypes.string,
  className: PropTypes.string,
  'data-testid': PropTypes.string,
};

export default React.memo(LoadingMessage);
