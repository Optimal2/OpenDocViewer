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
  evaluateSiteConfig,
  main,
  readSampleVersion,
} from './site-config-generator.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(TOOL_DIR, 'site-config-generator.mjs');
const EXAMPLE_PROFILE = path.join(TOOL_DIR, 'example.profile.json');
const SAMPLE_TEXT = fs.readFileSync(DEFAULT_SAMPLE, 'utf8');

const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-site-config-generator-'));
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

function siteOf(file) {
  return evaluateSiteConfig(fs.readFileSync(file, 'utf8')).site;
}

test('sample round-trip with example.profile.json: generate, verify through node:vm, then check passes', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const gen = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]);
  assert.equal(gen.code, 0, gen.stderr);

  const profile = JSON.parse(fs.readFileSync(EXAMPLE_PROFILE, 'utf8'));
  // Every set and unset key is listed with old -> new.
  for (const key of Object.keys(profile.set)) {
    const p = key.replace(/^\+/, '');
    assert.match(gen.stdout, new RegExp(`\\s${p.replace(/\./g, '\\.')}\\s.* -> `), `listing for ${p}`);
  }
  for (const p of profile.unset) assert.match(gen.stdout, new RegExp(`unset ${p.replace(/\./g, '\\.')}\\s`));

  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.startsWith(HEADER_MARKER));
  assert.match(text, /\/\/ Site profile: Example Hospital\n/);
  assert.ok(text.includes(`OpenDocViewer ${readSampleVersion()}`));
  // The sample's own comments survive.
  assert.ok(text.includes('// Ctrl/Cmd+P behavior:'));
  assert.ok(text.includes('* IMPORTANT MERGE RULES'));

  const site = siteOf(out);
  assert.equal(site.print.defaultPageMode, 'all');
  assert.equal(site.shortcuts.print.ctrlOrCmdP, 'browser');
  assert.equal(site.viewer.customFitWidthFactorPercent, null);
  assert.deepEqual(site.documentLoading.renderBenchmark.workerCounts, [0, 4]);
  assert.deepEqual(site.theme.bridge, { allowedOrigins: ['https://viewer.example.org'] });
  assert.equal('showPerfOverlay' in site, false);
  assert.equal('preparationNoticeThresholdPages' in site.print, false);

  const check = run(['check', '--profile', EXAMPLE_PROFILE, '--config', out]);
  assert.equal(check.code, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /OK: the site configuration matches/);
});

test('a path that does not exist in the sample is an error unless marked as an addition', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'print.noSuchSetting': 1, 'print.defaultPageMode': 'all' },
    unset: ['viewer.noSuchFlag'],
  });
  const result = run(['generate', '--profile', profile, '--out', out]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"print\.noSuchSetting" does not exist in the sample/);
  assert.match(result.stderr, /"\+print\.noSuchSetting"/);
  assert.match(result.stderr, /"viewer\.noSuchFlag" does not exist in the sample/);
  assert.equal(fs.existsSync(out), false, 'nothing is written on error');

  // Deeper paths through a non-object value are rejected as well.
  const through = writeProfile(dir, { name: 'Example Hospital', set: { 'print.defaultPageMode.x': 1 } }, 'through.json');
  const r2 = run(['generate', '--profile', through, '--out', out]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /"print\.defaultPageMode" is not an object literal/);
});

test('the add marker inserts the key in the addressed block and it reads back through node:vm', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: {
      '+print.pdf.exampleFlag': true,
      '+fineTune.exampleLevel': 3,
      '+theme.defaultMode': 'light',
      'print.pdf.prebuildAllPages.concurrency': 2,
    },
  });
  const result = run(['generate', '--profile', profile, '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /add\s+print\.pdf\.exampleFlag\s+\(absent\) -> true/);

  const text = fs.readFileSync(out, 'utf8');
  // Appended as the last entry of print.pdf: after prebuildAllPages, before the pdf block closes.
  const added = text.indexOf('exampleFlag: true');
  assert.ok(added > text.indexOf('prebuildAllPages: {'));
  assert.ok(added < text.indexOf('// Optional per-action button control'));
  assert.match(text, /concurrency: 2\n {8}},\n {8}\/\/ Added by the site profile: not present in the shipped sample\.\n {8}exampleFlag: true\n {6}}/);
  assert.match(text, /fineTune: \{ enabled: true, exampleLevel: 3 \}/);

  const site = siteOf(out);
  assert.equal(site.print.pdf.exampleFlag, true);
  assert.equal('exampleFlag' in site.print, false);
  assert.equal(site.print.pdf.prebuildAllPages.concurrency, 2);
  assert.deepEqual(site.fineTune, { enabled: true, exampleLevel: 3 });
  assert.equal(site.theme.defaultMode, 'light');

  // Marking an existing key as an addition, or adding below a missing parent, is an error.
  const bad = writeProfile(dir, {
    name: 'Example Hospital',
    set: { '+print.defaultPageMode': 'all', '+print.noSuchBlock.flag': true },
  }, 'bad.json');
  const r2 = run(['generate', '--profile', bad, '--out', path.join(dir, 'bad.js')]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /marked as an addition .* already exists in the sample/);
  assert.match(r2.stderr, /parent "print\.noSuchBlock" does not exist/);
});

