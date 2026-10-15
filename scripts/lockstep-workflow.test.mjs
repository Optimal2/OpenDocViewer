// Exercise the real YAML body in disposable local git repositories, without Bash.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runMatrix() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baseline = process.argv.includes('--baseline');
  const removeGuard = process.argv.includes('--remove-guard');
  const evidenceIndex = process.argv.indexOf('--evidence');
  const evidence = evidenceIndex < 0 ? null : path.resolve(process.argv[evidenceIndex + 1]);
  if (evidence) assert.ok(evidence.startsWith(`${repo}${path.sep}`), 'Evidence must stay in this checkout');

  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8');
  // Bound both the job and step by YAML indentation. Never capture a later run block.
  const job = workflow.match(/^  lockstep:\r?\n(?:(?!^  \S)[\s\S])*/m)?.[0];
  assert.ok(job, 'Expected the lockstep job');
  const step = job.match(/^      - name: Validate version lockstep\r?\n(?:(?!^      - |^  \S)[\s\S])*/m)?.[0];
  assert.ok(step, 'Expected the named lockstep step');
  const lines = step.split(/\r?\n/);
  const run = lines.indexOf('        run: |');
  assert.ok(run >= 0, 'Expected a literal run block');
  const bodyLines = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith('          ')) break;
    bodyLines.push(line.slice(10));
  }
  let body = `${bodyLines.join('\n').trimEnd()}\n`;
  assert.match(body, /& \$validator -Strict -BaseCommit \$base/);
  if (removeGuard) {
    const hardened = body;
    body = body
      .replace(/^\$global:LASTEXITCODE = \$null\n/m, '')
      .replace(
        /^if \(\$null -eq \$LASTEXITCODE\) \{\n  throw "Lockstep validator did not report an exit code:[^\n]*\n\}\n/m,
        '',
      );
    assert.notEqual(body, hardened, 'Mutation must remove the production guard');
  }

  // _tools is already excluded from Vitest discovery and agent documentation.
  // A failed cleanup must never turn copied tests into new test inputs.
  const scratchRoot = path.join(repo, '_tools');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'lockstep-fixture-'));
  const fixture = path.join(scratch, 'repo');
  const transcript = [
    `Source pin: ${git(repo, ['rev-parse', 'HEAD']).trim()}`,
    `Mode: ${baseline ? 'baseline' : removeGuard ? 'guard removed (expected RED)' : 'hardened'}`,
    "Runner prepend: $ErrorActionPreference = 'stop'",
    'Runner append: if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }',
    'Output below is verbatim except absolute fixture paths are replaced by <fixture>.',
  ];
  const failures = [];

  function git(cwd, args) {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  }

  try {
    fs.mkdirSync(fixture);
    // Copy the real validator and its manifest/SQL inputs, without unrelated UI assets.
    for (const file of [
      '.gitattributes',
      'package.json',
      'package-lock.json',
      'omp-components.json',
      'opendocviewer.module-definition.json',
      'sql/3-initialize-opendocviewer.sql',
      'scripts/omp/validate-component-versions.ps1',
      'scripts/omp/validate-component-versions.helpers.ps1',
    ]) {
      const destination = path.join(fixture, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repo, file), destination);
    }
    git(fixture, ['init', '-b', 'main']);
    git(fixture, ['config', 'user.name', 'Lockstep fixture']);
    git(fixture, ['config', 'user.email', 'fixture@example.invalid']);
    git(fixture, ['config', 'core.autocrlf', 'false']);
    git(fixture, ['add', '.']);
    git(fixture, ['commit', '-qm', 'Local fixture base']);
    git(fixture, ['remote', 'add', 'origin', fixture]);
    git(fixture, ['fetch', 'origin', 'main', '--no-tags']);
    const before = git(fixture, ['rev-parse', 'HEAD']).trim();
    const validator = path.join(fixture, 'scripts/omp/validate-component-versions.ps1');
    const original = fs.readFileSync(validator);
    const stepPath = path.join(scratch, 'step.ps1');
    const runnerScript = `$ErrorActionPreference = 'stop'\n${body}if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n`;
    fs.writeFileSync(stepPath, runnerScript);
    transcript.push('\nExtracted step file:', runnerScript);
    const cases = [
      ['normal', original, 0],
      ['missing', null, 1],
      ['directory', null, 1],
      ['syntax', 'param(\n', 1],
      ['empty', '', baseline ? 0 : 1],
      ['noop', '# No validation performed.\n', baseline ? 0 : 1],
      ['restored-normal', original, 0],
      // Measured limits: an explicit exit or a native command can supply a code.
      ['explicit-exit-zero', 'exit 0\n', 0],
      ['native-zero', 'git --version\n', 0],
      ['truncated-validator', original.toString('utf8').replace(/exit 0\s*$/, '# Final exit removed.\n'), 0],
      ['exit-one', 'exit 1\n', 1],
    ];
    // Windows environment names are case-insensitive, including Vite-loaded aliases.
    const fixtureEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !['omp_platform_root', 'openmoduleplatformroot'].includes(key.toLowerCase()),
      ),
    );
    for (const branch of ['push', 'pull_request']) {
      for (const initial of ['undefined', 'zero']) {
        for (const [name, content, expected] of cases) {
          fs.rmSync(validator, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
          if (name === 'directory') fs.mkdirSync(validator);
          else if (content !== null) fs.writeFileSync(validator, content);
          const quote = (value) => `'${value.replaceAll("'", "''")}'`;
          const seed = path.join(repo, 'scripts/test-lockstep-workflow.ps1');
          const result = spawnSync(
            'pwsh',
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `. ${quote(seed)} -InitialExit ${initial}; . ${quote(stepPath)}`,
            ],
            {
              cwd: fixture,
              encoding: 'utf8',
              timeout: 60_000,
              env: {
                ...fixtureEnv,
                NO_COLOR: '1',
                TERM: 'dumb',
                OMP_ALLOW_MISSING_PLATFORM: '1',
                GITHUB_EVENT_NAME: branch,
                GITHUB_BASE_REF: 'main',
                GITHUB_REF_NAME: 'main',
                DEFAULT_BRANCH: 'main',
                PUSH_BEFORE: before,
              },
            },
          );
          const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(scratch).join('<fixture>');
          transcript.push(
            `\n=== ${branch} / LASTEXITCODE=${initial} / ${name} ===`,
            output.trimEnd(),
            `Measured exit: ${result.status}`,
          );
          console.log(`${branch} / ${initial} / ${name}: exit ${result.status} (expected ${expected})`);
          if (name === 'normal') assert.equal(result.status, expected, output);
          if (result.error || result.status !== expected)
            failures.push(
              `${branch}/${initial}/${name}: ${result.error ?? result.status}, expected ${expected}`,
            );
          if (
            !baseline &&
            ['empty', 'noop'].includes(name) &&
            !output.includes('Lockstep validator did not report an exit code:')
          ) {
            failures.push(`${branch}/${initial}/${name}: missing named failure`);
          }
          if (
            ['normal', 'restored-normal', 'truncated-validator'].includes(name) &&
            !output.includes('Component version validation passed')
          )
            failures.push(`${branch}/${initial}/${name}: real validator did not pass`);
          const baseReason = branch === 'push' ? '(github.event.before,' : '(pull request base branch).';
          if (!output.includes(baseReason))
            failures.push(`${branch}/${initial}/${name}: wrong base-selection branch`);
        }
      }
    }
  } finally {
    if (evidence) {
      fs.mkdirSync(path.dirname(evidence), { recursive: true });
      fs.writeFileSync(evidence, `${transcript.join('\n')}\n`.replaceAll('\r\n', '\n'));
    }
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log('PASS: extracted lockstep workflow matrix');
}

if (process.env.VITEST) {
  const { test } = await import('vitest');
  test('lockstep rejects silent validators in the real runner wrapper', runMatrix, 300_000);
} else {
  runMatrix();
}
