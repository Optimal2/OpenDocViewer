import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import {
  DEFAULT_LOADER,
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
    ['COM¹.js', /reserved Windows device name/],
    ['com²', /reserved Windows device name/],
    ['COM³.txt', /reserved Windows device name/],
    ['LPT¹', /reserved Windows device name/],
    ['lpt².js', /reserved Windows device name/],
    ['LPT³ .js', /reserved Windows device name/],
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
// Review round 2: the atomic write keeps permissions, symlinks and the original error
// ---------------------------------------------------------------------------------------------

/** Pass-through file operations that record every call as [name, ...args]. */
function recordingOps(calls, overrides = {}) {
  const real = {
    realpathSync: (f) => fs.realpathSync(f),
    lstatSync: (f) => fs.lstatSync(f),
    statSync: (f) => fs.statSync(f),
    chmodSync: (f, m) => fs.chmodSync(f, m),
    renameSync: (a, b) => fs.renameSync(a, b),
    rmSync: (f, o) => fs.rmSync(f, o),
  };
  const ops = {};
  for (const name of Object.keys(real)) {
    ops[name] = (...args) => {
      calls.push([name, ...args]);
      return (overrides[name] || real[name])(...args);
    };
  }
  return ops;
}

function enoent(file) {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${file}'`), { code: 'ENOENT' });
}

/** Can this process create a file symlink? (Windows needs Developer Mode or elevation.) */
function canSymlink(dir) {
  const target = path.join(dir, 'probe-target');
  const probe = path.join(dir, 'probe-link');
  try {
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, probe, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { force: true });
    fs.rmSync(target, { force: true });
  }
}

test('regeneration copies the destination mode onto the temporary file before the rename', () => {
  // Asserted through the injected file operations: Windows cannot hold a POSIX 0600 mode.
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const calls = [];
  // A new destination has no mode to copy, so chmod is never called.
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out], { fileOps: recordingOps(calls) }).code, 0);
  assert.equal(calls.some(([name]) => name === 'chmodSync'), false);

  calls.length = 0;
  const real = fs.realpathSync(out);
  const tightened = recordingOps(calls, {
    statSync: (f) => ({ mode: f === real ? 0o100600 : fs.statSync(f).mode }),
    chmodSync: () => {},
  });
  const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out], { fileOps: tightened });
  assert.equal(result.code, 0, result.stderr);
  const chmods = calls.filter(([name]) => name === 'chmodSync');
  assert.equal(chmods.length, 1);
  const [, tempFile, mode] = chmods[0];
  assert.equal(mode, 0o600, 'only the permission bits, not the file type');
  assert.notEqual(path.resolve(tempFile), path.resolve(out));
  assert.equal(path.dirname(tempFile), path.dirname(real));
  const order = calls.map(([name]) => name);
  assert.ok(order.indexOf('chmodSync') < order.indexOf('renameSync'), order.join(','));
  assert.deepEqual(calls.find(([name]) => name === 'renameSync').slice(1), [tempFile, real]);
});

test.skipIf(process.platform === 'win32')('a tightened POSIX mode survives a real regeneration', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  fs.chmodSync(out, 0o600);
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  assert.equal(fs.statSync(out).mode & 0o7777, 0o600);
});

test('a mode that cannot be read or applied fails the write and keeps the previous file', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  const before = fs.readFileSync(out);
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });
  const eperm = () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  for (const override of [{ chmodSync: eperm }, { statSync: eperm }]) {
    const calls = [];
    const failed = run(['generate', '--profile', profile, '--out', out], { fileOps: recordingOps(calls, override) });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /ERROR: Cannot write ".*odv\.site\.config\.js": EPERM.*previous file, if any, is unchanged/);
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.equal(calls.filter(([name]) => name === 'rmSync').length, 1, 'our temporary file is removed');
    assert.deepEqual(fs.readFileSync(out), before);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['odv.site.config.js', 'profile.json']);
  }
});

