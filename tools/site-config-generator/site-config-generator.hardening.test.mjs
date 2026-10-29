import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import {
  DEFAULT_SAMPLE,
  HEADER_MARKER,
  REPO_ROOT,
  buildHeader,
  generateText,
  main,
  normalizeProfile,
  plainFileNameProblem,
  readSampleVersion,
} from './site-config-generator.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(TOOL_DIR, 'site-config-generator.mjs');
const EXAMPLE_PROFILE = path.join(TOOL_DIR, 'example.profile.json');
const SAMPLE_TEXT = fs.readFileSync(DEFAULT_SAMPLE, 'utf8').replace(/\r\n/g, '\n');
const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-site-config-hardening-'));
  tempRoots.push(dir);
  return dir;
}

function writeProfile(dir, profile, name = 'profile.json') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return file;
}

function run(argv, io = {}) {
  const out = [];
  const err = [];
  const code = main(argv, { log: (s) => out.push(s), error: (s) => err.push(s), ...io });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function readGenerated(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** The generated header: every line up to the first line that is not a comment. */
function headerOf(text) {
  const lines = text.split('\n');
  const end = lines.findIndex((line) => !line.startsWith('//'));
  return lines.slice(0, end).join('\n');
}

function countUndefined(text) {
  return text.split('undefined').length - 1;
}

/** The generator adds no "undefined" of its own: the header has none and the body has the sample's. */
function assertNoToolUndefined(file, sampleText, label) {
  const text = readGenerated(file);
  assert.doesNotMatch(headerOf(text), /undefined/, `${label}: header`);
  assert.equal(countUndefined(text), countUndefined(sampleText), `${label}: body`);
}

// ---------------------------------------------------------------------------------------------
// Finding 1: an explicit --sample at the shipped path keeps the package.json header version
// ---------------------------------------------------------------------------------------------

test('explicit --sample at the shipped path keeps the repository version in header and console', () => {
  const dir = tempDir();
  const version = readSampleVersion();
  const out = path.join(dir, 'f1.js');
  // Same command line as the reported reproduction, run from the repository root.
  const proc = spawnSync(process.execPath, [
    CLI, 'generate', '--profile', 'tools/site-config-generator/example.profile.json',
    '--out', out, '--sample', 'public/odv.site.config.sample.js',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const header = headerOf(readGenerated(out));
  assert.ok(header.includes(
    `// Built from:   public/odv.site.config.sample.js of OpenDocViewer ${version} (version from repository package.json)`
  ), header);
  assert.doesNotMatch(header, /undefined/);
  assert.ok(proc.stdout.split(/\r?\n/).includes(`Sample:  public/odv.site.config.sample.js (OpenDocViewer ${version})`), proc.stdout);
  assert.doesNotMatch(proc.stdout + proc.stderr, /undefined/);

  // Identical to the run without --sample, and check accepts it with or without --sample.
  const implicit = path.join(dir, 'implicit.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', implicit]).code, 0);
  assert.equal(readGenerated(out), readGenerated(implicit));
  for (const extra of [[], ['--sample', DEFAULT_SAMPLE]]) {
    const checked = run(['check', '--profile', EXAMPLE_PROFILE, '--config', out, ...extra]);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, new RegExp(`OpenDocViewer ${version.replace(/\./g, '\\.')}\\)`));
  }
});

test('an unknown version is said in words, never as "undefined"', () => {
  const profile = { name: 'Example Hospital', description: '' };
  const shipped = buildHeader(profile, undefined, DEFAULT_SAMPLE);
  assert.match(shipped, /public\/odv\.site\.config\.sample\.js of OpenDocViewer \(no version inferred\)/);
  assert.doesNotMatch(shipped, /undefined/);
  assert.doesNotMatch(buildHeader(profile, undefined, DEFAULT_SAMPLE, 'v2.10.0'), /undefined/);
  assert.match(buildHeader(profile, undefined, path.join(os.tmpdir(), 'custom.sample.js')), /custom --sample; no version inferred/);
});

test('no generated file or console line of any command contains "undefined" from the tool', () => {
  const dir = tempDir();
  const custom = path.join(dir, 'custom.sample.js');
  fs.writeFileSync(custom, SAMPLE_TEXT, 'utf8');
  // Valid for 2.10.0 and 2.11.0; the gate makes every run print or apply a version decision.
  const gated = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'i18n.default': 'en', 'toolbar.largeButtons': false },
    since: { 'toolbar.largeButtons': '2.11.0' },
  });
  const ungated = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } }, 'ungated.json');
  const tagged = (tag) => spawnSync('git', ['show', `${tag}:public/odv.site.config.sample.js`], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout;
  const variants = [
    ['default', EXAMPLE_PROFILE, [], SAMPLE_TEXT],
    ['explicit shipped --sample', EXAMPLE_PROFILE, ['--sample', DEFAULT_SAMPLE], SAMPLE_TEXT],
    ['custom --sample', EXAMPLE_PROFILE, ['--sample', custom], SAMPLE_TEXT],
    ['custom --sample, ungated', ungated, ['--sample', custom], SAMPLE_TEXT],
    ['--version 2.10.0', gated, ['--version', '2.10.0'], tagged('v2.10.0')],
    ['--version 2.11.0', gated, ['--version', '2.11.0'], tagged('v2.11.0')],
  ];
  for (const [label, profile, extra, sampleText] of variants) {
    const out = path.join(dir, `${label.replace(/\W+/g, '-')}.js`);
    const generated = run(['generate', '--profile', profile, '--out', out, ...extra]);
    assert.equal(generated.code, 0, `${label}: ${generated.stderr}`);
    assert.doesNotMatch(generated.stdout + generated.stderr, /undefined/, label);
    assertNoToolUndefined(out, sampleText.replace(/\r\n/g, '\n'), label);
    const checked = run(['check', '--profile', profile, '--config', out, ...extra]);
    assert.equal(checked.code, 0, `${label}: ${checked.stdout}${checked.stderr}`);
    assert.doesNotMatch(checked.stdout + checked.stderr, /undefined/, `${label} check`);
  }

  const outDir = path.join(dir, 'releases');
  const all = run(['generate-all', '--profile', gated, '--versions', '2.10.0,2.11.0', '--out-dir', outDir]);
  assert.equal(all.code, 0, all.stderr);
  assert.match(all.stdout, /2\.10\.0:\s+skipped \(since 2\.11\.0\)\s+toolbar\.largeButtons/);
  assert.doesNotMatch(all.stdout + all.stderr, /undefined/);
  for (const version of ['2.10.0', '2.11.0']) {
    assertNoToolUndefined(path.join(outDir, version, 'odv.site.config.js'), tagged(`v${version}`).replace(/\r\n/g, '\n'), version);
  }
});

