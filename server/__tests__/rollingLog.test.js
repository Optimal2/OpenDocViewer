// @vitest-environment node
// File: server/__tests__/rollingLog.test.js
/**
 * The rotating log files on a real temporary folder: outcome, order, rotation, recovery, and
 * what happens when the file or its folder is removed or replaced while it is open.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOG_WRITE_TIMEOUT_MS, createRollingLog, describeWriteError, resolveLogWriteTimeoutMs } from '../rollingLog.js';

const DAY = '2026-03-04';
const at = () => new Date(`${DAY}T10:00:00Z`);
let dir;
let log;
const read = (name, folder = dir) => fs.readFileSync(path.join(folder, name), 'utf8');
const remove = (target) => fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-rolling-log-'));
});

afterEach(async () => {
  await log?.closeAll();
  log = undefined;
  remove(dir);
});

describe('createRollingLog', () => {
  it('resolves when the line is in the file', async () => {
    log = createRollingLog({ logDir: dir, now: at });
    await log.write('print', 'one\n');
    expect(read(`print-${DAY}.log`)).toBe('one\n');
  });

  it('keeps the order of lines written at the same time', async () => {
    log = createRollingLog({ logDir: dir, now: at });
    const lines = Array.from({ length: 500 }, (_unused, index) => `line ${index}\n`);
    await Promise.all(lines.map((line) => log.write('print', line)));
    expect(read(`print-${DAY}.log`)).toBe(lines.join(''));
  });

  it('starts a new file when the UTC date changes', async () => {
    let time = new Date('2026-03-04T23:59:59Z');
    log = createRollingLog({ logDir: dir, now: () => time });
    await log.write('print', 'before midnight\n');
    time = new Date('2026-03-05T00:00:01Z');
    await log.write('print', 'after midnight\n');
    expect(read('print-2026-03-04.log')).toBe('before midnight\n');
    expect(read('print-2026-03-05.log')).toBe('after midnight\n');
  });

  it('rejects with the cause when the file cannot be written, and works again once it can', async () => {
    // A file where the log folder should be: the folder cannot be created and no log file opened.
    const blocked = path.join(dir, 'logs');
    fs.writeFileSync(blocked, 'not a folder');
    log = createRollingLog({ logDir: blocked, now: at });

    const failure = await log.write('print', 'lost\n').then(() => null, (error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(describeWriteError(failure).code).toMatch(/^E[A-Z]+$/);
    // A second attempt while the fault remains fails too, instead of vanishing.
    await expect(log.write('print', 'lost too\n')).rejects.toBeInstanceOf(Error);

    // The fault is remedied: the next write opens the file again and succeeds.
    fs.rmSync(blocked);
    await log.write('print', 'kept\n');
    expect(read(`print-${DAY}.log`, blocked)).toBe('kept\n');
  });
});

// The same for the files of both servers: print (user log), ingestion (system log) and error.
describe.each(['print', 'ingestion', 'error'])('a %s log file that changes under the running service', (prefix) => {
  const name = `${prefix}-${DAY}.log`;

  /**
   * The contract: a write that resolves has its line in the file at the path. A write may also
   * reject (the caller then answers 500). It must never resolve without the line being there.
   */
  async function writeAndCheck(folder, line) {
    const outcome = await log.write(prefix, line).then(() => 'resolved', () => 'rejected');
    if (outcome === 'resolved') {
      expect(fs.existsSync(path.join(folder, name)), 'resolved, but no file at the path').toBe(true);
      expect(read(name, folder), 'resolved, but the line is not in the file at the path').toContain(line);
    }
    return outcome;
  }

  it('never acknowledges a line after the file was removed while open', async () => {
    const folder = path.join(dir, 'logs');
    log = createRollingLog({ logDir: folder, now: at });
    await log.write(prefix, 'first\n');
    remove(path.join(folder, name)); // no closeAll: the service keeps running

    for (let index = 0; index < 20; index += 1) await writeAndCheck(folder, `after removal ${index}\n`);
    // The service recovers by itself: the file is back at the path and takes the lines.
    expect(await writeAndCheck(folder, 'last\n')).toBe('resolved');
    expect(read(name, folder)).not.toContain('first');
  });

  it('never acknowledges a line after the whole log folder was removed while open', async () => {
    const folder = path.join(dir, 'logs');
    log = createRollingLog({ logDir: folder, now: at });
    await log.write(prefix, 'first\n');
    remove(folder);

    for (let index = 0; index < 20; index += 1) await writeAndCheck(folder, `after removal ${index}\n`);
    expect(await writeAndCheck(folder, 'last\n')).toBe('resolved');
  });

  it('writes to the file at the path after the file was replaced by another one', async () => {
    const folder = path.join(dir, 'logs');
    log = createRollingLog({ logDir: folder, now: at });
    await log.write(prefix, 'first\n');
    // What an outside rotation tool does: move the file away and put a new one in its place.
    fs.renameSync(path.join(folder, name), path.join(folder, `${name}.moved`));
    fs.writeFileSync(path.join(folder, name), '');

    expect(await writeAndCheck(folder, 'after replacement\n')).toBe('resolved');
    expect(await writeAndCheck(folder, 'and one more\n')).toBe('resolved');
    expect(read(name, folder)).toBe('after replacement\nand one more\n');
    expect(read(`${name}.moved`, folder)).toContain('first\n');
  });
});

