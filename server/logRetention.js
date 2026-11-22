// File: server/logRetention.js
/** Shared best-effort retention for the optional standalone log servers. */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const LOG_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Print records (`print-*.log`) are the audit trail of who printed what, and for whom. */
export const PRINT_LOG_RETENTION_DEFAULT_DAYS = 30;

/**
 * Retention for the print records of the user log server. `PRINT_LOG_RETENTION_DAYS` decides
 * when it is a positive number. Otherwise the print records follow `LOG_RETENTION_DAYS`, but
 * never below 30 days, so a shorter retention for access and error logs does not shorten the
 * audit trail by accident.
 * @param {Record<string, (string|undefined)>} env
 * @returns {number}
 */
export function resolvePrintLogRetentionDays(env = {}) {
  const explicit = Number(env?.PRINT_LOG_RETENTION_DAYS);
  if (String(env?.PRINT_LOG_RETENTION_DAYS ?? '').trim() !== '' && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const general = Number(env?.LOG_RETENTION_DAYS);
  return Number.isFinite(general) && general > PRINT_LOG_RETENTION_DEFAULT_DAYS
    ? general
    : PRINT_LOG_RETENTION_DEFAULT_DAYS;
}

/**
 * Delete rotated log files whose modification time is beyond the retention period.
 * @param {{logDir:string, retentionDays:number, filePattern:RegExp, now:(number|undefined)}} options
 * @returns {Promise<void>}
 */
export async function pruneRotatedLogs({ logDir, retentionDays, filePattern, now = Date.now() }) {
  try {
    const files = await fsp.readdir(logDir);
    const maxAgeMs = retentionDays * LOG_RETENTION_SWEEP_INTERVAL_MS;
    await Promise.all(
      files.filter((file) => filePattern.test(file)).map(async (file) => {
        const filePath = path.join(logDir, file);
        try {
          const stat = await fsp.stat(filePath);
          if (now - stat.mtimeMs > maxAgeMs) await fsp.unlink(filePath);
        } catch {}
      })
    );
  } catch {}
}

/**
 * Repeat retention while a long-running service stays up. The timer does not
 * keep an otherwise stopped Node process alive.
 * @param {function(): Promise<void>} prune
 * @param {number} intervalMs
 * @returns {NodeJS.Timeout}
 */
export function scheduleLogRetention(prune, intervalMs = LOG_RETENTION_SWEEP_INTERVAL_MS) {
  const timer = setInterval(() => { void prune(); }, intervalMs);
  timer.unref?.();
  return timer;
}
