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

// Names the gate's status letters. The legend is kept in one place so
// formatDrift, the throw messages, and the test that asserts every printable
// letter is documented all stay in lockstep.
export const STATUS_LEGEND = {
  M: 'different content (raw bytes do not match HEAD)',
  D: 'file in HEAD missing on disk, or replaced by a non-regular entry (symlink, directory, fifo)',
  A: 'file only in the index (added but the working tree was emptied before the comparison ran)',
  T: 'type change (symlink on disk where HEAD has a blob, blob where HEAD has a symlink, etc.)',
  U: 'unmerged (a path with merge conflicts left in the working tree or index)',
  X: 'unknown type-change letter emitted by git itself; treat it like T',
  C: 'copy (would only appear without --no-renames; the gate suppresses renames, this row is here for completeness)',
  R: 'rename (suppressed by --no-renames; the gate never prints R, this row documents the suppression)',
};

/**
 * Lists every way docs-agent/ in the working tree or index differs from HEAD.
 * @param {string} repoRoot repository root (the directory that contains docs-agent/)
 * @param {string} [docsDir] directory to compare, relative to repoRoot
 * @returns {{staged: {status: string, path: string}[], worktree: {status: string, path: string}[], untracked: string[]}}
 */
export function findAgentDocsDrift(repoRoot, docsDir = DOCS_DIR) {
  const pathspec = ['--', docsDir];
  const maskedRaw = git(repoRoot, ['ls-files', '-v', '-z', ...pathspec])
    .split('\0')
    .filter((entry) => entry && (entry[0] === 'S' || /[a-z]/.test(entry[0])));
  if (maskedRaw.length > 0) {
    // Distinguish a cone sparse-checkout (which sets the S flag itself) from a
    // manually set --skip-worktree / --assume-unchanged bit. The two causes
    // take different fixes, and a sparse-checkout S flag cannot be cleared with
    // `git update-index --no-skip-worktree`; the user has to edit
    // .git/info/sparse-checkout or run `git sparse-checkout reapply`.
    // `git config --get` exits 1 when the key is not set, so go through
    // spawnSync directly and treat anything non-zero as "not configured".
    const sparseResult = spawnSync(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'core.safecrlf=false', 'config', '--get', 'core.sparseCheckout'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const sparseCheckoutConfig = sparseResult.status === 0 ? sparseResult.stdout.trim() : '';
    const sparseCheckoutOn = sparseCheckoutConfig === 'true' || sparseCheckoutConfig === '1';
    const onlySkipWorktree = maskedRaw.every((entry) => entry[0] === 'S');
    if (sparseCheckoutOn && onlySkipWorktree) {
      throw new Error(
        `Unsupported index flags under ${docsDir}/ (cone sparse-checkout):\n` +
          maskedRaw.map((entry) => `  ${entry}`).join('\n') +
          `\nThe repository uses core.sparseCheckout and the S flag on these entries comes from the cone, not from a manual bit. Either remove ${docsDir}/ from .git/info/sparse-checkout (or run 'git sparse-checkout reapply') so the entries become ordinary blobs, or disable sparse-checkout with 'git config core.sparseCheckout false'.`,
      );
    }
    throw new Error(
      `Unsupported index flags under ${docsDir}/ (skip-worktree or assume-unchanged):\n` +
        maskedRaw.map((entry) => `  ${entry}`).join('\n') +
        '\nClear these flags with `git update-index --no-skip-worktree -- <file>` and `git update-index --no-assume-unchanged -- <file>` before checking freshness. The index flag is what makes ordinary Git queries incomplete.',
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
    let typeChanged = false;
    try {
      const diskPath = path.join(repoRoot, file);
      const stat = fs.lstatSync(diskPath);
      if (!stat.isFile()) {
        // A symlink, directory, fifo or other non-regular entry on disk is
        // reported as T so the legend distinguishes it from a plain byte
        // change. The repo only stores blobs under docs-agent/, so a non-file
        // on disk is always wrong.
        typeChanged = true;
        status = 'T';
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
    // If the disk holds a non-file (symlink, directory, fifo) and git diff
    // already reported the path as D because the working-tree stat cache sees
    // a removal, upgrade the row to T so the legend names the actual cause.
    if (typeChanged) {
      const index = worktree.findIndex((change) => change.path === file);
      if (index >= 0) worktree[index] = { status: 'T', path: file };
      else worktree.push({ status: 'T', path: file });
    }
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

// Renders the legend in the same order the status letters are defined above,
// with `?` for the untracked rows so the legend is exhaustive.
function renderLegend() {
  const lines = [
    'M = ' + STATUS_LEGEND.M,
    'D = ' + STATUS_LEGEND.D,
    'A = ' + STATUS_LEGEND.A,
    'T = ' + STATUS_LEGEND.T,
    'U = ' + STATUS_LEGEND.U,
    'X = ' + STATUS_LEGEND.X,
    '? = untracked file (not in HEAD, also reports gitignored generator output)',
  ];
  return lines.join('; ');
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
    lines.push(`Working tree differs from HEAD. Status letters: ${renderLegend()}`);
    lines.push(...drift.worktree.map((entry) => `  ${entry.status}\t${entry.path}`));
  }
  if (drift.untracked.length > 0) {
    lines.push(`Untracked files under ${docsDir}/ (new generator output not in HEAD, or a gitignored file; ? = untracked):`);
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

// Imports must stay quiet for helper consumers (the vitest suite imports the
// exported helpers). Two things can fail here, with two different outcomes:
//
//   1. process.argv[1] is set to a path that does not realpath. The HOST
//      process is not the CLI (e.g. an embedded consumer that sets argv[1] to
//      its own entry point), so this is a non-event. Swallow it.
//   2. The MODULE path itself cannot be realpathed (broken install, removed
//      file). The CLI guard cannot make its comparison, so surface the
//      diagnostic and exit 2.
//
// Any throw from main() also exits 2.
const modulePath = fileURLToPath(import.meta.url);
let isCli = false;
try {
  // Guard 1: realpath argv[1] only. ENOENT here means "not the CLI, stay quiet".
  if (process.argv[1]) {
    isCli = fs.realpathSync(process.argv[1]) === fs.realpathSync(modulePath);
  }
} catch {
  // argv[1] not realpathable: not the CLI. process.exitCode is left alone.
  isCli = false;
}

if (isCli) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
