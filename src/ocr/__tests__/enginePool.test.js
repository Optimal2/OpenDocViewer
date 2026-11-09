// File: src/ocr/__tests__/enginePool.test.js
/**
 * The engine pool: engines are created lazily up to the size, the first starts alone and the
 * others wait for it, a caller beyond the size waits for a free engine, a job's control aborts
 * only its own engine (which is replaced lazily), a start-up failure of any engine is the pool's
 * failure and stops further engines, and terminate stops every engine and rejects the waiting.
 * Engines are fakes with the shape of engine.js.
 */
import { describe, expect, it, vi } from 'vitest';
import { createOcrEnginePool } from '../enginePool.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async (rounds = 20) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

/** A fake engine whose start and recognitions are settled by the test. */
function makeEngine(id) {
  const start = deferred();
  const jobs = [];
  let started = false;
  let failure = null;
  const engine = {
    id,
    start,
    jobs,
    setFailure(kind) { failure = { kind, error: new Error(`OCR engine could not start (${kind})`) }; },
    ensureStarted: vi.fn(async () => {
      if (failure) throw failure.error;
      await start.promise;
      started = true;
    }),
    recognize: vi.fn(async (image) => {
      await engine.ensureStarted();
      const job = deferred();
      job.image = image;
      jobs.push(job);
      return job.promise;
    }),
    terminate: vi.fn(async () => {
      started = false;
      for (const job of jobs) job.reject(new Error('OCR engine was terminated'));
    }),
    getFailure: () => failure,
    isStarted: () => started,
  };
  return engine;
}

function makePool(size) {
  const engines = [];
  const createEngine = vi.fn(() => {
    const engine = makeEngine(engines.length);
    engines.push(engine);
    return engine;
  });
  const pool = createOcrEnginePool({ size, createEngine });
  return { pool, engines, createEngine };
}

