// File: scripts/verify-ocr-lazy-chunk.mjs
/**
 * Post-build check: the OCR code is confined to a lazy chunk and the engine files are in place.
 *
 * Runs as the second half of `npm run build` (see package.json), so every build, CI run and
 * scripts/local-ci.ps1 gate performs it. It proves the "off by default" contract at bundle level:
 *
 *  1. Every chunk that mentions tesseract is an `ocr` chunk (`assets/ocr-<hash>.js`), produced
 *     by the `manualChunks` rule in vite.config.js for src/ocr/ and tesseract.js.
 *  2. No ocr chunk is referenced by dist/index.html, and no chunk imports one statically
 *     (`import ... from`, `export ... from`, bare `import "..."`). Only `import("...")` may reach
 *     it, which is exactly what src/utils/ocrLoader.js does after the switch is checked.
 *  3. At least one ocr chunk exists, otherwise the check would pass on a broken build.
 *  4. dist/ocr/ holds exactly the files scripts/ocr-assets.mjs describes, byte for byte, unless
 *     the build ran with ODV_OCR_ASSETS=skip, in which case the folder must be absent.
 *
 * Prints the sizes (whole dist, dist/ocr/, the ocr chunk, the eager scripts) so the cost of the
 * feature is visible in every build log. Exit code 0 on success, 1 with a problem list otherwise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeOcrAssets, isOcrAssetCopySkipped } from './ocr-assets.mjs';

const OCR_MARKER = /tesseract/i;
const OCR_CHUNK_PATTERN = /^assets\/ocr-[^/]+\.js$/;

/**
 * @param {string} dir
 * @returns {Array<string>} dist-relative posix paths of every file below dir.
 */
function listFiles(dir, root = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out.sort();
}

/**
 * @param {string} html
 * @returns {Array<string>} dist-relative paths of scripts and module preloads index.html loads.
 */
