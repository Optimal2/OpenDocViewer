// File: server/rollingLog.js
/**
 * Daily rotating log files for the log servers, with a write that reports its outcome.
 *
 * A record must never be answered as stored when it is not in its log file. `write` therefore
 * resolves only when the line has been written AND the file it was written to is still the file
 * at the log file's path. It rejects otherwise, at the latest when the write timeout runs out.
 *
 * - After each write the path is compared with the open file (device and file number). If the
 *   file was removed, moved or replaced while the service ran (also together with its folder),
 *   the open file is closed, the file is opened again at the path and the line is written there
 *   before `write` resolves. A line is never acknowledged from a file that is no longer at the
 *   path. If an outside tool moved the old file away, the line may exist in both files.
 * - No fsync per line: a write is complete when the operating system has accepted it, as it
 *   was before, so a successful write costs one extra `stat`. What the operating system has
 *   accepted but not yet stored can still be lost in a crash or a power failure, and a file
 *   removed after the check is not noticed until the next write.
 * - Lines keep their order: the writes of one file run one after the other, in the order of
 *   the calls, also when several requests write at the same time.
 * - A file whose write failed or timed out is dropped and opened again by the next write, so
 *   one fault (a full disk, a hung share) does not make every later line disappear silently.
 *   A write that timed out starts nothing more, and a file it was still opening is closed when
 *   that open returns. Only an append that the operating system already has cannot be taken
 *   back: it may still land, after lines written since.
 *   If the file then does not end with a line break, because part of a line reached it, the
 *   next line starts on a new line.
 * - The file name follows the UTC date; on a new day the next write opens the new file.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LOG_WRITE_TIMEOUT_MS = 10_000;

const utcDate = (date) => date.toISOString().slice(0, 10);

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Read the write timeout from an environment value: a whole number of milliseconds from 100 to
 * 600000. Anything else, or nothing, gives the default; `warning` then says so when a value was
 * given.
 * @param {(string|undefined)} raw
 * @returns {{ timeoutMs: number, warning: (string|null) }}
 */
export function resolveLogWriteTimeoutMs(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { timeoutMs: DEFAULT_LOG_WRITE_TIMEOUT_MS, warning: null };
  if (/^[0-9]{3,6}$/.test(text) && Number(text) >= 100 && Number(text) <= 600_000) {
    return { timeoutMs: Number(text), warning: null };
  }
  return {
    timeoutMs: DEFAULT_LOG_WRITE_TIMEOUT_MS,
    warning: `LOG_WRITE_TIMEOUT_MS is not a whole number of milliseconds from 100 to 600000. Using the default of ${DEFAULT_LOG_WRITE_TIMEOUT_MS}.`,
  };
}

/**
 * @param {{ logDir: string, now: (function(): Date|undefined), stderr: ({write: function(string): *}|undefined), fileSystem: (Object|undefined), writeTimeoutMs: (number|undefined) }} options
 */
