import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAgentDocMapRoot } from '../../scripts/resolve-agentdocmap-root.mjs';

function makeAgentDocMap(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'cli.js'), '// fake AgentDocMap cli\n');
}

describe('resolveAgentDocMapRoot linked-worktree fallback', () => {
  const tmpRoots = [];

  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-agentdocmap-'));
    tmpRoots.push(dir);
    return dir;
  }

  it('finds AgentDocMap next to the main checkout when the worktree has no sibling', () => {
    const base = tempDir();
    const mainCheckout = path.join(base, 'main', 'OpenDocViewer');
    const agentDocMap = path.join(base, 'main', 'AgentDocMap');
    fs.mkdirSync(mainCheckout, { recursive: true });
    makeAgentDocMap(agentDocMap);
    const worktree = path.join(base, 'worktree', 'OpenDocViewer');
    fs.mkdirSync(worktree, { recursive: true });

    const resolved = resolveAgentDocMapRoot(undefined, {
      repoRoot: worktree,
      env: {},
      gitCommonDir: path.join(mainCheckout, '.git'),
    });

    expect(resolved).toBe(agentDocMap);
  });

  it('keeps explicit flag, env and direct sibling ahead of the main-checkout sibling', () => {
    const base = tempDir();
    const mainCheckout = path.join(base, 'main', 'OpenDocViewer');
    const mainSibling = path.join(base, 'main', 'AgentDocMap');
    fs.mkdirSync(mainCheckout, { recursive: true });
    makeAgentDocMap(mainSibling);
    const worktree = path.join(base, 'worktree', 'OpenDocViewer');
    const directSibling = path.join(base, 'worktree', 'AgentDocMap');
    fs.mkdirSync(worktree, { recursive: true });
    makeAgentDocMap(directSibling);
    const envRoot = path.join(base, 'env', 'AgentDocMap');
    makeAgentDocMap(envRoot);
    const explicitRoot = path.join(base, 'explicit', 'AgentDocMap');
    makeAgentDocMap(explicitRoot);
    const common = { repoRoot: worktree, gitCommonDir: path.join(mainCheckout, '.git') };

    expect(resolveAgentDocMapRoot(explicitRoot, { ...common, env: { AGENTDOCMAP_ROOT: envRoot } })).toBe(
      explicitRoot,
    );
    expect(resolveAgentDocMapRoot(undefined, { ...common, env: { AGENTDOCMAP_ROOT: envRoot } })).toBe(
      envRoot,
    );
    expect(resolveAgentDocMapRoot(undefined, { ...common, env: {} })).toBe(directSibling);
  });

  it('mentions the main-checkout fallback in the not-found error', () => {
    const base = tempDir();
    const worktree = path.join(base, 'worktree', 'OpenDocViewer');
    fs.mkdirSync(worktree, { recursive: true });

    expect(() =>
      resolveAgentDocMapRoot(undefined, {
        repoRoot: worktree,
        env: {},
        gitCommonDir: path.join(base, 'main', 'OpenDocViewer', '.git'),
      }),
    ).toThrow(/main checkout/);
  });
});
