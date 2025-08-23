// File: src/index.js

import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import logger from './LogController';
import AppBootstrap from './components/AppBootstrap';

const logLevel = process.env.NODE_ENV === 'development' ? 'warn' : 'error';
logger.setLogLevel(logLevel);
logger.info('index.js file loaded');

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<AppBootstrap />);
