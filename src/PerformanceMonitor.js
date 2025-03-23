// File: src/PerformanceMonitor.js

import React, { useState, useEffect, useCallback, useContext } from 'react';
import { ViewerContext } from './ViewerContext';

/**
 * PerformanceMonitor component displays various performance metrics and viewer context information.
 * @returns {JSX.Element} The PerformanceMonitor component.
 */
const PerformanceMonitor = () => {
  const { allPages, error, workerCount, messageQueue } = useContext(ViewerContext);

  const [memoryUsage, setMemoryUsage] = useState({
    totalJSHeapSize: 0,
    usedJSHeapSize: 0,
    jsHeapSizeLimit: 0,
  });
  const [hardwareConcurrency, setHardwareConcurrency] = useState(1);

  /**
   * Updates memory usage statistics from the window.performance.memory API.
   */
  const updateStats = useCallback(() => {
    if (window.performance && window.performance.memory) {
      const { totalJSHeapSize, usedJSHeapSize, jsHeapSizeLimit } = window.performance.memory;
      setMemoryUsage({
        totalJSHeapSize: totalJSHeapSize / (1024 * 1024),
        usedJSHeapSize: usedJSHeapSize / (1024 * 1024),
        jsHeapSizeLimit: jsHeapSizeLimit / (1024 * 1024),
      });
    }
  }, []);

  useEffect(() => {
    const intervalId = setInterval(updateStats, 1000); // Update stats every second
    setHardwareConcurrency(navigator.hardwareConcurrency || 1);

    return () => clearInterval(intervalId); // Cleanup interval on component unmount
  }, [updateStats]);

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      right: 0,
      padding: '10px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      color: '#fff',
      zIndex: 1000,
      maxWidth: '300px',
      overflowY: 'auto',
      maxHeight: '400px'
    }}>
      <h3>Performance Monitor</h3>
      {memoryUsage && (
        <div>
          <p>Total JS Heap Size: {memoryUsage.totalJSHeapSize.toFixed(2)} MB</p>
          <p>Used JS Heap Size: {memoryUsage.usedJSHeapSize.toFixed(2)} MB</p>
          <p>JS Heap Size Limit: {memoryUsage.jsHeapSizeLimit.toFixed(2)} MB</p>
          <p>Hardware Concurrency: {hardwareConcurrency}</p>
        </div>
      )}
      <div>
        <h4>Viewer Context</h4>
        <p>Error: {error ? error.toString() : 'None'}</p>
        <p>Total Pages Loaded: {allPages.length}</p>
        <p>Worker Count: {workerCount}</p>
        {messageQueue.length > 0 && (
          <div>
            <h4>Messages</h4>
            <ul>
              {messageQueue.map((msg, index) => (
                <li key={index}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceMonitor;
