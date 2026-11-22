// File: scripts/release-script.test.mjs
/**
 * Runs the Pester tests for the decision logic of release.ps1 (scripts/release.Tests.ps1) as
 * part of the Vitest suite. release.ps1 itself is never run: the Pester file loads its function
 * definitions from the syntax tree only. Needs Pester 5 or later; a missing Pester fails the
 * test instead of skipping it, so a gate that cannot run never reads as passing.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'run-release-tests.ps1');

test('release.ps1 decision logic passes its Pester tests', async () => {
  const result = await new Promise((resolve) => {
    execFile(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', runner],
      { encoding: 'utf8', timeout: 240_000, windowsHide: true, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } },
      (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, output: stdout + stderr });
      },
    );
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /RELEASE-TESTS passed=\d+ failed=0/, result.output);
  const passed = Number(/RELEASE-TESTS passed=(\d+)/.exec(result.output)[1]);
  assert.ok(passed >= 30, `only ${passed} Pester tests ran:\n${result.output}`);
}, 300_000);
