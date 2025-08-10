// File: logger.js (ESM)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

/**
 * Logs incoming requests to a log file.
 * Body shape: { level: "info"|"warn"|"error", message: string, context?: object }
 */
export async function logRequest(req, res) {
  try {
    await ensureLogDir();
    const { level = 'info', message = '', context = {} } = req.body || {};
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${String(level).toUpperCase()}] ${message} ${JSON.stringify(context)}\n`;
    await fs.appendFile(path.join(LOG_DIR, 'access.log'), line, 'utf8');
    res.status(204).end();
  } catch (err) {
    console.error('Failed to write access log', err);
    res.status(500).send('Failed to write log');
  }
}

/** Logs server-side errors to error.log */
export async function logError(err) {
  try {
    await ensureLogDir();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [ERROR] ${err && err.stack ? err.stack : String(err)}\n`;
    await fs.appendFile(path.join(LOG_DIR, 'error.log'), line, 'utf8');
  } catch (e) {
    console.error('Failed to write error log', e);
  }
}
