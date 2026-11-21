// @vitest-environment jsdom
// File: src/logging/__tests__/userLogger.test.js
/**
 * The JSON print-log envelope carries the loaded bundle's session id and user id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadUserLog() {
  vi.resetModules();
  const mod = await import('../userLogger.js');
  return mod.default;
}

function sentEnvelope(fetchMock) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('userLogger JSON envelope', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    // Force the fetch path so the body can be inspected.
    vi.stubGlobal('navigator', { userAgent: 'test', language: 'en' });
    window.__ODV_CONFIG__ = { userLog: { enabled: true, endpoint: '/userlog/record', transport: 'json' } };
  });

  afterEach(() => {
    delete window.__ODV_CONFIG__;
    vi.unstubAllGlobals();
  });

  it('fills session.id and user.id from the bundle session passed with the print', async () => {
    const userLog = await loadUserLog();
    userLog.submitPrint({ reason: 'r', forWhom: 'f', sessionId: 'session-42', userId: 'user-7' });
    const body = sentEnvelope(fetchMock);
    expect(body.session.id).toBe('session-42');
    expect(body.user).toEqual({ id: 'user-7', name: null });
    expect(body.meta).toMatchObject({ reason: 'r', forWhom: 'f' });
  });

  it('keeps null when the bundle has no session id or user id', async () => {
    const userLog = await loadUserLog();
    userLog.submitPrint({ reason: 'r', sessionId: '', userId: '' });
    const body = sentEnvelope(fetchMock);
    expect(body.session.id).toBeNull();
    expect(body.user).toEqual({ id: null, name: null });
  });

  it('lets an explicit resolver and context take precedence over the bundle values', async () => {
    const userLog = await loadUserLog();
    userLog.setUserResolver(() => ({ id: 'resolved', name: 'Resolved Name' }));
    await userLog.initContext({ sessionId: 'context-session' });
    userLog.submitPrint({ sessionId: 'session-42', userId: 'user-7' });
    const body = sentEnvelope(fetchMock);
    expect(body.session.id).toBe('context-session');
    expect(body.user).toEqual({ id: 'resolved', name: 'Resolved Name' });
  });
});
