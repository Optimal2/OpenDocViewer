#!/usr/bin/env node
// Keep the plain node shebang: supported Node versions run ES modules natively,
// and this validation helper should not suppress runtime warnings.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    target: repoRoot,
    out: path.join(repoRoot, 'docs-agent'),
    projectName: 'OpenDocViewer',
    generatedAt: 'committed-docs',
    sourceMetadata: 'none',
  };
  const valueOptions = new Map([
    ['--agentdocmap-root', 'agentDocMapRoot'],
    ['--target', 'target'],
    ['--out', 'out'],
    ['--project-name', 'projectName'],
    ['--generated-at', 'generatedAt'],
    ['--source-metadata', 'sourceMetadata'],
  ]);

  const iterator = argv[Symbol.iterator]();
  for (const arg of iterator) {
    if (valueOptions.has(arg)) {
      options[valueOptions.get(arg)] = readOptionValue(iterator, arg);
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(iterator, optionName) {
  const next = iterator.next();
  if (next.done) {
    throw new Error(`${optionName} requires a value.`);
  }

  return next.value;
}

function printHelp() {
  console.log(`Generate OpenDocViewer agent documentation with AgentDocMap.

Usage:
  npm run doc:agent -- [--agentdocmap-root <path>] [--out <path>]

Options:
  --agentdocmap-root <path>  AgentDocMap repository root.
  --target <path>           Target repository root. Defaults to this repository.
  --out <path>              Output directory. Defaults to docs-agent.
  --project-name <name>     Project name used in generated docs.
  --generated-at <text>     Stable generated label. Defaults to committed-docs.
  --source-metadata <mode>  AgentDocMap source metadata mode. Defaults to none.
`);
}

function resolveAgentDocMapRoot(value) {
  const candidates = [
    value,
    process.env.AGENTDOCMAP_ROOT,
    path.resolve(repoRoot, '..', 'AgentDocMap'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (fs.existsSync(path.join(absolute, 'src', 'cli.js'))) {
      return absolute;
    }
  }

  throw new Error(
    'AgentDocMap was not found. Use --agentdocmap-root, set AGENTDOCMAP_ROOT, or clone AgentDocMap next to OpenDocViewer.',
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const agentDocMapRoot = resolveAgentDocMapRoot(options.agentDocMapRoot);
  const targetPath = resolveTargetPath(options.target);
  const outPath = resolveOutputPath(options.out);
  const cliPath = path.join(agentDocMapRoot, 'src', 'cli.js');
  const args = [
    cliPath,
    'generate',
    '--target',
    targetPath,
    '--out',
    outPath,
    '--project-name',
    options.projectName,
    '--generated-at',
    options.generatedAt,
    '--source-metadata',
    options.sourceMetadata,
  ];
  const commandSummary = formatCommand([process.execPath, ...args]);

  const result = spawnSync(process.execPath, args, {
    cwd: agentDocMapRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Failed to start AgentDocMap command: ${commandSummary}. ${result.error.message}`, {
      cause: result.error,
    });
  }

  if (result.signal) {
    throw new Error(`AgentDocMap terminated by signal ${result.signal}. Command: ${commandSummary}`);
  }

  if (result.status !== null && result.status !== 0) {
    throw new Error(`AgentDocMap exited with code ${result.status}. Command: ${commandSummary}`);
  }
}

function resolveTargetPath(value) {
  const workspaceRoot = path.dirname(repoRoot);
  const resolved = resolveLocalPathOption('--target', value, workspaceRoot);
  if (!fs.existsSync(path.join(resolved, 'package.json')) || !fs.existsSync(path.join(resolved, 'jsdoc.json'))) {
    throw new Error('--target must point to a local repository with package.json and jsdoc.json.');
  }

  return resolved;
}

function resolveOutputPath(value) {
  const resolved = resolveLocalPathOption('--out', value, repoRoot);
  if (path.basename(resolved) !== 'docs-agent') {
    throw new Error('--out must point to a docs-agent directory inside this repository.');
  }

  return resolved;
}

function resolveLocalPathOption(optionName, value, allowedRoot) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error(`${optionName} must be a non-empty local path.`);
  }

  const resolved = path.resolve(repoRoot, value);
  const root = path.resolve(allowedRoot);
  if (!isPathInsideOrSame(resolved, root)) {
    throw new Error(`${optionName} must stay inside ${root}. Actual path: ${resolved}`);
  }

  return resolved;
}

function isPathInsideOrSame(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatCommand(args) {
  return args.map(formatCommandArgument).join(' ');
}

function formatCommandArgument(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
