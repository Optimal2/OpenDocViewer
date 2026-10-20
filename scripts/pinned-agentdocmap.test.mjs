import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'vitest';
import { verifyAgentDocMapRevision } from './agent-docs-environment.mjs';
import { resolvePinnedAgentDocMap } from './pinned-agentdocmap.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-pinned-agentdocmap-'));
  tempRoots.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=ODV Test', '-c', 'user.email=odv-test@example.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout).trim();
}

function commitCli(repo, marker) {
  fs.writeFileSync(path.join(repo, 'src', 'cli.js'), `// ${marker}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', marker);
  return git(repo, 'rev-parse', 'HEAD');
}

// A minimal AgentDocMap stand-in: src/cli.js, a dependency-free lockfile, and an
// ignored node_modules like a real checkout. Returns the pinned and a newer commit.
function fakeAgentDocMap() {
  const root = tempDir();
  const repo = path.join(root, 'AgentDocMap');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'agentdocmap' } } }));
  const pinned = commitCli(repo, 'pinned');
  const newer = commitCli(repo, 'newer');
  return { root, repo, pinned, newer, cacheRoot: path.join(root, 'cache') };
}

function fakeInstall(calls) {
  return (dir) => {
    calls.push(dir);
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: {} }));
  };
}

test('a sibling checkout at another commit resolves to a worktree of the pinned commit', () => {
  const fake = fakeAgentDocMap();
  const installs = [];
  const resolved = resolvePinnedAgentDocMap(fake.repo, fake.pinned, { cacheRoot: fake.cacheRoot, install: fakeInstall(installs) });

  assert.equal(resolved.source, 'created');
  assert.equal(resolved.root, path.join(fake.cacheRoot, fake.pinned));
  assert.equal(verifyAgentDocMapRevision(resolved.root, fake.pinned), fake.pinned);
  assert.equal(fs.readFileSync(path.join(resolved.root, 'src', 'cli.js'), 'utf8'), '// pinned\n');
  assert.equal(installs.length, 1, 'dependencies are installed in the worktree');
  assert.ok(!installs[0].startsWith(fake.repo), 'npm ci never runs in the sibling checkout');
  // The sibling checkout itself is untouched.
  assert.equal(git(fake.repo, 'rev-parse', 'HEAD'), fake.newer);
  assert.equal(git(fake.repo, 'status', '--porcelain'), '');
  assert.ok(!fs.existsSync(path.join(fake.repo, 'node_modules')));
  // Only the final worktree remains; the staging directory is gone.
  assert.deepEqual(fs.readdirSync(fake.cacheRoot), [fake.pinned]);

  const again = resolvePinnedAgentDocMap(fake.repo, fake.pinned, { cacheRoot: fake.cacheRoot, install: fakeInstall(installs) });
  assert.deepEqual(again, { root: resolved.root, source: 'reused' });
  assert.equal(installs.length, 1, 'a reused worktree with matching dependencies is not reinstalled');
});

test('a clean sibling checkout at the pinned commit is used directly', () => {
  const fake = fakeAgentDocMap();
  git(fake.repo, 'checkout', '--quiet', '--detach', fake.pinned);
  const installs = [];
  const resolved = resolvePinnedAgentDocMap(fake.repo, fake.pinned, { cacheRoot: fake.cacheRoot, install: fakeInstall(installs) });
  assert.deepEqual(resolved, { root: fake.repo, source: 'checkout' });
  assert.equal(installs.length, 0);
  assert.ok(!fs.existsSync(fake.cacheRoot));
});

test('tracked modifications at the pinned commit also run the clean pinned worktree', () => {
  const fake = fakeAgentDocMap();
  git(fake.repo, 'checkout', '--quiet', '--detach', fake.pinned);
  fs.writeFileSync(path.join(fake.repo, 'src', 'cli.js'), '// local edit\n');
  const resolved = resolvePinnedAgentDocMap(fake.repo, fake.pinned, { cacheRoot: fake.cacheRoot, install: fakeInstall([]) });
  assert.equal(resolved.source, 'created');
  assert.equal(fs.readFileSync(path.join(resolved.root, 'src', 'cli.js'), 'utf8'), '// pinned\n');
  assert.equal(fs.readFileSync(path.join(fake.repo, 'src', 'cli.js'), 'utf8'), '// local edit\n');
});

test('worktrees of other revisions are removed once stale', () => {
  const fake = fakeAgentDocMap();
  const install = fakeInstall([]);
  const old = resolvePinnedAgentDocMap(fake.repo, fake.pinned, { cacheRoot: fake.cacheRoot, install });
  git(fake.repo, 'checkout', '--quiet', '--detach', fake.pinned);
  const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const resolved = resolvePinnedAgentDocMap(fake.repo, fake.newer, { cacheRoot: fake.cacheRoot, install, now: later });
  assert.equal(resolved.root, path.join(fake.cacheRoot, fake.newer));
  assert.ok(!fs.existsSync(old.root), 'the stale worktree directory is removed');
  assert.equal(git(fake.repo, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 2);
});

test('a pinned commit missing from the object store fails with an actionable message', () => {
  const fake = fakeAgentDocMap();
  assert.throws(
    () => resolvePinnedAgentDocMap(fake.repo, 'f'.repeat(40), { cacheRoot: fake.cacheRoot, install: fakeInstall([]) }),
    /pinned AgentDocMap commit f{40} is not in .* could not be fetched from origin/s,
  );
  assert.equal(git(fake.repo, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});