test('a symlinked destination is written through to its target, which keeps the link', () => {
  // Through the injected realpath: "link.js" is a regular file standing in for a symlink to
  // deploy/odv.site.config.js, so the spec also runs where symlinks need extra privileges.
  const dir = tempDir();
  const deploy = path.join(dir, 'deploy');
  fs.mkdirSync(deploy);
  const target = path.join(deploy, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', target]).code, 0);
  const link = path.join(dir, 'link.js');
  fs.copyFileSync(target, link);
  const standIn = fs.readFileSync(link);
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });
  const calls = [];
  const ops = recordingOps(calls, { realpathSync: (f) => (path.resolve(f) === link ? target : fs.realpathSync(f)) });
  const result = run(['generate', '--profile', profile, '--out', link], { fileOps: ops });
  assert.equal(result.code, 0, result.stderr);
  const [, temp, renamedTo] = calls.find(([name]) => name === 'renameSync');
  assert.equal(renamedTo, target);
  assert.equal(path.dirname(temp), deploy, 'the temporary file lives next to the target, never across volumes');
  assert.match(fs.readFileSync(target, 'utf8'), /default: 'sv'/);
  assert.deepEqual(fs.readFileSync(link), standIn, 'the link itself is not replaced');
  assert.deepEqual(fs.readdirSync(deploy), ['odv.site.config.js']);
});

test('real symlinks: written through, overwrite protection and --force unchanged, sample refused', (ctx) => {
  const dir = tempDir();
  if (!canSymlink(dir)) ctx.skip();
  const target = path.join(dir, 'deploy.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', target]).code, 0);
  const link = path.join(dir, 'link.js');
  fs.symlinkSync(target, link, 'file');
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });
  assert.equal(run(['generate', '--profile', profile, '--out', link]).code, 0);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.match(fs.readFileSync(target, 'utf8'), /default: 'sv'/);

  // A link to a hand-written file is refused without --force and written through with it.
  const hand = path.join(dir, 'hand.js');
  fs.writeFileSync(hand, '// hand-written site config\n', 'utf8');
  const handLink = path.join(dir, 'hand-link.js');
  fs.symlinkSync(hand, handLink, 'file');
  assert.match(run(['generate', '--profile', profile, '--out', handLink]).stderr, /exists and was not produced by this tool/);
  assert.equal(fs.readFileSync(hand, 'utf8'), '// hand-written site config\n');
  assert.equal(run(['generate', '--profile', profile, '--out', handLink, '--force']).code, 0);
  assert.equal(fs.lstatSync(handLink).isSymbolicLink(), true);
  assert.ok(readGenerated(hand).startsWith(HEADER_MARKER));

  // A link to the sample is the sample itself, even with --force.
  const sampleBefore = fs.readFileSync(DEFAULT_SAMPLE);
  const sampleLink = path.join(dir, 'sample-link.js');
  fs.symlinkSync(DEFAULT_SAMPLE, sampleLink, 'file');
  assert.match(run(['generate', '--profile', profile, '--out', sampleLink, '--force']).stderr, /must not be the sample file itself/);
  assert.deepEqual(fs.readFileSync(DEFAULT_SAMPLE), sampleBefore);
});

test('--out resolving to the sample is refused even with --force (injected realpath)', () => {
  const dir = tempDir();
  const link = path.join(dir, 'link.js');
  fs.writeFileSync(link, '// stand-in for a symlink to the sample\n', 'utf8');
  const sampleBefore = fs.readFileSync(DEFAULT_SAMPLE);
  const sampleReal = fs.realpathSync(DEFAULT_SAMPLE);
  const ops = recordingOps([], { realpathSync: (f) => (path.resolve(f) === link ? sampleReal : fs.realpathSync(f)) });
  const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', link, '--force'], { fileOps: ops });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--out must not be the sample file itself/);
  assert.deepEqual(fs.readFileSync(DEFAULT_SAMPLE), sampleBefore);
});