export function eagerScriptsFromHtml(html) {
  const refs = [];
  const patterns = [
    /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
    /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']modulepreload["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) refs.push(match[1]);
  }
  return [...new Set(refs.map((ref) => ref.replace(/^\.\//, '').replace(/^\//, '').split('?')[0]))];
}

/**
 * Static and dynamic imports of one chunk, resolved to dist-relative paths.
 *
 * @param {string} chunkPath dist-relative path of the importing chunk.
 * @param {string} code
 * @returns {{ staticImports: Array<string>, dynamicImports: Array<string> }}
 */
export function importsOfChunk(chunkPath, code) {
  const dir = posix.dirname(chunkPath);
  const resolveRef = (ref) => posix.normalize(posix.join(dir, ref));
  const staticImports = new Set();
  const dynamicImports = new Set();
  for (const match of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) dynamicImports.add(resolveRef(match[1]));
  for (const match of code.matchAll(/\b(?:import|export)\b[^;"'()]*?\bfrom\s*["']([^"']+)["']/g)) staticImports.add(resolveRef(match[1]));
  for (const match of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) staticImports.add(resolveRef(match[1]));
  return { staticImports: [...staticImports], dynamicImports: [...dynamicImports] };
}

/**
 * @param {string} distDir
 * @param {Object=} options
 * @param {URL=} options.nodeModulesUrl  node_modules folder the engine files are compared against.
 * @param {boolean=} options.skipAssets  Expect dist/ocr/ to be absent (ODV_OCR_ASSETS=skip).
 * @returns {{ ok: boolean, problems: Array<string>, summary: Object }}
 */
export function analyzeDist(distDir, { nodeModulesUrl = new URL('../node_modules/', import.meta.url), skipAssets = isOcrAssetCopySkipped() } = {}) {
  const problems = [];
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    return { ok: false, problems: [`dist/index.html not found under ${distDir}`], summary: {} };
  }
  const files = listFiles(distDir);
  // Only the bundled chunks under assets/ are scanned: the copied engine files under ocr/ and
  // the public config scripts name tesseract legitimately and are never executed eagerly.
  const jsFiles = files.filter((name) => /^assets\/[^/]+\.m?js$/.test(name));
  const code = new Map(jsFiles.map((name) => [name, readFileSync(join(distDir, name), 'utf8')]));
  const sizes = new Map(files.map((name) => [name, statSync(join(distDir, name)).size]));

  const eager = eagerScriptsFromHtml(readFileSync(indexPath, 'utf8'));
  const ocrChunks = jsFiles.filter((name) => OCR_CHUNK_PATTERN.test(name));
  const mentioning = jsFiles.filter((name) => OCR_MARKER.test(code.get(name)));

  for (const name of mentioning) {
    if (!OCR_CHUNK_PATTERN.test(name)) problems.push(`${name} mentions tesseract but is not an ocr chunk`);
  }
  if (!ocrChunks.length) problems.push('no ocr chunk (assets/ocr-*.js) in dist: the OCR module was not built');
  for (const name of ocrChunks) {
    if (eager.includes(name)) problems.push(`${name} is loaded by dist/index.html`);
    for (const [importer, source] of code) {
      if (importer === name) continue;
      const { staticImports } = importsOfChunk(importer, source);
      if (staticImports.includes(name)) problems.push(`${importer} imports ${name} statically`);
    }
  }

  const { files: expectedFiles } = describeOcrAssets(nodeModulesUrl);
  const present = files.filter((name) => name.startsWith('ocr/'));
  if (skipAssets) {
    if (present.length) problems.push(`ODV_OCR_ASSETS=skip but dist/ocr/ contains ${present.length} file(s)`);
  } else {
    const expectedNames = expectedFiles.map((file) => file.fileName).sort();
    if (JSON.stringify(present) !== JSON.stringify(expectedNames)) {
      problems.push(`dist/ocr/ differs from scripts/ocr-assets.mjs: expected ${JSON.stringify(expectedNames)}, found ${JSON.stringify(present)}`);
    }
    for (const file of expectedFiles) {
      if (!present.includes(file.fileName)) continue;
      const expected = readFileSync(file.sourceUrl);
      const actual = readFileSync(join(distDir, file.fileName));
      if (!expected.equals(actual)) problems.push(`${file.fileName} differs from its node_modules source`);
    }
  }

  const sum = (names) => names.reduce((total, name) => total + (sizes.get(name) || 0), 0);
  const summary = {
    distBytes: sum(files),
    ocrAssetBytes: sum(present),
    ocrChunkBytes: sum(ocrChunks),
    eagerScriptBytes: sum(eager.filter((name) => sizes.has(name))),
    ocrChunks,
    eagerScripts: eager,
    skipAssets,
  };
  return { ok: problems.length === 0, problems, summary };
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function main() {
  const distDir = resolve(process.argv[2] || fileURLToPath(new URL('../dist/', import.meta.url)));
  const { ok, problems, summary } = analyzeDist(distDir);
  console.log('[verify-ocr-lazy-chunk]');
  if (summary.distBytes !== undefined) {
    console.log(`  dist total      ${formatSize(summary.distBytes)}`);
    console.log(`  dist/ocr/       ${formatSize(summary.ocrAssetBytes)}${summary.skipAssets ? ' (ODV_OCR_ASSETS=skip)' : ''}`);
    console.log(`  ocr chunk       ${formatSize(summary.ocrChunkBytes)} ${summary.ocrChunks.join(', ')}`);
    console.log(`  eager scripts   ${formatSize(summary.eagerScriptBytes)} ${summary.eagerScripts.join(', ')}`);
  }
  if (ok) {
    console.log('  OK: OCR code is confined to the lazy ocr chunk and the engine files match their sources');
    process.exitCode = 0;
    return;
  }
  for (const problem of problems) console.error(`  PROBLEM: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
