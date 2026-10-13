import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'vitest';
import {
  PIN_PATH,
  collationChildEnv,
  readEnvironmentPin,
  resolvePinnedNode,
  verifyAgentDocMapDependencies,
  verifyAgentDocMapRevision,
} from './agent-docs-environment.mjs';

const pin = readEnvironmentPin();
const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-agent-docs-env-'));
  tempRoots.push(dir);
  return dir;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

test('the committed pin is exact and its collation fingerprint matches the pinned locale', () => {
  assert.match(pin.node, /^\d+\.\d+\.\d+$/);
  assert.match(pin.agentDocMap.revision, /^[0-9a-f]{40}$/);
  const sorted = [...pin.collation.probe].sort(new Intl.Collator(pin.collation.locale).compare);
  assert.deepEqual(sorted, pin.collation.expectedOrder);
  // The probe must be able to tell the pinned locale from the Swedish desktop default.
  assert.notDeepEqual([...pin.collation.probe].sort(new Intl.Collator('sv-SE').compare), pin.collation.expectedOrder);
});

test('readEnvironmentPin rejects a range, a short revision and a broken fingerprint', () => {
  const file = path.join(tempDir(), 'pin.json');
  writeJson(file, {
    node: '^22.23.3',
    agentDocMap: { repository: 'Optimal2/AgentDocMap', revision: 'f17676c' },
    collation: { locale: 'en-US', probe: ['a', 'b'], expectedOrder: ['a', 'c'] },
  });
  assert.throws(() => readEnvironmentPin(file), (error) => {
    assert.match(error.message, /node must be an exact version/);
    assert.match(error.message, /full 40-character commit SHA/);
    assert.match(error.message, /permutation of collation.probe/);
    return true;
  });
});