test('a dangling symlink destination is refused, not replaced by a regular file', () => {
  const dir = tempDir();
  const link = path.join(dir, 'dangling.js');
  const calls = [];
  const ops = recordingOps(calls, {
    realpathSync: (f) => { if (path.resolve(f) === link) throw enoent(f); return fs.realpathSync(f); },
    lstatSync: (f) => (path.resolve(f) === link ? { isSymbolicLink: () => true } : fs.lstatSync(f)),
  });
  for (const extra of [[], ['--force']]) {
    const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', link, ...extra], { fileOps: ops });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is a symbolic link whose target does not exist/);
  }
  assert.equal(calls.some(([name]) => name === 'renameSync'), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a temporary name that already exists (EEXIST) is never removed: it is not ours', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const calls = [];
  let stranger;
  const writer = (file) => {
    stranger = file;
    fs.writeFileSync(file, 'someone else\n', 'utf8');
    throw Object.assign(new Error(`EEXIST: file already exists, open '${file}'`), { code: 'EEXIST' });
  };
  const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out], { writeFile: writer, fileOps: recordingOps(calls) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ERROR: Cannot write ".*odv\.site\.config\.js": EEXIST/);
  assert.equal(calls.some(([name]) => name === 'rmSync'), false);
  assert.equal(fs.readFileSync(stranger, 'utf8'), 'someone else\n');
  assert.equal(fs.existsSync(out), false);
});

test('a failing cleanup never hides the original write error', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  const before = fs.readFileSync(out);
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });
  const calls = [];
  const ops = recordingOps(calls, {
    rmSync: () => { throw Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' }); },
  });
  const failed = run(['generate', '--profile', profile, '--out', out], { writeFile: partialWriter([]), fileOps: ops });
  assert.equal(failed.code, 1, 'a GeneratorError, not an escaping exception');
  assert.match(failed.stderr, /ERROR: Cannot write ".*odv\.site\.config\.js": ENOSPC.*previous file, if any, is unchanged/);
  assert.match(failed.stderr, /temporary file ".*" could not be removed \(EPERM.*delete it manually/);
  assert.equal(calls.filter(([name]) => name === 'rmSync').length, 1);
  assert.deepEqual(fs.readFileSync(out), before);

  // generate-all reports the same way and stops at the first version.
  const all = run(['generate-all', '--profile', profile, '--versions', '2.10.0,2.11.0', '--out-dir', path.join(dir, 'r')],
    { writeFile: partialWriter([]), fileOps: ops });
  assert.equal(all.code, 1);
  assert.match(all.stderr, /Generation for version 2\.10\.0 failed: Cannot write .*ENOSPC.*could not be removed/);
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

// ---------------------------------------------------------------------------------------------
// Review round 3: the destination is resolved once, and generate-all protects the sample and the
// loader exactly like generate
// ---------------------------------------------------------------------------------------------

const PUBLIC_DIR_REAL = path.dirname(fs.realpathSync(DEFAULT_SAMPLE));

/** Anything in the repository's public/ folder (the sample, the loader, a temporary file there). */
function isRepositoryFile(file) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(path.dirname(file)) === norm(PUBLIC_DIR_REAL) || norm(path.dirname(file)) === norm(path.dirname(DEFAULT_SAMPLE));
}

/**
 * Guards for specs that point a destination at a repository file: if the code under test ever
 * tried to write there, the guard throws instead, so even a failing run cannot touch public/.
 */
function guardedOps(calls, overrides = {}) {
  return recordingOps(calls, {
    ...overrides,
    renameSync: (from, to) => {
      if (isRepositoryFile(to)) throw new Error(`test guard: refused to rename onto repository file ${to}`);
      return fs.renameSync(from, to);
    },
  });
}

function guardedWriter(file, text) {
  if (isRepositoryFile(file)) throw new Error(`test guard: refused to create ${file}`);
  fs.writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
}

/** Realpath override: `link` resolves to `to`; everything else resolves for real. */
function linkTo(link, to) {
  return (f) => (path.resolve(f) === path.resolve(link) ? to : fs.realpathSync(f));
}

/** A profile that fits both release tags used by generate-all here (2.10.0 and 2.11.0). */
function simpleProfile(dir) {
  return writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'en' } }, 'simple.profile.json');
}

/** lstat override: `link` reports itself as a symbolic link. */
function lstatAsLink(link) {
  return (f) => (path.resolve(f) === path.resolve(link) ? { isSymbolicLink: () => true } : fs.lstatSync(f));
}

