// Freshness comparison for the committed docs-agent/ packet. Run it right after
// `npm run doc:agent`; it is the last step of .github/workflows/agent-docs.yml
// and of scripts/local-ci.ps1 step 4, so both sides apply the same rule.
//
// The rule: after regeneration, docs-agent/ in the working tree, in the index and
// in HEAD must be the same set of files with the same bytes. Three git queries
// cover staged/path changes; a raw blob comparison also bypasses clean filters
// and the stat cache. Masking index flags are rejected before comparing.
//
//   staged    `git diff --cached HEAD`  index differs from HEAD (any staged change);
//   worktree  `git diff HEAD`           working tree differs from HEAD (modified,
//                                       deleted, or added to the index only);
//   untracked `git ls-files --others`   files git does not track, INCLUDING
//                                       gitignored ones (no --exclude-standard).
//
// A fresh CI checkout has index == HEAD and no untracked files before the
// generator runs, so there the staged list is always empty and the other two
// reduce to "the generator output equals HEAD". Locally the same three queries
// compare against HEAD as well, so a staged change can no longer move the base.
// See docs-src/agent-documentation.md ("Freshness comparison").

import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DOCS_DIR = 'docs-agent';

function git(repoRoot, args) {
  // Silence checkout-conversion warnings. Raw blob checks below, not Git's
  // filtered diff or stat cache, enforce byte equality with HEAD.
  const result = spawnSync('git', ['-c', 'core.quotepath=off', '-c', 'core.safecrlf=false', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Failed to run git ${args.join(' ')}: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited with code ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function parseNameStatus(output) {
  const fields = output.split('\0').filter((field) => field !== '');
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    entries.push({ status: fields[i], path: fields[i + 1] });
  }
  return entries;
}

/**
 * Lists every way docs-agent/ in the working tree or index differs from HEAD.
 * @param {string} repoRoot repository root (the directory that contains docs-agent/)
 * @param {string} [docsDir] directory to compare, relative to repoRoot
 * @returns {{staged: {status: string, path: string}[], worktree: {status: string, path: string}[], untracked: string[]}}
 */
export function findAgentDocsDrift(repoRoot, docsDir = DOCS_DIR) {
  const pathspec = ['--', docsDir];
  const masked = git(repoRoot, ['ls-files', '-v', '-z', ...pathspec])
    .split('\0')
    .filter((entry) => entry && (entry[0] === 'S' || /[a-z]/.test(entry[0])));
  if (masked.length > 0) {
    throw new Error(
      `Unsupported index flags under ${docsDir}/ (skip-worktree or assume-unchanged):\n` +
        masked.map((entry) => `  ${entry}`).join('\n') +
        '\nClear these flags with git update-index --no-skip-worktree / --no-assume-unchanged before checking freshness.',
    );
  }
  const worktree = parseNameStatus(git(repoRoot, ['diff', '--no-renames', '--name-status', '-z', 'HEAD', ...pathspec]));
  const objectFormat = git(repoRoot, ['rev-parse', '--show-object-format']).trim();
  for (const entry of git(repoRoot, ['ls-tree', '-r', '-z', 'HEAD', ...pathspec]).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    const file = entry.slice(tab + 1);
    // Generated docs must be ordinary files, never links or submodules.
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error(`Unsupported generated documentation entry: ${file} (${mode} ${type}).`);
    }
    let status;
    try {
      const diskPath = path.join(repoRoot, file);
      if (!fs.lstatSync(diskPath).isFile()) {
        status = 'M';
      } else {
        const bytes = fs.readFileSync(diskPath);
        const actual = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (actual !== oid) status = 'M';
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      status = 'D';
    }
    if (status && !worktree.some((change) => change.path === file)) worktree.push({ status, path: file });
  }
  return {
    staged: parseNameStatus(git(repoRoot, ['diff', '--cached', '--no-renames', '--name-status', '-z', 'HEAD', ...pathspec])),
    worktree,
    untracked: git(repoRoot, ['ls-files', '--others', '-z', ...pathspec])
      .split('\0')
      .filter((entry) => entry !== ''),
  };
}

/**
 * True when nothing under docs-agent/ differs from HEAD.
 * @param {ReturnType<typeof findAgentDocsDrift>} drift
 */
export function isFresh(drift) {
  return drift.staged.length === 0 && drift.worktree.length === 0 && drift.untracked.length === 0;
}

/**
 * Human-readable report of the drift, one section per rejected state.
 * @param {ReturnType<typeof findAgentDocsDrift>} drift
 * @param {string} [docsDir]
 * @returns {string}
 */
export function formatDrift(drift, docsDir = DOCS_DIR) {
  const lines = [];
  if (drift.staged.length > 0) {
    lines.push(`Staged changes under ${docsDir}/ (index differs from HEAD; the gate checks HEAD, which is what gets pushed):`);
    lines.push(...drift.staged.map((entry) => `  ${entry.status}\t${entry.path}`));
  }
  if (drift.worktree.length > 0) {
    lines.push(
      `Working tree differs from HEAD (M = different content, D = file in HEAD missing or removed from the index, A = only in the index):`,
    );
    lines.push(...drift.worktree.map((entry) => `  ${entry.status}\t${entry.path}`));
  }
  if (drift.untracked.length > 0) {
    lines.push(`Untracked files under ${docsDir}/ (new generator output not in HEAD, or a gitignored file):`);
    lines.push(...drift.untracked.map((entry) => `  ?\t${entry}`));
  }
  return lines.join('\n');
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const drift = findAgentDocsDrift(repoRoot);
  if (isFresh(drift)) {
    console.log(`${DOCS_DIR}/ is fresh: working tree, index and HEAD agree after regeneration.`);
    return 0;
  }
  console.error(formatDrift(drift));
  console.error(
    `${DOCS_DIR}/ is stale: run 'npm run doc:agent', then 'git add ${DOCS_DIR}' (new and deleted files included) and commit the result.`,
  );
  return 1;
}

// Imports are intentionally quiet (the tests use the exported helpers). Resolve
// both spellings so a junction, symlink or subst entry cannot skip the CLI.
try {
  if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    process.exitCode = main();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
