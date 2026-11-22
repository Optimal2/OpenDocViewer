import { describe, expect, it } from 'vitest';
import { isAllowedUserLogOrigin, resolveUserLogHosts } from '../userLogOrigin.js';

describe('user log origin guard', () => {
  it('accepts exact same-origin Origin and Referer signals', () => {
    expect(isAllowedUserLogOrigin({ host: 'viewer.example', origin: 'https://viewer.example' })).toBe(true);
    expect(isAllowedUserLogOrigin({ host: 'viewer.example', referer: 'https://viewer.example/page' })).toBe(true);
    expect(isAllowedUserLogOrigin({ host: 'viewer.example', origin: 'https://other.example' })).toBe(false);
  });

  it('accepts only same-origin, not merely same-site, Sec-Fetch-Site requests', () => {
    expect(isAllowedUserLogOrigin({ secFetchSite: 'same-origin' })).toBe(true);
    expect(isAllowedUserLogOrigin({ secFetchSite: 'same-site' })).toBe(false);
    expect(isAllowedUserLogOrigin({ secFetchSite: 'cross-site' })).toBe(false);
  });

  it('keeps the documented compatibility default and supports strict rejection', () => {
    expect(isAllowedUserLogOrigin()).toBe(true);
    expect(isAllowedUserLogOrigin({ strict: true })).toBe(false);
  });

  it('compares with the forwarded public host when the proxy connects over loopback', () => {
    const proxied = { host: 'localhost:3002', forwardedHost: 'viewer.example', origin: 'https://viewer.example' };
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isAllowedUserLogOrigin({ ...proxied, remoteAddress })).toBe(true);
      expect(isAllowedUserLogOrigin({ ...proxied, remoteAddress, origin: 'https://other.example' })).toBe(false);
    }
    expect(isAllowedUserLogOrigin({
      host: 'localhost:3002', forwardedHost: 'viewer.example:8443', remoteAddress: '::1',
      referer: 'https://viewer.example:8443/page',
    })).toBe(true);
    // The Host header itself keeps working, with or without a forwarded host.
    expect(isAllowedUserLogOrigin({ ...proxied, remoteAddress: '::1', origin: 'http://localhost:3002' })).toBe(true);
  });

  it('ignores a forwarded host that does not come from loopback', () => {
    const request = { host: 'internal.example', forwardedHost: 'viewer.example', origin: 'https://viewer.example' };
    expect(isAllowedUserLogOrigin({ ...request, remoteAddress: '10.0.0.5' })).toBe(false);
    expect(isAllowedUserLogOrigin({ ...request, remoteAddress: '' })).toBe(false);
    expect(resolveUserLogHosts({ ...request, remoteAddress: '10.0.0.5' })).toEqual(['internal.example']);
  });

  it('uses the entry the nearest proxy added and never matches an unparsable origin', () => {
    expect(resolveUserLogHosts({
      host: 'localhost:3002', forwardedHost: 'spoofed.example, Viewer.Example', remoteAddress: '127.0.0.1',
    })).toEqual(['localhost:3002', 'viewer.example']);
    expect(isAllowedUserLogOrigin({ host: '', origin: 'null' })).toBe(false);
  });
});