test('check detects drift: exit code 1 and a diff summary naming the changed key', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.includes("defaultPageMode: 'all',"));
  fs.writeFileSync(out, text.replace("defaultPageMode: 'all',", "defaultPageMode: 'active',"), 'utf8');

  // Real process, so the exit code is the one an operator or a script sees.
  const proc = spawnSync(process.execPath, [CLI, 'check', '--profile', EXAMPLE_PROFILE, '--config', out], { encoding: 'utf8' });
  assert.equal(proc.status, 1, proc.stderr);
  assert.match(proc.stdout, /Keys that differ:\n {2}changed {3}print\.defaultPageMode {2}regenerated: 'all' {2}existing: 'active'/);
  assert.match(proc.stdout, /- +\d+ \| +defaultPageMode: 'all',/);
  assert.match(proc.stdout, /\+ +\d+ \| +defaultPageMode: 'active',/);
  assert.match(proc.stdout, /DRIFT:/);
});

test('keys at several nesting levels resolve by dotted path, not by name', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    set: {
      'shortcuts.print.ctrlOrCmdP': 'disable',
      'print.defaultPageMode': 'all',
      'compare.overlay.print.enabled': true,
    },
  });
  assert.equal(run(['generate', '--profile', profile, '--out', out]).code, 0);
  const site = siteOf(out);
  assert.equal(site.shortcuts.print.ctrlOrCmdP, 'disable');
  assert.equal('defaultPageMode' in site.shortcuts.print, false);
  assert.equal(site.print.defaultPageMode, 'all');
  assert.equal('ctrlOrCmdP' in site.print, false);
  assert.equal(site.compare.overlay.print.enabled, true);
  assert.equal(site.compare.curtain.print.enabled, false, 'the sibling print block is untouched');
  assert.equal(site.compare.overlay.enabled, false);

  // ctrlOrCmdP exists only below shortcuts.print, so the top-level print path is an error.
  const wrong = writeProfile(dir, { name: 'Example Hospital', set: { 'print.ctrlOrCmdP': 'disable' } }, 'wrong.json');
  const r2 = run(['generate', '--profile', wrong, '--out', path.join(dir, 'wrong.js')]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /"print\.ctrlOrCmdP" does not exist in the sample/);
});

test('CRLF and LF samples are both supported and their line endings are preserved', () => {
  const dir = tempDir();
  const lfSample = path.join(dir, 'sample-lf.js');
  const crlfSample = path.join(dir, 'sample-crlf.js');
  const lf = SAMPLE_TEXT.replace(/\r\n/g, '\n');
  fs.writeFileSync(lfSample, lf, 'utf8');
  fs.writeFileSync(crlfSample, lf.replace(/\n/g, '\r\n'), 'utf8');

  const lfOut = path.join(dir, 'lf.js');
  const crlfOut = path.join(dir, 'crlf.js');
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--sample', lfSample, '--out', lfOut]).code, 0);
  const crlfRun = run(['generate', '--profile', EXAMPLE_PROFILE, '--sample', crlfSample, '--out', crlfOut]);
  assert.equal(crlfRun.code, 0, crlfRun.stderr);

  const lfText = fs.readFileSync(lfOut, 'utf8');
  const crlfText = fs.readFileSync(crlfOut, 'utf8');
  assert.equal(lfText.includes('\r'), false);
  assert.equal(/(^|[^\r])\n/.test(crlfText), false, 'no bare LF in the CRLF output');
  assert.equal(crlfText, lfText.replace(/\n/g, '\r\n'), 'same content, only line endings differ');
  assert.deepEqual(siteOf(crlfOut), siteOf(lfOut));

  assert.equal(run(['check', '--profile', EXAMPLE_PROFILE, '--sample', crlfSample, '--config', crlfOut]).code, 0);
  // Regenerating an existing output keeps that file's line endings, whatever the sample uses.
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--sample', lfSample, '--out', crlfOut]).code, 0);
  assert.equal(fs.readFileSync(crlfOut, 'utf8'), crlfText);
  assert.equal(run(['check', '--profile', EXAMPLE_PROFILE, '--sample', lfSample, '--config', crlfOut]).code, 0);
});

