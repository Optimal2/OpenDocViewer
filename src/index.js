// File: src/index.js

import React, { useState, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import logger from './LogController';
import ErrorBoundary from './ErrorBoundary';
import OpenDocViewer from './OpenDocViewer';

// Set log level based on the environment
const logLevel = process.env.NODE_ENV === 'development' ? 'warn' : 'error';
logger.setLogLevel(logLevel);
logger.info('index.js file loaded');

const container = document.getElementById('root');
const root = createRoot(container);

/**
 * The main application component.
 * @returns {JSX.Element} The rendered component.
 */
const App = () => {
  const [startApp, setStartApp] = useState(false);
  const [settings, setSettings] = useState({
    folder: '',
    extension: '',
    endNumber: 300,
  });

  /**
   * Handles button click events.
   * @param {string} type - The type of document to load.
   */
  const handleButtonClick = useCallback((type) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      folder: type,
      extension: type,
    }));
    setStartApp(true);
    logger.info('Button clicked', { type });
  }, []);

  /**
   * Handles changes to the end number input field.
   * @param {React.ChangeEvent<HTMLInputElement>} e - The change event.
   */
  const handleEndNumberChange = useCallback((e) => {
    const value = Number(e.target.value);
    setSettings((prevSettings) => ({
      ...prevSettings,
      endNumber: value,
    }));
    logger.info('End number changed', { value });
  }, []);

  const renderViewer = useMemo(() => {
    if (startApp) {
      const { folder, extension, endNumber } = settings;
      logger.info('Starting OpenDocViewer', { folder, extension, endNumber });
      return (
        <ErrorBoundary>
          <OpenDocViewer folder={folder} extension={extension} endNumber={endNumber} />
        </ErrorBoundary>
      );
    }

    return (
      <div className="button-container">
        <input
          type="number"
          id="endNumber"
          value={settings.endNumber}
          onChange={handleEndNumberChange}
          placeholder="Enter end number"
          min="1"
          max="300"
        />
        {['jpg', 'png', 'tif', 'pdf'].map((type) => (
          <button key={type} onClick={() => handleButtonClick(type)}>
            {type.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }, [startApp, settings, handleButtonClick, handleEndNumberChange]);

  return renderViewer;
};

// Render the application
root.render(<App />);
