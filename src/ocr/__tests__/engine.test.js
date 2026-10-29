// File: src/ocr/__tests__/engine.test.js
// @vitest-environment jsdom
/**
 * createOcrEngine wraps one tesseract.js worker: created lazily with the self-hosted paths and
 * `cacheMethod: 'none'`, shared by every recognition, classified and remembered on start-up
 * failure (one attempt per session), and released by terminate(). tesseract.js itself is
 * replaced by an injected createWorker so no WebAssembly runs here.
 */
import { describe, expect, it, vi } from 'vitest';
import { OCR_STARTUP_FAILURE, classifyOcrStartupError, createOcrEngine, flattenOcrWords } from '../engine.js';

const ASSET_URLS = Object.freeze({
  workerPath: 'https://host.example/app/ocr/tesseract-7.0.0-core-7.0.0/worker.min.js',
  corePath: 'https://host.example/app/ocr/tesseract-7.0.0-core-7.0.0/tesseract-core-simd-lstm.wasm.js',
  langPath: 'https://host.example/app/ocr/tessdata-4.0.0_best_int-0123456789ab',
});

// Verbatim from Chromium 152 under the shipped policy (index.html / web.config): note that the
// browser names 'unsafe-eval', although 'wasm-unsafe-eval' alone is enough to allow the engine.
const CSP_MESSAGE = "WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self' 'sha256-VLp8cNctLQHS+quZb8UEJAQpLDhxTlAGTn8HeEru0Zs='\".";

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

describe('createOcrEngine', () => {
  it('validates its inputs', () => {
    expect(() => createOcrEngine({ languages: [], assetUrls: ASSET_URLS, createWorker: vi.fn() })).toThrow(/at least one language/);
    expect(() => createOcrEngine({ languages: ['swe'], assetUrls: { workerPath: 'x' }, createWorker: vi.fn() })).toThrow(/worker, core and language URLs/);
  });

  it('starts the worker lazily, once, with the self-hosted paths and no model cache', async () => {
    const worker = makeWorker();
    const createWorker = vi.fn(async () => worker);
    const engine = createOcrEngine({ languages: ['swe', 'eng'], assetUrls: ASSET_URLS, createWorker, log: makeLog() });
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
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.recognize.mock.calls[0][2]).toEqual({ text: true, blocks: true });
  });

  it('does not let the caller mutate the language order it was created with', async () => {
    const languages = ['swe'];
    const createWorker = vi.fn(async () => makeWorker());
    const engine = createOcrEngine({ languages, assetUrls: ASSET_URLS, createWorker, log: makeLog() });
    languages.push('eng');
    await engine.ensureStarted();
    expect(createWorker.mock.calls[0][0]).toEqual(['swe']);
  });

  it('returns text, confidence and the words with boxes, skipping blank words and words without a box', async () => {
    const engine = createOcrEngine({ languages: ['swe'], assetUrls: ASSET_URLS, createWorker: vi.fn(async () => makeWorker()), log: makeLog() });
    const result = await engine.recognize('page.png');
    expect(result.text).toBe('Hej världen\n');
    expect(result.confidence).toBe(91.5);
    expect(result.words).toEqual([
      { text: 'Hej', confidence: 95, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
      { text: 'världen', confidence: 88, bbox: { x0: 70, y0: 20, x1: 180, y1: 42 } },
    ]);
  });

  it('classifies a CSP block, logs the token once and stays off without a second worker', async () => {
    const createWorker = vi.fn(async () => { throw new Error(CSP_MESSAGE); });
    const log = makeLog();
    const engine = createOcrEngine({ languages: ['swe'], assetUrls: ASSET_URLS, createWorker, log });

    await expect(engine.recognize('page.png')).rejects.toThrow(/'unsafe-eval' is not an allowed source/);
    await expect(engine.recognize('page.png')).rejects.toThrow(/'unsafe-eval' is not an allowed source/);
    await expect(engine.ensureStarted()).rejects.toThrow(/'unsafe-eval' is not an allowed source/);

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(engine.isStarted()).toBe(false);
    expect(engine.getFailure()).toMatchObject({ kind: OCR_STARTUP_FAILURE.CSP });
    expect(log.error).toHaveBeenCalledTimes(1);
    const [message, context] = log.error.mock.calls[0];
    expect(message).toMatch(/could not start/);
    expect(context.kind).toBe('csp');
    expect(context.hint).toMatch(/'wasm-unsafe-eval'/);
    expect(context.hint).toMatch(/script-src/);
  });

  it('classifies missing engine files and names the URLs in the hint', async () => {
    const log = makeLog();
    const engine = createOcrEngine({
      languages: ['swe'],
      assetUrls: ASSET_URLS,
      createWorker: vi.fn(async () => { throw new Error('Failed to load TesseractCore'); }),
      log,
    });
    await expect(engine.ensureStarted()).rejects.toThrow();
    expect(engine.getFailure().kind).toBe(OCR_STARTUP_FAILURE.ASSETS);
    expect(log.error.mock.calls[0][1].hint).toContain(ASSET_URLS.corePath);
    expect(log.error.mock.calls[0][1].hint).toContain(`${ASSET_URLS.langPath}/<lang>.traineddata.gz`);
  });

  it('terminates the worker, releases the started state and can start again', async () => {
    const workers = [makeWorker(), makeWorker()];
    const createWorker = vi.fn(async () => workers[createWorker.mock.calls.length - 1]);
    const engine = createOcrEngine({ languages: ['swe'], assetUrls: ASSET_URLS, createWorker, log: makeLog() });

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
});

describe('classifyOcrStartupError', () => {
  it.each([
    [CSP_MESSAGE, OCR_STARTUP_FAILURE.CSP],
    ["Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source", OCR_STARTUP_FAILURE.CSP],
    ['Failed to load TesseractCore', OCR_STARTUP_FAILURE.ASSETS],
    ['Error: Network error while fetching swe.traineddata.gz', OCR_STARTUP_FAILURE.ASSETS],
    ['importScripts failed', OCR_STARTUP_FAILURE.ASSETS],
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
