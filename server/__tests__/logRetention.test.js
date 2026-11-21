import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_RETENTION_SWEEP_INTERVAL_MS,
  pruneRotatedLogs,
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
});