export function createRollingLog({
  logDir, now = () => new Date(), stderr = process.stderr, fileSystem = fs, writeTimeoutMs = DEFAULT_LOG_WRITE_TIMEOUT_MS,
}) {
  const files = fileSystem.promises;
  /** @type {Map<string, { date: string, file: string, handle: *, dev: *, ino: *, needsLineBreak: boolean, dropped: boolean }>} */
  const open = new Map();
  /** One chain of writes per file, so that lines keep the order of the calls. @type {Map<string, Promise<*>>} */
  const tails = new Map();
  /** @type {Map<string, number>} */
  const lastNoted = new Map();

  /** Stop using an open file. The close is not waited for when the file may be hung. */
  async function drop(prefix, entry, { waitForClose = true } = {}) {
    if (!entry || entry.dropped) return;
    entry.dropped = true;
    if (open.get(prefix) === entry) open.delete(prefix);
    const closing = Promise.resolve().then(() => entry.handle.close()).catch(() => { /* already closed or gone */ });
    if (waitForClose) await closing;
  }

  /** Thrown inside a write that was given up; its caller has been answered already. */
  const givenUp = () => codedError('ELOGTIMEOUT', 'the log write was given up');

  /**
   * The open file for the prefix, opening it when needed. `state.abandoned` is checked after
   * every step that waits: a write that was given up never makes its file the one in use, and
   * a file that opens after that is closed again at once.
   */
  async function entryFor(prefix, state) {
    const today = utcDate(now());
    let entry = open.get(prefix);
    if (entry && entry.date !== today) {
      await drop(prefix, entry);
      entry = undefined;
    }
    if (state.abandoned) throw givenUp();
    if (entry) return entry;

    const file = path.join(logDir, `${prefix}-${today}.log`);
    // The folder may have been removed while the service ran; opening the file would then fail.
    try { await files.mkdir(logDir, { recursive: true }); } catch { /* the open below reports it */ }
    if (state.abandoned) throw givenUp();
    // "a+": append, and allow reading the last byte below.
    const handle = await files.open(file, 'a+');
    const created = { date: today, file, handle, dev: null, ino: null, needsLineBreak: false, dropped: false };
    const closeUnused = () => Promise.resolve().then(() => handle.close()).catch(() => { /* already closed or gone */ });
    if (state.abandoned) {
      // The open came back after the write was given up (a disk that hung and recovered).
      await closeUnused();
      throw givenUp();
    }
    try {
      const stat = await handle.stat({ bigint: true });
      created.dev = stat.dev;
      created.ino = stat.ino;
      if (stat.size > 0n) {
        // Part of a line may have reached the file before an earlier write failed.
        const last = Buffer.alloc(1);
        const { bytesRead } = await handle.read(last, 0, 1, stat.size - 1n);
        created.needsLineBreak = bytesRead === 1 && last[0] !== 0x0a;
      }
    } catch (error) {
      await closeUnused();
      throw error;
    }
    if (state.abandoned) {
      await closeUnused();
      throw givenUp();
    }
    open.set(prefix, created);
    return created;
  }

  /** Whether the file at the path is still the open file. */
  async function isAtPath(entry) {
    try {
      const stat = await files.stat(entry.file, { bigint: true });
      return stat.dev === entry.dev && stat.ino === entry.ino;
    } catch {
      return false;
    }
  }

  /** Write one line and confirm that it is in the file at the log file's path. */
  async function appendConfirmed(prefix, line, state) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entry = await entryFor(prefix, state);
      state.entry = entry;
      // Given up while the file was being opened: do not start writing.
      if (state.abandoned) throw givenUp();
      try {
        await entry.handle.appendFile((entry.needsLineBreak ? '\n' : '') + line, 'utf8');
        entry.needsLineBreak = false;
      } catch (error) {
        await drop(prefix, entry);
        throw error;
      }
      if (await isAtPath(entry)) return;
      // Removed, moved or replaced while it was open: the line is not in the file at the path.
      // Close first (a removed file blocks its name on Windows until it is closed), then write
      // the line to the file at the path.
      await drop(prefix, entry);
      // Given up in the meantime: no second attempt.
      if (state.abandoned) throw givenUp();
    }
    throw codedError('ELOGFILEGONE', 'the log file was removed or replaced while the record was written');
  }

  /**
   * Append one line to today's file for the prefix.
   * @param {string} prefix e.g. "print", "ingestion", "access", "error"
   * @param {string} line Complete line including its line break.
   * @returns {Promise<void>} Resolves when the line is in the file at the log file's path;
   *   rejects with the cause, or with code ELOGTIMEOUT when the timeout runs out first.
   */
  function write(prefix, line) {
    const deadline = Date.now() + writeTimeoutMs;
    const task = () => new Promise((resolve, reject) => {
      const remaining = deadline - Date.now();
      const timeoutError = () => codedError('ELOGTIMEOUT', `the log write was not confirmed within ${writeTimeoutMs} ms`);
      // Waited too long behind other writes: do not start, the caller has been answered already.
      if (remaining <= 0) { reject(timeoutError()); return; }
      const state = { entry: null, abandoned: false };
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // The file may be hung. The write is given up: it starts no further step (no open, no
        // write, no second attempt), a file it is still opening is closed when the open
        // returns, and the file it had in use is dropped so that the next write opens the file
        // again. One thing cannot be taken back: an append that the operating system already
        // has. If that append completes later, its line is in the file although the caller
        // was answered with a failure, and it may come after lines written since.
        state.abandoned = true;
        drop(prefix, state.entry, { waitForClose: false });
        reject(timeoutError());
      }, remaining);
      appendConfirmed(prefix, line, state).then(
        () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } },
        (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } },
      );
    });
    const result = (tails.get(prefix) ?? Promise.resolve()).then(task, task);
    tails.set(prefix, result.catch(() => { /* the caller has the outcome */ }));
    return result;
  }

  /** Last resort when a log line cannot be written to its file. Never throws. */
  function toStderr(text) {
    try { stderr.write(text.endsWith('\n') ? text : `${text}\n`); } catch { /* nothing left to try */ }
  }

  /**
   * Write a line that must not be lost quietly (an error-log line). When the file cannot be
   * written, or not within the timeout, the line goes to standard error instead. Never rejects
   * and never throws.
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
  async function closeAll() {
    await Promise.all([...open.entries()].map(([prefix, entry]) => drop(prefix, entry)));
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