describe('createOcrEnginePool', () => {
  it('creates nothing until the first recognition, then one engine per concurrent page up to the size', async () => {
    const { pool, engines, createEngine } = makePool(2);
    expect(pool.size).toBe(2);
    expect(createEngine).not.toHaveBeenCalled();
    expect(pool.isStarted()).toBe(false);

    const first = pool.recognize('a');
    const second = pool.recognize('b');
    const third = pool.recognize('c');
    await flush();
    expect(engines).toHaveLength(2);
    expect(pool.engineCount()).toBe(2);
    // The first engine starts alone; the second waits for it before recognising.
    expect(engines[0].ensureStarted).toHaveBeenCalled();
    expect(engines[1].recognize).not.toHaveBeenCalled();
    engines[0].start.resolve();
    engines[1].start.resolve();
    await flush();
    expect(engines[0].jobs.map((job) => job.image)).toEqual(['a']);
    expect(engines[1].jobs.map((job) => job.image)).toEqual(['b']);
    expect(pool.isStarted()).toBe(true);

    // The third page waits for a free engine and takes the one that finishes first.
    engines[1].jobs[0].resolve({ text: 'b', confidence: 90, words: [] });
    await expect(second).resolves.toMatchObject({ text: 'b' });
    await flush();
    expect(engines[1].jobs.map((job) => job.image)).toEqual(['b', 'c']);
    expect(engines).toHaveLength(2);
    engines[0].jobs[0].resolve({ text: 'a', confidence: 90, words: [] });
    engines[1].jobs[1].resolve({ text: 'c', confidence: 90, words: [] });
    await expect(first).resolves.toMatchObject({ text: 'a' });
    await expect(third).resolves.toMatchObject({ text: 'c' });
  });

  it('aborts one recognition through its control by terminating that engine alone, and replaces it lazily', async () => {
    const { pool, engines } = makePool(2);
    const controlA = {};
    const controlB = {};
    const a = pool.recognize('a', controlA);
    const b = pool.recognize('b', controlB);
    await flush();
    engines[0].start.resolve();
    engines[1].start.resolve();
    await flush();
    expect(typeof controlA.abort).toBe('function');

    controlA.abort();
    await expect(a).rejects.toThrow(/terminated/);
    expect(engines[0].terminate).toHaveBeenCalledTimes(1);
    expect(engines[1].terminate).not.toHaveBeenCalled();
    expect(controlA.abort).toBeNull();
    expect(pool.engineCount()).toBe(1);

    // b runs on; a new page gets a fresh engine in the dropped one's place.
    const c = pool.recognize('c');
    await flush();
    expect(engines).toHaveLength(3);
    engines[2].start.resolve();
    await flush();
    engines[1].jobs[0].resolve({ text: 'b', confidence: 90, words: [] });
    engines[2].jobs[0].resolve({ text: 'c', confidence: 90, words: [] });
    await expect(b).resolves.toMatchObject({ text: 'b' });
    await expect(c).resolves.toMatchObject({ text: 'c' });
    expect(controlB.abort).toBeNull();
  });

  it('takes the first engine\'s start-up failure as its own, rejects everything with it and starts no further engine', async () => {
    const { pool, engines, createEngine } = makePool(3);
    const a = pool.recognize('a');
    const b = pool.recognize('b');
    await flush();
    engines[0].setFailure('csp');
    engines[0].start.reject(new Error('OCR engine could not start (csp)'));
    await expect(a).rejects.toThrow(/csp/);
    await expect(b).rejects.toThrow(/csp/);
    expect(pool.getFailure()).toMatchObject({ kind: 'csp' });
    await expect(pool.recognize('c')).rejects.toThrow(/csp/);
    await expect(pool.ensureStarted()).rejects.toThrow(/csp/);
    expect(createEngine).toHaveBeenCalledTimes(2);
  });

  it('terminates every engine and rejects callers waiting for one', async () => {
    const { pool, engines } = makePool(1);
    const a = pool.recognize('a');
    const waiting = pool.recognize('b');
    await flush();
    engines[0].start.resolve();
    await flush();
    await pool.terminate();
    expect(engines[0].terminate).toHaveBeenCalledTimes(1);
    await expect(a).rejects.toThrow(/terminated/);
    await expect(waiting).rejects.toThrow(/terminated/);
    expect(pool.engineCount()).toBe(0);
    expect(pool.isStarted()).toBe(false);

    // The pool is usable again afterwards, with a fresh engine.
    const c = pool.recognize('c');
    await flush();
    expect(engines).toHaveLength(2);
    engines[1].start.resolve();
    await flush();
    engines[1].jobs[0].resolve({ text: 'c', confidence: 90, words: [] });
    await expect(c).resolves.toMatchObject({ text: 'c' });
  });

  it('ensureStarted starts the first engine only', async () => {
    const { pool, engines } = makePool(4);
    const started = pool.ensureStarted();
    await flush();
    expect(engines).toHaveLength(1);
    engines[0].start.resolve();
    await started;
    expect(pool.isStarted()).toBe(true);
    expect(pool.engineCount()).toBe(1);
  });

  it('behaves like one engine for a size of one or less', async () => {
    const { pool, engines } = makePool(0);
    expect(pool.size).toBe(1);
    const a = pool.recognize('a');
    const b = pool.recognize('b');
    await flush();
    expect(engines).toHaveLength(1);
    engines[0].start.resolve();
    await flush();
    expect(engines[0].jobs.map((job) => job.image)).toEqual(['a']);
    engines[0].jobs[0].resolve({ text: 'a', confidence: 90, words: [] });
    await a;
    await flush();
    expect(engines[0].jobs.map((job) => job.image)).toEqual(['a', 'b']);
    engines[0].jobs[1].resolve({ text: 'b', confidence: 90, words: [] });
    await b;
  });

  it('needs an engine factory', () => {
    expect(() => createOcrEnginePool({ size: 2 })).toThrow(/engine factory/);
  });
});
