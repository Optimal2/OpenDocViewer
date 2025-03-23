// File: logger.js

const fs = require('fs').promises;
const path = require('path');

/**
 * Logs incoming requests to a log file.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
const logRequest = async (req, res) => {
  try {
    const { level, message, context } = req.body;
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(context)}`;

    await fs.appendFile(path.join(__dirname, 'logs', 'app.log'), logMessage + '\n');
    res.status(200).send('Log written successfully');
  } catch (err) {
    console.error('Failed to write log to file', err);
    res.status(500).send('Failed to write log');
  }
};

/**
 * Logs errors to a separate error log file.
 *
 * @param {Error} err - The error object to log.
 */
const logError = async (err) => {
  try {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] [ERROR] ${err.stack}`;

    await fs.appendFile(path.join(__dirname, 'logs', 'error.log'), errorMessage + '\n');
  } catch (error) {
    console.error('Failed to write error log to file', error);
  }
};

module.exports = {
  logRequest,
  logError,
};