describe('a line after an incomplete one', () => {
  it('starts on a new line when the existing file does not end with a line break', async () => {
    fs.writeFileSync(path.join(dir, `print-${DAY}.log`), '{"complete":1}\n{"part of a li');
    log = createRollingLog({ logDir: dir, now: at });
    await log.write('print', '{"next":2}\n');
    await log.write('print', '{"next":3}\n');
    expect(read(`print-${DAY}.log`)).toBe('{"complete":1}\n{"part of a li\n{"next":2}\n{"next":3}\n');
  });

  it('adds nothing when the existing file ends with a line break, or is empty', async () => {
    fs.writeFileSync(path.join(dir, `print-${DAY}.log`), '{"complete":1}\n');
    fs.writeFileSync(path.join(dir, `error-${DAY}.log`), '');
    log = createRollingLog({ logDir: dir, now: at });
    await log.write('print', '{"next":2}\n');
    await log.write('error', '{"next":2}\n');
    expect(read(`print-${DAY}.log`)).toBe('{"complete":1}\n{"next":2}\n');
    expect(read(`error-${DAY}.log`)).toBe('{"next":2}\n');
  });

  it('starts on a new line after a write that failed part of the way', async () => {
    // A file system whose first write stores half the line and then fails, like a disk that fills up.
    let failNext = true;
    const fileSystem = {
      ...fs,
      promises: {
        ...fs.promises,
        open: async (...args) => {
          const handle = await fs.promises.open(...args);
          const appendFile = handle.appendFile.bind(handle);
          handle.appendFile = async (text, encoding) => {
            if (!failNext) return appendFile(text, encoding);
            failNext = false;
            await appendFile(String(text).slice(0, Math.floor(String(text).length / 2)), encoding);
            throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
          };
          return handle;
        },
      },
    };
    log = createRollingLog({ logDir: dir, now: at, fileSystem });
    await expect(log.write('print', '{"lost":"record"}\n')).rejects.toMatchObject({ code: 'ENOSPC' });
    await log.write('print', '{"kept":"record"}\n');
    const lines = read(`print-${DAY}.log`).split('\n');
    expect(lines).toEqual(['{"lost":"', '{"kept":"record"}', '']);
    expect(JSON.parse(lines[1])).toEqual({ kept: 'record' });
  });
});