test('generate resolves the destination once: the write lands on the target the checks used', () => {
  const dir = tempDir();
  const checked = path.join(dir, 'checked', 'odv.site.config.js');
  fs.mkdirSync(path.dirname(checked));
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', checked]).code, 0);
  // A hand-written file that a SECOND resolution would return: it must never be written.
  const other = path.join(dir, 'other', 'hand.js');
  fs.mkdirSync(path.dirname(other));
  fs.writeFileSync(other, '// hand-written, not produced by this tool\n', 'utf8');
  const link = path.join(dir, 'link.js');
  fs.copyFileSync(checked, link); // stand-in for the link itself
  const linkBefore = fs.readFileSync(link);
  const profile = writeProfile(dir, { name: 'Example Hospital', set: { 'i18n.default': 'sv' } });
  const calls = [];
  let resolutions = 0;
  const ops = recordingOps(calls, {
    realpathSync: (f) => {
      if (path.resolve(f) !== link) return fs.realpathSync(f);
      resolutions += 1;
      return resolutions === 1 ? checked : other;
    },
  });
  const result = run(['generate', '--profile', profile, '--out', link], { fileOps: ops });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(resolutions, 1, 'the destination is resolved exactly once');
  const renames = calls.filter(([name]) => name === 'renameSync');
  assert.equal(renames.length, 1);
  assert.equal(renames[0][2], checked);
  assert.match(fs.readFileSync(checked, 'utf8'), /default: 'sv'/);
  assert.equal(fs.readFileSync(other, 'utf8'), '// hand-written, not produced by this tool\n', 'no write lands on a second resolution');
  assert.deepEqual(fs.readFileSync(link), linkBefore);
  assert.deepEqual(fs.readdirSync(path.dirname(other)), ['hand.js']);
});

test('generate-all resolves each destination once as well', () => {
  const dir = tempDir();
  const outDir = path.join(dir, 'out');
  assert.equal(run(['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0', '--out-dir', outDir]).code, 0);
  const out = path.join(outDir, '2.10.0', 'odv.site.config.js');
  const checked = path.join(dir, 'checked.js');
  fs.copyFileSync(out, checked);
  const other = path.join(dir, 'hand.js');
  fs.writeFileSync(other, '// hand-written\n', 'utf8');
  let resolutions = 0;
  const calls = [];
  const ops = recordingOps(calls, {
    realpathSync: (f) => {
      if (path.resolve(f) !== out) return fs.realpathSync(f);
      resolutions += 1;
      return resolutions === 1 ? checked : other;
    },
  });
  const result = run(['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0', '--out-dir', outDir], { fileOps: ops });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(resolutions, 1);
  assert.equal(calls.find(([name]) => name === 'renameSync')[2], checked);
  assert.equal(fs.readFileSync(other, 'utf8'), '// hand-written\n');
});

