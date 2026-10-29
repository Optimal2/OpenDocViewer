import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import {
  DEFAULT_LOADER,
  DEFAULT_SAMPLE,
  evaluateSiteConfig,
  main,
} from './site-config-generator.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-site-config-versions-'));
  tempRoots.push(dir);
  return dir;
}

function writeProfile(dir, profile, name = 'profile.json') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return file;
}

function run(argv) {
  const out = [];
  const err = [];
  const code = main(argv, { log: (s) => out.push(s), error: (s) => err.push(s) });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function generate(dir, profile, version, name = `${version}.js`) {
  const out = path.join(dir, name);
  const result = run(['generate', '--profile', profile, '--version', version, '--out', out]);
  return { result, out };
}

function readGenerated(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function siteOf(file) {
  return evaluateSiteConfig(readGenerated(file)).site;
}

test('generate reads two real release tags and preserves their different samples', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } });
  const older = generate(dir, profile, '2.10.0');
  const newer = generate(dir, profile, '2.11.0');
  assert.equal(older.result.code, 0, older.result.stderr);
  assert.equal(newer.result.code, 0, newer.result.stderr);
  assert.notEqual(readGenerated(older.out), readGenerated(newer.out));
  assert.match(readGenerated(older.out), /OpenDocViewer 2\.10\.0 \(version from tag v2\.10\.0\)/);
  assert.match(readGenerated(newer.out), /OpenDocViewer 2\.11\.0 \(version from tag v2\.11\.0\)/);
  assert.equal(siteOf(older.out).toolbar?.largeButtons, undefined);
  assert.equal(siteOf(newer.out).toolbar.largeButtons, true);
  assert.equal(siteOf(older.out).i18n.default, 'en');
  assert.equal(siteOf(newer.out).i18n.default, 'en');
});

test('a since gate is reported and skipped for 2.10.0 but applied for 2.11.0', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'toolbar.largeButtons': false },
    since: { 'toolbar.largeButtons': '2.11.0' },
  });
  const older = generate(dir, profile, '2.10.0');
  assert.equal(older.result.code, 0, older.result.stderr);
  assert.match(older.result.stdout, /skipped \(since 2\.11\.0\)\s+toolbar\.largeButtons/);
  assert.match(older.result.stdout, /no entries apply at this version/);
  assert.equal(siteOf(older.out).toolbar?.largeButtons, undefined);

  const newer = generate(dir, profile, '2.11.0');
  assert.equal(newer.result.code, 0, newer.result.stderr);
  assert.doesNotMatch(newer.result.stdout, /skipped/);
  assert.equal(siteOf(newer.out).toolbar.largeButtons, false);
  assert.match(newer.result.stdout, /set\s+toolbar\.largeButtons\s+true -> false/);
});

test('an ungated path missing from the selected release still fails', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'toolbar.largeButtons': false } });
  const { result, out } = generate(dir, profile, '2.10.0');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ERROR: The profile does not match the sample/);
  assert.match(result.stderr, /"toolbar\.largeButtons" does not exist/);
  assert.equal(fs.existsSync(out), false);
});

test('an unknown release tag fails with a readable error', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: {} });
  const { result, out } = generate(dir, profile, '99.99.99');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ERROR: Tag "v99\.99\.99" does not exist or is not a readable release commit\./);
  assert.equal(fs.existsSync(out), false);
});

test('generate-all writes both version folders and check --version accepts each file', () => {
  const dir = tempDir();
  const outDir = path.join(dir, 'releases');
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'i18n.default': 'en', 'toolbar.largeButtons': false },
    since: { 'toolbar.largeButtons': '2.11.0' },
  });
  const generated = run(['generate-all', '--profile', profile, '--versions', '2.10.0,2.11.0', '--out-dir', outDir]);
  assert.equal(generated.code, 0, generated.stderr);
  assert.match(generated.stdout, /2\.10\.0:\s+skipped \(since 2\.11\.0\)\s+toolbar\.largeButtons/);
  for (const version of ['2.10.0', '2.11.0']) {
    const out = path.join(outDir, version, 'odv.site.config.js');
    assert.equal(fs.existsSync(out), true, out);
    const checked = run(['check', '--profile', profile, '--version', version, '--config', out]);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /OK: the site configuration matches/);
  }
});

test('an until gate is inclusive for the older release and skipped for the newer one', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: { showPerfOverlay: true },
    until: { showPerfOverlay: '2.10.0' },
  });
  const older = generate(dir, profile, '2.10.0');
  const newer = generate(dir, profile, '2.11.0');
  assert.equal(older.result.code, 0, older.result.stderr);
  assert.equal(newer.result.code, 0, newer.result.stderr);
  assert.equal(siteOf(older.out).showPerfOverlay, true);
  assert.equal(siteOf(newer.out).showPerfOverlay, false);
  assert.match(newer.result.stdout, /skipped \(until 2\.10\.0\)\s+showPerfOverlay/);
});

