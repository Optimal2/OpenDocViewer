// File: server.js (ESM)

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import morgan from 'morgan';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { logRequest, logError } from './logger.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');

// Ensure log directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Access log (append mode)
const accessLogStream = fs.createWriteStream(path.join(LOG_DIR, 'access.log'), { flags: 'a' });
app.use(morgan('combined', { stream: accessLogStream }));

// Health check
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Routes
app.post('/log', logRequest);

// Error handling
app.use((err, _req, res, _next) => {
  logError(err);
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(port, () => {
  console.log(`OpenDocViewer Log Server running at http://localhost:${port}`);
});
