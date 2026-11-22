// @vitest-environment node
// File: server/__tests__/userLogServer.test.js
/**
 * Runs the real user log server in-process on a random loopback port. Log files, retention
 * sweeps and the listening socket are captured, so nothing is written to or removed from
 * server/logs.
 */

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ servers: [], written: [], pruned: [] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const createWriteStream = (file) => ({
    write: (line) => { state.written.push({ file: String(file), line: String(line) }); return true; },
    end: () => {},
    on: () => {},
  });
  const mkdirSync = () => undefined;
  const promises = { ...actual.promises, mkdir: async () => undefined };
  return {
    ...actual,
    createWriteStream,
    mkdirSync,
    promises,
    default: { ...actual.default, createWriteStream, mkdirSync, promises },
  };
});

vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));

vi.mock('../logRetention.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    pruneRotatedLogs: async (options) => { state.pruned.push(options); },
    scheduleLogRetention: () => null,
  };
});

vi.mock('express', async (importOriginal) => {
  const actual = await importOriginal();
  const createApp = (...args) => {
    const app = actual.default(...args);
    const listen = app.listen.bind(app);
    app.listen = (...listenArgs) => {
      const server = listen(...listenArgs);
      state.servers.push(server);
      return server;
    };
    return app;
  };
  return { ...actual, default: Object.assign(createApp, actual.default) };
});

let port = 0;

function post(body, headers = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/userlog/record',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const printLines = () => state.written.filter((entry) => /print-\d{4}-\d{2}-\d{2}\.log$/.test(entry.file));

beforeAll(async () => {
  for (const name of ['LOG_RETENTION_DAYS', 'PRINT_LOG_RETENTION_DAYS', 'ODV_STRICT_ORIGIN', 'TRUST_PROXY']) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv('PORT', '0');
  await import('../user-log-server.js');
  const server = state.servers[0];
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await Promise.all(state.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  vi.unstubAllEnvs();
});

describe('user log server', () => {
  it('keeps print records for 30 days and access and error logs for 14 by default', () => {
    const daysFor = (file) => state.pruned
      .filter((options) => options.filePattern.test(file))
      .map((options) => options.retentionDays);
    expect(daysFor('print-2026-11-01.log')).toEqual([30]);
    expect(daysFor('access-2026-11-01.log')).toEqual([14]);
    expect(daysFor('error-2026-11-01.log')).toEqual([14]);
  });

  it('writes the print record when the recipient contains # or $', async () => {
    const before = printLines().length;
    const response = await post({ meta: { reason: 'Patient request', forWhom: 'Ward #3 $A' } });
    expect(response).toEqual({ status: 200, text: 'true' });

    const lines = printLines().slice(before);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0].line);
    expect(record).toMatchObject({ action: 'print', reason: 'Patient request', forWhom: 'Ward _3 _A' });
  });

  it('keeps a recipient with line breaks and control characters on one log line', async () => {
    const before = printLines().length;
    const forged = 'Ward 3\r\n{"ts":"2026-01-01T00:00:00.000Z","action":"print","forWhom":"forged"}\u0000\u001b[2J';
    const response = await post({ reason: 'line one\nline two', forWhom: forged });
    expect(response.status).toBe(200);

    const lines = printLines().slice(before);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.endsWith('\n')).toBe(true);
    expect(lines[0].line.slice(0, -1)).not.toMatch(/[\r\n\u0000\u001b]/);
    const record = JSON.parse(lines[0].line);
    expect(record.reason).toBe('line one line two');
    expect(record.forWhom).not.toMatch(/[\r\n\u0000-\u001f]/);
    expect(record.forWhom.startsWith('Ward 3 {')).toBe(true);
  });

  it('accepts the public host that the proxy on loopback forwards, and still rejects other origins', async () => {
    const before = printLines().length;
    const body = { meta: { reason: 'r', forWhom: 'w' } };

    const forwarded = await post(body, { origin: 'https://viewer.example', 'x-forwarded-host': 'viewer.example' });
    expect(forwarded.status).toBe(200);

    const crossSite = await post(body, { origin: 'https://other.example', 'x-forwarded-host': 'viewer.example' });
    expect(crossSite.status).toBe(403);

    const unforwarded = await post(body, { origin: 'https://viewer.example' });
    expect(unforwarded.status).toBe(403);

    expect(printLines().slice(before)).toHaveLength(1);
  });
});
