// File: src/utils/__tests__/i18nVersion.test.js
/**
 * Locale cache-busting token (utils/i18nVersion.js, docs-src/runtime-configuration.md): a new
 * build with changed locale files must always produce a new locale URL; a value persisted in
 * localStorage must never outrank the build; only an explicit operator pin or ?i18nV can.
 */

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { getBuildLocaleToken, normalizeVersionToken, resolveI18nVersion } from '../i18nVersion.js';
import { computeLocaleResourceHash } from '../../../scripts/locale-resource-hash.mjs';

const BASE = { fallback: 'bundled-rev' };

describe('resolveI18nVersion', () => {
  it('lets the build token win over a persisted localStorage value', () => {
    expect(resolveI18nVersion({ ...BASE, storedVersion: '2026-01-01-old', buildId: '2.10.0-stable', resourceHash: 'abc123' }))
      .toBe('2.10.0-stable.abc123');
  });

  it('changes the token when only the locale content changes (same deterministic build id)', () => {
    const before = resolveI18nVersion({ ...BASE, buildId: '2.10.0-stable', resourceHash: 'aaaa' });
    const after = resolveI18nVersion({ ...BASE, buildId: '2.10.0-stable', resourceHash: 'bbbb' });
    expect(after).not.toBe(before);
  });

  it('keeps an explicit operator pin in config above the build token', () => {
    expect(resolveI18nVersion({ ...BASE, configVersion: 'site-7', buildId: 'b', resourceHash: 'h', storedVersion: 's' })).toBe('site-7');
  });

  it('treats config "auto" as not pinned', () => {
    expect(resolveI18nVersion({ ...BASE, configVersion: 'auto', buildId: 'b', resourceHash: 'h' })).toBe('b.h');
    expect(resolveI18nVersion({ ...BASE, configVersion: ' AUTO ', buildId: 'b' })).toBe('b');
  });

  it('keeps ?i18nV as the per-load diagnostic override', () => {
    expect(resolveI18nVersion({ ...BASE, query: 'diag', configVersion: 'site-7', buildId: 'b' })).toBe('diag');
  });

  it('falls back to localStorage, app version and the bundled revision only without a build token', () => {
    expect(resolveI18nVersion({ ...BASE, storedVersion: 'stored', appVersion: '2.10.0' })).toBe('stored');
    expect(resolveI18nVersion({ ...BASE, appVersion: '2.10.0' })).toBe('2.10.0');
    expect(resolveI18nVersion({ ...BASE })).toBe('bundled-rev');
  });

  it('builds the token from whichever build parts exist', () => {
    expect(getBuildLocaleToken('', 'h')).toBe('h');
    expect(getBuildLocaleToken('b', null)).toBe('b');
    expect(normalizeVersionToken('  ')).toBe('');
  });
});

describe('computeLocaleResourceHash', () => {
  const root = new URL('../../../', import.meta.url);

  it('is stable for the same files and short enough for a URL', () => {
    const first = computeLocaleResourceHash(root);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(computeLocaleResourceHash(root)).toBe(first);
  });

  it('changes when a locale file changes', () => {
    const files = new Map([
      ['en/common.json', readFileSync(new URL('public/locales/en/common.json', root))],
      ['sv/common.json', readFileSync(new URL('public/locales/sv/common.json', root))],
    ]);
    const original = computeLocaleResourceHash(root, files);
    files.set('sv/common.json', Buffer.concat([files.get('sv/common.json'), Buffer.from(' ')]));
    expect(computeLocaleResourceHash(root, files)).not.toBe(original);
  });
});
