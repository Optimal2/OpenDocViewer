// @vitest-environment node
// File: server/__tests__/clientAddress.test.js
/**
 * A reverse proxy that adds the client's source port to X-Forwarded-For (IIS ARR does by
 * default) must not turn the rate limit into a limit per connection, or put a port in the log.
 * Both real log servers run in-process on a loopback port, with the rate limit lowered to two
 * requests so that the third one from the same client shows whether it is counted.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeClientAddress } from '../clientAddress.js';
import { post } from './logServerHarness.js';

const state = vi.hoisted(() => ({ servers: [], written: [] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const createWriteStream = (file) => ({
    write: (line) => { state.written.push({ file: String(file), line: String(line) }); return true; },
    end: () => {},
    on: () => {},
  });
  const mkdirSync = () => undefined;
  const promises = { ...actual.promises, mkdir: async () => undefined };
  return { ...actual, createWriteStream, mkdirSync, promises, default: { ...actual.default, createWriteStream, mkdirSync, promises } };
});

vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));

vi.mock('../logRetention.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pruneRotatedLogs: async () => {}, scheduleLogRetention: () => null };
});

// The real limiter with the servers' own key generator; only the limit is lowered.
vi.mock('express-rate-limit', async (importOriginal) => {
  const actual = await importOriginal();
  const lowered = (options) => actual.default({ ...options, max: 2, limit: 2 });
  return { ...actual, default: lowered, rateLimit: lowered };
});

vi.mock('express', async (importOriginal) => {
  const actual = await importOriginal();
  const createApp = (...args) => {
    const app = actual.default(...args);
    const listen = app.listen.bind(app);
    // Loopback only, so running the suite can never raise a firewall prompt.
    app.listen = (port, ...rest) => {
      const server = listen(port, '127.0.0.1', ...rest.filter((argument) => typeof argument === 'function'));
      state.servers.push(server);
      return server;
    };
    return app;
  };
  return { ...actual, default: Object.assign(createApp, actual.default) };
});

const TOKEN = 'test-token';
const targets = {};

async function start(modulePath) {
  const before = state.servers.length;
  await import(modulePath);
  const server = state.servers[before];
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  return server.address().port;
}

beforeAll(async () => {
  for (const name of ['LOG_RETENTION_DAYS', 'PRINT_LOG_RETENTION_DAYS', 'ODV_STRICT_ORIGIN', 'ALLOWED_ORIGINS', 'JSON_LIMIT', 'TRUST_PROXY']) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOG_TOKEN', TOKEN);
  vi.stubEnv('PORT', '0');
  targets.user = {
    port: await start('../user-log-server.js'),
    path: '/userlog/record',
    body: { reason: 'r', forWhom: 'w' },
    headers: {},
    ok: 200,
    lines: /print-\d{4}-\d{2}-\d{2}\.log$/,
  };
  targets.system = {
    port: await start('../system-log-server.js'),
    path: '/log',
    body: { message: 'm' },
    headers: { 'x-log-token': TOKEN },
    ok: 204,
    lines: /ingestion-\d{4}-\d{2}-\d{2}\.log$/,
  };
});

afterAll(async () => {
  await Promise.all(state.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  vi.unstubAllEnvs();
});

describe('normalizeClientAddress', () => {
  it.each([
    ['1.2.3.4:5678', '1.2.3.4'],
    ['127.0.0.1:64123', '127.0.0.1'],
    ['[2001:db8::1]:5678', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['[::1]:80', '::1'],
    ['[fe80::1%eth0]:443', 'fe80::1%eth0'],
    // IPv4-mapped IPv6 with a port and no brackets: the dotted tail makes the port unambiguous.
    ['::ffff:1.2.3.4:5678', '::ffff:1.2.3.4'],
    ['::FFFF:127.0.0.1:64123', '::FFFF:127.0.0.1'],
    ['[::ffff:1.2.3.4]:5678', '::ffff:1.2.3.4'],
    ['::ffff:1.2.3.4', '::ffff:1.2.3.4'],
    ['::ffff:999.2.3.4:5678', '::ffff:999.2.3.4:5678'],
    // A zone index must be a name; anything else after % is not accepted.
    ['[::1%]:80', '[::1%]:80'],
    ['[::1%eth0%x]:80', '[::1%eth0%x]:80'],
    ['[::1% ]:80', '[::1% ]:80'],
    ['[::1%eth0/../x]:80', '[::1%eth0/../x]:80'],
    // Unchanged: plain addresses, and IPv6 without brackets (its last group is not a port).
    ['1.2.3.4', '1.2.3.4'],
    ['2001:db8::1', '2001:db8::1'],
    ['::1', '::1'],
    ['::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['2001:db8::1:5678', '2001:db8::1:5678'],
    // Unchanged: not an address.
    ['999.1.1.1:80', '999.1.1.1:80'],
    ['example.test:8080', 'example.test:8080'],
    ['[not-an-address]:80', '[not-an-address]:80'],
    ['1.2.3.4:', '1.2.3.4:'],
    ['unknown', 'unknown'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeClientAddress(input)).toBe(expected);
  });

  it('returns anything that is not a string as it is', () => {
    for (const value of [undefined, null, 5, {}]) expect(normalizeClientAddress(value)).toBe(value);
  });
});

describe.each(['user', 'system'])('%s log server behind a proxy that forwards address:port', (name) => {
  const send = (forwardedFor) => {
    const target = targets[name];
    return post(target.port, target.path, target.body, { ...target.headers, 'x-forwarded-for': forwardedFor });
  };
  const recordsFor = (address) => state.written
    .filter((entry) => targets[name].lines.test(entry.file))
    .map((entry) => JSON.parse(entry.line))
    .filter((record) => String(record.ip).startsWith(address));

  it('counts requests from one address with different source ports against the same limit', async () => {
    const ok = targets[name].ok;
    expect((await send('203.0.113.5:40001')).status).toBe(ok);
    expect((await send('203.0.113.5:40002')).status).toBe(ok);
    // The limit is two: the third request of the same client is refused whatever its port.
    expect((await send('203.0.113.5:40003')).status).toBe(429);
    // Another client still has its own allowance.
    expect((await send('203.0.113.9:40001')).status).toBe(ok);
  });

  it('writes the address without the port to the log record', async () => {
    const records = recordsFor('203.0.113.5');
    expect(records.length).toBeGreaterThanOrEqual(2);
    for (const record of records) expect(record.ip).toBe('203.0.113.5');

    expect((await send('[2001:db8::7]:40001')).status).toBe(targets[name].ok);
    expect(recordsFor('2001:db8::7').map((record) => record.ip)).toEqual(['2001:db8::7']);
  });

  it('takes the entry the nearest proxy added, never one the client sent before it', async () => {
    // With trust proxy = 1 the address is the last entry of X-Forwarded-For.
    expect((await send('198.51.100.77, 203.0.113.21:40001')).status).toBe(targets[name].ok);
    expect(recordsFor('203.0.113.21').map((record) => record.ip)).toEqual(['203.0.113.21']);
    expect(recordsFor('198.51.100.77')).toEqual([]);
    // A rule that sets the address and a proxy that then appends address:port give one client.
    expect((await send('203.0.113.22, 203.0.113.22:40001')).status).toBe(targets[name].ok);
    expect(recordsFor('203.0.113.22').map((record) => record.ip)).toEqual(['203.0.113.22']);
  });
});
