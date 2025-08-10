// File: src/ErrorBoundary.js

import React from 'react';
import PropTypes from 'prop-types';
import logger from './LogController';

/**
 * ErrorBoundary component for catching and displaying errors in a React component tree.
 */
class ErrorBoundary extends React.Component {
  /**
   * Creates an instance of ErrorBoundary.
   * @param {object} props - The component props.
   */
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  /**
   * Updates the state to indicate an error has occurred.
   * @param {Error} error - The error that was thrown.
   * @returns {object} The updated state.
   */
  static getDerivedStateFromError(error) {
    logger.error('Error caught in getDerivedStateFromError', { error: error.toString() });
    return { hasError: true, error };
  }

  /**
   * Logs error information when an error is caught.
   * @param {Error} error - The error that was thrown.
   * @param {object} errorInfo - Additional information about the error.
   */
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logger.error('Error caught by componentDidCatch', {
      error: error.toString(),
      componentStack: errorInfo.componentStack,
    });
  }

  /**
   * Handles retry logic by reloading the page.
   */
  handleRetry = () => {
    logger.info('Retry button clicked, reloading the page');
    window.location.reload();
  };

  /**
   * Renders the error details.
   * @returns {JSX.Element} The error details element.
   */
  renderErrorDetails = () => {
    const { error, errorInfo } = this.state;
    return (
      <details style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
        <summary>Error Details</summary>
        {error && error.toString()}
        <br />
        {errorInfo && errorInfo.componentStack}
      </details>
    );
  };

  /**
   * Renders the component.
   * @returns {JSX.Element} The rendered component.
   */
  render() {
    const { hasError } = this.state;

    if (hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong.</h1>
          <p>We&apos;re sorry for the inconvenience. Please try the following options:</p>
          {this.renderErrorDetails()}
          <button onClick={this.handleRetry} className="retry-button">Retry</button>
        </div>
      );
    }

    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ErrorBoundary;
