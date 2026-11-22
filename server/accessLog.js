// File: server/accessLog.js
/** HTTP access log of the log servers: the "combined" line, with a clean address and one line. */

import morgan from 'morgan';
import { normalizeClientAddress } from './clientAddress.js';
import { decodeHeaderValue } from './headerText.js';

// Same fields and order as morgan's "combined" format, so a reader of access-*.log sees the
// same line shape. Three tokens are our own: the client address without the source port that
// IIS ARR adds, and the referrer and user agent decoded like the other log fields.
const ACCESS_FORMAT = ':odv-client-address - :remote-user [:date[clf]] ":method :url HTTP/:http-version" '
  + ':status :res[content-length] ":odv-referrer" ":odv-user-agent"';

morgan.token('odv-client-address', (req) => normalizeClientAddress(req.ip || req.socket?.remoteAddress) || undefined);
morgan.token('odv-referrer', (req) => decodeHeaderValue(req.headers?.referer || req.headers?.referrer) || undefined);
morgan.token('odv-user-agent', (req) => decodeHeaderValue(req.headers?.['user-agent']) || undefined);

/**
 * @param {{ write: function(string): void, sanitize: function(string): string }} options
 *   write receives one finished line. morgan already writes control characters and the
 *   Unicode line separators in a field as escape sequences; sanitize, the server's own log
 *   sanitising, is applied to the whole line as a second guard, so that the line stays one
 *   line even with a logger version that does not escape.
 * @returns {function} Express middleware.
 */
export function createAccessLogger({ write, sanitize }) {
  return morgan(ACCESS_FORMAT, {
    stream: {
      write: (line) => write(`${sanitize(String(line).replace(/\r?\n$/, ''))}\n`),
    },
  });
}
