// File: src/ocr/__tests__/setup.test.js
// @vitest-environment jsdom
/**
 * describeOcrSetup turns the runtime config into engine inputs and reports every configuration
 * problem once: a `languages` array that fell back to the default, entries dropped for their form
 * or because no model exists, and an `assetBaseUrl` ignored for its query, fragment or scheme.
 */
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredOcrEngine, describeOcrSetup } from '../setup.js';

const MANIFEST = Object.freeze({
  root: 'ocr/',
  workerPath: 'ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
  corePath: 'ocr/tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js',
  langPath: 'ocr/tessdata-4.0.0_best_int-0123456789ab/',
  languages: ['swe', 'eng'],
});

function options(extra = {}) {
  return {
    log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
    manifest: MANIFEST,
    moduleUrl: 'https://host.example/app/assets/ocr-Ab12Cd34.js',
    documentBaseUrl: 'https://host.example/app/index.html',
    dev: false,
    ...extra,
  };
}

describe('describeOcrSetup', () => {
  it('uses the defaults silently when nothing but the switch is configured', () => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true } }, opts);
    expect(setup.languages).toEqual(['swe', 'eng']);
    expect(setup.assetUrls.base).toBe('https://host.example/app/ocr/');
    expect(setup.warnings).toEqual([]);
    expect(opts.log.warn).not.toHaveBeenCalled();
  });

  it('warns once when an explicit empty list falls back to the default', () => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, languages: [] } }, opts);
    expect(setup.languages).toEqual(['swe', 'eng']);
    expect(setup.warnings).toEqual([expect.stringMatching(/no usable entry; using the default \["swe","eng"\]/)]);
    expect(opts.log.warn).toHaveBeenCalledTimes(1);
    expect(opts.log.warn.mock.calls[0][0]).toMatch(/^OCR configuration: /);
  });

  it('drops a code with no model, names it, and keeps the rest', () => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, languages: ['sve', 'swe'] } }, opts);
    expect(setup.languages).toEqual(['swe']);
    expect(setup.warnings).toEqual([expect.stringMatching(/no Tesseract model with that code.*\["sve"\]/)]);
  });

  it('reports malformed entries separately from unknown models', () => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, languages: ['swe', 7, 'script/Latin', 'zzz'] } }, opts);
    expect(setup.languages).toEqual(['swe']);
    expect(setup.warnings).toEqual([
      expect.stringMatching(/not a Tesseract language code.*\[7,"script\/Latin"\]/),
      expect.stringMatching(/no Tesseract model with that code.*\["zzz"\]/),
    ]);
    expect(opts.log.warn).toHaveBeenCalledTimes(2);
  });

  it('warns when languages is not an array and when a code is repeated', () => {
    const notArray = describeOcrSetup({ ocr: { enabled: true, languages: 'swe' } }, options());
    expect(notArray.languages).toEqual(['swe', 'eng']);
    expect(notArray.warnings).toEqual([expect.stringMatching(/must be an array of language codes, not string; using the default/)]);

    const repeated = describeOcrSetup({ ocr: { enabled: true, languages: ['swe', 'eng', 'swe'] } }, options());
    expect(repeated.languages).toEqual(['swe', 'eng']);
    expect(repeated.warnings).toEqual([expect.stringMatching(/repeats \["swe"\]; each code is loaded once/)]);
  });

  it('falls back to the default when every configured code is unknown', () => {
    const setup = describeOcrSetup({ ocr: { enabled: true, languages: ['zzz'] } }, options());
    expect(setup.languages).toEqual(['swe', 'eng']);
    expect(setup.warnings).toEqual([
      expect.stringMatching(/no Tesseract model with that code/),
      expect.stringMatching(/left no known language; using the default/),
    ]);
  });

  it.each([
    ['a query string', 'https://cdn.example/ocr?token=x', 'query-or-fragment'],
    ['a fragment', 'https://cdn.example/ocr#v1', 'query-or-fragment'],
    ['a javascript: scheme', 'javascript:alert(1)', 'scheme'],
    ['a data: scheme', 'data:text/javascript,1', 'scheme'],
    ['a scheme hidden behind a line feed', 'java\nscript:alert(1)', 'invalid-characters'],
    ['a NUL character', 'https://cdn.example/\u0000ocr/', 'invalid-characters'],
  ])('ignores an assetBaseUrl with %s and says why', (_label, assetBaseUrl, reason) => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, assetBaseUrl } }, opts);
    expect(setup.assetUrls.base).toBe('https://host.example/app/ocr/');
    expect(setup.warnings).toEqual([expect.stringContaining(`ocr.assetBaseUrl ${JSON.stringify(assetBaseUrl)} ignored (${reason})`)]);
  });

  it('resolves an accepted assetBaseUrl against the page', () => {
    const setup = describeOcrSetup({ ocr: { enabled: true, assetBaseUrl: '/shared/odv-ocr' } }, options());
    expect(setup.assetUrls.base).toBe('https://host.example/shared/odv-ocr/');
    expect(setup.assetUrls.workerPath).toBe('https://host.example/shared/odv-ocr/tesseract-7.0.0-core-7.0.0/worker.min.js');
    expect(setup.warnings).toEqual([]);
  });

  it('fails loudly without a build manifest', () => {
    expect(() => describeOcrSetup({ ocr: { enabled: true } }, options({ manifest: null }))).toThrow(/manifest is missing/);
  });
});

describe('createConfiguredOcrEngine', () => {
  it('hands the resolved languages and URLs to the engine, which starts the injected worker with them', async () => {
    const worker = { recognize: vi.fn(), setParameters: vi.fn(async () => {}), terminate: vi.fn(async () => {}) };
    const createWorker = vi.fn(async () => worker);
    const opts = options();
    const { engine, setup } = createConfiguredOcrEngine(
      { ocr: { enabled: true, languages: ['eng', 'sve'] } },
      { ...opts, createWorker },
    );
    expect(setup.languages).toEqual(['eng']);
    await engine.ensureStarted();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker.mock.calls[0][0]).toEqual(['eng']);
    expect(createWorker.mock.calls[0][2]).toMatchObject({
      workerPath: 'https://host.example/app/ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
      langPath: 'https://host.example/app/ocr/tessdata-4.0.0_best_int-0123456789ab',
      cacheMethod: 'none',
    });
    await engine.terminate();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
