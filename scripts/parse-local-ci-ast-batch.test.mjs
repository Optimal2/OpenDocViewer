import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createPowerShellParser } from './parse-local-ci-ast.mjs';

function fixture() {
  const calls = [];
  const spawn = (exe, args, options) => {
    const batch = args.includes('-ManifestPath');
    const files = batch ? JSON.parse(fs.readFileSync(args.at(-1), 'utf8')) : [args.at(-1)];
    const results = files.map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return { parseErrors: [], nodes: [{ id: 1, parentId: 0, type: 'ScriptBlockAst', start: 0, end: text.length, text }] };
    });
    calls.push({ exe, args, options, files, results });
    return { status: 0, stdout: JSON.stringify(batch ? { paths: files, results } : results[0]), stderr: '' };
  };
  return { calls, spawn };
}

test('batch parser caches exact source text only, and deduplicates prewarming', () => {
  const { calls, spawn } = fixture();
  const parser = createPowerShellParser({ spawn });
  parser.prewarm(['same', 'same', 'same ', ' same', 'same\r\n', 'same\n']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].files.length, 5);
  for (const text of ['same', 'same ', ' same', 'same\r\n', 'same\n']) assert.equal(parser.parse(text).nodes[0].text, text);
  assert.equal(calls.length, 1);
  assert.equal(parser.parse('new').nodes[0].text, 'new');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('-Path'), 'uncached single parse retains the single-file API');
  assert.equal(createPowerShellParser({ spawn }).parse('same').nodes[0].text, 'same');
  assert.equal(calls.length, 3, 'cache belongs to one parser instance');
});

test('batch parser bounds groups and keeps the explicit 64 MiB buffer', () => {
  const { calls, spawn } = fixture();
  createPowerShellParser({ spawn }).prewarm(Array.from({ length: 35 }, (_, i) => `source ${i}`));
  assert.deepEqual(calls.map((call) => call.files.length), [16, 16, 3]);
  assert.ok(calls.every((call) => call.options.maxBuffer === 64 * 1024 * 1024));
  assert.ok(calls.flatMap((call) => call.files).every((file) => !fs.existsSync(file)), 'temporary files are removed');
});

test.each([
  ['unavailable interpreters', { error: { code: 'ENOENT', message: 'missing' } }, /PowerShell \(pwsh\/powershell\) is unavailable.*refusing to skip/],
  ['maxBuffer refusal', { error: { code: 'ENOBUFS', message: 'buffer full' } }, /exceeded the 64 MiB maxBuffer \(ENOBUFS\).*not a missing interpreter/],
  ['launch failure', { error: { code: 'EACCES', message: 'denied' } }, /failed to launch pwsh \(EACCES\).*refusing to skip/],
  ['process failure', { status: 7, stderr: 'parser failed' }, /parser exited 7: parser failed/],
  ['terminated process', { status: null, signal: 'SIGTERM', stderr: '' }, /parser exited null/],
  ['invalid JSON', { status: 0, stdout: '{' }, /JSON/],
])('batch parser refuses %s', (name, response, reason) => {
  const attempts = [];
  const { spawn } = fixture();
  let broken = true;
  const parser = createPowerShellParser({ spawn: (exe, ...args) => { attempts.push(exe); return broken ? response : spawn(exe, ...args); } });
  assert.throws(() => parser.prewarm(['a', 'b']), reason);
  assert.deepEqual(attempts, name === 'unavailable interpreters' ? ['pwsh', 'powershell'] : ['pwsh']);
  broken = false;
  assert.equal(parser.parse('a').nodes[0].text, 'a', 'failed batch must not populate the cache');
});

test('batch parser falls back only when the first interpreter is missing', () => {
  const { spawn, calls } = fixture();
  const parser = createPowerShellParser({ spawn: (exe, ...args) => exe === 'pwsh'
    ? { error: { code: 'ENOENT', message: 'missing' } } : spawn(exe, ...args) });
  parser.prewarm(['a', 'b']);
  assert.deepEqual(calls.map((call) => call.exe), ['powershell']);
});

