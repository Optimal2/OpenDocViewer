// File: tests/ui/support/first-check-processes.mjs
/**
 * Test-scoped ownership for the first-check harness' child processes.
 * Playwright runs fixture teardown after normal returns, failures and timeouts;
 * keeping the children here means no measurement test has to remember cleanup.
 */
import { test as base } from '@playwright/test';
import { spawn } from 'node:child_process';

const EXIT_WAIT_MS = 5000;

/** @param {import('node:child_process').ChildProcess} child */
const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

/** @param {import('node:child_process').ChildProcess} child */
function waitForExit(child) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, EXIT_WAIT_MS);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/**
 * Terminate one owned child and wait until the OS process has exited. A second
 * SIGKILL is attempted before reporting a cleanup failure; teardown never
 * silently leaves a child running.
 * @param {import('node:child_process').ChildProcess} child
 */
export async function stopOwnedProcess(child) {
  if (!hasExited(child)) {
    const exited = waitForExit(child);
    child.kill();
    if (!await exited) {
      const forcedExit = waitForExit(child);
      child.kill('SIGKILL');
      if (!await forcedExit) {
        throw new Error(`Owned child process ${child.pid ?? '(no pid)'} did not exit after two termination attempts`);
      }
    }
  }
  if (!hasExited(child)) {
    throw new Error(`Owned child process ${child.pid ?? '(no pid)'} has no exit status after cleanup`);
  }
}

/** Persisted observations survive a worker restart after a forced timeout. */
export const CLEANUP_REPORT_FILENAME = 'owned-process-cleanup.ndjson';
export const processCleanupReports = new Map();

export const test = base.extend({
  ownedProcesses: async ({}, use, testInfo) => {
    const children = [];
    const spawnOwned = (args) => {
      const child = spawn(process.execPath, args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      children.push(child);
      return child;
    };

    await use({
      spawn: spawnOwned,
      startCpuContention(count) {
        if (!Number.isInteger(count) || count < 1 || count > 32) {
          throw new RangeError('CPU contention requires between 1 and 32 owned processes');
        }
        return Array.from({ length: count }, () => spawnOwned(['--eval', 'while (true) {}']));
      },
    });

    const failures = [];
    await Promise.all(children.map(async (child) => {
      try {
        await stopOwnedProcess(child);
      } catch (error) {
        failures.push(String(error?.message ?? error));
      }
    }));
    const report = {
      title: testInfo.title,
      childCount: children.length,
      allExited: children.every(hasExited),
      children: children.map((child) => ({
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
      })),
    };
    processCleanupReports.set(testInfo.title, report);
    const [{ appendFile }, { join }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
    await appendFile(join(testInfo.project.outputDir, CLEANUP_REPORT_FILENAME), `${JSON.stringify(report)}\n`, 'utf8');
    if (failures.length > 0) throw new Error(failures.join('; '));
  },
});
