import { describe, expect, it } from 'vitest';
import { isAllowedUserLogOrigin } from '../userLogOrigin.js';

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
});
