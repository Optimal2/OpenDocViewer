import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('src/app/bootConfig.js', 'utf8')
  .replace('(async function boot()', 'globalThis.bootResult = (async function boot()')
  .replace("await import('/src/manual-page/main.jsx')", "globalThis.started = 'manual'")
  .replace("await import('/src/index.jsx')", 'globalThis.started = true');

describe('site config bootstrap diagnostics', () => {
  it.each(['not-found', 'wrong-content-type', 'script-error-or-integrity', 'runtime-error', 'ok'])('reports %s', async (scenario) => {
    const reason = scenario === 'runtime-error' ? 'script-error-or-integrity' : scenario;
    const warn = vi.fn();
    const listeners = new Map();
    const window = {
      location: { pathname: '/viewer/' },
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    };
    const context = {
      window, URL, console: { warn, error: vi.fn() },
      fetch: vi.fn(async (url) => ({
        ok: !url.includes('site.config') || reason !== 'not-found',
        headers: { get: () => url.includes('site.config') && reason === 'wrong-content-type' ? 'text/html' : 'application/javascript' },
      })),
      document: {
        querySelector: () => null,
        createElement: () => ({}),
        head: { appendChild: (script) => {
          if (script.src.includes('site.config') && scenario === 'runtime-error') {
            window.__ODV_SITE_CONFIG__ = { partial: true };
            listeners.get('error')({ filename: script.src });
            script.onload();
          } else if (script.src.includes('site.config') && reason === 'script-error-or-integrity') script.onerror();
          else script.onload();
        } },
      },
    };
    runInNewContext(source, context);
    await context.bootResult;
    expect(window.__ODV_SITE_CONFIG_STATUS__).toMatchObject({ attempted: true, loaded: reason === 'ok', reason });
    expect(window.__ODV_SITE_CONFIG_STATUS__.url).toMatch(/^\/viewer\/odv.site.config.js/);
    expect(context.started).toBe(true);
    expect(listeners.size).toBe(0);
    if (scenario === 'runtime-error') expect(window.__ODV_SITE_CONFIG__).toBeUndefined();
    if (reason === 'wrong-content-type' || reason === 'script-error-or-integrity') {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(reason), expect.any(String));
    } else expect(warn).not.toHaveBeenCalled();
    expect(context.fetch.mock.calls.every(([, options]) => options.cache === 'no-store')).toBe(true);
  });

  it('loads the configs from the ODV base and starts the manual entry on the stand-alone manual page', async () => {
    const meta = { 'odv-app-base': '../', 'odv-page': 'manual' };
    const window = {
      location: { href: 'http://host/OpenDocViewer/manual/', pathname: '/OpenDocViewer/manual/' },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const loaded = [];
    const context = {
      window, URL, console: { warn: vi.fn(), error: vi.fn() },
      fetch: vi.fn(async () => ({ ok: true, headers: { get: () => 'application/javascript' } })),
      document: {
        baseURI: 'http://host/OpenDocViewer/manual/',
        querySelector: (selector) => {
          const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
          return name && meta[name] ? { getAttribute: () => meta[name] } : null;
        },
        createElement: () => ({}),
        head: { appendChild: (script) => { loaded.push(script.src.split('?')[0]); script.onload(); } },
      },
    };
    runInNewContext(source, context);
    await context.bootResult;
    expect(loaded).toEqual(['/OpenDocViewer/odv.site.config.js', '/OpenDocViewer/odv.config.js']);
    expect(context.started).toBe('manual');
  });
});
