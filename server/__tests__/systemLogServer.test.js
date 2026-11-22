// @vitest-environment node
// File: server/__tests__/systemLogServer.test.js
/**
 * Runs the real system log server in-process on a loopback port. Log files, retention sweeps
 * and the listening socket are captured, so nothing is written to or removed from server/logs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chars, post, splitLines, utf8Header } from './logServerHarness.js';

const state = vi.hoisted(() => ({ servers: [], written: [] }));

// Log files are kept in memory: see fakeLogFileSystem in logServerHarness.js.
vi.mock('node:fs', async (importOriginal) => (await import('./logServerHarness.js')).fakeLogFileSystem(await importOriginal(), state));

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
let port = 0;
const send = (body, headers = {}) => post(port, '/log', body, { 'x-log-token': TOKEN, ...headers });
const ingestionLines = () => state.written.filter((entry) => /ingestion-\d{4}-\d{2}-\d{2}\.log$/.test(entry.file));

beforeAll(async () => {
  for (const name of ['LOG_RETENTION_DAYS', 'ALLOWED_ORIGINS', 'JSON_LIMIT', 'TRUST_PROXY']) vi.stubEnv(name, undefined);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOG_TOKEN', TOKEN);
  vi.stubEnv('PORT', '0');
  await import('../system-log-server.js');
  const server = state.servers[0];
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await Promise.all(state.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  vi.unstubAllEnvs();
});

describe('system log server', () => {
  it.each([
    ['U+2028 line separator', chars(0x2028)],
    ['U+2029 paragraph separator', chars(0x2029)],
    ['U+0085 next line', chars(0x85)],
    ['a line feed', '\n'],
    ['a carriage return and line feed', '\r\n'],
  ])('keeps %s in a context key, a context value and the message on one log line', async (_name, separator) => {
    const before = ingestionLines().length;
    const forgedKey = `a${separator}{"level":"error","message":"forged"}`;
    const response = await send({
      level: 'info',
      message: `first${separator}second`,
      context: { [forgedKey]: `value${separator}more`, nested: { [`k${separator}k`]: 1 } },
    });
    expect(response.status).toBe(204);

    const lines = ingestionLines().slice(before);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.endsWith('\n')).toBe(true);
    expect(splitLines(lines[0].line)).toHaveLength(1);
    const record = JSON.parse(lines[0].line);
    expect(record.message).toBe('first second');
    // The key survives as data: nothing is lost, it just cannot break the line.
    expect(Object.keys(record.context)).toHaveLength(2);
    expect(Object.values(record.context)[0]).toBe('value more');
  });

  it('logs a UTF-8 user agent with its letters and keeps a header line break on one line', async () => {
    const letters = chars(0xc5, 0xc4, 0xd6, 0xe5, 0xe4, 0xf6);
    const before = ingestionLines().length;
    await send({ message: 'm' }, { 'user-agent': utf8Header(`Agent ${letters}`) });
    await send({ message: 'm' }, { 'user-agent': utf8Header(`Agent${chars(0x2028)}forged`) });
    await send({ message: 'm' }, { 'user-agent': `Agent${chars(0x85)}forged` });

    const lines = ingestionLines().slice(before);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0].line).ua).toBe(`Agent ${letters}`);
    for (const entry of lines) expect(splitLines(entry.line)).toHaveLength(1);
    expect(JSON.parse(lines[1].line).ua).toBe('Agent forged');
    expect(JSON.parse(lines[2].line).ua).toBe('Agent forged');
  });
});
