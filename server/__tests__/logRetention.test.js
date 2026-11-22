import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_RETENTION_SWEEP_INTERVAL_MS,
  pruneRotatedLogs,
  resolvePrintLogRetentionDays,
  scheduleLogRetention,
} from '../logRetention.js';

vi.mock('node:fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
}));
const { promises: fsp } = await import('node:fs');

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('log retention', () => {
  it('removes only expired rotated files', async () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    fsp.readdir.mockResolvedValue(['print-2026-11-01.log', 'print-2026-11-20.log', 'other.log']);
    fsp.stat.mockImplementation((filePath) => Promise.resolve({
      mtimeMs: filePath.includes('11-01') ? now - 20 * LOG_RETENTION_SWEEP_INTERVAL_MS : now,
    }));

    await pruneRotatedLogs({
      logDir: '/logs',
      retentionDays: 14,
      filePattern: /^print-\d{4}-\d{2}-\d{2}\.log$/,
      now,
    });

    expect(fsp.unlink).toHaveBeenCalledTimes(1);
    expect(fsp.unlink.mock.calls[0][0]).toContain('print-2026-11-01.log');
  });

  it('runs the prune callback again while the service remains alive', async () => {
    vi.useFakeTimers();
    const prune = vi.fn(() => Promise.resolve());
    const timer = scheduleLogRetention(prune);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LOG_RETENTION_SWEEP_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it('keeps print records 30 days unless a longer or an explicit print retention is set', () => {
    expect(resolvePrintLogRetentionDays({})).toBe(30);
    expect(resolvePrintLogRetentionDays()).toBe(30);
    // The general retention never shortens the print records below 30 days.
    expect(resolvePrintLogRetentionDays({ LOG_RETENTION_DAYS: '14' })).toBe(30);
    expect(resolvePrintLogRetentionDays({ LOG_RETENTION_DAYS: '90' })).toBe(90);
    expect(resolvePrintLogRetentionDays({ LOG_RETENTION_DAYS: '90', PRINT_LOG_RETENTION_DAYS: '45' })).toBe(45);
    expect(resolvePrintLogRetentionDays({ PRINT_LOG_RETENTION_DAYS: '7' })).toBe(7);
    for (const invalid of ['', ' ', 'abc', '0', '-5']) {
      expect(resolvePrintLogRetentionDays({ PRINT_LOG_RETENTION_DAYS: invalid })).toBe(30);
    }
  });
});