test('the workflows take Node and the AgentDocMap revision from the pin', () => {
  const pinFile = path.relative(path.resolve(path.dirname(PIN_PATH), '..'), PIN_PATH).replaceAll('\\', '/');
  for (const name of ['agent-docs.yml', 'release.yml']) {
    const workflow = fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    assert.ok(workflow.includes(`pin=${pinFile}`), `${name} reads ${pinFile}`);
    assert.ok(workflow.includes('ref: ${{ steps.pin.outputs.agentdocmap-revision }}'), `${name} pins the AgentDocMap ref`);
    assert.ok(workflow.includes('node-version: ${{ steps.pin.outputs.node }}'), `${name} pins Node`);
    assert.doesNotMatch(workflow, /node-version:\s*['"]?\d/, `${name} has no literal node-version`);
    assert.doesNotMatch(workflow, /repository:\s*Optimal2\/AgentDocMap/, `${name} has no literal AgentDocMap repository`);
  }
});

test('resolvePinnedNode uses the running Node when it is the pinned version', () => {
  const node = resolvePinnedNode('22.23.3', { env: {}, execPath: '/x/node', runningVersion: 'v22.23.3' });
  assert.deepEqual(node, { path: '/x/node', version: 'v22.23.3', source: 'running Node', note: null });
});

test('resolvePinnedNode is strict in CI', () => {
  assert.throws(
    () => resolvePinnedNode('22.23.3', { env: { GITHUB_ACTIONS: 'true' }, runningVersion: 'v25.6.0', exists: () => true, probe: () => 'v22.23.3' }),
    /CI must run the pinned Node v22.23.3 but runs v25.6.0/,
  );
});

test('resolvePinnedNode finds the pinned fnm installation locally and says so', () => {
  const expected = path.join('C:\\AppData', 'fnm', 'node-versions', 'v22.23.3', 'installation', 'node.exe');
  const node = resolvePinnedNode('22.23.3', {
    env: { APPDATA: 'C:\\AppData' },
    platform: 'win32',
    runningVersion: 'v25.6.0',
    exists: (candidate) => candidate === expected,
    probe: () => 'v22.23.3',
  });
  assert.equal(node.path, expected);
  assert.equal(node.source, 'fnm');
  assert.match(node.note, /ambient Node v25\.6\.0 differs from the pinned v22\.23\.3/);
});

test('resolvePinnedNode fails loudly when the pinned Node is missing or mislabelled', () => {
  const options = { env: { APPDATA: 'C:\\AppData' }, platform: 'win32', runningVersion: 'v25.6.0', exists: () => false };
  assert.throws(() => resolvePinnedNode('22.23.3', options), /not installed[\s\S]*fnm install 22\.23\.3[\s\S]*ODV_AGENT_DOCS_NODE/);
  assert.throws(
    () =>
      resolvePinnedNode('22.23.3', {
        ...options,
        env: { ODV_AGENT_DOCS_NODE: 'C:\\node20\\node.exe' },
        exists: () => true,
        probe: () => 'v20.0.0',
      }),
    /reports v20\.0\.0, but the pin requires v22\.23\.3/,
  );
});

test('verifyAgentDocMapDependencies compares node_modules with package-lock.json', () => {
  const root = tempDir();
  const locked = {
    packages: {
      '': { name: 'agentdocmap' },
      'node_modules/jsdoc': { version: '4.0.5', integrity: 'sha512-a' },
      'node_modules/fsevents': { version: '2.3.3', optional: true },
    },
  };
  writeJson(path.join(root, 'package-lock.json'), locked);
  assert.throws(() => verifyAgentDocMapDependencies(root), /are not installed by npm/);

  const hidden = path.join(root, 'node_modules', '.package-lock.json');
  writeJson(hidden, { packages: { 'node_modules/jsdoc': { version: '4.0.5', integrity: 'sha512-a' } } });
  assert.equal(verifyAgentDocMapDependencies(root), 1);

  writeJson(hidden, { packages: { 'node_modules/jsdoc': { version: '4.0.4', integrity: 'sha512-b' }, 'node_modules/extra': { version: '1.0.0' } } });
  assert.throws(() => verifyAgentDocMapDependencies(root), /installed 4\.0\.4, locked 4\.0\.5[\s\S]*extra: installed but not in package-lock\.json/);
});

test('verifyAgentDocMapRevision requires the pinned commit without tracked changes', () => {
  const root = tempDir();
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'cli.js'), 'one\n');
  git('add', 'cli.js');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'one');
  const head = git('rev-parse', 'HEAD');

  assert.equal(verifyAgentDocMapRevision(root, head), head);
  assert.throws(() => verifyAgentDocMapRevision(root, '0'.repeat(40)), new RegExp(`is at ${head}, but .* pins 0{40}`));
  fs.writeFileSync(path.join(root, 'cli.js'), 'two\n');
  assert.throws(() => verifyAgentDocMapRevision(root, head), /has tracked modifications/);
});

function runWithShim(collation, script) {
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: collationChildEnv(collation) });
}

const sortScript = "console.log(['ä', 'z', 'a'].sort((l, r) => l.localeCompare(r)).join(' '))";

test('the collation shim forces the pinned locale on locale-less localeCompare', () => {
  const english = runWithShim(pin.collation, sortScript);
  assert.equal(english.status, 0, english.stderr);
  assert.equal(english.stdout.trim(), 'a ä z');

  const probe = pin.collation.probe;
  const swedish = { locale: 'sv-SE', probe, expectedOrder: [...probe].sort(new Intl.Collator('sv-SE').compare) };
  const result = runWithShim(swedish, sortScript);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'a z ä');
});

test('the collation shim leaves an explicit locale alone', () => {
  const result = runWithShim(pin.collation, "console.log(['ä', 'z', 'a'].sort((l, r) => l.localeCompare(r, 'sv-SE')).join(' '))");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'a z ä');
});

test('the collation shim rejects an effective collation that differs from the pin', () => {
  const result = runWithShim({ ...pin.collation, locale: 'sv-SE' }, sortScript);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Effective collation does not match the pin \(locale sv-SE/);
});
