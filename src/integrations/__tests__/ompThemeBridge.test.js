// File: src/integrations/__tests__/ompThemeBridge.test.js
/**
 * Unit tests for the opt-in cross-origin theme bridge (postMessage).
 *
 * Covers: allowed vs denied origin, malformed message shape, revision ordering
 * (stale messages are ignored), and that applying a remote change never echoes
 * it back (no ping-pong).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  stub.parent = stub;
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
    it('applies a newer change from an allowed origin', () => {
      const seen = [];
      const stop = startOmpThemeBridge({
        allowedOrigins: ['https://app.example'],
        onRemotePreference: (value) => seen.push(value),
        getCurrentRevision: () => 'r1',
      });
      harness.emitMessage({
        origin: 'https://app.example',
        source: {},
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
        source: {},
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
        source: {},
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
      harness.emitMessage({ origin: 'https://app.example', source: {}, data: { kind: 'other' } });
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
        source: {},
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
      expect(posted).toEqual([]);
    });
  });
});
