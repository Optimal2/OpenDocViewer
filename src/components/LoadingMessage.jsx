// File: src/components/LoadingMessage.js

import React from 'react';
import PropTypes from 'prop-types';

/**
 * LoadingMessage component.
 * Displays a loading message or error message based on page status.
 *
 * @param {Object} props - Component props.
 * @param {string} props.message - Loading message.
 * @param {number} props.pageStatus - Status of the page loading.
 * @returns {JSX.Element} The loading message.
 */
const LoadingMessage = ({ pageStatus }) => {
  let displayMessage = 'Please wait, pages are still loading.';
  let imageUrl = 'placeholder.png';

  if (pageStatus === -1) {
    displayMessage = 'Error: The document is corrupted, missing, or in an unsupported format.';
    imageUrl = 'lost.png';
  }

  return (
    <div className="loading-message">
      <img src={imageUrl} alt="Loading or Error" className="loading-image" />
      <h2>{displayMessage}</h2>
    </div>
  );
};

LoadingMessage.propTypes = {
  pageStatus: PropTypes.number.isRequired,
};

export default LoadingMessage;

