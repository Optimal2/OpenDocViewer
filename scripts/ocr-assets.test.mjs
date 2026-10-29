// File: scripts/ocr-assets.test.mjs
/**
 * describeOcrAssets derives the dist/ocr/ layout from the installed packages: versioned folder
 * names for the engine, a content-hashed folder for the language models (one folder for all
 * languages, new URL whenever a model changes) and a manifest the app reads the paths from.
 * Runs against a synthetic node_modules in a temp folder and, once, against the real one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test } from 'vitest';
import {
  OCR_ASSET_ROOT,
  OCR_CORE_FILE,
  OCR_LANGUAGE_VARIANT,
  OCR_SHIPPED_LANGUAGES,
  OCR_WORKER_FILE,
  describeOcrAssets,
  isOcrAssetCopySkipped,
} from './ocr-assets.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a fake node_modules with the four packages. Returns its file: URL (trailing slash).
 * @param {{ tesseract?: string, core?: string, data?: Object<string, string>, models?: Object<string, string> }} [options]
 */
export function fakeNodeModules({ tesseract = '7.0.0', core = '7.0.0', data = {}, models = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-ocr-assets-'));
  tempRoots.push(dir);
  const write = (rel, content) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  write('tesseract.js/package.json', JSON.stringify({ name: 'tesseract.js', version: tesseract }));
  write(`tesseract.js/dist/${OCR_WORKER_FILE}`, '// worker script\n');
  write('tesseract.js-core/package.json', JSON.stringify({ name: 'tesseract.js-core', version: core }));
  write(`tesseract.js-core/${OCR_CORE_FILE}`, '// core wasm.js\n');
  for (const lang of OCR_SHIPPED_LANGUAGES) {
    write(`@tesseract.js-data/${lang}/package.json`, JSON.stringify({ name: `@tesseract.js-data/${lang}`, version: data[lang] || '1.0.0' }));
    write(`@tesseract.js-data/${lang}/${OCR_LANGUAGE_VARIANT}/${lang}.traineddata.gz`, models[lang] || `model ${lang}\n`);
  }
  return pathToFileURL(`${dir}${path.sep}`);
}

test('describes the engine files under versioned folders and the models under a hashed folder', () => {
  const { manifest, files } = describeOcrAssets(fakeNodeModules());

  assert.equal(manifest.root, OCR_ASSET_ROOT);
  assert.equal(manifest.workerPath, `${OCR_ASSET_ROOT}tesseract-7.0.0-core-7.0.0/${OCR_WORKER_FILE}`);
  assert.equal(manifest.corePath, `${OCR_ASSET_ROOT}tesseract-7.0.0-core-7.0.0/${OCR_CORE_FILE}`);
  assert.match(manifest.langPath, new RegExp(`^${OCR_ASSET_ROOT}tessdata-${OCR_LANGUAGE_VARIANT}-[0-9a-f]{12}/$`));
  assert.deepEqual(manifest.languages, [...OCR_SHIPPED_LANGUAGES]);
  assert.deepEqual(manifest.versions, {
    'tesseract.js': '7.0.0',
    'tesseract.js-core': '7.0.0',
    '@tesseract.js-data/swe': '1.0.0',
    '@tesseract.js-data/eng': '1.0.0',
  });

  assert.deepEqual(files.map((file) => file.fileName), [
    manifest.workerPath,
    manifest.corePath,
    `${manifest.langPath}swe.traineddata.gz`,
    `${manifest.langPath}eng.traineddata.gz`,
  ]);
  for (const file of files) {
    assert.ok(fs.existsSync(file.sourceUrl), `source exists: ${file.sourceUrl}`);
    assert.ok(file.fileName.startsWith(OCR_ASSET_ROOT));
  }
});

test('the model folder hash is stable for the same bytes and changes with a model or its version', () => {
  const base = describeOcrAssets(fakeNodeModules()).manifest.langPath;
  assert.equal(describeOcrAssets(fakeNodeModules()).manifest.langPath, base);
  assert.notEqual(describeOcrAssets(fakeNodeModules({ models: { swe: 'other bytes\n' } })).manifest.langPath, base);
  assert.notEqual(describeOcrAssets(fakeNodeModules({ data: { eng: '1.0.1' } })).manifest.langPath, base);
});

test('the engine folder follows the tesseract.js and core versions', () => {
  const { manifest } = describeOcrAssets(fakeNodeModules({ tesseract: '7.1.0', core: '7.0.2' }));
  assert.equal(manifest.workerPath, `${OCR_ASSET_ROOT}tesseract-7.1.0-core-7.0.2/${OCR_WORKER_FILE}`);
  assert.equal(manifest.versions['tesseract.js'], '7.1.0');
});

test('a missing package is an error, not a silent gap', () => {
  const url = fakeNodeModules();
  fs.rmSync(new URL('@tesseract.js-data/eng/', url), { recursive: true, force: true });
  assert.throws(() => describeOcrAssets(url), /ENOENT/);
});

test('ODV_OCR_ASSETS=skip is the only value that leaves the folder out', () => {
  assert.equal(isOcrAssetCopySkipped({}), false);
  assert.equal(isOcrAssetCopySkipped({ ODV_OCR_ASSETS: '' }), false);
  assert.equal(isOcrAssetCopySkipped({ ODV_OCR_ASSETS: 'yes' }), false);
  assert.equal(isOcrAssetCopySkipped({ ODV_OCR_ASSETS: 'copy' }), false);
  assert.equal(isOcrAssetCopySkipped({ ODV_OCR_ASSETS: 'skip' }), true);
  assert.equal(isOcrAssetCopySkipped({ ODV_OCR_ASSETS: ' SKIP ' }), true);
});

test('the installed packages produce the pinned versions', () => {
  const { manifest, files } = describeOcrAssets(new URL('../node_modules/', import.meta.url));
  assert.equal(manifest.versions['tesseract.js'], '7.0.0');
  assert.equal(manifest.versions['tesseract.js-core'], '7.0.0');
  assert.equal(manifest.versions['@tesseract.js-data/swe'], '1.0.0');
  assert.equal(manifest.versions['@tesseract.js-data/eng'], '1.0.0');
  for (const file of files) {
    assert.ok(fs.statSync(file.sourceUrl).size > 1000, `${file.fileName} has content`);
  }
});
