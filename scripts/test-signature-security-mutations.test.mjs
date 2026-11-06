/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repoRoot, 'scripts/test-signature-security-mutations.mjs');
const sources = {
  'src/utils/pdfSignatures.js': 'return CURVE_OID_TO_POINT_SIZE.get(oidOf(params)) ?? null;\n',
  'src/utils/pdfSignatureInspector.js': 'if (workerRecreations >= MAX_WORKER_RECREATIONS) return null;\n',
  'src/utils/pdfSignatureRevisions.js': '// Inert revision fixture.\n',
  'src/utils/pdfSignatureRenderCheck.js': '// Inert render fixture.\n'
};

function snapshot(root) {
  return Object.keys(sources).map((file) => ({
    file,
    content: readFileSync(join(root, file), 'utf8'),
    mtime: statSync(join(root, file)).mtimeMs
  }));
}

// Every CLI invocation gets its own cwd, script copy, sources and fake test runner.
// Even a future selection regression can only mutate disposable fixture files.
function withFixture(check) {
  const parentBefore = snapshot(repoRoot);
  const root = mkdtempSync(join(process.env.AO_JOB_SCRATCH || tmpdir(), 'signature-mutations-'));
  try {
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    mkdirSync(join(root, 'node_modules/vitest'), { recursive: true });
    copyFileSync(cli, join(root, 'runner.mjs'));
    for (const [file, content] of Object.entries(sources)) {
      writeFileSync(join(root, file), content);
      utimesSync(join(root, file), 1600000000, 1600000000);
    }
    writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `
import { appendFileSync, readFileSync } from 'node:fs';
const name = process.argv.at(-1);
const baseline = name === 'F[1-57]' || name === 'F[68]';
const changed = baseline
  ? Object.keys(${JSON.stringify(sources)}).every(file => readFileSync(file, 'utf8') === 'synthetic baseline\\n')
  : readFileSync(process.env.EXPECT_FILE, 'utf8') === process.env.EXPECT_MUTATION;
appendFileSync('calls.jsonl', JSON.stringify({ args: process.argv.slice(2), changed }) + '\\n');
if (!changed) { console.error('Fixture did not observe expected mutation'); process.exit(2); }
if (process.env.SURVIVE === name) { console.log('Tests 1 passed'); process.exit(0); }
console.error('AssertionError: synthetic mutation killed');
console.log('Tests 1 failed');
process.exit(1);
`);
    // Supply deterministic historical content without consulting repository history.
    // Other subprocesses, including the fake test runner, execute normally.
    writeFileSync(join(root, 'baseline.mjs'), `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (command !== 'git') return original(command, args, options);
  if (!options.windowsHide) throw new Error('Baseline subprocess must be hidden');
  return { status: 0, stdout: 'synthetic baseline\\n', stderr: '' };
};
syncBuiltinESMExports();
`);
    const before = snapshot(root);
    const run = (only, { baseline = false, ...env } = {}) => {
      const result = spawnSync(process.execPath, [
        ...(baseline ? ['--import', pathToFileURL(join(root, 'baseline.mjs')).href] : []),
        join(root, 'runner.mjs'), `--only=${only}`, ...(baseline ? ['--baseline'] : [])
      ], {
        cwd: root,
        env: { ...process.env, ...env },
        encoding: 'utf8', timeout: 10000, windowsHide: true
      });
      expect(result.error ?? null).toBeNull();
      expect(result.signal).toBeNull();
      return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };
    const calls = () => {
      try { return readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    check({ root, before, run, calls });
  } finally {
    rmSync(root, { recursive: true, force: true });
    expect(snapshot(repoRoot)).toEqual(parentBefore);
  }
}

describe('signature mutation CLI isolation and literal selection', () => {
  it.each(['F[', 'F.+', '^F12$', 'F1|F2', 'ZZZ-no-such-mutation'])(
    'selects nothing and writes no sources for %s', (only) => withFixture(({ root, before, run, calls }) => {
      const result = run(only);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain('All 0 selected mutation groups were killed');
      expect(calls()).toEqual([]);
      expect(snapshot(root)).toEqual(before);
    })
  );

  it.each([
    ['F12', 'src/utils/pdfSignatureInspector.js', 'return null;\n', 'F12'],
    ['(guess the curve from the key)', 'src/utils/pdfSignatures.js', 'return CURVE_OID_TO_POINT_SIZE.get(oidOf(params)) ?? 32;\n', 'row 24b unknown ECDSA curve']
  ])('runs a positive literal selection %s and restores the complete source snapshots', (only, file, mutation, name) => {
    withFixture(({ root, before, run, calls }) => {
      const result = run(only, { EXPECT_FILE: file, EXPECT_MUTATION: mutation });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain('All 1 selected mutation groups were killed');
      expect(calls()).toEqual([{ args: ['run', expect.any(String), '-t', name], changed: true }]);
      expect(snapshot(root)).toEqual(before);
    });
  });

  it('fails when a selected mutation survives and restores the complete source snapshots', () => withFixture(({ root, before, run, calls }) => {
    const result = run('F12', {
      EXPECT_FILE: 'src/utils/pdfSignatureInspector.js', EXPECT_MUTATION: 'return null;\n', SURVIVE: 'F12'
    });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('Expected assertion failure');
    expect(calls()).toHaveLength(1);
    expect(calls()[0].changed).toBe(true);
    expect(snapshot(root)).toEqual(before);
  }));

  it('rejects a missing mutation anchor without writing sources', () => withFixture(({ root, before, run, calls }) => {
    const result = run('F8');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('Mutation F8 no longer matches source');
    expect(calls()).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  }));

  it.each([false, true])('restores complete source snapshots when baseline failure is %s', (fail) => {
    withFixture(({ root, before, run, calls }) => {
      const result = run('F12', {
        baseline: true, EXPECT_FILE: 'src/utils/pdfSignatureInspector.js', EXPECT_MUTATION: 'return null;\n',
        ...(fail ? { SURVIVE: 'F[68]' } : {})
      });
      expect(result.status, result.output).toBe(fail ? 1 : 0);
      expect(calls().map(({ changed }) => changed)).toEqual(fail ? [true, true] : [true, true, true]);
      if (fail) expect(result.output).toContain('Expected assertion failure');
      else expect(result.output).toContain('All 1 selected mutation groups were killed');
      expect(snapshot(root)).toEqual(before);
    });
  });
});
