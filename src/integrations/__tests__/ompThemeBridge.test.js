// File: src/integrations/__tests__/ompThemeBridge.test.js
/**
 * Unit tests for the opt-in cross-origin theme bridge (postMessage).
 *
 * Covers: allowed vs denied origin, malformed message shape, revision ordering
 * (stale messages are ignored), and that applying a remote change never echoes
 * it back (no ping-pong).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sharedThemeRevisionTime } from '../../utils/ompThemePreference.js';
import {
  OMP_THEME_BRIDGE_KIND,
  OMP_THEME_BRIDGE_VERSION,
  parseThemeBridgeMessage,
  isThemeBridgeOriginAllowed,
  startOmpThemeBridge,
  announceThemeToAllowedOrigins,
} from '../ompThemeBridge.js';

function installWindowStub() {
  const listeners = {};
  const posted = [];
  const stub = {
    addEventListener: (type, handler) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener: (type, handler) => {
      listeners[type] = (listeners[type] || []).filter((entry) => entry !== handler);
    },
    parent: null,
  };
  stub.parent = { postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }) };
  Object.defineProperty(globalThis, 'window', {
    value: stub,
    configurable: true,
    writable: true,
  });
  return {
    stub,
    posted,
    emitMessage: (event) => {
      for (const handler of listeners.message || []) handler(event);
    },
  };
}

/** Build a well-formed bridge message. */
function makeMessage(mode, revision) {
  return { kind: OMP_THEME_BRIDGE_KIND, version: OMP_THEME_BRIDGE_VERSION, mode, revision };
}

