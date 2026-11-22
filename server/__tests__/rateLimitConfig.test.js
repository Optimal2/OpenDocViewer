// @vitest-environment node
// File: server/__tests__/rateLimitConfig.test.js

import { describe, expect, it, vi } from 'vitest';
import { createRejectionReporter, resolveRateLimitPerMinute } from '../rateLimitConfig.js';

describe('resolveRateLimitPerMinute', () => {
  it.each([[undefined], [''], ['   ']])('uses the default when the value is %j', (raw) => {
    expect(resolveRateLimitPerMinute('X_LIMIT', raw, 60)).toEqual({ limit: 60, enabled: true, warning: null });
  });

  it.each([['0'], ['off'], ['OFF'], [' Off ']])('switches the limit off for %j', (raw) => {
    expect(resolveRateLimitPerMinute('X_LIMIT', raw, 60)).toEqual({ limit: 0, enabled: false, warning: null });
  });

  it.each([['1', 1], ['600', 600], [' 25 ', 25]])('uses %j as the limit', (raw, limit) => {
    expect(resolveRateLimitPerMinute('X_LIMIT', raw, 60)).toEqual({ limit, enabled: true, warning: null });
  });

  it.each([['abc'], ['-5'], ['1.5'], ['12x'], ['1e3'], ['00'], ['yes'], ['99999999999']])(
    'falls back to the default with a warning for %j',
    (raw) => {
      const result = resolveRateLimitPerMinute('X_LIMIT', raw, 60);
      expect(result.limit).toBe(60);
      expect(result.enabled).toBe(true);
      expect(result.warning).toContain('X_LIMIT');
      expect(result.warning).toContain('60');
      // The rejected value is not echoed into the log.
      expect(result.warning).not.toContain(raw);
    },
  );
});

describe('createRejectionReporter', () => {
  it('writes one line per client and window', () => {
    let time = 1_000_000;
    const write = vi.fn();
    const report = createRejectionReporter({ write, now: () => time });

    expect(report('203.0.113.5')).toBe(true);
    expect(report('203.0.113.5')).toBe(false);
    expect(report('203.0.113.9')).toBe(true);
    time += 59_999;
    expect(report('203.0.113.5')).toBe(false);
    time += 1;
    expect(report('203.0.113.5')).toBe(true);
    expect(write.mock.calls.map((call) => call[0])).toEqual(['203.0.113.5', '203.0.113.9', '203.0.113.5']);
  });

  it('does not grow without bound', () => {
    let time = 0;
    const write = vi.fn();
    const report = createRejectionReporter({ write, now: () => time, maxClients: 3 });
    for (const client of ['a', 'b', 'c', 'd', 'e']) expect(report(client)).toBe(true);
    time += 60_000;
    expect(report('a')).toBe(true);
    expect(write).toHaveBeenCalledTimes(6);
  });
});
