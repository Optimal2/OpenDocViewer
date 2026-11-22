// @vitest-environment node
// File: server/__tests__/rateLimitSettings.test.js
/**
 * The per-client rate limits of both log servers can be set and switched off with environment
 * variables, and a record rejected by the limit leaves a line in the error log. Each case starts
 * the real server in-process on a loopback port with its own environment.
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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
const SERVERS = {
  user: {
    module: '../user-log-server.js',
    variable: 'USER_LOG_RATE_LIMIT_PER_MINUTE',
    defaultLimit: 60,
    path: '/userlog/record',
    body: { reason: 'r', forWhom: 'w' },
    headers: {},
    ok: 200,
  },
  system: {
    module: '../system-log-server.js',
    variable: 'SYSTEM_LOG_RATE_LIMIT_PER_MINUTE',
    defaultLimit: 120,
    path: '/log',
    body: { message: 'm' },
    headers: { 'x-log-token': TOKEN },
    ok: 204,
  },
};

/** Start a fresh instance of a server with the given value of its rate limit variable. */
async function start(name, value) {
  const server = SERVERS[name];
  vi.resetModules();
  for (const variable of ['LOG_RETENTION_DAYS', 'PRINT_LOG_RETENTION_DAYS', 'ODV_STRICT_ORIGIN', 'ALLOWED_ORIGINS', 'JSON_LIMIT',
    'TRUST_PROXY', 'USER_LOG_RATE_LIMIT_PER_MINUTE', 'SYSTEM_LOG_RATE_LIMIT_PER_MINUTE']) {
    vi.stubEnv(variable, undefined);
  }
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOG_TOKEN', TOKEN);
  vi.stubEnv('PORT', '0');
  if (value !== undefined) vi.stubEnv(server.variable, value);
  const before = state.servers.length;
  await import(server.module);
  const listener = state.servers[before];
  if (!listener.listening) await new Promise((resolve) => listener.once('listening', resolve));
  const port = listener.address().port;
  return {
    send: (address = '203.0.113.5:40001') => post(port, server.path, server.body, { ...server.headers, 'x-forwarded-for': address }),
    /** Statuses of `count` requests from one client address. */
    async statuses(count, address) {
      const result = [];
      for (let i = 0; i < count; i += 1) result.push((await this.send(address)).status);
      return result;
    },
  };
}

const errorRecords = () => state.written
  .filter((entry) => /error-\d{4}-\d{2}-\d{2}\.log$/.test(entry.file))
  .map((entry) => JSON.parse(entry.line));
const rejections = () => errorRecords().filter((record) => record.event === 'rate-limit-rejected');

afterEach(() => {
  state.written.length = 0;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all(state.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  vi.unstubAllEnvs();
});

describe.each(Object.keys(SERVERS))('%s log server rate limit', (name) => {
  const { ok, defaultLimit, variable } = SERVERS[name];

  it('uses the value of its environment variable', async () => {
    const server = await start(name, '3');
    expect(await server.statuses(5)).toEqual([ok, ok, ok, 429, 429]);
  });

  it.each(['0', 'off', 'OFF'])('has no limit when the variable is %s', async (value) => {
    const server = await start(name, value);
    const statuses = await server.statuses(defaultLimit + 5);
    expect(statuses.every((status) => status === ok)).toBe(true);
  });

  it('keeps the default limit when the variable is not set', async () => {
    const server = await start(name, undefined);
    const statuses = await server.statuses(defaultLimit + 1);
    expect(statuses.slice(0, defaultLimit).every((status) => status === ok)).toBe(true);
    expect(statuses[defaultLimit]).toBe(429);
  });

  it('keeps the default limit and warns at start when the variable is not valid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = await start(name, 'plenty');
    const messages = warn.mock.calls.map((call) => call.join(' '));
    expect(messages.filter((message) => message.includes(variable))).toHaveLength(1);
    expect(messages.join('\n')).toContain(`default of ${defaultLimit}`);
    const statuses = await server.statuses(defaultLimit + 1);
    expect(statuses[defaultLimit - 1]).toBe(ok);
    expect(statuses[defaultLimit]).toBe(429);
  });

  it('writes one error-log line per address and minute when a record is rejected', async () => {
    const server = await start(name, '1');
    expect(await server.statuses(4, '203.0.113.5:40001')).toEqual([ok, 429, 429, 429]);
    expect(await server.statuses(3, '203.0.113.9:40001')).toEqual([ok, 429, 429]);

    const lines = rejections();
    // The record that was accepted leaves no line; each rejected client leaves exactly one.
    expect(lines.map((record) => record.ip)).toEqual(['203.0.113.5', '203.0.113.9']);
    for (const record of lines) {
      expect(record.level).toBe('warn');
      expect(record.limitPerMinute).toBe(1);
      expect(record.message).toMatch(/rejected by the rate limit/);
      expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
    }
  });
});