test('gates also apply to unset entries and compare version components numerically', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    unset: ['showPerfOverlay'],
    since: { showPerfOverlay: '2.9.0', '// comment': 'ignored' },
  });
  const older = generate(dir, profile, '2.10.0');
  assert.equal(older.result.code, 0, older.result.stderr);
  assert.equal('showPerfOverlay' in siteOf(older.out), false, '2.10.0 is newer than 2.9.0');
  assert.doesNotMatch(older.result.stdout, /skipped/);

  const newerProfile = writeProfile(dir, {
    name: 'Example Hospital',
    unset: ['showPerfOverlay'],
    since: { showPerfOverlay: '2.11.0' },
  }, 'newer.json');
  const skipped = generate(dir, newerProfile, '2.10.0', 'skipped.js');
  assert.equal(skipped.result.code, 0, skipped.result.stderr);
  assert.equal(siteOf(skipped.out).showPerfOverlay, false);
  assert.match(skipped.result.stdout, /skipped \(since 2\.11\.0\)\s+showPerfOverlay/);
});

test('--loader wins over a tag for verification without changing the tagged header', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } });
  const out = path.join(dir, 'explicit-loader.js');
  const generated = run(['generate', '--profile', profile, '--version', '2.10.0', '--loader', DEFAULT_LOADER, '--out', out]);
  assert.equal(generated.code, 0, generated.stderr);
  assert.match(readGenerated(out), /version from tag v2\.10\.0/);

  const ambiguous = run(['generate', '--profile', profile, '--version', '2.10.0', '--sample', DEFAULT_SAMPLE, '--out', out]);
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.stderr, /--version and --sample cannot be combined/);
});

test('orphan gates and gated custom samples fail instead of guessing', () => {
  const dir = tempDir();
  const orphan = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'i18n.default': 'en' },
    since: { 'toolbar.largeButtons': '2.11.0' },
  });
  const orphanResult = generate(dir, orphan, '2.11.0', 'orphan.js');
  assert.equal(orphanResult.result.code, 1);
  assert.match(orphanResult.result.stderr, /Gate "since\.toolbar\.largeButtons" does not name a path in set or unset/);

  const sample = path.join(dir, 'custom.sample.js');
  fs.copyFileSync(DEFAULT_SAMPLE, sample);
  const gated = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'toolbar.largeButtons': false },
    since: { 'toolbar.largeButtons': '2.11.0' },
  }, 'gated.json');
  const out = path.join(dir, 'custom.js');
  const custom = run(['generate', '--profile', gated, '--sample', sample, '--out', out]);
  assert.equal(custom.code, 1);
  assert.match(custom.stderr, /profile is version-gated, but no version is known/);
  assert.equal(fs.existsSync(out), false);
});

test('version and generate-all argument shapes are usage errors', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: {} });
  const out = path.join(dir, 'out.js');
  const badVersion = run(['generate', '--profile', profile, '--version', '2.10', '--out', out]);
  assert.equal(badVersion.code, 2);
  assert.match(badVersion.stderr, /--version must have three dot-separated numbers/);

  const cases = [
    ['2.10.0,2.10.0', 'odv.site.config.js', /duplicate versions/],
    ['2.10.0,', 'odv.site.config.js', /--versions must be a non-empty/],
    ['2.10.0', '..\\outside.js', /--name must be a plain file name/],
    ['2.10.0', 'nested/out.js', /--name must be a plain file name/],
  ];
  for (const [versions, name, message] of cases) {
    const result = run(['generate-all', '--profile', profile, '--versions', versions, '--out-dir', path.join(dir, 'releases'), '--name', name]);
    assert.equal(result.code, 2, `${versions} ${name}`);
    assert.match(result.stderr, message);
  }
});

test('generate-all stops at the first failed version and writes nothing more', () => {
  const dir = tempDir();
  const outDir = path.join(dir, 'releases');
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'toolbar.largeButtons': false } });
  const result = run(['generate-all', '--profile', profile, '--versions', '2.11.0,2.10.0', '--out-dir', outDir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Generation for version 2\.10\.0 failed:/);
  assert.match(result.stderr, /"toolbar\.largeButtons" does not exist/);
  assert.equal(fs.existsSync(path.join(outDir, '2.11.0', 'odv.site.config.js')), true);
  assert.equal(fs.existsSync(path.join(outDir, '2.10.0', 'odv.site.config.js')), false);
});
