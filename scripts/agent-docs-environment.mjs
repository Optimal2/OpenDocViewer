// Reads and enforces scripts/agent-docs-environment.json, the single pin for the
// environment that generates docs-agent/: the Node version, the AgentDocMap
// revision (plus its installed dependencies) and the collation locale.
//
// CI (GITHUB_ACTIONS/CI=true) is strict: the running Node must already be the
// pinned version. Locally the ambient Node may differ; the generator then runs
// AgentDocMap with the pinned Node binary found through ODV_AGENT_DOCS_NODE, fnm
// or nvm, prints a visible NOTE, and fails with an actionable message when no
// pinned binary is installed. AgentDocMap's revision, dependencies and the
// collation are enforced the same way on both sides.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const PIN_PATH = path.join(scriptDir, 'agent-docs-environment.json');
export const COLLATION_SHIM_PATH = path.join(scriptDir, 'agent-docs-collation-shim.mjs');
export const COLLATION_ENV = 'ODV_AGENT_DOCS_COLLATION';
export const NODE_OVERRIDE_ENV = 'ODV_AGENT_DOCS_NODE';

/**
 * Reads and validates the environment pin.
 * @param {string} [pinPath]
 * @returns {{node: string, agentDocMap: {repository: string, revision: string}, collation: {locale: string, probe: string[], expectedOrder: string[]}}}
 */
