// File: src/ocr/__tests__/setup.test.js
// @vitest-environment jsdom
/**
 * describeOcrSetup turns the runtime config into engine inputs and reports every configuration
 * problem once: a `languages` array that fell back to the default, entries dropped for their form
 * or because no model exists, and an `assetBaseUrl` ignored for its query, fragment or scheme.
 */
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredOcrEngine, describeOcrSetup, resolveOcrConcurrency } from '../setup.js';

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

  it('warns when languages is neither a preset name nor an array, naming the names, and when a code is repeated', () => {
    const notArray = describeOcrSetup({ ocr: { enabled: true, languages: 'swe' } }, options());
    expect(notArray.languages).toEqual(['swe', 'eng']);
    expect(notArray.warnings).toEqual(['ocr.languages must be one of "auto", "swedish", "english" or an array of language codes, not "swe"; using the default ["swe","eng"]']);
    const notString = describeOcrSetup({ ocr: { enabled: true, languages: 7 } }, options());
    expect(notString.warnings).toEqual([expect.stringMatching(/or an array of language codes, not number; using the default/)]);

    const repeated = describeOcrSetup({ ocr: { enabled: true, languages: ['swe', 'eng', 'swe'] } }, options());
    expect(repeated.languages).toEqual(['swe', 'eng']);
    expect(repeated.warnings).toEqual([expect.stringMatching(/repeats \["swe"\]; each code is loaded once/)]);
  });

  it.each([
    ['swedish', ['swe']],
    ['english', ['eng']],
    ['auto', ['swe', 'eng']],
    [' English ', ['eng']],
  ])('loads exactly the models the name %j stands for, silently', (value, expected) => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, languages: value } }, opts);
    expect(setup.languages).toEqual(expected);
    expect(setup.warnings).toEqual([]);
    expect(opts.log.warn).not.toHaveBeenCalled();
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

  it('gives one plain engine when the automatic choice is one worker (a two-core client) and reports the count', () => {
    const { engine, setup, workerCount } = createConfiguredOcrEngine({ ocr: { enabled: true } }, options({ createWorker: vi.fn(), cores: 2, deviceMemoryGiB: 8 }));
    expect(workerCount).toBe(1);
    expect(setup.workerCount).toBe(1);
    expect(setup.workerPlan).toMatchObject({ workerCount: 1, automatic: true, caps: { cores: 1 } });
    expect(engine).not.toHaveProperty('size');
  });

  it('sizes the pool for the client by default: the plan without a page count, with the loaded languages counted', () => {
    const { engine, setup, workerCount } = createConfiguredOcrEngine({ ocr: { enabled: true, languages: ['swe', 'eng', 'zzz'] } }, options({ createWorker: vi.fn(), cores: 4, deviceMemoryGiB: 1.5 }));
    // Four cores allow three; a quarter of 1.5 GiB over 130 MiB per two-model engine allows two.
    expect(workerCount).toBe(2);
    expect(engine.size).toBe(2);
    expect(setup.workerPlan).toMatchObject({ automatic: true, caps: { cores: 3, memory: 2, pages: null, max: 8 }, inputs: { languageCount: 2, memoryPerWorkerMiB: 130 } });
  });

  it('builds a pool even for a count of one when asked to (the boost control grows it later)', () => {
    const { engine, workerCount } = createConfiguredOcrEngine({ ocr: { enabled: true } }, options({ createWorker: vi.fn(), cores: 2, deviceMemoryGiB: 8, pool: true }));
    expect(workerCount).toBe(1);
    expect(engine.size).toBe(1);
    expect(typeof engine.resize).toBe('function');
    // Anything but the literal true leaves a single engine.
    const single = createConfiguredOcrEngine({ ocr: { enabled: true } }, options({ createWorker: vi.fn(), cores: 2, deviceMemoryGiB: 8, pool: 'yes' }));
    expect(single.engine).not.toHaveProperty('size');
  });

  it('builds a pool of the configured size whose engines each start their own worker', async () => {
    const createWorker = vi.fn(async () => ({ recognize: vi.fn(async () => ({ data: { text: '', blocks: [] } })), terminate: vi.fn(async () => {}) }));
    const { engine, workerCount } = createConfiguredOcrEngine(
      { ocr: { enabled: true, workerCount: 2 } },
      options({ createWorker }),
    );
    expect(workerCount).toBe(2);
    expect(engine.size).toBe(2);
    await Promise.all([engine.recognize('a', {}), engine.recognize('b', {})]);
    expect(createWorker).toHaveBeenCalledTimes(2);
    await engine.terminate();
  });

  it('lets the caller override the worker count (the benchmark compares counts), within the maximum', () => {
    const opts = options({ createWorker: vi.fn() });
    expect(createConfiguredOcrEngine({ ocr: { enabled: true, workerCount: 1 } }, { ...opts, workerCount: 3 }).engine.size).toBe(3);
    expect(createConfiguredOcrEngine({ ocr: { enabled: true, workerCount: 4 } }, { ...opts, workerCount: 1 }).workerCount).toBe(1);
    expect(createConfiguredOcrEngine({ ocr: { enabled: true } }, { ...opts, workerCount: 99 }).workerCount).toBe(8);
    expect(createConfiguredOcrEngine({ ocr: { enabled: true, workerCount: 2 } }, { ...opts, workerCount: 0 }).workerCount).toBe(2);
  });
});

