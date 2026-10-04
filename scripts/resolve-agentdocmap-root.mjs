import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const defaultRepoRoot = path.resolve(scriptDir, '..');

function isAgentDocMapRoot(candidate) {
  return fs.existsSync(path.join(candidate, 'src', 'cli.js'));
}

function resolveMainCheckoutSibling(repoRoot, gitCommonDirOverride) {
  try {
    let commonDir = gitCommonDirOverride;
    if (!commonDir) {
      const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      if (result.error || result.status !== 0) {
        return null;
      }
      commonDir = String(result.stdout || '').trim();
    }
    if (!commonDir) {
      return null;
    }
    // The common dir's parent is the main checkout: for a linked worktree it is
    // the main checkout's .git directory, for a normal checkout it is this
    // repo's own .git directory (which makes the fallback equal ../AgentDocMap).
    const absoluteCommonDir = path.resolve(repoRoot, commonDir);
    const mainCheckout = path.dirname(absoluteCommonDir);
    return path.resolve(mainCheckout, '..', 'AgentDocMap');
  } catch {
    return null;
  }
}

export function resolveAgentDocMapRoot(explicitValue, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const env = options.env ?? process.env;
  const candidates = [explicitValue, env?.AGENTDOCMAP_ROOT, path.resolve(repoRoot, '..', 'AgentDocMap')].filter(
    Boolean,
  );
  const fallback = resolveMainCheckoutSibling(repoRoot, options.gitCommonDir);
  if (fallback && !candidates.includes(fallback)) {
    candidates.push(fallback);
  }

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (isAgentDocMapRoot(absolute)) {
      return absolute;
    }
  }

  throw new Error(
    'AgentDocMap was not found. Use --agentdocmap-root, set AGENTDOCMAP_ROOT, clone AgentDocMap next to OpenDocViewer, or (from a linked git worktree) next to the main checkout.',
  );
}
