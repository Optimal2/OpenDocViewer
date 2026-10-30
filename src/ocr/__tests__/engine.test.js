// File: src/ocr/__tests__/engine.test.js
// @vitest-environment jsdom
/**
 * createOcrEngine wraps one tesseract.js worker: created lazily with the self-hosted paths and
 * `cacheMethod: 'none'`, shared by every recognition, and released by terminate(). Start-up
 * failures are made observable even where tesseract.js 7.0.0 stays silent: the WebAssembly probe
 * reports a CSP refusal before any worker exists, the `errorHandler` carries model failures, and
 * the start timeout bounds everything else. tesseract.js itself is replaced by an injected
 * createWorker, so no WebAssembly runs here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OCR_START_TIMEOUT_MS,
  OCR_PAGE_SEGMENTATION_MODE,
  OCR_STARTUP_FAILURE,
  classifyOcrStartupError,
  createOcrEngine,
  flattenOcrWords,
  probeWebAssemblyCompilation,
} from '../engine.js';

const ASSET_URLS = Object.freeze({
  workerPath: 'https://host.example/app/ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
  corePath: 'https://host.example/app/ocr/tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js',
  langPath: 'https://host.example/app/ocr/tessdata-4.0.0_best_int-0123456789ab',
});

// Verbatim from Chromium 152 under the shipped policy (index.html / web.config): note that the
// browser names 'unsafe-eval', although 'wasm-unsafe-eval' alone is enough to allow the engine.
const CSP_MESSAGE = "WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self' 'sha256-VLp8cNctLQHS+quZb8UEJAQpLDhxTlAGTn8HeEru0Zs='\".";
// What tesseract.js 7.0.0 hands to errorHandler for a missing model (worker-script/index.js).
const MODEL_404_MESSAGE = 'Error: Network error while fetching https://host.example/app/ocr/tessdata-4.0.0_best_int-0123456789ab/deu.traineddata.gz. Response code: 404';

function fakeResult() {
  return {
    data: {
      text: 'Hej världen\n',
      confidence: 91.5,
      blocks: [{
        paragraphs: [{
          lines: [{
            words: [
              { text: 'Hej', confidence: 95, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
              { text: ' ', confidence: 0, bbox: { x0: 60, y0: 20, x1: 62, y1: 40 } },
              { text: 'världen', confidence: 88, bbox: { x0: 70, y0: 20, x1: 180, y1: 42 } },
              { text: 'nobox', confidence: 50 },
            ],
          }],
        }],
      }],
    },
  };
}

function makeWorker() {
  return {
    recognize: vi.fn(async () => fakeResult()),
    setParameters: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
  };
}

function makeLog() {
  return { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
}

/** An engine whose WebAssembly probe passes, so only the injected createWorker decides. */
function makeEngine(overrides = {}) {
  return createOcrEngine({
    languages: ['swe', 'eng'],
    assetUrls: ASSET_URLS,
    probeWebAssembly: () => {},
    log: makeLog(),
    ...overrides,
  });
}

