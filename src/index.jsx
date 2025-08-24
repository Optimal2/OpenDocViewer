/**
 * File: src/index.jsx
 *
 * OpenDocViewer — Application Entry
 *
 * RESPONSIBILITIES
 *   - Load global styles (CSS variables + layout).
 *   - Initialize the client logger level based on environment.
 *   - Mount the React application (<AppBootstrap/>) into #root.
 *
 * RUNTIME & BUILD NOTES
 *   - This file relies on Vite injecting `import.meta.env.MODE` and (via vite.config.js)
 *     a compatible `process.env.NODE_ENV`. Either can be used to detect development mode.
 *   - The optional Performance HUD is controlled elsewhere via runtime config (odv.config.js).
 *   - Project-wide gotcha: we import from 'file-type' (root) *not* 'file-type/browser';
 *     v21 does not export that subpath for bundlers and builds will fail if changed.
 *
 * Source reference for this entrypoint (traceability): :contentReference[oaicite:0]{index=0}
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import logger from './LogController';
import AppBootstrap from './components/AppBootstrap';

/**
 * Determine environment and set a sensible client-side log level.
 * - dev:   'debug' (more verbose for local iteration)
 * - prod:  'warn'  (keep console noise down for end users)
 */
const isDev =
  (typeof import.meta !== 'undefined' && import.meta?.env?.MODE === 'development') ||
  (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development');

logger.setLogLevel(isDev ? 'debug' : 'warn');
logger.info('OpenDocViewer entry loaded', { mode: isDev ? 'development' : 'production' });

/**
 * Mount the app into #root. Fail fast (but safely) if the target is missing.
 */
const container = document.getElementById('root');

if (!container) {
  // Avoid throwing; log clearly so diagnostics are actionable.
  logger.error('Failed to bootstrap: #root element not found in document.');
} else {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <AppBootstrap />
    </React.StrictMode>
  );
}
