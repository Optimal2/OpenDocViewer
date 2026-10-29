// File: src/ocr/__tests__/assetUrls.test.js
/**
 * resolveOcrAssetUrls turns the build manifest (dist-relative paths) into absolute URLs: next to
 * the application by default (one level above the hashed assets/ folder in production, the dev
 * server root in dev), or under a validated `ocr.assetBaseUrl` with the same folder layout.
 */
import { describe, expect, it } from 'vitest';
import { readOcrAssetManifest, resolveOcrAssetUrls } from '../assetUrls.js';

const MANIFEST = Object.freeze({
  root: 'ocr/',
  workerPath: 'ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
  corePath: 'ocr/tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js',
  langPath: 'ocr/tessdata-4.0.0_best_int-0123456789ab/',
  languages: ['swe', 'eng'],
});

const PROD_MODULE = 'https://host.example/OpenDocViewer/assets/ocr-Ab12Cd34.js';
const DEV_MODULE = 'http://127.0.0.1:5173/src/ocr/assetUrls.js';
const PAGE = 'https://host.example/OpenDocViewer/index.html';

describe('resolveOcrAssetUrls', () => {
  it('locates the folder next to the application in a production build', () => {
    const urls = resolveOcrAssetUrls(MANIFEST, { moduleUrl: PROD_MODULE, documentBaseUrl: PAGE });
    expect(urls).toEqual({
      base: 'https://host.example/OpenDocViewer/ocr/',
      workerPath: 'https://host.example/OpenDocViewer/ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
      corePath: 'https://host.example/OpenDocViewer/ocr/tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js',
      langPath: 'https://host.example/OpenDocViewer/ocr/tessdata-4.0.0_best_int-0123456789ab',
    });
  });

  it('uses the server root in the dev server', () => {
    const urls = resolveOcrAssetUrls(MANIFEST, { moduleUrl: DEV_MODULE, documentBaseUrl: 'http://127.0.0.1:5173/', dev: true });
    expect(urls.base).toBe('http://127.0.0.1:5173/ocr/');
    expect(urls.workerPath).toBe('http://127.0.0.1:5173/ocr/tesseract-7.0.0-core-7.0.0/worker.min.js');
    expect(urls.langPath).toBe('http://127.0.0.1:5173/ocr/tessdata-4.0.0_best_int-0123456789ab');
  });

  it('never leaves a trailing slash on langPath, because tesseract.js appends /<lang>.traineddata.gz', () => {
    const urls = resolveOcrAssetUrls(MANIFEST, { moduleUrl: PROD_MODULE, documentBaseUrl: PAGE });
    expect(urls.langPath.endsWith('/')).toBe(false);
    expect(`${urls.langPath}/swe.traineddata.gz`).toBe('https://host.example/OpenDocViewer/ocr/tessdata-4.0.0_best_int-0123456789ab/swe.traineddata.gz');
  });

  it.each([
    ['an absolute base', 'https://cdn.example/odv-ocr/', 'https://cdn.example/odv-ocr/'],
    ['a protocol-relative base', '//cdn.example/odv-ocr/', 'https://cdn.example/odv-ocr/'],
    ['a root-relative base', '/shared/ocr/', 'https://host.example/shared/ocr/'],
    ['a page-relative base', 'engine/', 'https://host.example/OpenDocViewer/engine/'],
  ])('replaces the ocr/ prefix with %s, resolved against the page', (_label, assetBaseUrl, expectedBase) => {
    const urls = resolveOcrAssetUrls(MANIFEST, { assetBaseUrl, moduleUrl: PROD_MODULE, documentBaseUrl: PAGE });
    expect(urls.base).toBe(expectedBase);
    expect(urls.workerPath).toBe(`${expectedBase}tesseract-7.0.0-core-7.0.0/worker.min.js`);
    expect(urls.corePath).toBe(`${expectedBase}tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js`);
    expect(urls.langPath).toBe(`${expectedBase}tessdata-4.0.0_best_int-0123456789ab`);
  });

  it('ignores the module location when a base is given', () => {
    const fromProd = resolveOcrAssetUrls(MANIFEST, { assetBaseUrl: 'https://cdn.example/x/', moduleUrl: PROD_MODULE, documentBaseUrl: PAGE });
    const fromDev = resolveOcrAssetUrls(MANIFEST, { assetBaseUrl: 'https://cdn.example/x/', moduleUrl: DEV_MODULE, documentBaseUrl: PAGE, dev: true });
    expect(fromDev).toEqual(fromProd);
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a manifest without langPath', { ...MANIFEST, langPath: '' }],
  ])('throws a clear error for %s', (_label, manifest) => {
    expect(() => resolveOcrAssetUrls(manifest, { moduleUrl: PROD_MODULE })).toThrow(/manifest is missing/);
  });

  it('refuses manifest paths outside the root folder', () => {
    expect(() => resolveOcrAssetUrls({ ...MANIFEST, corePath: 'assets/core.js' }, { moduleUrl: PROD_MODULE })).toThrow(/outside ocr\//);
  });
});

describe('readOcrAssetManifest', () => {
  it('returns the manifest the build generated, with every path inside the root', () => {
    const manifest = readOcrAssetManifest();
    expect(manifest).not.toBeNull();
    expect(manifest.root).toBe('ocr/');
    for (const key of ['workerPath', 'corePath', 'langPath']) {
      expect(manifest[key].startsWith('ocr/')).toBe(true);
    }
    expect(manifest.workerPath.endsWith('/worker.min.js')).toBe(true);
    expect(manifest.corePath.endsWith('/tesseract-core-simd-lstm.wasm.js')).toBe(true);
    expect(manifest.langPath.endsWith('/')).toBe(true);
    expect(manifest.languages).toEqual(['swe', 'eng']);
    expect(manifest.versions['tesseract.js']).toBe('7.0.0');
    expect(manifest.versions['tesseract.js-core']).toBe('7.0.0');
  });
});