describe('createOcrEngine', () => {
  it('validates its inputs', () => {
    expect(() => createOcrEngine({ languages: [], assetUrls: ASSET_URLS, createWorker: vi.fn() })).toThrow(/at least one language/);
    expect(() => createOcrEngine({ languages: ['swe'], assetUrls: { workerPath: 'x' }, createWorker: vi.fn() })).toThrow(/worker, core and language URLs/);
  });

  it('starts the worker lazily, once, with the self-hosted paths, no model cache and an error handler', async () => {
    const worker = makeWorker();
    const createWorker = vi.fn(async () => worker);
    const engine = makeEngine({ createWorker });
    expect(createWorker).not.toHaveBeenCalled();
    expect(engine.isStarted()).toBe(false);

    await engine.recognize('page-1.png');
    await engine.recognize('page-2.png');
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(engine.isStarted()).toBe(true);

    const [languages, oem, options] = createWorker.mock.calls[0];
    expect(languages).toEqual(['swe', 'eng']);
    expect(oem).toBe(1);
    expect(options).toMatchObject({
      workerPath: ASSET_URLS.workerPath,
      corePath: ASSET_URLS.corePath,
      langPath: ASSET_URLS.langPath,
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: true,
    });
    expect(typeof options.logger).toBe('function');
    expect(typeof options.errorHandler).toBe('function');
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.recognize.mock.calls[0][2]).toEqual({ text: true, blocks: true });
  });

  it('switches the worker to automatic page segmentation before the first recognition', async () => {
    const order = [];
    const worker = makeWorker();
    worker.setParameters.mockImplementation(async (params) => { order.push(['setParameters', params]); });
    worker.recognize.mockImplementation(async () => { order.push(['recognize']); return fakeResult(); });
    const engine = makeEngine({ createWorker: vi.fn(async () => worker) });

    await engine.recognize('page-1.png');
    await engine.recognize('page-2.png');

    expect(OCR_PAGE_SEGMENTATION_MODE).toBe('3');
    expect(worker.setParameters).toHaveBeenCalledTimes(1);
    expect(order[0]).toEqual(['setParameters', { tessedit_pageseg_mode: '3' }]);
    expect(order.slice(1)).toEqual([['recognize'], ['recognize']]);
  });

  it('fails the start and terminates the worker when the segmentation mode cannot be set', async () => {
    const worker = makeWorker();
    worker.setParameters.mockRejectedValue(new Error('SetVariable refused'));
    const log = makeLog();
    const engine = makeEngine({ createWorker: vi.fn(async () => worker), log });

    await expect(engine.recognize('page-1.png')).rejects.toThrow(/SetVariable refused/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.recognize).not.toHaveBeenCalled();
    expect(engine.isStarted()).toBe(false);
    expect(engine.getFailure()).toMatchObject({ kind: OCR_STARTUP_FAILURE.UNKNOWN });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('does not let the caller mutate the language order it was created with', async () => {
    const languages = ['swe'];
    const createWorker = vi.fn(async () => makeWorker());
    const engine = makeEngine({ languages, createWorker });
    languages.push('eng');
    await engine.ensureStarted();
    expect(createWorker.mock.calls[0][0]).toEqual(['swe']);
  });

  it('returns text, confidence and the words with boxes, skipping blank words and words without a box', async () => {
    const engine = makeEngine({ createWorker: vi.fn(async () => makeWorker()) });
    const result = await engine.recognize('page.png');
    expect(result.text).toBe('Hej världen\n');
    expect(result.confidence).toBe(91.5);
    expect(result.words).toEqual([
      { text: 'Hej', confidence: 95, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
      { text: 'världen', confidence: 88, bbox: { x0: 70, y0: 20, x1: 180, y1: 42 } },
    ]);
  });

  it('reports a CSP refusal from the WebAssembly probe before any worker is created, once, and stays off', async () => {
    const createWorker = vi.fn(async () => makeWorker());
    const log = makeLog();
    const probeWebAssembly = vi.fn(() => { throw new Error(CSP_MESSAGE); });
    const engine = makeEngine({ createWorker, log, probeWebAssembly });

    await expect(engine.recognize('page.png')).rejects.toThrow(/'unsafe-eval' is not an allowed source/);
    await expect(engine.recognize('page.png')).rejects.toThrow(/'unsafe-eval' is not an allowed source/);
    await expect(engine.ensureStarted()).rejects.toThrow(/'unsafe-eval' is not an allowed source/);

    expect(probeWebAssembly).toHaveBeenCalledTimes(1);
    expect(createWorker).not.toHaveBeenCalled();
    expect(engine.isStarted()).toBe(false);
    expect(engine.getFailure()).toMatchObject({ kind: OCR_STARTUP_FAILURE.CSP });
    expect(log.error).toHaveBeenCalledTimes(1);
    const [message, context] = log.error.mock.calls[0];
    expect(message).toMatch(/could not start/);
    expect(context.kind).toBe('csp');
    expect(context.hint).toMatch(/'wasm-unsafe-eval'/);
    expect(context.hint).toMatch(/script-src/);
  });

  it('rejects when createWorker rejects (a load failure) and names the URLs in the hint', async () => {
    const log = makeLog();
    const engine = makeEngine({ createWorker: vi.fn(async () => { throw new Error('Failed to load TesseractCore'); }), log });
    await expect(engine.ensureStarted()).rejects.toThrow('Failed to load TesseractCore');
    expect(engine.getFailure().kind).toBe(OCR_STARTUP_FAILURE.ASSETS);
    expect(log.error.mock.calls[0][1].hint).toContain(ASSET_URLS.corePath);
    expect(log.error.mock.calls[0][1].hint).toContain(`${ASSET_URLS.langPath}/<lang>.traineddata.gz`);
  });

  it('rejects through errorHandler when tesseract.js never settles createWorker (a missing model)', async () => {
    // tesseract.js 7.0.0 only settles createWorker for `load` failures; a model that is not
    // found reaches the errorHandler and would otherwise leave the start pending forever.
    const createWorker = vi.fn((_langs, _oem, options) => new Promise(() => {
      setTimeout(() => options.errorHandler(MODEL_404_MESSAGE), 0);
    }));
    const log = makeLog();
    const engine = makeEngine({ createWorker, log });
    await expect(engine.ensureStarted()).rejects.toThrow(/deu\.traineddata\.gz. Response code: 404/);
    expect(engine.getFailure().kind).toBe(OCR_STARTUP_FAILURE.ASSETS);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(1);
    await expect(engine.recognize('page.png')).rejects.toThrow(/404/);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('bounds a start that stays silent with the timeout and terminates a worker that arrives late', async () => {
    let resolveLate;
    const lateWorker = makeWorker();
    const createWorker = vi.fn(() => new Promise((resolve) => { resolveLate = resolve; }));
    const log = makeLog();
    const engine = makeEngine({ createWorker, log, startTimeoutMs: 20 });

    await expect(engine.ensureStarted()).rejects.toThrow(/did not start within 20 ms/);
    expect(engine.getFailure().kind).toBe(OCR_STARTUP_FAILURE.TIMEOUT);
    expect(log.error.mock.calls[0][1].kind).toBe('timeout');

    resolveLate(lateWorker);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateWorker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.isStarted()).toBe(false);
  });

  it('uses the 60 s default bound', () => {
    expect(DEFAULT_OCR_START_TIMEOUT_MS).toBe(60000);
  });

  it('terminates the worker, releases the started state and can start again', async () => {
    const workers = [makeWorker(), makeWorker()];
    const createWorker = vi.fn(async () => workers[createWorker.mock.calls.length - 1]);
    const engine = makeEngine({ createWorker });

    await engine.terminate();
    expect(createWorker).not.toHaveBeenCalled();

    await engine.recognize('page.png');
    await engine.terminate();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(engine.isStarted()).toBe(false);

    await engine.recognize('page.png');
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(workers[1].recognize).toHaveBeenCalledTimes(1);
  });

  it('rejects a recognition that is in flight or still starting when terminate() is called', async () => {
    // tesseract.js never settles a job that was in flight when its worker is terminated.
    const worker = makeWorker();
    worker.recognize = vi.fn(() => new Promise(() => {}));
    let resolveStart;
    const createWorker = vi.fn(() => new Promise((resolve) => { resolveStart = resolve; }));
    const engine = makeEngine({ createWorker });

    const starting = engine.recognize('page-1.png');
    await engine.terminate();
    resolveStart(worker);
    await expect(starting).rejects.toThrow(/terminated/);
    expect(worker.recognize).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.getFailure()).toBeNull();

    const second = makeWorker();
    second.recognize = vi.fn(() => new Promise(() => {}));
    createWorker.mockImplementation(async () => second);
    const inFlight = engine.recognize('page-2.png');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.recognize).toHaveBeenCalledTimes(1);
    await engine.terminate();
    await expect(inFlight).rejects.toThrow(/terminated/);
    expect(second.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('probeWebAssemblyCompilation', () => {
  it('passes where WebAssembly compilation is allowed (this test runtime)', () => {
    expect(() => probeWebAssemblyCompilation()).not.toThrow();
  });
});

describe('classifyOcrStartupError', () => {
  it.each([
    [CSP_MESSAGE, OCR_STARTUP_FAILURE.CSP],
    ["Refused to compile or instantiate WebAssembly module because 'wasm-unsafe-eval' is not an allowed source", OCR_STARTUP_FAILURE.CSP],
    ['Failed to load TesseractCore', OCR_STARTUP_FAILURE.ASSETS],
    [MODEL_404_MESSAGE, OCR_STARTUP_FAILURE.ASSETS],
    ['importScripts failed', OCR_STARTUP_FAILURE.ASSETS],
    ['OCR worker did not start within 60000 ms', OCR_STARTUP_FAILURE.TIMEOUT],
    ['something else entirely', OCR_STARTUP_FAILURE.UNKNOWN],
    ['', OCR_STARTUP_FAILURE.UNKNOWN],
  ])('classifies %j as %s', (message, expected) => {
    expect(classifyOcrStartupError(new Error(message))).toBe(expected);
    expect(classifyOcrStartupError(message)).toBe(expected);
  });

  it('copes with non-error values', () => {
    expect(classifyOcrStartupError(null)).toBe(OCR_STARTUP_FAILURE.UNKNOWN);
    expect(classifyOcrStartupError(undefined)).toBe(OCR_STARTUP_FAILURE.UNKNOWN);
    expect(classifyOcrStartupError({ message: CSP_MESSAGE })).toBe(OCR_STARTUP_FAILURE.CSP);
  });
});

describe('flattenOcrWords', () => {
  it('returns an empty list for a result without blocks', () => {
    expect(flattenOcrWords({})).toEqual([]);
    expect(flattenOcrWords(null)).toEqual([]);
    expect(flattenOcrWords({ blocks: [{ paragraphs: null }] })).toEqual([]);
  });
});
