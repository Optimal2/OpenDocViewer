// @vitest-environment jsdom
// File: src/integrations/__tests__/integrationSettings.test.js
/**
 * Settings a host application may carry in the bundle: what is accepted, what is refused, and
 * that a refusal never leaves a half-applied setting behind.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyIntegrationSettings,
  getEffectiveUserLogConfig,
  getIntegrationSettings,
  readSettingsPolicy,
  resetIntegrationSettings,
  resolveSameOriginEndpoint,
  sanitizeIntegrationSettings,
} from '../integrationSettings.js';

const BASE = 'https://viewer.example/odv/';
const ON = { enabled: true, allow: ['userLog'] };

function bundleWith(settings) {
  return { session: { id: 's' }, documents: [], integration: { source: 'host', settings } };
}

describe('resolveSameOriginEndpoint', () => {
  it('keeps a path on the viewer origin and makes it absolute', () => {
    expect(resolveSameOriginEndpoint('/host/log-print', BASE)).toBe('https://viewer.example/host/log-print');
    expect(resolveSameOriginEndpoint('log', BASE)).toBe('https://viewer.example/odv/log');
    expect(resolveSameOriginEndpoint('https://viewer.example/x', BASE)).toBe('https://viewer.example/x');
  });

  it.each([
    'https://elsewhere.example/log',
    '//elsewhere.example/log',
    'http://viewer.example/log',          // same host, weaker scheme
    'https://viewer.example:8443/log',    // same host, other port
    'javascript:alert(1)',
    'data:text/plain,x',
    '',
    '   ',
  ])('refuses %s', (endpoint) => {
    expect(resolveSameOriginEndpoint(endpoint, BASE)).toBe('');
  });

  it('refuses anything that is not text', () => {
    expect(resolveSameOriginEndpoint(null, BASE)).toBe('');
    expect(resolveSameOriginEndpoint({ toString: () => '/x' }, BASE)).toBe('');
  });
});

describe('readSettingsPolicy', () => {
  it('is off unless the site turns it on', () => {
    expect(readSettingsPolicy({})).toEqual({ enabled: false, allow: [] });
    expect(readSettingsPolicy({ integrations: { portableBundle: { settingsFromBundle: { enabled: false, allow: ['userLog'] } } } }).enabled).toBe(false);
  });

  it('keeps only groups it knows', () => {
    const cfg = { integrations: { portableBundle: { settingsFromBundle: { enabled: true, allow: ['userLog', 'print', 42] } } } };
    expect(readSettingsPolicy(cfg)).toEqual({ enabled: true, allow: ['userLog'] });
  });

  it('is off when nothing is allowed', () => {
    const cfg = { integrations: { portableBundle: { settingsFromBundle: { enabled: true, allow: [] } } } };
    expect(readSettingsPolicy(cfg).enabled).toBe(false);
  });
});

describe('sanitizeIntegrationSettings', () => {
  const userLog = { enabled: true, endpoint: '/host/log-print', transport: 'form' };

  it('accepts a same-origin print log from a bundle the viewer fetched itself', () => {
    const { settings, rejected } = sanitizeIntegrationSettings(bundleWith({ userLog }), { mode: 'session-url', policy: ON, base: BASE });
    expect(settings).toEqual({ userLog: { enabled: true, endpoint: 'https://viewer.example/host/log-print', transport: 'form' } });
    expect(rejected).toEqual([]);
  });

  it('accepts the same from a same-origin parent page', () => {
    const { settings } = sanitizeIntegrationSettings(bundleWith({ userLog }), { mode: 'parent-page', policy: ON, base: BASE });
    expect(settings.userLog.endpoint).toBe('https://viewer.example/host/log-print');
  });

  it.each(['session-token', 'url-params', 'js-api', 'demo', '', undefined])(
    'ignores settings from a bundle that arrived through %s', (mode) => {
      const { settings, rejected } = sanitizeIntegrationSettings(bundleWith({ userLog }), { mode, policy: ON, base: BASE });
      expect(settings).toEqual({});
      expect(rejected).toEqual(['untrusted-bootstrap-mode']);
    });

  it('ignores everything when the site has not turned the feature on', () => {
    const { settings, rejected } = sanitizeIntegrationSettings(bundleWith({ userLog }), { mode: 'session-url', policy: { enabled: false, allow: [] }, base: BASE });
    expect(settings).toEqual({});
    expect(rejected).toEqual(['settings-from-bundle-disabled']);
  });

  it('drops the whole print log when its endpoint is on another origin', () => {
    const hostile = { enabled: true, endpoint: 'https://elsewhere.example/steal', transport: 'json' };
    const { settings, rejected } = sanitizeIntegrationSettings(bundleWith({ userLog: hostile }), { mode: 'session-url', policy: ON, base: BASE });
    // Not { enabled: true, transport: 'json' } on top of the site's own endpoint.
    expect(settings).toEqual({});
    expect(rejected).toContain('userLog.endpoint:not-same-origin');
  });

  it('lets a bundle turn its own logging off without naming an endpoint', () => {
    const { settings } = sanitizeIntegrationSettings(bundleWith({ userLog: { enabled: false } }), { mode: 'session-url', policy: ON, base: BASE });
    expect(settings).toEqual({ userLog: { enabled: false } });
  });

  it('refuses an unknown transport and non-boolean flags but keeps the rest', () => {
    const { settings, rejected } = sanitizeIntegrationSettings(
      bundleWith({ userLog: { enabled: 'yes', endpoint: '/host/log', transport: 'beacon' } }),
      { mode: 'session-url', policy: ON, base: BASE });
    expect(settings).toEqual({ userLog: { endpoint: 'https://viewer.example/host/log' } });
    expect(rejected).toEqual(['userLog.transport:unknown']);
  });

  it('never passes through fields or groups it does not know', () => {
    const { settings, rejected } = sanitizeIntegrationSettings(
      bundleWith({ userLog: { endpoint: '/host/log', ui: { showReasonWhen: 'never' }, headers: { x: 1 } }, print: { header: 'x' }, __proto__: { polluted: true } }),
      { mode: 'session-url', policy: ON, base: BASE });
    expect(settings).toEqual({ userLog: { endpoint: 'https://viewer.example/host/log' } });
    expect(rejected).toContain('print:unknown-group');
    expect({}.polluted).toBeUndefined();
  });

  it('gives nothing for a bundle without settings', () => {
    for (const bundle of [null, {}, { integration: {} }, { integration: { settings: [] } }, { integration: { settings: 'x' } }]) {
      expect(sanitizeIntegrationSettings(bundle, { mode: 'session-url', policy: ON, base: BASE })).toEqual({ settings: {}, rejected: [] });
    }
  });
});

describe('applyIntegrationSettings and getEffectiveUserLogConfig', () => {
  const site = {
    userLog: { enabled: false, endpoint: '/site/log', transport: 'json', ui: { showReasonWhen: 'always' } },
    integrations: { portableBundle: { settingsFromBundle: { enabled: true, allow: ['userLog'] } } },
  };

  beforeEach(() => {
    window.__ODV_GET_CONFIG__ = () => site;
    resetIntegrationSettings();
  });

  afterEach(() => {
    delete window.__ODV_GET_CONFIG__;
    resetIntegrationSettings();
  });

  it('is the site configuration when no bundle carries settings', () => {
    expect(getEffectiveUserLogConfig()).toBe(site.userLog);
  });

  it('puts the integration on top of the site configuration and keeps the dialog options', () => {
    applyIntegrationSettings(bundleWith({ userLog: { enabled: true, endpoint: '/host/log-print', transport: 'form', ui: { showReasonWhen: 'never' } } }), 'session-url');
    const effective = getEffectiveUserLogConfig();
    expect(effective.enabled).toBe(true);
    expect(effective.transport).toBe('form');
    expect(new URL(effective.endpoint).pathname).toBe('/host/log-print');
    expect(effective.ui).toBe(site.userLog.ui);
    expect(site.userLog.enabled).toBe(false); // the site configuration itself is not touched
  });

  it('a later bundle without settings clears the earlier overlay', () => {
    applyIntegrationSettings(bundleWith({ userLog: { enabled: true, endpoint: '/host/log-print' } }), 'session-url');
    applyIntegrationSettings({ session: { id: 's2' }, documents: [] }, 'session-url');
    expect(getIntegrationSettings()).toEqual({});
    expect(getEffectiveUserLogConfig()).toBe(site.userLog);
  });

  it('does nothing while the site has the feature off', () => {
    window.__ODV_GET_CONFIG__ = () => ({ userLog: site.userLog });
    applyIntegrationSettings(bundleWith({ userLog: { enabled: true, endpoint: '/host/log-print' } }), 'session-url');
    expect(getEffectiveUserLogConfig()).toBe(site.userLog);
  });
});
