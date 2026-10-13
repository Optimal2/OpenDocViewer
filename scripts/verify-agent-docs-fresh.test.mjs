import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'vitest';
import { findAgentDocsDrift, formatDrift, isFresh } from './verify-agent-docs-fresh.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A throwaway repository whose HEAD holds a two-file docs-agent/ packet, a
// gitignore rule and one file outside the packet.
function repoWithPacket({ autocrlf = 'false' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-agent-docs-fresh-'));
  tempRoots.push(root);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '-q');
  git('config', 'core.autocrlf', autocrlf);
  git('config', 'core.safecrlf', 'false');
  write(root, '.gitignore', '*.tmp\n');
  write(root, 'docs-agent/REPORT.md', 'fresh report\nsecond line\n');
  write(root, 'docs-agent/chunks/src.md', 'fresh chunk\n');
  write(root, 'src/app.js', 'export {};\n');
  git('add', '.');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'packet');
  return { root, git };
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('a clean checkout is fresh', () => {
  const { root } = repoWithPacket();
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift, { staged: [], worktree: [], untracked: [] });
  assert.ok(isFresh(drift));
});

test('an untracked file under docs-agent is rejected, also in a subdirectory', () => {
  const { root } = repoWithPacket();
  write(root, 'docs-agent/NEW.md', 'new generator output\n');
  write(root, 'docs-agent/chunks/new.md', 'new chunk\n');
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.untracked.sort(), ['docs-agent/NEW.md', 'docs-agent/chunks/new.md']);
  assert.ok(!isFresh(drift));
  assert.match(formatDrift(drift), /Untracked files under docs-agent\/[\s\S]*\?\tdocs-agent\/NEW\.md/);
});

test('a gitignored file under docs-agent is rejected too', () => {
  const { root, git } = repoWithPacket();
  write(root, 'docs-agent/cache.tmp', 'ignored output\n');
  assert.equal(git('status', '--porcelain', '--', 'docs-agent'), '', 'git status hides the ignored file');
  assert.deepEqual(findAgentDocsDrift(root).untracked, ['docs-agent/cache.tmp']);
});

test('a deleted tracked file is rejected', () => {
  const { root } = repoWithPacket();
  fs.rmSync(path.join(root, 'docs-agent/REPORT.md'));
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.worktree, [{ status: 'D', path: 'docs-agent/REPORT.md' }]);
  assert.deepEqual(drift.staged, []);
});

test('a staged deletion is rejected even when nothing is left in the working tree', () => {
  const { root, git } = repoWithPacket();
  git('rm', '-q', 'docs-agent/REPORT.md');
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.staged, [{ status: 'D', path: 'docs-agent/REPORT.md' }]);
  assert.deepEqual(drift.worktree, [{ status: 'D', path: 'docs-agent/REPORT.md' }]);
});

test('staged stale content is rejected after the working tree is regenerated to HEAD', () => {
  const { root, git } = repoWithPacket();
  write(root, 'docs-agent/REPORT.md', 'stale report\n');
  git('add', 'docs-agent/REPORT.md');
  write(root, 'docs-agent/REPORT.md', 'fresh report\nsecond line\n');
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.staged, [{ status: 'M', path: 'docs-agent/REPORT.md' }]);
  assert.deepEqual(drift.worktree, []);
  assert.deepEqual(drift.untracked, []);
  assert.match(formatDrift(drift), /Staged changes under docs-agent\//);
});

test('fresh output staged on top of a stale HEAD is rejected (the old index-relative diff accepted it)', () => {
  const { root, git } = repoWithPacket();
  write(root, 'docs-agent/REPORT.md', 'regenerated report\n');
  git('add', 'docs-agent/REPORT.md');
  assert.equal(
    spawnSync('git', ['-C', root, 'diff', '--exit-code', '--', 'docs-agent']).status,
    0,
    'git diff -- docs-agent (working tree vs index) sees nothing',
  );
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.staged, [{ status: 'M', path: 'docs-agent/REPORT.md' }]);
  assert.deepEqual(drift.worktree, [{ status: 'M', path: 'docs-agent/REPORT.md' }]);
});

test('a new file that is only staged is reported as added', () => {
  const { root, git } = repoWithPacket();
  write(root, 'docs-agent/NEW.md', 'new\n');
  git('add', 'docs-agent/NEW.md');
  const drift = findAgentDocsDrift(root);
  assert.deepEqual(drift.staged, [{ status: 'A', path: 'docs-agent/NEW.md' }]);
  assert.deepEqual(drift.worktree, [{ status: 'A', path: 'docs-agent/NEW.md' }]);
  assert.deepEqual(drift.untracked, []);
});

test('staged, modified and untracked files outside docs-agent are not rejected', () => {
  const { root, git } = repoWithPacket();
  write(root, 'src/app.js', 'export const staged = 1;\n');
  git('add', 'src/app.js');
  write(root, 'src/app.js', 'export const unstaged = 2;\n');
  write(root, 'src/new.js', 'untracked\n');
  write(root, 'notes.tmp', 'ignored\n');
  write(root, 'docs-agent-notes.md', 'sibling with a shared prefix\n');
  assert.ok(isFresh(findAgentDocsDrift(root)));
});

test('LF output in a CRLF (core.autocrlf=true) checkout is fresh, as git diff already treats it', () => {
  const { root, git } = repoWithPacket({ autocrlf: 'true' });
  fs.rmSync(path.join(root, 'docs-agent'), { recursive: true });
  git('checkout', '--', 'docs-agent');
  assert.match(fs.readFileSync(path.join(root, 'docs-agent/REPORT.md'), 'utf8'), /\r\n/, 'checkout wrote CRLF');
  write(root, 'docs-agent/REPORT.md', 'fresh report\nsecond line\n');
  assert.ok(isFresh(findAgentDocsDrift(root)));
});

test('both freshness gates run the shared comparison after regeneration', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/agent-docs.yml', import.meta.url), 'utf8');
  const localCi = fs.readFileSync(new URL('./local-ci.ps1', import.meta.url), 'utf8');
  for (const [name, source, generate, verify] of [
    ['agent-docs.yml', workflow, 'run: npm run doc:agent', 'run: node scripts/verify-agent-docs-fresh.mjs'],
    ['local-ci.ps1', localCi, '& npm run doc:agent', '& node scripts/verify-agent-docs-fresh.mjs'],
  ]) {
    const generateAt = source.indexOf(generate);
    const verifyAt = source.indexOf(verify);
    assert.ok(generateAt >= 0, `${name} regenerates docs-agent`);
    assert.ok(verifyAt > generateAt, `${name} runs the shared comparison after regeneration`);
    assert.doesNotMatch(source, /git diff --exit-code -- docs-agent/, `${name} no longer uses the index-relative diff`);
  }
});
