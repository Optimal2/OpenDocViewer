// Foreground, bounded RED/GREEN evidence for the final correction only.
// Run with Node 22.23.3 and TEMP/TMP/TMPDIR in registered job scratch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPowerShellParser } from './parse-local-ci-ast.mjs';
import { finalFixtures } from './remedy-lock-final-fixtures.mjs';

assert.equal(process.version, 'v22.23.3');
const root = path.resolve(import.meta.dirname, '..');
const scratch = os.tmpdir();
assert.match(scratch.replaceAll('\\', '/'), /^G:\/wt\/tmp\/[^/]+\/?$/i);
const evidence = path.join(root, 'docs-src/evidence/remedy-lock-final');
const raw = path.join(scratch, 'remedy-lock-final-raw');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(raw, { recursive: true });
const source = fs.readFileSync(path.join(root, 'scripts/local-ci.ps1'), 'utf8');
const testPath = path.join(root, 'scripts/local-ci-agent-docs-output.test.mjs');
const validator = fs.readFileSync(testPath, 'utf8');
const probePath = path.join(root, 'scripts/.remedy-lock-final-probe.test.mjs');
assert.ok(!fs.existsSync(probePath));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const sanitize = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')
  .split(root).join('<repo>').split(root.replaceAll('\\', '/')).join('<repo>')
  .split(scratch).join('<scratch>').split(scratch.replaceAll('\\', '/')).join('<scratch>');
const records = [];

function run(name, testedSource, testedValidator, pattern, expectedExit, reason) {
  const probe = testedValidator.replace("const source = fs.readFileSync(localCiPath, 'utf8');", `const source = ${JSON.stringify(testedSource)};`);
  assert.notEqual(probe, testedValidator, 'source injection must bind');
  fs.writeFileSync(probePath, probe, 'utf8');
  const args = ['node_modules/vitest/vitest.mjs', 'run', 'scripts/.remedy-lock-final-probe.test.mjs', '-t', pattern];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  fs.writeFileSync(path.join(raw, `${name}.log`), stdout + stderr);
  const log = sanitize(stdout + stderr).trimEnd() + '\n';
  fs.writeFileSync(path.join(evidence, `${name}.log`), log);
  records.push({ name, command: `node ${args.join(' ')}`, nativeExit: result.status,
    sourceSha256: sha256(testedSource), validatorSha256: sha256(testedValidator),
    rawOutputSha256: sha256(stdout + stderr), publicOutputSha256: sha256(log) });
  fs.writeFileSync(path.join(evidence, 'proofs.json'), JSON.stringify(records, null, 2) + '\n');
  console.log(`${name}: native exit ${result.status} (expected ${expectedExit})`);
  assert.ifError(result.error);
  assert.equal(result.status, expectedExit, log);
  if (reason) assert.match(log, reason);
}

const withoutGuard = (name) => {
  const pattern = new RegExp(`[ \\t]*// FINAL-${name}-BEGIN[\\s\\S]*?// FINAL-${name}-END`);
  const result = validator.replace(pattern, '');
  assert.notEqual(result, validator, 'guard removal must bind');
  return result;
};

try {
  const fixtures = finalFixtures(source, createPowerShellParser().parse(source));
  for (const fixture of fixtures) {
    run(`red-${fixture.name}`, fixture.text, validator, '^each step-4 cause branch', 1, fixture.reason);
  }
  for (const [guard, fixture, test] of [
    ['ECHO-ORDER', fixtures[0], 'final correction rejects real echo'],
    ['SILENT-TERMINATION', fixtures[2], 'final correction rejects early zero'],
  ]) {
    const mutated = withoutGuard(guard);
    run(`guard-off-${fixture.name}`, fixture.text, mutated, '^each step-4 cause branch', 0);
    run(`binding-red-${fixture.name}`, source, mutated, test, 1, /Missing expected exception/);
  }
  run('restored-green', source, validator, 'final correction|^each step-4 cause branch', 0);
  assert.equal(fs.readFileSync(testPath, 'utf8'), validator);
  assert.equal(fs.readFileSync(path.join(root, 'scripts/local-ci.ps1'), 'utf8'), source);
} finally {
  fs.rmSync(probePath, { force: true });
}