describe('a write that is never confirmed', () => {
  /** A file system whose appendFile hangs while `hung` is true. */
  function hangingFileSystem(control) {
    return {
      ...fs,
      promises: {
        ...fs.promises,
        open: async (...args) => {
          const handle = await fs.promises.open(...args);
          const appendFile = handle.appendFile.bind(handle);
          handle.appendFile = (text, encoding) => (control.hung
            ? new Promise((resolve) => { control.release = () => resolve(appendFile(text, encoding)); })
            : appendFile(text, encoding));
          return handle;
        },
      },
    };
  }

  it('rejects with ELOGTIMEOUT when the timeout runs out, also for the writes waiting behind it', async () => {
    const control = { hung: true, release: null };
    log = createRollingLog({ logDir: dir, now: at, fileSystem: hangingFileSystem(control), writeTimeoutMs: 300 });
    const started = Date.now();
    const outcomes = await Promise.all(['a\n', 'b\n', 'c\n'].map((line) => log.write('print', line).then(() => 'resolved', (error) => error.code)));
    expect(outcomes).toEqual(['ELOGTIMEOUT', 'ELOGTIMEOUT', 'ELOGTIMEOUT']);
    // Every caller has its answer about when the timeout runs out, not one timeout after the other.
    expect(Date.now() - started).toBeLessThan(1500);

    // The disk works again: the next write opens the file anew and is confirmed.
    control.hung = false;
    await log.write('print', 'after\n');
    expect(read(`print-${DAY}.log`)).toContain('after\n');

    // The hung write finishing late changes nothing for anyone.
    control.release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await log.write('print', 'later\n');
    expect(read(`print-${DAY}.log`)).toContain('later\n');
  });

  it('writeOrStderr does not wait longer than the timeout either', async () => {
    const control = { hung: true, release: null };
    const written = [];
    log = createRollingLog({
      logDir: dir, now: at, fileSystem: hangingFileSystem(control), writeTimeoutMs: 200, stderr: { write: (text) => written.push(text) },
    });
    const started = Date.now();
    await expect(log.writeOrStderr('error', '{"event":"x"}\n')).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(written.join('')).toContain('ELOGTIMEOUT');
    expect(written.join('')).toContain('{"event":"x"}');
    control.hung = false;
    control.release?.();
  });
});

describe('resolveLogWriteTimeoutMs', () => {
  it.each([[undefined], [''], ['  ']])('uses the default of ten seconds for %j', (raw) => {
    expect(DEFAULT_LOG_WRITE_TIMEOUT_MS).toBe(10_000);
    expect(resolveLogWriteTimeoutMs(raw)).toEqual({ timeoutMs: 10_000, warning: null });
  });

  it.each([['100', 100], ['2500', 2500], ['600000', 600_000]])('takes %j', (raw, timeoutMs) => {
    expect(resolveLogWriteTimeoutMs(raw)).toEqual({ timeoutMs, warning: null });
  });

  it.each([['0'], ['99'], ['600001'], ['-5'], ['1.5'], ['off'], ['ten']])('falls back to the default with a warning for %j', (raw) => {
    const result = resolveLogWriteTimeoutMs(raw);
    expect(result.timeoutMs).toBe(10_000);
    expect(result.warning).toContain('LOG_WRITE_TIMEOUT_MS');
  });
});

describe('writeOrStderr and writeBestEffort', () => {
  const blockedLog = (stderr, now) => {
    const blocked = path.join(dir, 'logs');
    fs.writeFileSync(blocked, 'not a folder');
    return createRollingLog({ logDir: blocked, stderr, now });
  };

  it('writeOrStderr puts the line on standard error when the file cannot be written, and never rejects', async () => {
    const written = [];
    log = blockedLog({ write: (text) => written.push(text) }, at);
    await expect(log.writeOrStderr('error', '{"event":"x"}\n')).resolves.toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('{"event":"x"}');
    expect(written[0]).toMatch(/error log not writable: E[A-Z]+/);
  });

  it('writeOrStderr does not throw when standard error cannot be written either', async () => {
    log = blockedLog({ write: () => { throw new Error('stderr closed'); } }, at);
    await expect(log.writeOrStderr('error', 'line\n')).resolves.toBe(false);
  });

  it('writeOrStderr reports true when the line reached the file', async () => {
    log = createRollingLog({ logDir: dir, now: at });
    await expect(log.writeOrStderr('error', 'line\n')).resolves.toBe(true);
    expect(read(`error-${DAY}.log`)).toBe('line\n');
  });

  it('writeBestEffort notes a failing file on standard error at most once a minute', async () => {
    let time = new Date('2026-03-04T10:00:00Z');
    const written = [];
    log = blockedLog({ write: (text) => written.push(text) }, () => time);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
    log.writeBestEffort('access', 'a\n');
    log.writeBestEffort('access', 'b\n');
    await settle();
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('a\n');
    time = new Date('2026-03-04T10:01:01Z');
    log.writeBestEffort('access', 'c\n');
    await settle();
    expect(written).toHaveLength(2);
  });
});
