// File: server/rollingLog.js
/**
 * Daily rotating log files for the log servers, with a write that reports its outcome.
 *
 * A record must never be answered as stored when it was not. `write` therefore resolves only
 * when the line has been handed to the file without an error, and rejects otherwise.
 *
 * - No fsync per line: the promise resolves when the operating system has accepted the write,
 *   which is what the servers did before, so a successful write is not slower.
 * - Lines keep their order: each file has one stream, and a stream writes in the order of the
 *   calls, also when several requests write at the same time.
 * - A stream that has failed is dropped. The next write opens the file again, so one error
 *   (a full disk, a removed folder) does not make every later line disappear silently.
 * - The file name follows the UTC date; on a new day the next write opens the new file.
 */

import fs from 'node:fs';
import path from 'node:path';

const utcDate = (date) => date.toISOString().slice(0, 10);

/**
 * @param {{ logDir: string, now: (function(): Date|undefined), stderr: ({write: function(string): *}|undefined), fileSystem: (Object|undefined) }} options
 */
export function createRollingLog({ logDir, now = () => new Date(), stderr = process.stderr, fileSystem = fs }) {
  /** @type {Map<string, { date: string, stream: *, failure: (Error|null) }>} */
  const open = new Map();
  /** @type {Map<string, number>} */
  const lastNoted = new Map();

  function close(entry) {
    try { entry.stream.end(); } catch { /* already closed */ }
  }

  function entryFor(prefix) {
    const today = utcDate(now());
    let entry = open.get(prefix);
    if (entry && (entry.date !== today || entry.failure || entry.stream.destroyed)) {
      close(entry);
      open.delete(prefix);
      entry = undefined;
    }
    if (!entry) {
      // The folder may have been removed while the service ran; opening the file would then fail.
      try { fileSystem.mkdirSync(logDir, { recursive: true }); } catch { /* the open below reports it */ }
      const created = { date: today, stream: null, failure: null };
      created.stream = fileSystem.createWriteStream(path.join(logDir, `${prefix}-${today}.log`), { flags: 'a' });
      // Without a listener an 'error' event would end the process. The error is kept so that
      // writes waiting on this stream are rejected with the real cause.
      created.stream.on('error', (error) => { created.failure = error || new Error('log stream error'); });
      open.set(prefix, created);
      entry = created;
    }
    return entry;
  }

  /**
   * Append one line to today's file for the prefix.
   * @param {string} prefix e.g. "print", "ingestion", "access", "error"
   * @param {string} line Complete line including its line break.
   * @returns {Promise<void>} Resolves when the line was written; rejects with the write error.
   */
  function write(prefix, line) {
    return new Promise((resolve, reject) => {
      let entry;
      try {
        entry = entryFor(prefix);
        entry.stream.write(line, (error) => {
          // The callback of a write that was waiting on a failed stream may only say that the
          // stream is gone; the stream itself knows the cause.
          const failure = entry.failure || entry.stream.errored || error;
          if (failure) {
            entry.failure = failure;
            reject(failure);
          } else {
            resolve();
          }
        });
      } catch (error) {
        if (entry) entry.failure = error;
        reject(error);
      }
    });
  }

  /** Last resort when a log line cannot be written to its file. Never throws. */
  function toStderr(text) {
    try { stderr.write(text.endsWith('\n') ? text : `${text}\n`); } catch { /* nothing left to try */ }
  }

  /**
   * Write a line that must not be lost quietly (an error-log line). When the file cannot be
   * written, the line goes to standard error instead. Never rejects and never throws.
   * @param {string} prefix
   * @param {string} line
   * @returns {Promise<boolean>} true when the line reached the file.
   */
  async function writeOrStderr(prefix, line) {
    try {
      await write(prefix, line);
      return true;
    } catch (error) {
      toStderr(`[${prefix} log not writable: ${describeWriteError(error).code}] ${line}`);
      return false;
    }
  }

  /**
   * Write a line whose loss is tolerable (an access-log line). A failure is noted on standard
   * error at most once a minute per file. Returns nothing and never throws.
   * @param {string} prefix
   * @param {string} line
   */
  function writeBestEffort(prefix, line) {
    write(prefix, line).catch((error) => {
      const time = now().getTime();
      if (time - (lastNoted.get(prefix) ?? -Infinity) < 60_000) return;
      lastNoted.set(prefix, time);
      toStderr(`[${prefix} log not writable: ${describeWriteError(error).code}] lines are being lost; noted at most once a minute.`);
    });
  }

  /** Close every open file (for a clean shutdown and for tests). */
  function closeAll() {
    for (const entry of open.values()) close(entry);
    open.clear();
  }

  return { write, writeOrStderr, writeBestEffort, toStderr, closeAll };
}

/**
 * What to put in the error log about a failed write: the error code and message, never the
 * record that could not be written.
 * @param {*} error
 * @returns {{ code: string, message: string }}
 */
export function describeWriteError(error) {
  return {
    code: String(error?.code || error?.name || 'Error'),
    message: String(error?.message || error || 'unknown error'),
  };
}
