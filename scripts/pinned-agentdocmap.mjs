// Resolves a checkout of the AgentDocMap revision pinned in
// scripts/agent-docs-environment.json.
//
// When the AgentDocMap checkout selected by --agentdocmap-root, AGENTDOCMAP_ROOT
// or the sibling lookup is already clean at the pinned commit it is used as is.
// Otherwise a detached git worktree of the pinned commit is created from that
// checkout's object store under a cache directory (OS temp by default), its
// dependencies are installed there with npm ci, and the generator runs from it.
// The selected checkout itself is never switched, reset or installed into; its
// repository only gains the worktree registration. The worktree is reused by
// later runs with the same pin, and worktrees of other revisions that have not
// been used for a day are removed. Moving the pin stays a deliberate commit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyAgentDocMapDependencies } from './agent-docs-environment.mjs';

export const PINNED_CACHE_ENV = 'ODV_AGENTDOCMAP_CACHE';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Default cache directory for pinned AgentDocMap worktrees. */
export function defaultPinnedCacheRoot(env = process.env) {
  return path.resolve(env[PINNED_CACHE_ENV] || path.join(os.tmpdir(), 'odv-agentdocmap-pinned'));
}

function runGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').trim(),
    detail: result.error?.message || String(result.stderr || '').trim(),
  };
}

function git(cwd, args) {
  const result = runGit(cwd, args);
  if (!result.ok) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.detail}`);
  }
  return result.stdout;
}

/**
 * True when `dir` is a git checkout whose HEAD is `revision` without tracked
 * modifications.
 * @param {string} dir
 * @param {string} revision
 */
export function isCleanCheckoutAt(dir, revision) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return false;
  }
  const head = runGit(dir, ['rev-parse', 'HEAD']);
  if (!head.ok || head.stdout !== revision) {
    return false;
  }
  const status = runGit(dir, ['status', '--porcelain', '--untracked-files=no']);
  return status.ok && status.stdout === '';
}

/**
 * Installs AgentDocMap's locked dependencies with npm ci in `root`.
 * @param {string} root
 */
export function npmCi(root) {
  const args = ['ci', '--no-audit', '--no-fund'];
  const npmCli = process.env.npm_execpath;
  const useNpmCli = typeof npmCli === 'string' && /npm-cli\.js$/i.test(npmCli) && fs.existsSync(npmCli);
  const isWindows = process.platform === 'win32';
  const command = useNpmCli ? process.execPath : isWindows ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, useNpmCli ? [npmCli, ...args] : args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    // npm.cmd can only be started through a shell on Windows; the arguments are fixed literals.
    shell: !useNpmCli && isWindows,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`npm ci failed in ${root}: ${result.error?.message || `exit code ${result.status}`}`);
  }
}

function ensureDependencies(root, install) {
  try {
    verifyAgentDocMapDependencies(root);
  } catch {
    install(root);
    verifyAgentDocMapDependencies(root);
  }
}

function removeWorktree(sourceRoot, dir) {
  if (!runGit(sourceRoot, ['worktree', 'remove', '--force', dir]).ok) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  runGit(sourceRoot, ['worktree', 'prune']);
}

function removeStaleWorktrees(sourceRoot, cacheRoot, revision, now) {
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === revision) {
      continue;
    }
    const dir = path.join(cacheRoot, entry.name);
    if (now - fs.statSync(dir).mtimeMs > STALE_AFTER_MS) {
      removeWorktree(sourceRoot, dir);
    }
  }
}

function ensureCommit(sourceRoot, revision) {
  if (runGit(sourceRoot, ['cat-file', '-e', `${revision}^{commit}`]).ok) {
    return;
  }
  const fetched = runGit(sourceRoot, ['fetch', '--quiet', 'origin', revision]);
  if (!fetched.ok || !runGit(sourceRoot, ['cat-file', '-e', `${revision}^{commit}`]).ok) {
    throw new Error(
      `The pinned AgentDocMap commit ${revision} is not in ${sourceRoot} and could not be fetched from origin` +
        `${fetched.ok ? '' : ` (${fetched.detail})`}.\n` +
        `Run "git fetch" in ${sourceRoot}, or point --agentdocmap-root or AGENTDOCMAP_ROOT at a clone that has it.`,
    );
  }
}

/**
 * Returns a clean AgentDocMap checkout at `revision`, creating or reusing a
 * detached worktree of it when `sourceRoot` is at another commit.
 * @param {string} sourceRoot AgentDocMap checkout whose object store provides the commit
 * @param {string} revision pinned full commit SHA
 * @param {{cacheRoot?: string, install?: (root: string) => void, now?: number}} [options]
 * @returns {{root: string, source: 'checkout'|'created'|'reused'}}
 */
export function resolvePinnedAgentDocMap(sourceRoot, revision, options = {}) {
  if (isCleanCheckoutAt(sourceRoot, revision)) {
    return { root: sourceRoot, source: 'checkout' };
  }

  const cacheRoot = path.resolve(options.cacheRoot ?? defaultPinnedCacheRoot());
  const install = options.install ?? npmCi;
  const now = options.now ?? Date.now();
  fs.mkdirSync(cacheRoot, { recursive: true });
  removeStaleWorktrees(sourceRoot, cacheRoot, revision, now);

  const target = path.join(cacheRoot, revision);
  if (fs.existsSync(target)) {
    if (isCleanCheckoutAt(target, revision)) {
      ensureDependencies(target, install);
      fs.utimesSync(target, new Date(now), new Date(now));
      return { root: target, source: 'reused' };
    }
    removeWorktree(sourceRoot, target);
  }

  ensureCommit(sourceRoot, revision);
  // Build in a private staging directory and move it into place, so a run that
  // fails half-way (or races another run) never leaves a half-installed target.
  const staging = path.join(cacheRoot, `${revision}.${process.pid}.${now}`);
  git(sourceRoot, ['worktree', 'add', '--detach', staging, revision]);
  try {
    install(staging);
    verifyAgentDocMapDependencies(staging);
    git(sourceRoot, ['worktree', 'move', staging, target]);
  } catch (error) {
    removeWorktree(sourceRoot, staging);
    if (isCleanCheckoutAt(target, revision)) {
      return { root: target, source: 'reused' };
    }
    throw error;
  }
  return { root: target, source: 'created' };
}
