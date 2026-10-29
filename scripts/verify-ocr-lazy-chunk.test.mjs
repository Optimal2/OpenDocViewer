// File: scripts/verify-ocr-lazy-chunk.test.mjs
/**
 * analyzeDist must pass a build where the OCR code sits in a dynamically imported ocr chunk and
 * dist/ocr/ matches the installed packages, and must fail for every way that contract can break:
 * tesseract in an eager chunk, a static import of the ocr chunk, a preload of it, a missing
 * chunk, a missing or altered engine file, or a folder that should have been skipped.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { describeOcrAssets } from './ocr-assets.mjs';
import { fakeNodeModules } from './ocr-assets.test.mjs';
import { analyzeDist, eagerScriptsFromHtml, importsOfChunk } from './verify-ocr-lazy-chunk.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const INDEX_HTML = [
  '<!doctype html><html><head>',
  '<script type="module" crossorigin src="./assets/main-AAA.js" data-odv-bootstrap></script>',
  '<link rel="modulepreload" crossorigin href="./assets/bootConfig-BBB.js">',
  '</head><body></body></html>',
].join('\n');

/**
 * @param {{ main?: string, extra?: Object<string, string>, html?: string, withAssets?: boolean }} [options]
 * @returns {{ distDir: string, nodeModulesUrl: URL }}
 */
function fakeDist({ main, extra = {}, html = INDEX_HTML, withAssets = true } = {}) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-verify-ocr-'));
  tempRoots.push(distDir);
  const write = (rel, content) => {
    const full = path.join(distDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  write('index.html', html);
  write('assets/main-AAA.js', main ?? 'import{a}from"./bootConfig-BBB.js";a(()=>import("./ocr-CCC.js"));');
  write('assets/bootConfig-BBB.js', 'export const a=(f)=>f();');
  write('assets/ocr-CCC.js', 'const t="tesseract";export{t};');
  write('odv.config.js', '// Tesseract language codes live here legitimately');
  for (const [rel, content] of Object.entries(extra)) write(rel, content);

  const nodeModulesUrl = fakeNodeModules();
  if (withAssets) {
    for (const file of describeOcrAssets(nodeModulesUrl).files) {
      write(file.fileName, fs.readFileSync(file.sourceUrl));
    }
  }
  return { distDir, nodeModulesUrl };
}

test('a lazy ocr chunk with matching engine files passes and is measured', () => {
  const { distDir, nodeModulesUrl } = fakeDist();
  const result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary.ocrChunks, ['assets/ocr-CCC.js']);
  assert.deepEqual(result.summary.eagerScripts, ['assets/main-AAA.js', 'assets/bootConfig-BBB.js']);
  assert.ok(result.summary.ocrAssetBytes > 0);
  assert.ok(result.summary.distBytes > result.summary.ocrAssetBytes);
  assert.equal(result.summary.ocrChunkBytes, fs.statSync(path.join(distDir, 'assets/ocr-CCC.js')).size);
});

test('tesseract in a chunk that is not an ocr chunk fails', () => {
  const { distDir, nodeModulesUrl } = fakeDist({ main: 'const x="Tesseract";import("./ocr-CCC.js");' });
  const result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.deepEqual(result.problems, ['assets/main-AAA.js mentions tesseract but is not an ocr chunk']);
});

test('a static import of the ocr chunk fails, a dynamic one passes', () => {
  const { distDir, nodeModulesUrl } = fakeDist({ main: 'import{t}from"./ocr-CCC.js";console.log(t);' });
  assert.deepEqual(analyzeDist(distDir, { nodeModulesUrl, skipAssets: false }).problems, ['assets/main-AAA.js imports assets/ocr-CCC.js statically']);

  const other = fakeDist({ main: 'export*from"./ocr-CCC.js";' });
  assert.deepEqual(analyzeDist(other.distDir, { nodeModulesUrl: other.nodeModulesUrl, skipAssets: false }).problems, ['assets/main-AAA.js imports assets/ocr-CCC.js statically']);

  const bare = fakeDist({ main: 'import"./ocr-CCC.js";' });
  assert.deepEqual(analyzeDist(bare.distDir, { nodeModulesUrl: bare.nodeModulesUrl, skipAssets: false }).problems, ['assets/main-AAA.js imports assets/ocr-CCC.js statically']);
});

