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
import { chars, post, splitLines, utf8Header } from './logServerHarness.js';

const state = vi.hoisted(() => ({ servers: [], written: [] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const createWriteStream = (file) => ({
    destroyed: false,
    write: (line, callback) => {
      state.written.push({ file: String(file), line: String(line) });
      if (typeof callback === 'function') setImmediate(callback);
      return true;
    },
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
  // The print log has no limit unless one is set; set one so that its limiter is mounted.
  vi.stubEnv('USER_LOG_RATE_LIMIT_PER_MINUTE', '60');
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

describe.each(['user', 'system'])('%s log server access log', (name) => {
  const accessLines = (marker) => state.written
    .filter((entry) => /access-\d{4}-\d{2}-\d{2}\.log$/.test(entry.file) && entry.line.includes(marker))
    .map((entry) => entry.line);

  it('writes the client address without the port, in the combined line shape', async () => {
    const target = targets[name];
    const marker = `agent-${name}-plain`;
    await post(target.port, target.path, target.body, {
      ...target.headers, 'x-forwarded-for': '203.0.113.40:40001', 'user-agent': marker, referer: 'https://viewer.example/page',
    });
    const lines = accessLines(marker);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(
      `^203\\.0\\.113\\.40 - - \\[[^\\]]+\\] "POST ${target.path} HTTP/1\\.1" \\d{3} (\\d+|-) "https://viewer\\.example/page" "${marker}"\\n$`,
    ));
  });

  it.each([
    ['U+2028 sent as UTF-8', utf8Header(`forged${chars(0x2028)}line`), '2028'],
    ['U+2029 sent as UTF-8', utf8Header(`forged${chars(0x2029)}line`), '2029'],
    ['U+0085 sent as UTF-8', utf8Header(`forged${chars(0x85)}line`), '0085'],
    ['the single byte 0x85', `forged${chars(0x85)}line`, '0085'],
  ])('keeps a line break in user agent and referer on one access line (%s)', async (_name, value, code) => {
    const target = targets[name];
    const marker = `agent-${name}-${_name.replace(/[^a-z0-9]/gi, '')}`;
    await post(target.port, target.path, target.body, {
      ...target.headers, 'x-forwarded-for': '203.0.113.41:40001', 'user-agent': `${marker} ${value}`, referer: `https://viewer.example/${value}`,
    });
    const lines = accessLines(marker);
    expect(lines).toHaveLength(1);
    expect(splitLines(lines[0])).toHaveLength(1);
    expect(lines[0].startsWith('203.0.113.41 - ')).toBe(true);
    // The access logger writes the character as an escape sequence, never as a line break.
    const escaped = `forged${chars(0x5c)}u${code}line`;
    expect(lines[0]).toContain(`"${marker} ${escaped}"`);
    expect(lines[0]).toContain(`"https://viewer.example/${escaped}"`);
  });

  it('logs a user agent sent as UTF-8 with its letters', async () => {
    const target = targets[name];
    const letters = chars(0xc5, 0xc4, 0xd6, 0xe5, 0xe4, 0xf6);
    const marker = `agent-${name}-letters`;
    await post(target.port, target.path, target.body, {
      ...target.headers, 'x-forwarded-for': '203.0.113.42:40001', 'user-agent': utf8Header(`${marker} ${letters}`),
    });
    expect(accessLines(marker)[0]).toContain(`"${marker} ${letters}"`);
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