test.each([
  ['missing results', (data) => { delete data.results; }],
  ['missing entry', (data) => { data.results.pop(); }],
  ['extra entry', (data) => { data.results.push(data.results[0]); }],
  ['wrong ordering', (data) => { data.paths.reverse(); }],
  ['invalid AST', (data) => { data.results[1].nodes = null; }],
  ['invalid parse errors', (data) => { data.results[1].parseErrors = 'error'; }],
])('batch parser refuses corrupt response: %s', (name, corrupt) => {
  const { spawn, calls } = fixture();
  let broken = true;
  const parser = createPowerShellParser({ spawn: (...args) => {
    const result = spawn(...args);
    if (broken) { const data = JSON.parse(result.stdout); corrupt(data); result.stdout = JSON.stringify(data); }
    return result;
  } });
  assert.throws(() => parser.prewarm(['a', 'b']), /PowerShell AST (batch response|response)/);
  broken = false;
  assert.equal(parser.parse('a').nodes[0].text, 'a');
  assert.equal(calls.length, 2, 'an invalid later entry must not cache an earlier one');
});

test('real batch parser preserves single-file ASTs, malformed source errors and file errors', () => {
  const parserScript = fileURLToPath(new URL('./parse-local-ci-ast.ps1', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-batch-contract-'));
  try {
    const texts = ['', "# comment\r\n$x = 'åäö'\r\n", '$x = (', 'if ($true) {', "$x = 'unterminated"];
    const files = texts.map((text, i) => { const file = path.join(dir, `${i}.ps1`); fs.writeFileSync(file, text); return file; });
    files.push(path.join(dir, 'missing.ps1'));
    const invoke = (args) => {
      const result = spawnSync('pwsh', ['-NoProfile', '-File', parserScript, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const singles = files.map((file) => invoke(['-Path', file]));
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify(files));
    const batch = invoke(['-ManifestPath', manifest]);
    assert.deepEqual(batch.paths, files);
    assert.deepEqual(batch.results, singles);
    assert.ok(singles.slice(2).every((parsed) => parsed.parseErrors.length > 0));
    for (const invalid of ['{}', '[]', '[null]', '["a", 2]', '{', JSON.stringify(Array(17).fill('a'))]) {
      fs.writeFileSync(manifest, invalid);
      const result = spawnSync('pwsh', ['-NoProfile', '-File', parserScript, '-ManifestPath', manifest], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `invalid manifest must fail: ${invalid}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real parser emits UTF-8 under a legacy inherited console code page', () => {
  const script = fileURLToPath(new URL('./parse-local-ci-ast.ps1', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-ast-encoding-'));
  try {
    const wrapper = path.join(dir, 'legacy-console.ps1');
    const sourceFile = path.join(dir, 'unicode.ps1');
    const source = "# comment\r\n$x = '\u00e5\u00e4\u00f6'\r\n";
    fs.writeFileSync(sourceFile, source, 'utf8');
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify([sourceFile]), 'utf8');
    fs.writeFileSync(wrapper, `param([string]$Mode,[string]$InputFile)\n[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(1252)\nif ($Mode -eq 'single') { & '${script.replaceAll("'", "''")}' -Path $InputFile } else { & '${script.replaceAll("'", "''")}' -ManifestPath $InputFile }\n`, 'utf8');
    for (const mode of ['single', 'batch']) {
      const result = spawnSync('pwsh', ['-NoProfile', '-File', wrapper, '-Mode', mode, '-InputFile', mode === 'single' ? sourceFile : manifest], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      const ast = mode === 'single' ? parsed : parsed.results[0];
      assert.equal(ast.nodes.find((node) => node.type === 'ScriptBlockAst').text, source, `${mode} must preserve the exact Unicode/CRLF source`);
      assert.ok(ast.nodes.some((node) => node.value === '\u00e5\u00e4\u00f6'), `${mode} must preserve Unicode scalar values`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