test('a preload or script tag for the ocr chunk in index.html fails', () => {
  const html = `${INDEX_HTML}\n<link rel="modulepreload" href="./assets/ocr-CCC.js">`;
  const { distDir, nodeModulesUrl } = fakeDist({ html });
  assert.deepEqual(analyzeDist(distDir, { nodeModulesUrl, skipAssets: false }).problems, ['assets/ocr-CCC.js is loaded by dist/index.html']);
});

test('a build without any ocr chunk fails', () => {
  const { distDir, nodeModulesUrl } = fakeDist({ main: 'console.log(1);' });
  fs.rmSync(path.join(distDir, 'assets/ocr-CCC.js'));
  const result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.deepEqual(result.problems, ['no ocr chunk (assets/ocr-*.js) in dist: the OCR module was not built']);
});

test('engine files that are missing, extra or altered fail', () => {
  const { distDir, nodeModulesUrl } = fakeDist();
  const { files } = describeOcrAssets(nodeModulesUrl);
  fs.rmSync(path.join(distDir, files[0].fileName));
  let result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /dist\/ocr\/ differs from scripts\/ocr-assets\.mjs/);

  fs.writeFileSync(path.join(distDir, files[0].fileName), '// not the worker\n');
  result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.deepEqual(result.problems, [`${files[0].fileName} differs from its node_modules source`]);

  fs.writeFileSync(path.join(distDir, 'ocr/stray.txt'), 'x');
  result = analyzeDist(distDir, { nodeModulesUrl, skipAssets: false });
  assert.match(result.problems.join('\n'), /ocr\/stray\.txt/);
});

test('ODV_OCR_ASSETS=skip requires the folder to be absent', () => {
  const skipped = fakeDist({ withAssets: false });
  const ok = analyzeDist(skipped.distDir, { nodeModulesUrl: skipped.nodeModulesUrl, skipAssets: true });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.summary.skipAssets, true);
  assert.equal(ok.summary.ocrAssetBytes, 0);

  const copied = fakeDist();
  const bad = analyzeDist(copied.distDir, { nodeModulesUrl: copied.nodeModulesUrl, skipAssets: true });
  assert.deepEqual(bad.problems, ['ODV_OCR_ASSETS=skip but dist/ocr/ contains 4 file(s)']);

  const missing = analyzeDist(skipped.distDir, { nodeModulesUrl: skipped.nodeModulesUrl, skipAssets: false });
  assert.match(missing.problems.join('\n'), /found \[\]/);
});

test('a folder without index.html is reported, not thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-verify-empty-'));
  tempRoots.push(dir);
  const result = analyzeDist(dir, { skipAssets: false });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /index\.html not found/);
});

test('eagerScriptsFromHtml reads script tags and module preloads in either attribute order', () => {
  const html = [
    '<script type="module" src="./assets/a.js"></script>',
    '<link rel="modulepreload" href="/assets/b.js?v=1">',
    '<link href="assets/c.js" rel="modulepreload">',
    '<link rel="stylesheet" href="./assets/style.css">',
    '<script>inline()</script>',
  ].join('');
  assert.deepEqual(eagerScriptsFromHtml(html), ['assets/a.js', 'assets/b.js', 'assets/c.js']);
});

test('importsOfChunk separates static from dynamic imports and resolves relative paths', () => {
  const code = 'import{a}from"./x.js";import b from \'./y.js\';export{c}from"./z.js";import"./w.js";const p=import("./lazy.js");const q=import(\n "../other.js" );';
  const result = importsOfChunk('assets/main.js', code);
  assert.deepEqual(result.staticImports, ['assets/x.js', 'assets/y.js', 'assets/z.js', 'assets/w.js']);
  assert.deepEqual(result.dynamicImports, ['assets/lazy.js', 'other.js']);
});