describe('ompThemeBridge', () => {
  let originalWindow;
  let harness;

  beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    harness = installWindowStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });

  describe('parseThemeBridgeMessage', () => {
    it('accepts a versioned message with a known mode', () => {
      expect(parseThemeBridgeMessage(makeMessage('dark', 'r2')))
        .toEqual({ mode: 'dark', revision: 'r2' });
    });

    it('rejects the wrong shape', () => {
      expect(parseThemeBridgeMessage(null)).toBeNull();
      expect(parseThemeBridgeMessage({ kind: 'other', version: 1, mode: 'dark', revision: 'r1' })).toBeNull();
      expect(parseThemeBridgeMessage({ kind: OMP_THEME_BRIDGE_KIND, version: 999, mode: 'dark', revision: 'r1' })).toBeNull();
      expect(parseThemeBridgeMessage({ kind: OMP_THEME_BRIDGE_KIND, version: 1, mode: 'sepia', revision: 'r1' })).toBeNull();
      expect(parseThemeBridgeMessage({ kind: OMP_THEME_BRIDGE_KIND, version: 1, mode: 'dark', revision: '' })).toBeNull();
    });
  });

  describe('isThemeBridgeOriginAllowed', () => {
    it('matches origins exactly and stays off by default', () => {
      expect(isThemeBridgeOriginAllowed('https://app.example', ['https://app.example'])).toBe(true);
      expect(isThemeBridgeOriginAllowed('https://evil.example', ['https://app.example'])).toBe(false);
      expect(isThemeBridgeOriginAllowed('https://app.example', [])).toBe(false);
      expect(isThemeBridgeOriginAllowed('https://app.example.evil.example', ['https://app.example'])).toBe(false);
    });
  });

  describe('startOmpThemeBridge', () => {
    it('does not listen or announce in a top-level window, even with allowed origins', () => {
      harness.stub.parent = harness.stub;
      const listen = vi.spyOn(harness.stub, 'addEventListener');
      const remove = vi.spyOn(harness.stub, 'removeEventListener');
      harness.stub.postMessage = vi.fn();
      const onRemotePreference = vi.fn();
      const allowedOrigins = ['https://app.example'];
      const stop = startOmpThemeBridge({ allowedOrigins, onRemotePreference });
      harness.emitMessage({ origin: allowedOrigins[0], source: harness.stub, data: makeMessage('dark', 'r2') });
      announceThemeToAllowedOrigins({ mode: 'dark', revision: 'r2', allowedOrigins });
      stop();
      expect(listen).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(onRemotePreference).not.toHaveBeenCalled();
      expect(harness.stub.postMessage).not.toHaveBeenCalled();
    });

    it('clamps a far-future revision before applying it so a later real change can win', () => {
      const now = 1_800_000_000_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      let current = { mode: 'light', revision: `${(now - 1).toString(36)}-local` };
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        getCurrentRevision: () => current.revision,
        onRemotePreference: (value) => { current = value; },
      });
      const emit = (mode, time) => harness.emitMessage({
        origin: 'https://app.example', source: harness.stub.parent,
        data: makeMessage(mode, `${time.toString(36)}-remote`),
      });
      emit('dark', now + 100 * 365 * 24 * 60 * 60 * 1000);
      expect(current.mode).toBe('dark');
      expect(sharedThemeRevisionTime(current.revision)).toBe(now + 5_000);
      clock.mockReturnValue(now + 5_001);
      emit('light', Date.now());
      expect(current).toEqual({ mode: 'light', revision: `${Date.now().toString(36)}-remote` });
      expect(harness.posted).toEqual([]);
      stop();
    });

    it('preserves revisions within the clock skew and compares after clamping', () => {
      const now = 1_800_000_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      let current = null;
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        getCurrentRevision: () => current,
        onRemotePreference: (value) => { current = value.revision; seen.push(value); },
      });
      const boundary = `${(now + 5_000).toString(36)}-original`;
      harness.emitMessage({ origin: 'https://app.example', source: harness.stub.parent, data: makeMessage('dark', boundary) });
      harness.emitMessage({ origin: 'https://app.example', source: harness.stub.parent, data: makeMessage('light', `${(now + 60_000).toString(36)}-future`) });
      expect(seen).toEqual([{ mode: 'dark', revision: boundary }]);
      stop();
    });

    it('rejects unrelated windows even when their origin is allowed', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
      });
      harness.emitMessage({ origin: 'https://app.example', source: {}, data: makeMessage('dark', 'r2') });
      stop();
      expect(seen).toEqual([]);
    });

    it('applies a newer change from an allowed origin', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => 'r1',
      });
      harness.emitMessage({
        origin: 'https://app.example',
        source: harness.stub.parent,
        data: makeMessage('dark', 'r2'),
      });
      stop();
      expect(seen).toEqual([{ mode: 'dark', revision: 'r2' }]);
    });

    it('ignores stale revisions from an allowed origin', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => 'r2',
      });
      harness.emitMessage({
        origin: 'https://app.example',
        source: harness.stub.parent,
        data: makeMessage('light', 'r1'),
      });
      stop();
      expect(seen).toEqual([]);
    });

    it('ignores messages from a denied origin', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => null,
      });
      harness.emitMessage({
        origin: 'https://evil.example',
        source: harness.stub.parent,
        data: makeMessage('dark', 'r9'),
      });
      stop();
      expect(seen).toEqual([]);
    });

    it('ignores malformed messages and missing sources', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => null,
      });
      harness.emitMessage({ origin: 'https://app.example', source: harness.stub.parent, data: { kind: 'other' } });
      harness.emitMessage({ origin: 'https://app.example', source: null, data: makeMessage('dark', 'r3') });
      stop();
      expect(seen).toEqual([]);
    });

    it('never echoes an applied remote change back', () => {
      const posted = [];
      harness.stub.parent = {
        postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }),
      };
      let current = null;
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => {
          // The apply path mirrors the value locally and must not announce it.
          current = value;
        },
        getCurrentRevision: () => current?.revision || null,
      });
      harness.emitMessage({
        origin: 'https://app.example',
        source: harness.stub.parent,
        data: makeMessage('dark', 'r4'),
      });
      stop();
      expect(current).toEqual({ mode: 'dark', revision: 'r4' });
      expect(posted).toEqual([]);
    });

    it('does nothing when the bridge is not configured', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: [],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => null,
      });
      expect(typeof stop).toBe('function');
      stop();
      expect(seen).toEqual([]);
    });
  });

  describe('announceThemeToAllowedOrigins', () => {
    it('posts with the exact allowed targetOrigin', () => {
      const posted = [];
      globalThis.window.parent = {
        postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }),
      };
      announceThemeToAllowedOrigins({ mode: 'dark', revision: 'r5', allowedOrigins: ['https://app.example'] });
      expect(posted).toHaveLength(1);
      expect(posted[0].targetOrigin).toBe('https://app.example');
      expect(posted[0].message).toMatchObject({ kind: OMP_THEME_BRIDGE_KIND, version: OMP_THEME_BRIDGE_VERSION, mode: 'dark', revision: 'r5' });
    });

    it('never uses a wildcard targetOrigin and stays silent when off', () => {
      const posted = [];
      globalThis.window.parent = {
        postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }),
      };
      announceThemeToAllowedOrigins({ mode: 'dark', revision: 'r5', allowedOrigins: [] });
      announceThemeToAllowedOrigins({ mode: 'dark', revision: 'r5', allowedOrigins: ['*', 'null', 'https://app.example/path'] });
      expect(posted).toEqual([]);
    });
  });
});