test('values of every JSON type are written as valid JavaScript literals', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const values = {
    'print.pdf.filename': 'it\'s a "quoted" value, a backslash \\ and\nsecond line   end',
    'print.pdf.marginPt': -2.5,
    'print.pdf.enabled': false,
    'userLog.ui.fields.forWhom.regex': null,
    'print.pdf.benchmark.strategies': ['main-thread'],
    'viewer.problemNotice.title': { en: 'Example title', 'x-custom': [1, { deep: true }] },
    'userLog.ui.fields.reason.source.options': [
      { value: 'example-a', label: { en: 'Example reason A with a fairly long label text', sv: 'Example A' } },
      { value: 'example-b', label: { en: 'Example reason B', sv: 'Example B' }, allowFreeText: true },
    ],
  };
  const profile = writeProfile(dir, { name: 'Example Hospital', set: values });
  const result = run(['generate', '--profile', profile, '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  const site = siteOf(out);
  for (const [p, value] of Object.entries(values)) {
    const actual = p.split('.').reduce((o, k) => o[k], site);
    assert.deepEqual(actual, value, p);
  }
  assert.equal(run(['check', '--profile', profile, '--config', out]).code, 0);
});

test('unset comments the property out, or removes it inline when it shares a line', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const profile = writeProfile(dir, {
    name: 'Example Hospital',
    unset: ['printHeader.css', 'fineTune.enabled', 'compare.curtain.print'],
  });
  const result = run(['generate', '--profile', profile, '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /\n {6}\/\/ css: `\n/);
  assert.match(text, /fineTune: \{ \}/);
  assert.match(text, /\n {8}\/\/ print: \{ enabled: false \}\n/);
  const site = siteOf(out);
  assert.equal('css' in site.printHeader, false);
  assert.equal(typeof site.printFooter.css, 'string', 'the footer css is untouched');
  assert.deepEqual(site.fineTune, {});
  assert.deepEqual(site.compare.curtain, { enabled: false });
});

test('conflicting entries and unknown profile keys are rejected', () => {
  const dir = tempDir();
  const out = path.join(dir, 'odv.site.config.js');
  const overlap = writeProfile(dir, {
    name: 'Example Hospital',
    set: { 'print.pdf': { enabled: false } },
    unset: ['print.pdf.filename'],
  });
  const r1 = run(['generate', '--profile', overlap, '--out', out]);
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /Conflicting profile entries/);

  const unknown = writeProfile(dir, { name: 'Example Hospital', sett: {} }, 'unknown.json');
  const r2 = run(['generate', '--profile', unknown, '--out', out]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /Unknown top-level profile key "sett"/);
});

test('generate requires --out and refuses to replace a file it did not produce', () => {
  const dir = tempDir();
  const usage = run(['generate', '--profile', EXAMPLE_PROFILE]);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /requires --out/);

  const out = path.join(dir, 'odv.site.config.js');
  fs.writeFileSync(out, '// hand-written site config\n', 'utf8');
  const refused = run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /was not produced by this tool/);
  assert.equal(fs.readFileSync(out, 'utf8'), '// hand-written site config\n');

  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out, '--force']).code, 0);
  assert.ok(fs.readFileSync(out, 'utf8').startsWith(HEADER_MARKER));
  // Once generated, regenerating needs no --force.
  assert.equal(run(['generate', '--profile', EXAMPLE_PROFILE, '--out', out]).code, 0);
});

test('new-profile writes a commented example profile that generate accepts', () => {
  const dir = tempDir();
  const profile = path.join(dir, 'site.profile.json');
  assert.equal(run(['new-profile', '--out', profile]).code, 0);
  const parsed = JSON.parse(fs.readFileSync(profile, 'utf8'));
  assert.equal(parsed.name, 'Example Hospital');
  assert.ok(Array.isArray(parsed['//']));
  assert.equal(run(['new-profile', '--out', profile]).code, 1, 'no silent overwrite');

  const out = path.join(dir, 'odv.site.config.js');
  const result = run(['generate', '--profile', profile, '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(siteOf(out).print.defaultPageMode, 'all');
});
