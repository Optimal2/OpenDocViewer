// File: src/components/LoadingMessage.jsx
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
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * LoadingMessage component.
 *
 * @param {Object} props
 * @param {number} props.pageStatus                Status of the page loading. (-1 => error; otherwise "loading")
 * @param {string} [props.loadingText]             Override: text shown while loading.
 * @param {string} [props.errorText]               Override: text shown on error.
 * @param {string} [props.loadingImageSrc]         Override: image shown while loading.
 * @param {string} [props.errorImageSrc]           Override: image shown on error.
 * @param {string} [props.className]               Optional extra class names for the root container.
 * @returns {React.ReactElement}
 */
const LoadingMessage = ({
  pageStatus,
  loadingText,
  errorText,
  loadingImageSrc = 'placeholder.png',
  errorImageSrc = 'lost.png',
  className = '',
  // Note: React supports 'data-testid' as a prop, but we omit it from JSDoc to avoid Closure parser issues with dashed names.
  'data-testid': testId,
}) => {
  const { t } = useTranslation('common');
  const isError = pageStatus === -1;

  const displayMessage = isError
    ? (errorText || t('viewer.loadingMessage.errorText'))
    : (loadingText || t('viewer.loadingMessage.loadingText'));

  const imageUrl = isError ? errorImageSrc : loadingImageSrc;
  const alt = isError ? t('viewer.loadingMessage.alt.error') : t('viewer.loadingMessage.alt.loading');

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
