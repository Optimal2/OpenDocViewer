// @vitest-environment node
// File: server/__tests__/logWriteFailure.test.js
/**
 * A log server must never answer that a record was stored when writing it failed. Both real
 * servers run in-process on a loopback port; the log streams are stand-ins that can be made to
 * fail like a full disk, and that behave like a real stream afterwards: a failed stream is
 * destroyed and has to be opened again.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { post, postAndHangUp } from './logServerHarness.js';

const state = vi.hoisted(() => ({
  servers: [],
  written: [],
  opened: [],
  /** @type {(null|function(string): (Error|null))} */
  failure: null,
  delayMs: 0,
  hung: false,
}));

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

/** Wait until the condition holds; the error report is written after the answer. */
async function eventually(condition, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !condition()) await new Promise((resolve) => setTimeout(resolve, 10));
}

const TOKEN = 'test-token';
const SECRET_TEXT = 'RECORD-CONTENT-THAT-MUST-NOT-BE-IN-THE-ERROR-LOG';
const targets = {};
const diskFull = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
const failing = (...prefixes) => (file) => (prefixes.some((prefix) => new RegExp(`${prefix}-\\d{4}-\\d{2}-\\d{2}\\.log$`).test(file)) ? diskFull() : null);
const linesOf = (prefix) => state.written
  .filter((entry) => new RegExp(`${prefix}-\\d{4}-\\d{2}-\\d{2}\\.log$`).test(entry.file))
  .map((entry) => entry.line);

async function start(modulePath) {
  const before = state.servers.length;
  await import(modulePath);
  const server = state.servers[before];
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  return server.address().port;
}

beforeAll(async () => {
  for (const name of ['LOG_RETENTION_DAYS', 'PRINT_LOG_RETENTION_DAYS', 'ODV_STRICT_ORIGIN', 'ALLOWED_ORIGINS', 'JSON_LIMIT',
    'TRUST_PROXY', 'SYSTEM_LOG_RATE_LIMIT_PER_MINUTE']) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOG_TOKEN', TOKEN);
  vi.stubEnv('PORT', '0');
  vi.stubEnv('USER_LOG_RATE_LIMIT_PER_MINUTE', '2');
  vi.stubEnv('LOG_WRITE_TIMEOUT_MS', '400');
  targets.user = {
    port: await start('../user-log-server.js'), path: '/userlog/record', record: 'print', ok: 200,
    body: (text) => ({ reason: text, forWhom: 'w' }), headers: {},
  };
  targets.system = {
    port: await start('../system-log-server.js'), path: '/log', record: 'ingestion', ok: 204,
    body: (text) => ({ message: text }), headers: { 'x-log-token': TOKEN },
  };
});

