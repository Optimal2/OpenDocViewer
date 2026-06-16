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

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueOptions.has(arg)) {
      options[valueOptions.get(arg)] = readOptionValue(argv, i, arg);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readOptionValue(argv, index, optionName) {
  if (index + 1 >= argv.length) {
    throw new Error(`${optionName} requires a value.`);
  }

  return argv[index + 1];
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
  const cliPath = path.join(agentDocMapRoot, 'src', 'cli.js');
  const args = [
    cliPath,
    'generate',
    '--target',
    path.resolve(options.target),
    '--out',
    path.resolve(options.out),
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

  if (result.status !== null && result.status !== 0) {
    throw new Error(`AgentDocMap exited with code ${result.status}. Command: ${commandSummary}`);
  }
}

function formatCommand(args) {
  return JSON.stringify(args);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
