// File: tests/ui/manual-page-subpath-server.mjs
/**
 * Minimal static file server for the WP4 production proof: it exposes the production build
 * (`dist/`) under the `/OpenDocViewer/` subpath, exactly like an IIS application under a virtual
 * directory. Only Node built-ins are used (no extra dependency).
 *
 * - `<prefix>/` and any `<prefix>/<directory>/` answer with that folder's `index.html`, so both
 *   the viewer (`/OpenDocViewer/`) and the stand-alone manual page (`/OpenDocViewer/manual/`)
 *   boot from the built entries.
 * - A directory requested without its trailing slash is redirected to the slash form, the way
 *   the IIS directory courtesy redirect does it in production (the AddTrailingSlash rule skips
 *   real directories: its IsFile/IsDirectory conditions are negated).
 * - Both GET and HEAD are served (the boot loader probes `odv.site.config.js` and
 *   `odv.config.js` with HEAD before loading them), with production-plausible content types.
 * - Anything outside the prefix, a missing file, or a path escaping `dist/` answers 404.
 * - `/OpenDocViewer/manual` (no trailing slash) behaviour beyond the generic directory redirect
 *   is intentionally not special-cased: IIS owns that redirect in production (WP3 proved web.config).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// path.resolve normalises away fileURLToPath's trailing separator, so the containment check
// below treats the dist root itself as inside (otherwise `/OpenDocViewer/` would 404).
const ROOT = path.resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
const PREFIX = '/OpenDocViewer';
const PORT = Number(process.env.ODV_MANUAL_PAGE_PORT || 5181);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new RangeError('ODV_MANUAL_PAGE_PORT must be an integer between 1024 and 65535');
}

const CONTENT_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}));

/** @param {string} filePath */
function contentTypeOf(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

/** @param {http.ServerResponse} res @param {number} status @param {string} message */
function sendText(res, status, message) {
  const body = Buffer.from(`${message}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }

  if (pathname === PREFIX) {
    res.writeHead(301, { location: `${PREFIX}/`, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (!pathname.startsWith(`${PREFIX}/`)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const relative = decodeURIComponent(pathname.slice(PREFIX.length));
  const resolved = path.resolve(ROOT, `.${relative}`);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    sendText(res, 404, 'Not found');
    return;
  }

  fs.stat(resolved, (error, stats) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }
    if (stats.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: `${pathname}/`, 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const indexFile = path.join(resolved, 'index.html');
      fs.stat(indexFile, (indexError, indexStats) => {
        if (indexError || !indexStats.isFile()) {
          sendText(res, 404, 'Not found');
          return;
        }
        serveFile(indexFile, req, res);
      });
      return;
    }
    if (!stats.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }
    serveFile(resolved, req, res);
  });
});

/** @param {string} filePath @param {http.IncomingMessage} req @param {http.ServerResponse} res */
function serveFile(filePath, req, res) {
  fs.readFile(filePath, (error, body) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': contentTypeOf(filePath),
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  });
}

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`manual-page subpath server: http://127.0.0.1:${PORT}${PREFIX}/\n`);
});
