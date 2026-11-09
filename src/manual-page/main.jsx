// File: src/manual-page/main.jsx
/**
 * Entry of the stand-alone manual page (manual/index.html). src/app/bootConfig.js imports it after
 * it has loaded odv.site.config.js and odv.config.js from the ODV base, so i18n starts with the
 * viewer's configuration (locale path, supported languages, stored language choice).
 */

import 'material-icons/iconfont/filled.css';
import '../styles.css';
import './manualPage.css';
import '../i18n'; // initialize i18n before rendering
import logger from '../logging/systemLogger.js';
import { mountManualPage } from './mountManualPage.jsx';

const isDev =
  (typeof import.meta !== 'undefined' && import.meta?.env?.MODE === 'development') ||
  (typeof globalThis !== 'undefined' && globalThis.process?.env?.NODE_ENV === 'development');

logger.setLogLevel(isDev ? 'debug' : 'warn');

const container = document.getElementById('root');
if (!container) {
  logger.error('Failed to start the manual page: #root element not found in document.');
} else {
  mountManualPage(container);
}
