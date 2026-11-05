/** @vitest-environment node */
// Regression test for the js/regex-injection finding in
// scripts/test-signature-security-mutations.mjs: the `--only` CLI argument must
// be treated as literal text, never compiled with `new RegExp(...)`.
// Every case below selects zero mutations, so the CLI under test never writes
// source files and never spawns mutation runs: the cases stay fast and safe to
// run alongside the rest of the suite.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repoRoot, 'scripts/test-signature-security-mutations.mjs');

function runCli(onlyValue) {
  return spawnSync(process.execPath, [cli, `--only=${onlyValue}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true
  });
}

function expectZeroSelected(onlyValue) {
  const result = runCli(onlyValue);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.error ?? null).toBeNull();
  expect(result.status).toBe(0);
  expect(output).toContain('All 0 selected mutation groups were killed');
}

describe('test-signature-security-mutations --only treats its argument literally', () => {
  it('does not compile an unbalanced character class (F[)', () => {
    // `new RegExp('F[')` throws "Unterminated character class" and exits non-zero.
    expectZeroSelected('F[');
  });

  it('does not interpret dot-plus as a pattern (F.+)', () => {
    // As a regex `F.+` matches F1..F8, F10b and F12 and would run those mutations.
    expectZeroSelected('F.+');
  });

  it('does not interpret anchors as a pattern (^F12$)', () => {
    // As a regex `^F12$` matches the F12 mutation id and would run that mutation.
    expectZeroSelected('^F12$');
  });

  it('does not interpret alternation as a pattern (F1|F2)', () => {
    // As a regex `F1|F2` matches the F1, F10b, F12 and F2 mutation ids.
    expectZeroSelected('F1|F2');
  });

  it('still reports zero selections for plain text that matches nothing', () => {
    expectZeroSelected('ZZZ-no-such-mutation');
  });
});
