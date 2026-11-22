// File: server/__tests__/logServerHarness.js
/**
 * Shared pieces for the tests that run a log server in-process: line splitting and a POST
 * helper that puts header values on the wire byte for byte. The vi.mock calls stay in each
 * test file.
 */

import net from 'node:net';

/** Header value whose bytes on the wire are the UTF-8 encoding of the text. */
export const utf8Header = (text) => Buffer.from(text, 'utf8').toString('latin1');

/** Text made of the given code points, so the test sources stay plain ASCII. */
export const chars = (...codes) => String.fromCharCode(...codes);

/** Every way a reader may split a file into lines. */
export const splitLines = (text) => text
  .split(new RegExp(`\\r\\n|[\\n\\r${chars(0x85)}${chars(0x2028)}${chars(0x2029)}]`))
  .filter(Boolean);

/**
 * POST a JSON body over a raw socket. Each header value is written as latin1, one byte per
 * character, so a test decides the exact bytes (Node's own HTTP client would re-encode them).
 * @returns {Promise<{status:number, text:string}>}
 */
export function post(port, path, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const all = {
    host: `127.0.0.1:${port}`,
    'content-type': 'application/json',
    'content-length': String(payload.length),
    connection: 'close',
    ...headers,
  };
  const head = Buffer.from(
    `POST ${path} HTTP/1.1\r\n${Object.entries(all).map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`,
    'latin1',
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.end(Buffer.concat([head, payload])));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1] ?? 0);
      const separator = response.indexOf('\r\n\r\n');
      resolve({ status, text: separator === -1 ? '' : response.slice(separator + 4) });
    });
  });
}
