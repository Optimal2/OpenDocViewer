// File: tests/ui/signature-first-check-fixture-child.mjs
/**
 * Intentional failures executed only by signature-first-check-harness.regression.mjs.
 * Each child merely holds a timer open; neither test generates CPU load.
 */
import { once } from 'node:events';
import { test } from './support/first-check-processes.mjs';

const IDLE_CHILD = ['--eval', 'setTimeout(() => {}, 60000)'];

test('owned child exits after a forced test-body failure', async ({ ownedProcesses }) => {
  const child = ownedProcesses.spawn(IDLE_CHILD);
  await once(child, 'spawn');
  throw new Error('Intentional regression failure: fixture teardown must still run');
});

test('owned child exits after a forced test timeout', async ({ ownedProcesses }) => {
  test.setTimeout(250);
  const child = ownedProcesses.spawn(IDLE_CHILD);
  await once(child, 'spawn');
  await new Promise((resolve) => setTimeout(resolve, 60000));
});
