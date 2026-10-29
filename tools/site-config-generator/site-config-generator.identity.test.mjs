import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';
import { DEFAULT_LOADER, DEFAULT_SAMPLE, PROFILE_TEMPLATE, main } from './site-config-generator.mjs';

// The sample/loader refusal judges FILE IDENTITY, not path spelling, and every write command
// refuses an output file name that is not a plain file name. Specs that point a destination at a
// repository file run behind guards that refuse any write into public/, recognised by the identity
// of the folder, so even a failing run (or a mutation of the code under test) cannot touch it.

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PROFILE = path.join(TOOL_DIR, 'example.profile.json');
const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-site-config-identity-'));
  tempRoots.push(dir);
  return dir;
}

function run(argv, io = {}) {
  const out = [];
  const err = [];
  const code = main(argv, { log: (s) => out.push(s), error: (s) => err.push(s), ...io });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function identityOf(file) {
  try {
    const stats = fs.statSync(file, { bigint: true });
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

const PUBLIC_DIR = path.dirname(DEFAULT_SAMPLE);
const PUBLIC_DIR_IDENTITY = identityOf(PUBLIC_DIR);

/** In the repository's public/ folder, by the folder's identity or by its name. */
function isRepositoryFile(file) {
  const dir = path.dirname(file);
  if (PUBLIC_DIR_IDENTITY !== undefined && identityOf(dir) === PUBLIC_DIR_IDENTITY) return true;
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(dir) === norm(PUBLIC_DIR);
}

/** Recording file operations that refuse a rename into public/; `overrides` replace real calls. */
function guardedOps(calls, overrides = {}) {
  const real = {
    realpathSync: (f) => fs.realpathSync(f),
    lstatSync: (f) => fs.lstatSync(f),
    statSync: (f, o) => fs.statSync(f, o),
    chmodSync: (f, m) => fs.chmodSync(f, m),
    renameSync: (from, to) => {
      if (isRepositoryFile(to)) throw new Error(`test guard: refused to rename onto repository file ${to}`);
      return fs.renameSync(from, to);
    },
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

/** Recording writer that refuses to create anything in public/. */
function guardedWriter(writes) {
  return (file, text) => {
    writes.push(file);
    if (isRepositoryFile(file)) throw new Error(`test guard: refused to create ${file}`);
    fs.writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
  };
}

/** statSync override: `alias` reports the identity of `file`, as a second spelling of it would. */
function statAs(alias, file) {
  return (f, o) => fs.statSync(path.resolve(f) === path.resolve(alias) ? file : f, o);
}

const HAND_WRITTEN = '// hand-written stand-in for a second spelling of a repository file\n';
const PROTECTED = [
  ['sample', DEFAULT_SAMPLE, 'sample file'],
  ['loader', DEFAULT_LOADER, 'loader (odv.config.js)'],
];

// ---------------------------------------------------------------------------------------------
// A second spelling of the sample or the loader (mapped/substituted drive, \\?\ prefix, hard
// link) is the same file: refused by identity in all three write commands
// ---------------------------------------------------------------------------------------------

for (const [what, file, label] of PROTECTED) {
  const expectedVia = `(it is the same file as "${path.resolve(file)}")`;

  test(`generate refuses a second spelling of the ${what} by file identity, with and without --force`, () => {
    const dir = tempDir();
    const alias = path.join(dir, 'alias.js');
    fs.writeFileSync(alias, HAND_WRITTEN, 'utf8');
    const before = fs.readFileSync(file);
    const calls = [];
    const writes = [];
    const io = { writeFile: guardedWriter(writes), fileOps: guardedOps(calls, { statSync: statAs(alias, file) }) };
    for (const extra of [[], ['--force']]) {
      const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', alias, ...extra], io);
      assert.equal(result.code, 1, extra.join(' '));
      assert.equal(result.stderr, `ERROR: --out must not be the ${label} itself ${expectedVia}.`);
    }
    assert.deepEqual(writes, []);
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.equal(fs.readFileSync(alias, 'utf8'), HAND_WRITTEN);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  test(`generate-all refuses a second spelling of the ${what} by file identity, with and without --force`, () => {
    const dir = tempDir();
    const outDir = path.join(dir, 'releases');
    const alias = path.join(outDir, '2.10.0', 'odv.site.config.js');
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.writeFileSync(alias, HAND_WRITTEN, 'utf8');
    const before = fs.readFileSync(file);
    const calls = [];
    const writes = [];
    const io = { writeFile: guardedWriter(writes), fileOps: guardedOps(calls, { statSync: statAs(alias, file) }) };
    for (const extra of [[], ['--force']]) {
      const result = run(['generate-all', '--profile', EXAMPLE_PROFILE, '--versions', '2.10.0', '--out-dir', outDir, ...extra], io);
      assert.equal(result.code, 1, extra.join(' '));
      assert.equal(result.stderr, `ERROR: Generation for version 2.10.0 failed: "${alias}" must not be the ${label} itself ${expectedVia}.`);
    }
    assert.deepEqual(writes, []);
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.equal(fs.readFileSync(alias, 'utf8'), HAND_WRITTEN);
    assert.deepEqual(fs.readFileSync(file), before);
  });

  test(`new-profile refuses a second spelling of the ${what} by file identity, with and without --force`, () => {
    const dir = tempDir();
    const alias = path.join(dir, 'alias.json');
    fs.writeFileSync(alias, HAND_WRITTEN, 'utf8');
    const before = fs.readFileSync(file);
    const calls = [];
    const writes = [];
    const io = { writeFile: guardedWriter(writes), fileOps: guardedOps(calls, { statSync: statAs(alias, file) }) };
    for (const extra of [[], ['--force']]) {
      const result = run(['new-profile', '--out', alias, ...extra], io);
      assert.equal(result.code, 1, extra.join(' '));
      assert.equal(result.stderr, `ERROR: --out must not be the ${label} itself ${expectedVia}.`);
    }
    assert.deepEqual(writes, []);
    assert.equal(calls.some(([name]) => name === 'renameSync'), false);
    assert.equal(fs.readFileSync(alias, 'utf8'), HAND_WRITTEN);
    assert.deepEqual(fs.readFileSync(file), before);
  });
}

test.skipIf(process.platform !== 'win32')('a real \\\\?\\ spelling of the sample or the loader is refused (generate and new-profile)', () => {
  // No injection: the verbatim prefix reaches the real file system. Where realpath accepts it, it
  // keeps the prefix (so no path comparison matches) and only the file identity recognises the
  // file; some Node versions instead fail to resolve such a path at all ("Cannot resolve").
  // Either way the command must refuse and nothing may be written.
  const verbatim = (p) => `\\\\?\\${path.resolve(p)}`;
  const spellings = (p) => [verbatim(p), verbatim(p).toLowerCase()];
  for (const [what, file, label] of PROTECTED) {
    const before = fs.readFileSync(file);
    for (const out of spellings(file)) {
      for (const extra of [[], ['--force']]) {
        for (const argv of [['new-profile', '--out', out], ['generate', '--profile', EXAMPLE_PROFILE, '--out', out]]) {
          const calls = [];
          const writes = [];
          const result = run([...argv, ...extra], { writeFile: guardedWriter(writes), fileOps: guardedOps(calls) });
          assert.equal(result.code, 1, `${what} ${argv[0]} ${out} ${extra.join(' ')}`);
          const refused = new RegExp(`^ERROR: (--out must not be the ${label.replace(/[()]/g, '\\$&')} itself \\(it is the same file as |Cannot resolve )`);
          assert.match(result.stderr, refused, result.stderr);
          assert.deepEqual(writes, []);
          assert.equal(calls.some(([name]) => name === 'renameSync'), false);
        }
      }
    }
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test('identity is only compared when both dev and ino are known and equal', () => {
  // ino 0 means "no identity": two such files must not count as the same file.
  const dir = tempDir();
  const out = path.join(dir, 'no-inode.json');
  fs.writeFileSync(out, 'old\n', 'utf8');
  const noInode = (f, o) => ({ ...fs.statSync(f, o), dev: 1n, ino: 0n });
  const zero = run(['new-profile', '--out', out, '--force'], { fileOps: guardedOps([], { statSync: noInode }) });
  assert.equal(zero.code, 0, zero.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), PROFILE_TEMPLATE);

  // The same inode number on another device is another file.
  const otherDevice = path.join(dir, 'other-device.json');
  fs.writeFileSync(otherDevice, 'old\n', 'utf8');
  const sample = fs.statSync(DEFAULT_SAMPLE, { bigint: true });
  const sameInoOtherDev = (f, o) => (path.resolve(f) === otherDevice
    ? { ...fs.statSync(f, o), dev: sample.dev + 1n, ino: sample.ino }
    : fs.statSync(f, o));
  const moved = run(['new-profile', '--out', otherDevice, '--force'], { fileOps: guardedOps([], { statSync: sameInoOtherDev }) });
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(fs.readFileSync(otherDevice, 'utf8'), PROFILE_TEMPLATE);
});

test('a destination that does not exist yet is still refused by name (the path fallback)', () => {
  // A custom --sample that does not exist has no identity: only the path comparison can refuse it.
  const dir = tempDir();
  const missing = path.join(dir, 'missing.sample.js');
  const writes = [];
  const result = run(['generate', '--profile', EXAMPLE_PROFILE, '--sample', missing, '--out', missing, '--force'],
    { writeFile: guardedWriter(writes), fileOps: guardedOps([]) });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'ERROR: --out must not be the sample file itself.');
  assert.deepEqual(writes, []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---------------------------------------------------------------------------------------------
// The output file name must be a plain file name in every write command: no device name, no
// trailing dot or space, no colon (alternate data stream); refused before anything is created
// ---------------------------------------------------------------------------------------------

const TRAILING = 'ends with a space or a dot, which Windows strips silently';
const DEVICE = 'is a reserved Windows device name';
const COLON = 'contains a colon (drive letter or alternate data stream)';
const BAD_NAMES = [
  ['a trailing dot', 'odv.site.config.js.', TRAILING],
  ['a trailing space', 'odv.site.config.js ', TRAILING],
  ['a device name', 'NUL', DEVICE],
  ['a device name with an extension', 'com1.js', DEVICE],
];

/** File operations that must never be reached for a refused name. */
function unreachableOps(calls) {
  const refuse = (name) => () => { throw new Error(`test guard: ${name} must not be reached`); };
  return guardedOps(calls, { renameSync: refuse('renameSync'), chmodSync: refuse('chmodSync'), rmSync: refuse('rmSync') });
}

function refusingWriter(writes) {
  return (file) => {
    writes.push(file);
    throw new Error(`test guard: refused to create ${file}`);
  };
}

for (const [shape, name, problem] of BAD_NAMES) {
  for (const command of ['generate', 'new-profile']) {
    test(`${command} refuses an --out ending in ${shape} before creating anything, with and without --force`, () => {
      const dir = tempDir();
      const out = path.join(dir, name);
      for (const extra of [[], ['--force']]) {
        const calls = [];
        const writes = [];
        const argv = command === 'generate'
          ? ['generate', '--profile', EXAMPLE_PROFILE, '--out', out, ...extra]
          : ['new-profile', '--out', out, ...extra];
        const result = run(argv, { writeFile: refusingWriter(writes), fileOps: unreachableOps(calls) });
        assert.equal(result.code, 1, extra.join(' '));
        assert.equal(result.stderr, `ERROR: "${path.resolve(out)}" is not a usable output file: its file name ${problem}.`);
        assert.deepEqual(writes, []);
        assert.deepEqual(calls, [], 'refused before the destination is resolved or anything is created');
      }
      assert.deepEqual(fs.readdirSync(dir), []);
    });
  }

  test(`generate-all refuses a --name ending in ${shape} as a usage error`, () => {
    const dir = tempDir();
    const outDir = path.join(dir, 'releases');
    const result = run(['generate-all', '--profile', EXAMPLE_PROFILE, '--versions', '2.10.0', '--out-dir', outDir, '--name', name, '--force'],
      { writeFile: refusingWriter([]), fileOps: unreachableOps([]) });
    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`--name must be a plain file name: .* ${problem.replace(/[()]/g, '\\$&')}\\.`));
    assert.deepEqual(fs.readdirSync(dir), []);
  });
}

test('a lookalike of the sample with a trailing dot is refused, not written next to it', () => {
  for (const [, file] of PROTECTED) {
    for (const suffix of ['.', ' ']) {
      const out = `${file}${suffix}`;
      for (const argv of [['new-profile', '--out', out, '--force'], ['generate', '--profile', EXAMPLE_PROFILE, '--out', out, '--force']]) {
        const writes = [];
        const result = run(argv, { writeFile: refusingWriter(writes), fileOps: unreachableOps([]) });
        assert.equal(result.code, 1);
        assert.equal(result.stderr, `ERROR: "${path.resolve(out)}" is not a usable output file: its file name ${TRAILING}.`);
        assert.deepEqual(writes, []);
      }
    }
  }
  assert.equal(fs.readdirSync(PUBLIC_DIR).some((f) => /[ .]$/.test(f)), false);
});

for (const command of ['generate', 'new-profile']) {
  test(`${command} refuses an alternate-data-stream --out and leaves nothing behind`, () => {
    // Real writer and real file operations: if the name were not refused first, Windows would
    // create the temporary file's base name plus a stream and keep the base file after a failure.
    const dir = tempDir();
    const base = path.join(dir, 'existing.js');
    fs.writeFileSync(base, 'keep\n', 'utf8');
    const out = `${base}:stream`;
    for (const extra of [[], ['--force']]) {
      const argv = command === 'generate'
        ? ['generate', '--profile', EXAMPLE_PROFILE, '--out', out, ...extra]
        : ['new-profile', '--out', out, ...extra];
      const result = run(argv);
      assert.equal(result.code, 1, extra.join(' '));
      assert.equal(result.stderr, `ERROR: "${path.resolve(out)}" is not a usable output file: its file name ${COLON}.`);
    }
    assert.deepEqual(fs.readdirSync(dir), ['existing.js']);
    assert.equal(fs.readFileSync(base, 'utf8'), 'keep\n');
  });
}

test('generate-all refuses a --name with an alternate data stream as a usage error', () => {
  const dir = tempDir();
  const result = run(['generate-all', '--profile', EXAMPLE_PROFILE, '--versions', '2.10.0', '--out-dir', path.join(dir, 'releases'), '--name', 'odv.site.config.js:stream', '--force']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--name must be a plain file name: .* contains a colon/);
  assert.deepEqual(fs.readdirSync(dir), []);
});
