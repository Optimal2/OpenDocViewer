import { describe, expect, it } from 'vitest';
import { isManualEnabled } from '../manualEnabled.js';

describe('isManualEnabled', () => {
  it('is enabled when the key, the block or the whole config is absent', () => {
    expect(isManualEnabled(undefined)).toBe(true);
    expect(isManualEnabled(null)).toBe(true);
    expect(isManualEnabled({})).toBe(true);
    expect(isManualEnabled({ help: {} })).toBe(true);
    expect(isManualEnabled({ help: { manual: { source: 'auto' } } })).toBe(true);
  });

  it('is disabled only by the boolean false', () => {
    expect(isManualEnabled({ help: { manual: { enabled: false } } })).toBe(false);
    for (const value of [true, 'false', 0, '', null, undefined, 'no']) {
      expect(isManualEnabled({ help: { manual: { enabled: value } } })).toBe(true);
    }
  });

  it('treats a config whose getters throw as enabled', () => {
    const config = { help: { get manual() { throw new Error('host getter'); } } };
    expect(isManualEnabled(config)).toBe(true);
  });
});
