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
    // The request says "connection: close", so the server ends the connection after its answer.
    // The client must not end its side first: the answer may come after the record is written.
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.write(Buffer.concat([head, payload])));
    socket.on('end', () => socket.end());
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

/**
 * Stand-in for node:fs in the tests that run a log server in-process: log files are kept in
 * memory, so nothing is written to or removed from server/logs. Use it as the factory result of
 * `vi.mock('node:fs', ...)` with the test's hoisted state:
 *
 *   state.written   every line that was stored, as { file, line }
 *   state.opened    every file that was opened, in order
 *   state.failure   optional function(file) returning an Error to fail that write, or null
 *   state.delayMs   optional delay of each write
 *   state.hung      when true a write never finishes (a hung disk)
 *   state.onAppend  optional observer called with the file when its server's append starts
 *
 * A file whose write failed must be opened again, as with a real file.
 */
export function fakeLogFileSystem(actual, state) {
  state.written ??= [];
  state.opened ??= [];
  let nextFileNumber = 1n;
  /** @type {Map<string, bigint>} The file number of the file currently at each path. */
  const atPath = new Map();

  const open = async (file) => {
    const name = String(file);
    state.opened.push(name);
    if (!atPath.has(name)) { atPath.set(name, nextFileNumber); nextFileNumber += 1n; }
    const ino = atPath.get(name);
    return {
      stat: async () => ({ dev: 1n, ino, size: 0n }),
      read: async () => ({ bytesRead: 0 }),
      close: async () => {},
      appendFile: async (text) => {
        // A test can wait for the server's write call before advancing a fake clock or sending the
        // next overlapping request. This observes server arrival, not client socket send order.
        state.onAppend?.(name);
        if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        if (state.hung) await new Promise(() => { /* never */ });
        const error = typeof state.failure === 'function' ? state.failure(name) : null;
        if (error) throw error;
        state.written.push({ file: name, line: String(text) });
      },
    };
  };
  const stat = async (file) => {
    const ino = atPath.get(String(file));
    if (ino === undefined) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    return { dev: 1n, ino, size: 0n };
  };
  const mkdirSync = () => undefined;
  const promises = { ...actual.promises, mkdir: async () => undefined, open, stat };
  return { ...actual, mkdirSync, promises, default: { ...actual.default, mkdirSync, promises } };
}

/**
 * Send a complete POST over a raw socket and close the connection at once, without reading the
 * answer. This is what the viewer does with a print record.
 * @returns {Promise<void>} Resolves when the connection is closed.
 */
export function postAndHangUp(port, path, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const all = { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': String(payload.length), ...headers };
  const head = Buffer.from(
    `POST ${path} HTTP/1.1\r\n${Object.entries(all).map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`,
    'latin1',
  );
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      // Everything is sent, then the connection is closed straight away.
      socket.end(Buffer.concat([head, payload]), () => socket.destroy());
    });
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}
