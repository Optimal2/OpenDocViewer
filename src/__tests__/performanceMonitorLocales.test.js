// File: src/__tests__/performanceMonitorLocales.test.js
/**
 * Every `perf.*` text the performance overlay asks for exists in both language files, so the
 * overlay's buttons and labels are not left in the English fallback.
 */

import { describe, it, expect } from 'vitest';
import en from '../../public/locales/en/common.json';
import sv from '../../public/locales/sv/common.json';
import source from '../PerformanceMonitor.jsx?raw';

function usedPerfKeys() {
  const keys = new Set();
  for (const match of source.matchAll(/\bt\('perf\.([A-Za-z0-9_.]+)'/g)) keys.add(match[1]);
  return [...keys];
}

function hasKey(table, key) {
  let current = table;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object') return false;
    if (part in current) {
      current = current[part];
      continue;
    }
    // i18next plural forms: key_one, key_other, ...
    return Object.keys(current).some((name) => name.startsWith(`${part}_`));
  }
  return true;
}

describe('performance overlay translations', () => {
  const keys = usedPerfKeys();

  it('finds the overlay texts', () => {
    expect(keys).toContain('copySnapshot');
    expect(keys).toContain('downloadHostMetadata');
  });

  it.each([['en', en], ['sv', sv]])('has every perf.* key in %s', (_lang, table) => {
    expect(keys.filter((key) => !hasKey(table.perf, key))).toEqual([]);
  });
});
