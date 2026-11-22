// @vitest-environment node
// File: server/__tests__/rollingLog.test.js
/** The rotating log files on a real temporary folder: outcome, order, rotation and recovery. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRollingLog, describeWriteError } from '../rollingLog.js';

let dir;
let log;
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-rolling-log-'));
});

afterEach(async () => {
  log?.closeAll();
  log = undefined;
  // Give the closed streams a moment to release their files (Windows).
  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('createRollingLog', () => {
  it('resolves when the line is in the file', async () => {
    log = createRollingLog({ logDir: dir, now: () => new Date('2026-03-04T10:00:00Z') });
    await log.write('print', 'one\n');
    expect(read('print-2026-03-04.log')).toBe('one\n');
  });

  it('keeps the order of lines written at the same time', async () => {
    log = createRollingLog({ logDir: dir, now: () => new Date('2026-03-04T10:00:00Z') });
    const lines = Array.from({ length: 500 }, (_unused, index) => `line ${index}\n`);
    await Promise.all(lines.map((line) => log.write('print', line)));
    expect(read('print-2026-03-04.log')).toBe(lines.join(''));
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
    log = createRollingLog({ logDir: blocked, now: () => new Date('2026-03-04T10:00:00Z') });

    const failure = await log.write('print', 'lost\n').then(() => null, (error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(describeWriteError(failure).code).toMatch(/^E[A-Z]+$/);
    // A second attempt while the fault remains fails too, instead of vanishing.
    await expect(log.write('print', 'lost too\n')).rejects.toBeInstanceOf(Error);

    // The fault is remedied: the next write opens the file again and succeeds.
    fs.rmSync(blocked);
    await log.write('print', 'kept\n');
    expect(fs.readFileSync(path.join(blocked, 'print-2026-03-04.log'), 'utf8')).toBe('kept\n');
  });

  it('creates the log folder again when it was removed while running', async () => {
    const folder = path.join(dir, 'logs');
    log = createRollingLog({ logDir: folder, now: () => new Date('2026-03-04T10:00:00Z') });
    await log.write('print', 'first\n');
    log.closeAll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await log.write('print', 'second\n');
    expect(fs.readFileSync(path.join(folder, 'print-2026-03-04.log'), 'utf8')).toBe('second\n');
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
    log = blockedLog({ write: (text) => written.push(text) }, () => new Date('2026-03-04T10:00:00Z'));
    await expect(log.writeOrStderr('error', '{"event":"x"}\n')).resolves.toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('{"event":"x"}');
    expect(written[0]).toMatch(/error log not writable: E[A-Z]+/);
  });

  it('writeOrStderr does not throw when standard error cannot be written either', async () => {
    log = blockedLog({ write: () => { throw new Error('stderr closed'); } }, () => new Date('2026-03-04T10:00:00Z'));
    await expect(log.writeOrStderr('error', 'line\n')).resolves.toBe(false);
  });

  it('writeOrStderr reports true when the line reached the file', async () => {
    log = createRollingLog({ logDir: dir, now: () => new Date('2026-03-04T10:00:00Z') });
    await expect(log.writeOrStderr('error', 'line\n')).resolves.toBe(true);
    expect(read('error-2026-03-04.log')).toBe('line\n');
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