// ---------------------------------------------------------------------------------------------
// Finding 2: --name must be a plain, ordinary file name
// ---------------------------------------------------------------------------------------------

test('--name rejects device names, colons, trailing space/dot, empty names and separators', () => {
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: {} });
  const outDir = path.join(dir, 'releases');
  const cases = [
    ['', /is empty/],
    ['NUL', /reserved Windows device name/],
    ['nul', /reserved Windows device name/],
    ['CON.js', /reserved Windows device name/],
    ['con.site.config.js', /reserved Windows device name/],
    ['Aux', /reserved Windows device name/],
    ['PRN.txt', /reserved Windows device name/],
    ['COM1', /reserved Windows device name/],
    ['com9.js', /reserved Windows device name/],
    ['LPT1.js', /reserved Windows device name/],
    ['lpt9', /reserved Windows device name/],
    ['NUL .js', /reserved Windows device name/],
    ['file.js:stream', /contains a colon/],
    ['C:other.js', /contains a colon/],
    ['odv.site.config.js ', /ends with a space or a dot/],
    ['odv.site.config.js.', /ends with a space or a dot/],
    ['odv?.js', /character that Windows does not allow/],
    ['odv\u0001.js', /character that Windows does not allow/],
    ['.', /directory reference/],
    ['..', /directory reference/],
    ['../x', /path separator/],
    ['..\\x', /path separator/],
    ['nested/out.js', /path separator/],
  ];
  for (const [name, message] of cases) {
    const result = run(['generate-all', '--profile', profile, '--versions', '2.10.0', '--out-dir', outDir, '--name', name]);
    assert.equal(result.code, 2, JSON.stringify(name));
    assert.match(result.stderr, /--name must be a plain file name/, JSON.stringify(name));
    assert.match(result.stderr, message, JSON.stringify(name));
  }
  assert.equal(fs.existsSync(outDir), false, 'a usage error writes nothing');
});

test('--name accepts an ordinary file name, including names that only start like a device', () => {
  for (const name of ['odv.site.config.js', 'CONSOLE.js', 'com10.js', 'lpt.js', 'nul-site.js', '.hidden.js']) {
    assert.equal(plainFileNameProblem(name), '', name);
  }
  const dir = tempDir();
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } });
  const outDir = path.join(dir, 'releases');
  const result = run(['generate-all', '--profile', profile, '--versions', '2.10.0', '--out-dir', outDir, '--name', 'site-a.config.js']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(outDir, '2.10.0', 'site-a.config.js')), true);
});

// ---------------------------------------------------------------------------------------------
// Finding 3: a failed write leaves the destination untouched and no temporary file behind
// ---------------------------------------------------------------------------------------------