for (const [what, file, pattern] of [
  ['sample', DEFAULT_SAMPLE, /must not be the sample file itself \(it is a link to /],
  ['loader', DEFAULT_LOADER, /must not be the loader \(odv\.config\.js\) itself \(it is a link to /],
]) {
  test(`generate refuses a link whose target is the ${what}, with and without --force`, () => {
    const dir = tempDir();
    const link = path.join(dir, 'link.js');
    assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', link]).code, 0); // header-carrying stand-in
    const before = fs.readFileSync(file);
    const calls = [];
    const ops = guardedOps(calls, { realpathSync: linkTo(link, fs.realpathSync(file)), lstatSync: lstatAsLink(link) });
    for (const extra of [[], ['--force']]) {
      const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', link, ...extra], { writeFile: guardedWriter, fileOps: ops });
      assert.equal(result.code, 1, extra.join(' '));
      assert.match(result.stderr, new RegExp(`ERROR: --out ${pattern.source}`));
    }
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  test(`generate-all refuses a link whose target is the ${what}, with and without --force, and stops`, () => {
    const dir = tempDir();
    const outDir = path.join(dir, 'out');
    const link = path.join(outDir, '2.10.0', 'odv.site.config.js');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', link]).code, 0); // header-carrying stand-in
    const before = fs.readFileSync(file);
    const calls = [];
    const ops = guardedOps(calls, { realpathSync: linkTo(link, fs.realpathSync(file)), lstatSync: lstatAsLink(link) });
    for (const extra of [[], ['--force']]) {
      const result = run(['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0,2.11.0', '--out-dir', outDir, ...extra],
        { writeFile: guardedWriter, fileOps: ops });
      assert.equal(result.code, 1, extra.join(' '));
      assert.match(result.stderr, new RegExp(`ERROR: Generation for version 2\\.10\\.0 failed: ".*odv\\.site\\.config\\.js" ${pattern.source}`));
      assert.equal(fs.existsSync(path.join(outDir, '2.11.0')), false, 'no later version is written');
    }
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.deepEqual(fs.readFileSync(file), before);
  });
}

test('generate-all writes through a link to an ordinary file and refuses a dangling link', () => {
  const dir = tempDir();
  const outDir = path.join(dir, 'out');
  const link = path.join(outDir, '2.10.0', 'odv.site.config.js');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const deploy = path.join(dir, 'deploy');
  fs.mkdirSync(deploy);
  const target = path.join(deploy, 'odv.site.config.js');
  fs.writeFileSync(target, '// hand-written\n', 'utf8');
  fs.writeFileSync(link, '// stand-in for the link\n', 'utf8');
  const ops = recordingOps([], { realpathSync: linkTo(link, target) });
  const argv = ['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0', '--out-dir', outDir];
  const refused = run(argv, { fileOps: ops });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /exists and was not produced by this tool/, 'the target is judged');
  assert.equal(fs.readFileSync(target, 'utf8'), '// hand-written\n');
  const forced = run([...argv, '--force'], { fileOps: ops });
  assert.equal(forced.code, 0, forced.stderr);
  assert.ok(readGenerated(target).startsWith(HEADER_MARKER));
  assert.equal(fs.readFileSync(link, 'utf8'), '// stand-in for the link\n', 'the link itself is not replaced');
  assert.deepEqual(fs.readdirSync(deploy), ['odv.site.config.js']);

  const dangling = recordingOps([], {
    realpathSync: (f) => { if (path.resolve(f) === link) throw enoent(f); return fs.realpathSync(f); },
    lstatSync: lstatAsLink(link),
  });
  const result = run([...argv, '--force'], { fileOps: dangling });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Generation for version 2\.10\.0 failed: .* is a symbolic link whose target does not exist/);
});

test('a plain destination is still written by generate and generate-all', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  assert.ok(readGenerated(out).startsWith(HEADER_MARKER));
  const outDir = path.join(dir, 'all');
  assert.equal(run(['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0,2.11.0', '--out-dir', outDir]).code, 0);
  for (const v of ['2.10.0', '2.11.0']) assert.ok(readGenerated(path.join(outDir, v, 'odv.site.config.js')).startsWith(HEADER_MARKER));
});

test('real symlinks: generate-all refuses links to the sample and the loader, with and without --force', (ctx) => {
  const dir = tempDir();
  if (!canSymlink(dir)) ctx.skip();
  for (const file of [DEFAULT_SAMPLE, DEFAULT_LOADER]) {
    const outDir = path.join(dir, path.basename(file));
    const link = path.join(outDir, '2.10.0', 'odv.site.config.js');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(file, link, 'file');
    const before = fs.readFileSync(file);
    for (const extra of [[], ['--force']]) {
      const result = run(['generate-all', '--profile', simpleProfile(dir), '--versions', '2.10.0,2.11.0', '--out-dir', outDir, ...extra],
        { writeFile: guardedWriter, fileOps: guardedOps([]) });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /must not be the (sample file|loader \(odv\.config\.js\)) itself \(it is a link to /);
      assert.equal(fs.existsSync(path.join(outDir, '2.11.0')), false);
    }
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test('the copied permission bits are the mode the regenerated file ends up with (simulated mode table)', () => {
  // An in-memory mode table behind the seam: chmod sets a mode on the temporary file and the
  // rename carries it onto the target, so the spec asserts the RESULTING mode, not only the call.
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  const real = fs.realpathSync(out);
  const modes = new Map([[real, 0o100600]]);
  const ops = recordingOps([], {
    statSync: (f) => ({ mode: modes.has(f) ? modes.get(f) : 0o100644 }),
    chmodSync: (f, m) => { modes.set(f, 0o100000 | m); },
    renameSync: (from, to) => {
      fs.renameSync(from, to);
      modes.set(to, modes.has(from) ? modes.get(from) : 0o100644);
      modes.delete(from);
    },
  });
  const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out], { fileOps: ops });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(ops.statSync(real).mode & 0o7777, 0o600);
  assert.deepEqual([...modes.keys()], [real], 'no mode left behind on a temporary name');
});
