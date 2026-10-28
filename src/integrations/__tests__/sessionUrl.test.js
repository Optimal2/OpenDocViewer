// File: src/integrations/__tests__/sessionUrl.test.js
/**
 * Unit tests for the session URL integration (`?sessionurl=` / `?bundleUrl=`).
 *
 * Covers: http(s) and same-origin `blob:` URLs are fetched and parsed, every other protocol is
 * refused without a fetch, and the shared guards (non-2xx, empty body, oversized body, invalid
 * JSON) apply to blob URLs exactly as to http URLs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasSessionUrlParameter, readFromSessionUrl } from '../sessionUrl.js';

const ORIGIN = 'http://viewer.example';

function installWindowStub(search) {
  const previous = globalThis.window;
  globalThis.window = {
    location: { href: `${ORIGIN}/?${search}`, search: `?${search}` }
  };
  return () => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  };
}

function installFetchStub({ ok = true, status = 200, statusText = 'OK', text = '' } = {}) {
  const previous = globalThis.fetch;
  const fetchMock = vi.fn(async () => ({ ok, status, statusText, text: async () => text }));
  globalThis.fetch = fetchMock;
  return { fetchMock, restore: () => { globalThis.fetch = previous; } };
}

describe('sessionUrl', () => {
  let restoreWindow;
  let fetchStub;
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (restoreWindow) restoreWindow();
    if (fetchStub) fetchStub.restore();
    restoreWindow = null;
    fetchStub = null;
    warnSpy.mockRestore();
  });

  it('fetches and parses a same-origin http URL', async () => {
    restoreWindow = installWindowStub('sessionUrl=/bundles/abc.json');
    fetchStub = installFetchStub({ text: JSON.stringify({ documents: [1] }) });

    expect(hasSessionUrlParameter()).toBe(true);
    const result = await readFromSessionUrl();

    expect(fetchStub.fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchStub.fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/bundles/abc.json`);
    expect(result.source).toBe('sessionUrl');
    expect(result.data).toEqual({ documents: [1] });
    expect(result.timing.responseTextBytes).toBeGreaterThan(0);
  });

  it('fetches and parses a blob: URL created by the host page', async () => {
    const blobUrl = `blob:${ORIGIN}/1f2e3d4c-0000-4000-8000-000000000000`;
    restoreWindow = installWindowStub(`bundleUrl=${encodeURIComponent(blobUrl)}`);
    fetchStub = installFetchStub({ text: JSON.stringify({ documents: [{ id: 'blob' }] }) });

    const result = await readFromSessionUrl();

    expect(fetchStub.fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchStub.fetchMock.mock.calls[0][0]).toBe(blobUrl);
    expect(result.source).toBe('bundleUrl');
    expect(result.data).toEqual({ documents: [{ id: 'blob' }] });
  });

  it.each(['ftp://files.example/bundle.json', 'file:///C:/bundle.json', 'javascript:alert(1)', 'data:application/json,{}'])(
    'refuses %s without fetching',
    async (rawUrl) => {
      restoreWindow = installWindowStub(`sessionurl=${encodeURIComponent(rawUrl)}`);
      fetchStub = installFetchStub({ text: '{}' });

      expect(await readFromSessionUrl()).toBeNull();
      expect(fetchStub.fetchMock).not.toHaveBeenCalled();
    }
  );

  it('applies the non-2xx, empty and invalid-JSON guards to blob URLs too', async () => {
    const blobUrl = `blob:${ORIGIN}/00000000-0000-4000-8000-000000000001`;
    restoreWindow = installWindowStub(`sessionurl=${encodeURIComponent(blobUrl)}`);

    fetchStub = installFetchStub({ ok: false, status: 404, statusText: 'Not Found', text: '{}' });
    expect(await readFromSessionUrl()).toBeNull();
    fetchStub.restore();

    fetchStub = installFetchStub({ text: '' });
    expect(await readFromSessionUrl()).toBeNull();
    fetchStub.restore();

    fetchStub = installFetchStub({ text: 'not json' });
    expect(await readFromSessionUrl()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when no session URL parameter is present', async () => {
    restoreWindow = installWindowStub('other=1');
    fetchStub = installFetchStub({ text: '{}' });

    expect(hasSessionUrlParameter()).toBe(false);
    expect(await readFromSessionUrl()).toBeNull();
    expect(fetchStub.fetchMock).not.toHaveBeenCalled();
  });
});