/** Writer that leaves 40 characters in its file and then fails, like a disk-full condition. */
function partialWriter(calls) {
  return (file, text) => {
    calls.push(file);
    fs.writeFileSync(file, text.slice(0, 40), 'utf8');
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  };
}

test('generate keeps the previous file when the write fails part-way', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  const before = fs.readFileSync(out);
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });

  const calls = [];
  const failed = run(['generate', '--profile', profile, '--out', out], { writeFile: partialWriter(calls) });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /ERROR: Cannot write ".*odv\.site\.config\.js": ENOSPC.*previous file, if any, is unchanged/);
  assert.doesNotMatch(failed.stdout, /^Wrote /m);
  assert.equal(calls.length, 1);
  assert.notEqual(path.resolve(calls[0]), path.resolve(out), 'the destination itself is never opened for writing');
  assert.deepEqual(fs.readFileSync(out), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['odv.site.config.js', 'profile.json']);

  // A new destination is not created at all when the write fails.
  const fresh = path.join(dir, 'fresh.js');
  assert.equal(run(['generate', '--profile', profile, '--out', fresh], { writeFile: partialWriter([]) }).code, 1);
  assert.equal(fs.existsSync(fresh), false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['odv.site.config.js', 'profile.json']);
});

test('the atomic write keeps the overwrite protection and --force exactly as before', () => {
  const dir = tempDir();
  const out = path.join(dir, 'handmade.js');
  fs.writeFileSync(out, '// hand-written site config\n', 'utf8');
  const refused = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /exists and was not produced by this tool/);
  assert.equal(fs.readFileSync(out, 'utf8'), '// hand-written site config\n');
  assert.deepEqual(fs.readdirSync(dir), ['handmade.js']);

  const forced = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out, '--force']);
  assert.equal(forced.code, 0, forced.stderr);
  assert.ok(readGenerated(out).startsWith(HEADER_MARKER));
  assert.deepEqual(fs.readdirSync(dir), ['handmade.js']);
});

test('generate-all keeps every previous file and stops after the first failed write', () => {
  const dir = tempDir();
  const outDir = path.join(dir, 'releases');
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } });
  assert.equal(run(['generate-all', '--profile', profile, '--versions', '2.10.0,2.11.0', '--out-dir', outDir]).code, 0);
  const files = ['2.10.0', '2.11.0'].map((v) => path.join(outDir, v, 'odv.site.config.js'));
  const before = files.map((f) => fs.readFileSync(f));

  const changed = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } }, 'changed.json');
  const calls = [];
  const failed = run(['generate-all', '--profile', changed, '--versions', '2.10.0,2.11.0', '--out-dir', outDir], { writeFile: partialWriter(calls) });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /Generation for version 2\.10\.0 failed: Cannot write/);
  assert.equal(calls.length, 1, 'nothing more is written after the first failure');
  files.forEach((f, i) => assert.deepEqual(fs.readFileSync(f), before[i], f));
  for (const v of ['2.10.0', '2.11.0']) assert.deepEqual(fs.readdirSync(path.join(outDir, v)), ['odv.site.config.js']);
});

// ---------------------------------------------------------------------------------------------
// Finding 4: version components beyond Number.MAX_SAFE_INTEGER compare exactly
// ---------------------------------------------------------------------------------------------

test('gates compare version components above Number.MAX_SAFE_INTEGER exactly', () => {
  const profile = normalizeProfile({
    name: 'Example Hospital',
    set: { 'i18n.default': 'en' },
    unset: ['showPerfOverlay'],
    since: { 'i18n.default': '2.11.9007199254740993' },
    until: { showPerfOverlay: '2.11.9007199254740992' },
  });
  // 9007199254740992 and ...993 are the same Number; they must not compare as equal.
  const below = generateText({ profile, sampleText: SAMPLE_TEXT, version: '2.11.9007199254740992' });
  assert.deepEqual(below.skipped, [{ path: 'i18n.default', gate: 'since', version: '2.11.9007199254740993' }]);
  assert.deepEqual(below.changes.map((c) => c.path), ['showPerfOverlay']);

  const at = generateText({ profile, sampleText: SAMPLE_TEXT, version: '2.11.9007199254740993' });
  assert.deepEqual(at.skipped, [{ path: 'showPerfOverlay', gate: 'until', version: '2.11.9007199254740992' }]);
  assert.deepEqual(at.changes.map((c) => c.path), ['i18n.default']);

  // Longer digit strings are larger, and leading zeros do not change the value.
  const longer = generateText({ profile, sampleText: SAMPLE_TEXT, version: '2.11.10000000000000000000' });
  assert.deepEqual(longer.changes.map((c) => c.path), ['i18n.default']);
  const padded = generateText({ profile, sampleText: SAMPLE_TEXT, version: '2.11.09007199254740993' });
  assert.deepEqual(padded.changes.map((c) => c.path), ['i18n.default']);
});
