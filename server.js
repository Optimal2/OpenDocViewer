// File: server.js

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { logRequest, logError } = require('./logger');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.LOG_SERVER_PORT || 3001;

// Middleware
app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(
  morgan('combined', {
    stream: fs.createWriteStream(path.join(__dirname, 'access.log'), {
      flags: 'a',
    }),
  })
);

// Routes
app.post('/log', logRequest);

// Error handling
app.use((err, req, res, next) => {
  logError(err);
  res.status(500).send('Internal Server Error');
  next(err);
});

// Start server
app.listen(port, () => {
  console.log(`OpenDocViewer Log Server running at http://localhost:${port}`);
});