afterEach(() => {
  state.failure = null;
  state.delayMs = 0;
  state.hung = false;
  state.written.length = 0;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all(state.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  vi.unstubAllEnvs();
});

describe.each(['system', 'user'])('%s log server when a record cannot be written', (name) => {
  // Each request comes from its own client, so that the rate limit of the print log stays out of the way.
  let client = 0;
  const send = (text) => {
    const target = targets[name];
    client += 1;
    return post(target.port, target.path, target.body(text), { ...target.headers, 'x-forwarded-for': `198.51.100.${client}` });
  };

  it('answers as before when the record is written', async () => {
    const response = await send('stored');
    expect(response.status).toBe(targets[name].ok);
    expect(linesOf(targets[name].record)).toHaveLength(1);
  });

  it('answers 500 and writes an error-log line with the cause, not the record', async () => {
    state.failure = failing(targets[name].record);
    const response = await send(SECRET_TEXT);
    expect(response.status).toBe(500);
    expect(linesOf(targets[name].record)).toEqual([]);

    const failures = () => linesOf('error').map((line) => JSON.parse(line)).filter((record) => record.event === 'log-write-failed');
    await eventually(() => failures().length > 0);
    const errors = failures();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ level: 'error', log: targets[name].record, code: 'ENOSPC' });
    expect(errors[0].message).toMatch(/no space left/);
    expect(JSON.stringify(errors[0])).not.toContain(SECRET_TEXT);
  });

  it('does not answer before the write has finished', async () => {
    state.delayMs = 300;
    const started = Date.now();
    const response = await send('slow disk');
    expect(response.status).toBe(targets[name].ok);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });

  it('falls back to standard error when the error log cannot be written either, and still answers 500', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    state.failure = failing(targets[name].record, 'error');
    const response = await send(SECRET_TEXT);
    expect(response.status).toBe(500);
    const reportedText = () => stderr.mock.calls.map((call) => String(call[0])).join('');
    await eventually(() => reportedText().includes('log-write-failed'));
    const text = reportedText();
    expect(text).toContain('log-write-failed');
    expect(text).toContain('ENOSPC');
    expect(text).not.toContain(SECRET_TEXT);
  });

  it('writes the next record again once the fault is remedied', async () => {
    state.failure = failing(targets[name].record);
    expect((await send('lost')).status).toBe(500);
    expect((await send('lost too')).status).toBe(500);

    state.failure = null;
    const opened = state.opened.length;
    expect((await send('kept')).status).toBe(targets[name].ok);
    expect(linesOf(targets[name].record)).toHaveLength(1);
    // The failed stream was dropped and the file opened again.
    expect(state.opened.length).toBeGreaterThan(opened);
  });

  it('answers 500 once when the write is never confirmed, and writes again when the disk answers', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    state.hung = true;
    const started = Date.now();
    const response = await send(SECRET_TEXT);
    const waited = Date.now() - started;
    expect(response.status).toBe(500);
    // One answer only: the body is the plain 500 text, not two answers on the connection.
    expect(response.text.match(/HTTP\/1\.1/g)).toBeNull();
    // LOG_WRITE_TIMEOUT_MS is 400 here. The answer comes when that time is up; it does not
    // also wait for the error report, which on a hung disk takes as long again.
    expect(waited).toBeGreaterThanOrEqual(380);
    expect(waited).toBeLessThan(700);
    const reportedText = () => stderr.mock.calls.map((call) => String(call[0])).join('');
    await eventually(() => reportedText().includes('log-write-failed'));
    const reported = reportedText();
    expect(reported).toContain('log-write-failed');
    expect(reported).toContain('ELOGTIMEOUT');
    expect(reported).not.toContain(SECRET_TEXT);

    state.hung = false;
    expect((await send('kept')).status).toBe(targets[name].ok);
    expect(linesOf(targets[name].record)).toHaveLength(1);
  });

  it('writes the record when the client closes the connection right after sending it', async () => {
    const target = targets[name];
    client += 1;
    const marker = `hang-up-${name}-${client}`;
    await postAndHangUp(target.port, target.path, target.body(marker), { ...target.headers, 'x-forwarded-for': `198.51.100.${client}` });
    // The viewer never reads the answer; the record has to be written all the same.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !linesOf(target.record).some((line) => line.includes(marker))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(linesOf(target.record).filter((line) => line.includes(marker))).toHaveLength(1);
  });

  it('keeps the order of records written at the same time', async () => {
    state.delayMs = 20;
    const target = targets[name];
    const texts = Array.from({ length: 12 }, (_unused, index) => `ordered-${name}-${index}`);
    // Sent one after the other on separate connections, without waiting for the answers.
    const pending = [];
    for (const text of texts) {
      client += 1;
      pending.push(post(target.port, target.path, target.body(text), { ...target.headers, 'x-forwarded-for': `198.51.100.${client}` }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const responses = await Promise.all(pending);
    expect(responses.every((response) => response.status === target.ok)).toBe(true);
    const stored = linesOf(target.record).map((line) => /ordered-\w+-\d+/.exec(line)?.[0]);
    expect(stored).toEqual(texts);
  });
});

describe('a record rejected by the rate limit', () => {
  const rejections = () => linesOf('error').map((line) => JSON.parse(line)).filter((record) => record.event === 'rate-limit-rejected');
  const send = (address) => post(targets.user.port, targets.user.path, targets.user.body('r'), { 'x-forwarded-for': address });

  it('is reported again within the minute when its error-log line could not be written', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect((await send('203.0.113.77')).status).toBe(200);
    expect((await send('203.0.113.77')).status).toBe(200);

    state.failure = failing('error');
    expect((await send('203.0.113.77')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rejections()).toEqual([]);
    // The line that could not be written went to standard error instead.
    expect(stderr.mock.calls.map((call) => String(call[0])).join('')).toContain('rate-limit-rejected');

    // The error log works again: the client was not marked as reported, so it is reported now.
    state.failure = null;
    expect((await send('203.0.113.77')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rejections().map((record) => record.ip)).toEqual(['203.0.113.77']);

    // And only once from here on.
    expect((await send('203.0.113.77')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rejections()).toHaveLength(1);
  });
});