export function readEnvironmentPin(pinPath = PIN_PATH) {
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  const problems = [];
  if (typeof pin.node !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin.node)) {
    problems.push('node must be an exact version such as "22.23.3" (no range, no "v" prefix)');
  }
  if (typeof pin.agentDocMap?.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pin.agentDocMap.repository)) {
    problems.push('agentDocMap.repository must be "<owner>/<name>"');
  }
  if (typeof pin.agentDocMap?.revision !== 'string' || !/^[0-9a-f]{40}$/.test(pin.agentDocMap.revision)) {
    problems.push('agentDocMap.revision must be a full 40-character commit SHA');
  }
  const collation = pin.collation;
  if (typeof collation?.locale !== 'string' || collation.locale.trim() === '') {
    problems.push('collation.locale must be a BCP 47 locale such as "en-US"');
  }
  if (!Array.isArray(collation?.probe) || !Array.isArray(collation?.expectedOrder)) {
    problems.push('collation.probe and collation.expectedOrder must be arrays');
  } else if ([...collation.probe].sort().join('\n') !== [...collation.expectedOrder].sort().join('\n')) {
    problems.push('collation.expectedOrder must be a permutation of collation.probe');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid agent-docs environment pin ${pinPath}:\n  - ${problems.join('\n  - ')}`);
  }
  return pin;
}

/**
 * True when running in CI, where the pinned Node must be the running Node.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isStrictEnvironment(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
}

function nodeBinaryName(platform) {
  return platform === 'win32' ? 'node.exe' : path.join('bin', 'node');
}

/**
 * Well-known install locations of a given Node version (fnm, nvm-windows, nvm).
 * @param {string} version exact version without "v"
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, homedir?: string}} [options]
 * @returns {{source: string, path: string}[]}
 */
export function pinnedNodeCandidates(version, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homedir ?? os.homedir();
  const tag = `v${version}`;
  const candidates = [];
  const fnmDirs = [env.FNM_DIR];
  if (platform === 'win32') {
    fnmDirs.push(env.APPDATA && path.join(env.APPDATA, 'fnm'));
  } else {
    fnmDirs.push(path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'fnm'), path.join(home, '.fnm'));
  }
  for (const dir of fnmDirs.filter(Boolean)) {
    candidates.push({ source: 'fnm', path: path.join(dir, 'node-versions', tag, 'installation', nodeBinaryName(platform)) });
  }
  if (platform === 'win32') {
    if (env.NVM_HOME) {
      candidates.push({ source: 'nvm-windows', path: path.join(env.NVM_HOME, tag, 'node.exe') });
    }
  } else {
    const nvmDir = env.NVM_DIR || path.join(home, '.nvm');
    candidates.push({ source: 'nvm', path: path.join(nvmDir, 'versions', 'node', tag, 'bin', 'node') });
  }
  return candidates;
}

function probeNodeVersion(binary) {
  const result = spawnSync(binary, ['-p', 'process.version'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout || '').trim();
}

/**
 * Resolves the Node binary that must run AgentDocMap.
 * @param {string} version pinned exact version without "v"
 * @param {{env?: NodeJS.ProcessEnv, execPath?: string, runningVersion?: string, platform?: string,
 *   homedir?: string, exists?: (p: string) => boolean, probe?: (p: string) => string|null}} [options]
 * @returns {{path: string, version: string, source: string, note: string|null}}
 */
export function resolvePinnedNode(version, options = {}) {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const runningVersion = options.runningVersion ?? process.version;
  const exists = options.exists ?? fs.existsSync;
  const probe = options.probe ?? probeNodeVersion;
  const wanted = `v${version}`;

  if (runningVersion === wanted) {
    return { path: execPath, version: wanted, source: 'running Node', note: null };
  }
  if (isStrictEnvironment(env)) {
    throw new Error(
      `CI must run the pinned Node ${wanted} but runs ${runningVersion}. ` +
        'The workflow has to take node-version from scripts/agent-docs-environment.json.',
    );
  }

  const checked = [];
  const candidates = [];
  if (env[NODE_OVERRIDE_ENV]) {
    candidates.push({ source: NODE_OVERRIDE_ENV, path: env[NODE_OVERRIDE_ENV], explicit: true });
  }
  candidates.push(...pinnedNodeCandidates(version, { env, platform: options.platform, homedir: options.homedir }));
  for (const candidate of candidates) {
    if (!exists(candidate.path)) {
      if (candidate.explicit) {
        throw new Error(`${NODE_OVERRIDE_ENV} points to a missing file: ${candidate.path}`);
      }
      checked.push(`${candidate.source}: ${candidate.path} (missing)`);
      continue;
    }
    const actual = probe(candidate.path);
    if (actual === wanted) {
      return {
        path: candidate.path,
        version: wanted,
        source: candidate.source,
        note: `ambient Node ${runningVersion} differs from the pinned ${wanted}; AgentDocMap runs with ${candidate.path} (${candidate.source}).`,
      };
    }
    if (candidate.explicit) {
      throw new Error(`${NODE_OVERRIDE_ENV}=${candidate.path} reports ${actual ?? 'no version'}, but the pin requires ${wanted}.`);
    }
    checked.push(`${candidate.source}: ${candidate.path} (reports ${actual ?? 'no version'})`);
  }

  throw new Error(
    `The pinned Node ${wanted} for agent documentation is not installed (running Node is ${runningVersion}).\n` +
      `Install it, for example with "fnm install ${version}", or set ${NODE_OVERRIDE_ENV} to a Node ${wanted} executable.\n` +
      `Checked:\n  - ${checked.join('\n  - ')}`,
  );
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || '').trim();
    throw new Error(`git ${args.join(' ')} failed in ${root}: ${detail}`);
  }
  return String(result.stdout || '').trim();
}

/**
 * Fails unless the AgentDocMap checkout is exactly the pinned revision with no
 * tracked modifications.
 * @param {string} agentDocMapRoot
 * @param {string} revision
 * @returns {string} the verified revision
 */
export function verifyAgentDocMapRevision(agentDocMapRoot, revision) {
  const head = git(agentDocMapRoot, ['rev-parse', 'HEAD']);
  if (head !== revision) {
    throw new Error(
      `AgentDocMap at ${agentDocMapRoot} is at ${head}, but scripts/agent-docs-environment.json pins ${revision}.\n` +
        `Point --agentdocmap-root or AGENTDOCMAP_ROOT at a checkout of ${revision}, ` +
        'or update the pin (and regenerate docs-agent) when AgentDocMap is deliberately upgraded.',
    );
  }
  const dirty = git(agentDocMapRoot, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty !== '') {
    throw new Error(`AgentDocMap at ${agentDocMapRoot} has tracked modifications:\n${dirty}`);
  }
  return head;
}

/**
 * Fails unless node_modules metadata matches package-lock.json (npm's hidden
 * lockfile node_modules/.package-lock.json is compared entry by entry).
 * This does NOT hash installed file contents: patched, missing or linked package
 * files can pass while lock metadata stays unchanged. Use a clean npm ci install
 * to reproduce CI; the freshness gate checks output, not dependency integrity.
 * @param {string} agentDocMapRoot
 * @returns {number} number of verified packages
 */
export function verifyAgentDocMapDependencies(agentDocMapRoot) {
  const lockPath = path.join(agentDocMapRoot, 'package-lock.json');
  const installedPath = path.join(agentDocMapRoot, 'node_modules', '.package-lock.json');
  const fix = `Run "npm ci" in ${agentDocMapRoot}.`;
  if (!fs.existsSync(installedPath)) {
    throw new Error(`AgentDocMap dependencies are not installed by npm (missing ${installedPath}). ${fix}`);
  }
  const locked = JSON.parse(fs.readFileSync(lockPath, 'utf8')).packages ?? {};
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).packages ?? {};
  const mismatches = [];
  for (const [key, entry] of Object.entries(locked)) {
    if (key === '') continue;
    const actual = installed[key];
    if (!actual) {
      if (!entry.optional) mismatches.push(`${key}: missing (locked ${entry.version})`);
    } else if (actual.version !== entry.version || (entry.integrity && actual.integrity !== entry.integrity)) {
      mismatches.push(`${key}: installed ${actual.version}, locked ${entry.version}`);
    }
  }
  for (const key of Object.keys(installed)) {
    if (!(key in locked)) mismatches.push(`${key}: installed but not in package-lock.json`);
  }
  if (mismatches.length > 0) {
    throw new Error(`AgentDocMap node_modules does not match its package-lock.json. ${fix}\n  - ${mismatches.join('\n  - ')}`);
  }
  return Object.keys(installed).length;
}

/**
 * Environment for the AgentDocMap child process: preloads the collation shim
 * (inherited by nested Node processes such as JSDoc) and hands it the pin.
 * @param {ReturnType<typeof readEnvironmentPin>['collation']} collation
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function collationChildEnv(collation, baseEnv = process.env) {
  const shimImport = `--import=${pathToFileURL(COLLATION_SHIM_PATH).href}`;
  return {
    ...baseEnv,
    NODE_OPTIONS: [baseEnv.NODE_OPTIONS, shimImport].filter(Boolean).join(' '),
    [COLLATION_ENV]: JSON.stringify(collation),
  };
}