describe('describeOcrSetup worker count', () => {
  it('resolves the automatic count from the given cores and memory without a warning, by default and for 0', () => {
    const opts = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, workerCount: 0 } }, { ...opts, cores: 8, deviceMemoryGiB: 8 });
    // Eight cores, 8 GiB: the cores bind (seven) below the ceiling of eight.
    expect(setup.workerCount).toBe(7);
    expect(setup.warnings).toEqual([]);
    expect(describeOcrSetup({ ocr: { enabled: true } }, { ...opts, cores: 8, deviceMemoryGiB: 8 }).workerCount).toBe(7);
    expect(describeOcrSetup({ ocr: { enabled: true, workerCount: 0 } }, { ...opts, cores: 2, deviceMemoryGiB: 8 }).workerCount).toBe(1);
    // A page count lowers it: three pending pages on the same client give two.
    expect(describeOcrSetup({ ocr: { enabled: true } }, { ...opts, cores: 8, deviceMemoryGiB: 8, pageCount: 3 }).workerCount).toBe(2);
  });

  it('warns once for a rejected value (and chooses automatically) and once for a clamped one', () => {
    const rejected = options();
    const setup = describeOcrSetup({ ocr: { enabled: true, workerCount: '3' } }, { ...rejected, cores: 8, deviceMemoryGiB: 8 });
    expect(setup.workerCount).toBe(7);
    expect(setup.warnings).toEqual(['ocr.workerCount must be an integer (0 for automatic), not "3"; using the automatic choice']);
    expect(rejected.log.warn).toHaveBeenCalledTimes(1);

    const clamped = options();
    const high = describeOcrSetup({ ocr: { enabled: true, workerCount: 12 } }, clamped);
    expect(high.workerCount).toBe(8);
    expect(high.warnings).toEqual(['ocr.workerCount is limited to 8; using 8']);
  });
});

describe('resolveOcrConcurrency', () => {
  const client = { cores: 8, deviceMemoryGiB: 8 };

  it('lowers the pages in flight to what the pending pages warrant, never above the pool', () => {
    const setup = describeOcrSetup({ ocr: { enabled: true } }, { ...options(), ...client });
    expect(setup.workerCount).toBe(7);
    expect(resolveOcrConcurrency(1, setup, { ocr: { enabled: true } }, client)).toBe(1);
    expect(resolveOcrConcurrency(4, setup, { ocr: { enabled: true } }, client)).toBe(2);
    expect(resolveOcrConcurrency(7, setup, { ocr: { enabled: true } }, client)).toBe(4);
    expect(resolveOcrConcurrency(300, setup, { ocr: { enabled: true } }, client)).toBe(7);
    expect(resolveOcrConcurrency(0, setup, { ocr: { enabled: true } }, client)).toBe(7);
  });

  it('returns a manual worker count as it is, whatever is pending', () => {
    const cfg = { ocr: { enabled: true, workerCount: 3 } };
    const setup = describeOcrSetup(cfg, { ...options(), ...client });
    expect(resolveOcrConcurrency(1, setup, cfg, client)).toBe(3);
    expect(resolveOcrConcurrency(300, setup, cfg, client)).toBe(3);
  });

  it('counts the languages the setup loads and never exceeds a smaller pool', () => {
    // The benchmark builds pools of its own size; a pool of two stays at two for many pages.
    const setup = { workerCount: 2, languages: ['swe'] };
    expect(resolveOcrConcurrency(300, setup, { ocr: { enabled: true } }, client)).toBe(2);
    expect(resolveOcrConcurrency(2, setup, { ocr: { enabled: true } }, client)).toBe(1);
    expect(resolveOcrConcurrency(5, { workerCount: 'x' }, { ocr: { enabled: true } }, client)).toBe(1);
  });
});
